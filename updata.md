# Diagnostic history: backend integration review

This review is based on the frontend source and checked-in documentation, not inspection of the deployed backend or its database. Endpoint examples marked **proposal** are not claims that endpoints exist. The repository contains a proposed remote health client, but `AppController` currently uses `LocalHealthRecordRepository` by default. A locally saved scan is not confirmation of backend database storage.

## 1. Existing Backend Capabilities

| Capability | Frontend contract observed | Evidence and limitations |
| --- | --- | --- |
| Register/select vehicle | `POST /api/vehicles/` sends `{vin,vehicle_name,make,model,year}`; `GET /api/vehicles/search/` sends `search` or `vin`, plus pagination. Responses require `{status:true,data:{...}}`. | `lib/services/vehicle_management_api.dart`, `lib/models/vehicle_management.dart`. No authorization header is sent. |
| DTC analysis | `POST /api/analyze/dtc` with `{ "codes": ["P0300"] }`. Response is a direct object or `data` object with `success`, `status`, `title`, `description`, `codes`, `totalFaults`, `faults`. | `lib/services/dtc_analysis_service.dart`. 90-second timeout, no vehicle context or authorization header. Persisting analysis is not part of this API. |
| Generic response analysis | `POST /api/sendcoomend` with `{command,response}` and expected `{status:true,data:{analysis:{...}}}`. | `lib/obd_analysis_api.dart`; this does not store a scan. |
| Health records, client only | `POST`/`GET /api/health/vehicles/{vehicleId}/scans`, `POST /dtcs/observations`, `GET /dtcs`, `POST`/`GET /sensors`, profile and maintenance endpoints. Requests and models are implemented in `lib/data/remote_health_repository.dart`; responses may be direct or wrapped in `data`. Optional bearer token. | This client is not the default repository; deployed availability, ownership enforcement and persistence are not established. `BACKEND_REQUIREMENTS*.md` describes desired behavior, not proof of deployment. |
| Existing local PDF | `DiagnosticReportService` generates a current-session PDF; UI uses `printing`. | No backend report endpoint is needed to render a PDF from a complete retrieved record. Historical PDF and historical analysis UI are not yet implemented. |

The existing scan model contains `id`, `vehicleId`, `mode`, `startedAt`, `completedAt`, `status`, `vin`, `modules`, `rawRecords`, `dtcCodes`, `freezeFrameCodes`, `milOn`, `dtcCount`, `readinessIncomplete`, `unavailable`, `dtcAnalysis`, `dataCoverage`, and other metadata. Sensor readings are currently separate records. `POST /scans` is used both for initial save and subsequent analysis attachment, but idempotent upsert behavior is not confirmed. The client currently uses prefixed local identities such as `vehicle:<id>`, which are not necessarily the raw server vehicle ID.

## 2. Backend Gap Analysis

| Priority | Requirement | Reviewed capability and gap | Status |
| --- | --- | --- | --- |
| P0 | Persist scans for the selected vehicle, with ownership enforcement and server confirmation | `POST /health/vehicles/{id}/scans` is implemented only in an inactive client. Verify availability, raw-ID mapping, authentication, VIN matching and durable storage. Extend this endpoint if it exists; no new route is required if it meets the contract below. | Blocked pending backend verification |
| P0 | Prevent duplicate records and permit analysis attachment | Existing client repeats `POST /scans` for the same scan ID; upsert/duplicate behavior is unknown. Extend existing route or support idempotent `PUT` below. | Requires Modification / verification |
| P0 | Retrieve one vehicle's history and a complete immutable session | Existing client has `GET /scans?limit=`, with no paging cursor or single-record method. `BACKEND_REQUIREMENTS.md` proposes a detail route, but no deployed implementation is confirmed. Extend list and implement detail only if not already available. | Blocked pending verification |
| P0 | Account authorization | Optional health Bearer header exists but frontend has no sign-in/token acquisition flow, and vehicle and analysis clients send no token. Backend must confirm its authentication and ownership model; the frontend cannot establish authorization from the current code. | Blocked |
| P1 | Persist per-scan analysis | DTC API returns analysis but has no record identifier or persistence operation. Existing scan upsert can store `dtcAnalysis` if the backend guarantees a safe conditional update. | Requires Modification / verification |
| P1 | Complete session snapshot | Scans store raw records and codes; sensor readings are separate, while vehicle make/model/year/name are not fields on `DiagnosticScanSession`. Verify whether backend can store a historical snapshot, including readings, without losing raw values or changing past records. | Requires Modification / verification |
| P2 | Vehicle-specific DTC interpretation | Existing analysis request contains codes only. No current request model supports make/model/year, module or freeze-frame context. Preserve code-only analysis unless backend confirms an extension. | Requires Modification if contextual analysis is desired |

## 3. Required API Updates

The following are **proposals**, not verified existing endpoints. Use `/api/health/vehicles/{vehicleId}/scans` if the current server already supports equivalent semantics; do not add duplicate routes. All requests use `Accept: application/json`, `Content-Type: application/json; charset=utf-8`, and, if the confirmed auth system uses it, `Authorization: Bearer <access_token>`. The server must authenticate the user and authorize ownership of `{vehicleId}` for every read and write. Never authorize based solely on VIN supplied by the caller.

### Proposal A: idempotent session upsert

`PUT /api/health/vehicles/{vehicleId}/scans/{scanId}`. Path parameters are nonempty server vehicle ID and client-generated unique session ID. No query parameters. Require stable ID, matching body IDs and normalized 17-character VIN; validate that VIN matches the registered vehicle, timestamps are valid ISO-8601 and scan status is `completed`, `partial`, or `failed`. Required body fields are `id`, `vehicleId`, `vin`, `startedAt`, `mode`, `status`, `readOnly`; `completedAt`, vehicle snapshot, measurements, raw records, DTCs, module information and `dtcAnalysis` are optional and must reflect actually observed data. Analysis is stored separately from raw observations. Validate array sizes and permit absent data without inventing values.

```json
{"id":"scan-123","vehicleId":"veh-123","vin":"1HGCM82633A004352","startedAt":"2026-11-25T10:00:00Z","completedAt":"2026-11-25T10:00:04Z","mode":"dtcScan","status":"completed","readOnly":true,"dtcCodes":["P0300"],"rawRecords":[],"dtcAnalysis":null}
```

Proposed success: `201` on creation, `200` on idempotent repeat/update, with `{ "status": true, "data": { "id": "scan-123", "vehicleId": "veh-123" } }`. Duplicate submissions with the same `(vehicleId, scanId)` and identical content must not create another row. Reject a reused ID with incompatible session identity or mismatched VIN as `409`. To update analysis without overwriting other fields, use a version/ETag and `If-Match` (return `412` on conflict), or an existing atomic analysis update operation. Return `{ "status": false, "messages": [{ "message": "..." }] }` for `400`/`422` invalid payload, `401` unauthenticated, `403` forbidden, `404` unknown vehicle, `409` mismatch/conflict, and `5xx` server failure. A response must mean durable commit; preserve original timestamps and vehicle association on retry.

### Proposal B: paginated vehicle history

`GET /api/health/vehicles/{vehicleId}/scans?limit=20&cursor=<opaque>`. Path: authorized raw vehicle ID. Optional query: `limit` positive integer capped by the server, and opaque `cursor`. No body. Newest first with stable tie-breaking. Example success:

```json
{"status":true,"data":{"results":[{"id":"scan-123","vehicleId":"veh-123","vin":"1HGCM82633A004352","startedAt":"2026-11-25T10:00:00Z","mode":"dtcScan","status":"completed","dtcCodes":["P0300"],"dtcAnalysis":null}],"nextCursor":null,"totalCount":1}}
```

`totalCount` may be omitted if unavailable. Errors use the envelope above: `400` invalid cursor/limit, `401`, `403`, `404`, or `5xx`.

### Proposal C: individual historical record

`GET /api/health/vehicles/{vehicleId}/scans/{scanId}` with no query or body, returning `{ "status": true, "data": <complete stored scan snapshot> }` or `401`, `403`, `404`, `5xx` in the error envelope above. Return the original vehicle snapshot, measured values and raw records, DTCs and previously stored analysis, not current vehicle readings. If existing `GET /scans` already returns complete records and pagination is sufficient, a new detail route is not strictly required.

## 4. Required Database Changes

Actual database schema is unavailable. First inspect existing vehicle, telemetry and diagnostic collections; reuse them if they satisfy the invariants. Only if missing, extend the existing diagnostic store with a session ID, server vehicle foreign key/reference, VIN snapshot, original timestamps, operation/status, raw observations, structured DTCs, optional sensor/module snapshots and versioned analysis. A unique `(vehicle_id, session_id)` constraint and index ordered by `(vehicle_id, completed_at DESC, session_id)` support deduplication and history; protect referential integrity and enforce VIN/vehicle association. A separate DTC table is not necessary if the existing representation already preserves these fields and supports required queries. Migrate existing records only after verifying ownership and identity; do not infer VIN or move ambiguous local records automatically.

## 5. Diagnostic Analysis API Requirements

The implemented code-only analysis request accepts multiple DTCs (client deduplicates and caps at 100). Existing result fields include `success`, `status`, `title`, `description`, `totalFaults`, `codes`, and `faults`, with per-fault descriptions, causes, symptoms, steps, solutions, severity and confidence when supplied. Verify actual availability, language behavior and failure contracts. If contextual analysis is required, extend the existing endpoint with optional make, model, year, VIN only when necessary, ECU, state, freeze-frame and observations; define their privacy and validation semantics. No such context is currently sent. Preserve errors and timeout behavior, keep interpretations distinct from observations, and attach the response to the specific stored session via the confirmed scan update mechanism. A new analysis endpoint is not needed if the existing one can be extended.

## 6. Implementation Status

- **Available in frontend:** vehicle lookup/registration client, code-only DTC analysis, local health repository, current-session PDF generation and printing.
- **Requires Modification / verification:** idempotent scan persistence, VIN/ownership validation, per-session analysis update, snapshot fields and paginated history on the existing health routes.
- **Missing or unverified:** deployed authenticated scan persistence/detail APIs and backend database schema; no claim is made that they are absent from the server.
- **Blocked:** a truthful “saved in backend” confirmation, remote vehicle-specific history/details and persistent analysis until endpoint availability, identity, idempotency and authorization are confirmed. Historical PDF can be implemented after a complete historical record is available; no PDF-generation API is inherently required.
