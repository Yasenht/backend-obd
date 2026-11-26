# Implement Missing Backend APIs and Generate Frontend Integration Documentation

## 1. Review the Backend Requirements File

Thoroughly read and analyze the provided `updata_api.md` file, which contains the backend requirements needed to complete the frontend implementation.

Before making any changes, review the existing backend project, including:

- Existing API endpoints and routes.
- Controllers and service classes.
- Database models, schemas, and relationships.
- Request validation mechanisms.
- Authentication and authorization.
- Existing response structures.
- Error handling mechanisms.
- Vehicle management functionality.
- Diagnostic records and diagnostic history.
- Diagnostic Trouble Code (DTC) analysis services.

The objective is to identify which requirements are already supported and which require additional backend implementation.

## 2. Implement Missing API Endpoints

Compare the requirements documented in `updata_api.md` against the existing backend implementation.

For each requirement:

- If an existing endpoint fully supports the requirement, reuse it without modification.
- If an existing endpoint partially supports the requirement, extend it while maintaining backward compatibility.
- If the required functionality does not exist, implement a new endpoint.
- If database modifications are necessary, create the required migrations.
- Follow the existing backend architecture, coding standards, naming conventions, and project structure.

Do not create duplicate endpoints or duplicate database tables for functionality that already exists.

Implement all genuinely missing backend functionality required to complete the frontend integration.

## 3. Database and Data Integrity Requirements

Ensure that all newly implemented functionality maintains database integrity and security.

- Correctly associate diagnostic records with their corresponding Vehicle ID and VIN.
- Ensure that every vehicle has its own independent diagnostic history.
- Prevent duplicate diagnostic records.
- Preserve existing database records.
- Implement appropriate database relationships, constraints, and indexes.
- Validate all incoming request data.
- Ensure that users can only access vehicles and diagnostic records they are authorized to access.
- Use database transactions where necessary.
- Maintain backward compatibility with the existing database structure.
- Do not delete or overwrite existing data.

## 4. API Response Standardization

Ensure that every relevant API endpoint returns clear, consistent, and predictable responses.

Follow the existing backend response structure and conventions wherever possible.

For each endpoint, provide appropriate responses for all applicable scenarios, including:

- Successful requests.
- Successful record creation.
- Successful record updates.
- Empty results.
- Invalid request data.
- Missing required fields.
- Invalid Vehicle ID or VIN.
- Record not found.
- Authentication failure.
- Authorization failure.
- Duplicate records.
- Database errors.
- External API failures.
- Internal server errors.

Use appropriate HTTP status codes, including:

| HTTP Status Code | Description |
|---|---|
| 200 | Successful request |
| 201 | Resource successfully created |
| 400 | Invalid request |
| 401 | Authentication required |
| 403 | Access denied |
| 404 | Resource not found |
| 409 | Duplicate record or resource conflict |
| 422 | Validation failed, if supported by the existing framework |
| 429 | Too many requests |
| 500 | Internal server error |
| 502 | External service failure |
| 503 | Service temporarily unavailable |

Only use status codes that are appropriate for the actual endpoint behavior.

## 5. Create Frontend API Integration Documentation

After implementing and testing the required backend functionality, create a new Markdown file in the project root directory named exactly:

`frontend_api_responses.md`

This file will be provided to the frontend developer or frontend coding agent to complete the application integration.

The documentation must contain all relevant existing, newly created, and modified endpoints required by the frontend.

For every endpoint, include the following information:

### Endpoint Information

- Endpoint name.
- Endpoint description and purpose.
- Complete endpoint URL or relative path.
- HTTP method.
- Authentication requirements.
- Required permissions.
- Required request headers.
- Content type.
- Path parameters.
- Query parameters.
- Request body.
- Required and optional fields.
- Field names and data types.
- Validation rules.
- Default values, when applicable.

### Request Examples

Provide complete and valid examples of API requests, including:

- cURL request examples.
- JSON request bodies.
- Authentication header examples using placeholder tokens.
- Query parameter examples.
- Pagination and filtering examples, when applicable.

### Successful Response Examples

Provide the actual JSON response structure returned by the implemented endpoint for every applicable successful scenario.

Include:

- HTTP status code.
- Complete JSON response body.
- Returned data structure.
- Field names and data types.
- Nullable fields.
- Nested objects and arrays.
- Pagination metadata, when applicable.
- Empty result responses, when applicable.

### Failure Response Examples

Provide the actual JSON response structure returned by the implemented endpoint for every applicable failure scenario.

For each failure response, include:

- HTTP status code.
- Error code, if available.
- Error message.
- Complete JSON response body.
- Field-level validation errors, when applicable.
- Explanation of what causes the error.
- Recommended frontend handling behavior.

## 6. Frontend Integration Instructions

For each endpoint, provide clear instructions explaining how the frontend should integrate with it.

Document:

- When the endpoint should be called.
- Which data must be collected before sending the request.
- How to construct the request payload.
- How to process the successful response.
- How to extract the returned data.
- How to handle loading states.
- How to handle empty responses.
- How to display validation errors.
- How to handle failed requests.
- When retrying a request is appropriate.
- How to prevent duplicate submissions.
- When to refresh the frontend data.
- Any dependencies between endpoints.

For workflows involving multiple endpoints, document the correct execution order.

## 7. Required Documentation Structure

Organize `frontend_api_responses.md` into the following sections:

1. API Overview.
2. Base URL and Environment Configuration.
3. Authentication and Authorization.
4. Existing Reusable Endpoints.
5. Newly Implemented Endpoints.
6. Modified Endpoints.
7. Vehicle Management APIs.
8. Diagnostic Record Storage APIs.
9. Vehicle Diagnostic History APIs.
10. Diagnostic Record Details APIs.
11. Diagnostic Trouble Code Analysis APIs.
12. Successful Response Examples.
13. Failure Response Examples.
14. Validation Rules.
15. Frontend Integration Workflows.
16. Pagination and Filtering.
17. Error Handling Guidelines.
18. Testing Results.
19. Known Limitations and Remaining Requirements.

Include only sections relevant to the actual implemented functionality.

## 8. Documentation Accuracy Requirements

**This is a critical requirement.**

The documentation must reflect the actual backend implementation, not hypothetical or proposed API structures.

- Do not invent endpoints.
- Do not invent request fields.
- Do not invent response fields.
- Do not provide response examples that differ from the actual backend responses.
- Verify all endpoint paths and HTTP methods.
- Verify all request and response structures.
- Verify field names, data types, and nullability.
- Clearly distinguish verified responses from any examples that could not be tested.
- Clearly identify any functionality that remains incomplete or blocked.
- Never include real authentication tokens, passwords, API keys, or sensitive user information.

The frontend developer must be able to use this documentation directly without guessing how the backend behaves.

## 9. Testing and Validation

Before completing the task, test all newly implemented and modified endpoints.

Verify:

- Successful API requests.
- Failed API requests.
- Request validation.
- Authentication and authorization.
- Database storage and retrieval.
- Vehicle ID and VIN associations.
- Vehicle-specific diagnostic history.
- Diagnostic record details.
- DTC analysis integration.
- Duplicate record prevention.
- Empty result handling.
- Database integrity.
- Backward compatibility.
- Existing endpoint functionality.

Run the available automated tests, integration tests, linting, and build validation.

Whenever possible, capture actual API responses from the test environment and use them in `frontend_api_responses.md`.

Do not claim that an endpoint has been successfully tested unless the test was actually executed and passed.

## 10. Important Implementation Rules

- Implement the required functionality directly within the existing backend project.
- Add missing features without removing existing functionality.
- Do not rebuild the backend from scratch.
- Do not modify unrelated functionality.
- Do not remove existing endpoints.
- Do not introduce breaking changes to existing API contracts.
- Reuse existing services, controllers, models, and middleware.
- Avoid unnecessary dependencies.
- Do not use mock responses as a replacement for real backend functionality.
- Do not stop after analyzing the requirements; implement all missing functionality that can be completed.
- Document any remaining blockers and explain what is required to resolve them.

## 11. Final Deliverables

After completing the implementation, provide:

- A summary of the backend requirements reviewed.
- A list of existing API endpoints reused.
- A list of newly implemented API endpoints.
- A list of modified API endpoints.
- A list of newly created and modified files.
- A summary of database changes and migrations.
- Test execution results.
- Any remaining limitations or unresolved requirements.
- The completed `frontend_api_responses.md` file, ready to be shared with the frontend developer.

## Final Objective

Complete all missing backend functionality described in `updata_api.md` while preserving the existing backend architecture and functionality.

Deliver a fully documented and tested API integration contract containing the actual request structures, successful responses, failure responses, validation rules, and integration instructions required by the frontend.

The final `frontend_api_responses.md` file must provide the frontend developer with everything necessary to complete the integration without making assumptions or requesting unnecessary clarification about the backend API.

---

# Frontend integration contract (backend implementation)

The preceding text is the original task request, retained for reference. This section describes the backend implementation in this workspace as of 2026-11-26. It does not claim the changes are deployed. Examples use fictional data; IDs and timestamps must be replaced with values returned by the server. API responses may also include `metrics`, which vary per request.

## API overview, configuration and access

The deployed base URL used by the frontend is `https://backend-obd.onrender.com/api`; local deployments use their configured host and port with the `/api` prefix. Send `Accept: application/json` and, for JSON bodies, `Content-Type: application/json`. URL-encode each path parameter, especially identities such as `vehicle:veh_123`.

**All routes described here are currently public by explicit request.** They do not require or verify JWTs and do not enforce account ownership. Anyone who knows or discovers an identifier can access or modify health records. The optional frontend bearer header does not establish authorization. Do not treat this as a production-ready private history service. `/auth/me` currently returns anonymous data; login and refresh endpoints exist but their tokens are not used to protect these routes.

Success responses generally use `{ "status": true, "data": ... }`; failures normally have `{ "status": false, "messages": [{ "message": "...", "code": "...", "field": "..." }] }`. `code` and `field` are not always present. Validation errors are HTTP 400 and their issue objects are produced by the validator. The server may include request metrics. Do not assume that every external service failure produces the same HTTP status or error code.

## Vehicle management: existing routes

`POST /vehicles/` registers a vehicle. Required: `vin` (17 characters, letters I/O/Q excluded) and nonblank `vehicle_name` (distinctive display name). Optional: `make` and `model` (nonblank strings up to 120 characters), `year` (integer 1886–3000). Strings are trimmed; VIN is uppercased. A successful response is 201 with the saved vehicle under `data`, including Mongo `_id`, public `id`, `vin`, `vehicle_name`, optional vehicle details and timestamps. Repeated VINs may return 409. The response's `id` is the preferred public ID.

```sh
curl -X POST "$BASE_URL/vehicles/" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"vin":"1HGCM82633A004352","vehicle_name":"My car","make":"Honda","model":"Accord","year":2020}'
```

`GET /vehicles/search/?vin=1HGCM82633A004352&offset=0&limit=20&includeTotalCount=true` searches by exact VIN. Alternatively use `search` (or `q`/`query`) for a partial VIN/name, or `vehicle_name` for a partial name. At least one search term is required. `offset` defaults to 0, `limit` to 20 (1–100); response `data.results` is an array and `data.totalCount` is supplied when requested. `GET /vehicles/` is the same search handler. Empty searches return 400. `GET /vehicles/{id}/` returns `data.vehicle` and, if available, `data.latestTelemetry`; an unknown vehicle returns 404.

`POST /vehicles/{id}/telemetry/` accepts finite `speed` (0–400), `batteryVoltage` (0–60) and optional `recordedAt` date and returns the telemetry document with HTTP 201. `GET /vehicles/{id}/telemetry/?offset=0&limit=20&includeTotalCount=true` returns `data.results` and optionally `totalCount`. Telemetry is separate from health sensor readings.

## Diagnostic scan storage and history

Existing routes are `POST /health/vehicles/{vehicleId}/scans`, `PUT /health/vehicles/{vehicleId}/scans/{scanId}`, `GET /health/vehicles/{vehicleId}/scans` and `GET /health/vehicles/{vehicleId}/scans/{scanId}`. Both writes accept a complete scan. A `POST` repeated with the same vehicle and scan ID updates that scan; the PUT path ID must match body `id`. Both currently return 201, including updates. The unique Mongo index on `(vehicleKey, scanId)` prevents duplicate rows; concurrent first submissions can receive 409 `SCAN_CONFLICT`. Reusing a scan ID with a different `startedAt` or conflicting non-null VIN returns 409 `SCAN_ID_CONFLICT`.

Registered public IDs (`veh_...` or `vehicle:veh_...`) must exist when writing scans. When a VIN is supplied in the scan or `vehicleSnapshot`, it must match that vehicle or the server returns 409 `VIN_MISMATCH`. The API also retains legacy local profile identities (`vin:`, `profile:`, `adapter:` and others); those are not proof of a registered vehicle or ownership. A body `vehicleId`, when provided, must match the path value as text. No VIN is inferred for a scan if absent.

Required body fields: `id` (string, 1–120), `mode` (`firstConnection`, `dtcScan`, `freezeFrame`, `liveData`, `manual`, `other`), `startedAt` (date), `status` (`completed`, `partial`, `failed`), and `readOnly` (boolean). `vehicleId` and VIN are optional for backward compatibility. `completedAt` may be null or absent and cannot precede `startedAt`; future timestamps beyond five minutes are rejected. First-connection, DTC and freeze-frame scans must be read-only. Raw records containing modifying commands are rejected. Optional arrays include `modules` (maximum 100), `rawRecords` (5000), `dtcCodes` and `freezeFrameCodes` (500 each), `readinessIncomplete` and `unavailable` (100 each). `milOn` is boolean or null; when omitted the current implementation defaults it to false. `dtcCount` is an optional non-negative integer or null. Optional `dtcAnalysis` stores the provided analysis, `dataCoverage` is 0–1, and `notes`, `protocol`, and `adapterName` are strings. Each raw record requires `id`, `command`, `rawResponse`, `recordedAt`, `source` and `quality`.

New optional snapshot fields: `vehicleSnapshot` is null or an object with optional `vin`, `vehicle_name`, `make`, `model`, `year`; `sensorReadings` is an array of up to 5,000 objects, each requiring a string `key` and numeric `value`, with optional `unit` and `recordedAt`. These are supplied by the caller and are not filled from current vehicle data. Existing clients need not send them. Independently stored sensor readings are not automatically embedded in a scan. Snapshot values are not authenticated or verified as measured values.

```sh
curl -X PUT "$BASE_URL/health/vehicles/vehicle%3Aveh_123/scans/scan-123" \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"id":"scan-123","vehicleId":"vehicle:veh_123","vin":"1HGCM82633A004352","startedAt":"2026-11-25T10:00:00Z","completedAt":"2026-11-25T10:00:04Z","mode":"dtcScan","status":"completed","readOnly":true,"milOn":null,"dtcCodes":["P0300"],"rawRecords":[],"dtcAnalysis":null}'
```

The example is a valid request shape; replace `veh_123` with a registered vehicle whose VIN matches. A successful response contains the saved scan document as `data`, including `id`, `vehicleId` if supplied, `vehicleKey`, `scanId`, observations, `createdAt`, and `updatedAt`. Server defaults and Mongo `_id` may also be present. GET detail returns the same stored document with 200; missing profile or scan returns 404. `GET .../scans?limit=20&offset=0` returns `data.results` and the same array in `data.scans`, plus `count` and `totalCount`. It accepts `mode`, `from`, `to`, `limit` (default 100, maximum 500), and `offset` (default 0); ordering is completed time, start time and Mongo ID descending. An existing profile with no scans returns empty arrays and zero counts. Cursor pagination is not implemented.

### Conditional analysis attachment: new route

`PATCH /health/vehicles/{vehicleId}/scans/{scanId}/analysis` updates only `dtcAnalysis`. First GET the scan, then pass its exact `data.updatedAt` ISO timestamp as `If-Match` (optionally enclosed in double quotes). Body is `{ "dtcAnalysis": <object-or-null> }`; the JSON representation is limited to 262,144 characters. On 200, `data` is the updated scan, including the new `updatedAt`; raw records and snapshots remain intact. Missing/invalid `If-Match` returns 400 `INVALID_IF_MATCH`, invalid body returns 400 `INVALID_ANALYSIS`, an oversized analysis returns 400 `ANALYSIS_TOO_LARGE`, and missing scan/profile returns 404. A stale timestamp returns 412 `SCAN_VERSION_MISMATCH`; fetch the latest scan and ask the user to resolve the conflict before retrying. This guard applies to this PATCH; legacy full POST/PUT updates still replace submitted scan fields and are not protected by `If-Match`.

```sh
curl -X PATCH "$BASE_URL/health/vehicles/vehicle%3Aveh_123/scans/scan-123/analysis" \
  -H 'Content-Type: application/json' -H 'If-Match: 2026-11-25T10:00:05.000Z' \
  -d '{"dtcAnalysis":{"success":true,"faults":[]}}'
```

For example, a stale update produces a 412 response whose core fields are:

```json
{"status":false,"messages":[{"message":"The scan has changed. Reload it before saving analysis.","code":"SCAN_VERSION_MISMATCH"}]}
```

The response can additionally contain `metrics`. `GET` and `PATCH` are public and must not be relied on for privacy or ownership enforcement.

## DTC analysis and related existing health APIs

`POST /analyze/dtc` takes `{ "codes": ["P0300"] }` (maximum 100 strings, maximum 100 characters each). The server trims, uppercases and deduplicates; valid codes match `[PBCU][0-9A-F]{4}`. The 200 `data` contains `success`, `codes`, `status`, `title`, `description`, `totalFaults`, and `faults`. Each invalid code or failed Gemini request produces an individual `{code,success:false,error}` fault, while the top-level `success` remains true. Empty codes return a healthy-shaped response; absence of codes is not proof that a vehicle is fault-free. The endpoint does not save a scan or accept vehicle-specific context. Live Gemini output and availability were not tested here; configuring `GEMINI_API_KEY` and the model is required for actual AI analysis. Call this after saving the scan, then conditionally attach its complete returned `data` with the PATCH route.

```sh
curl -X POST "$BASE_URL/analyze/dtc" -H 'Content-Type: application/json' -d '{"codes":["P0300"]}'
```

`POST /sendcoomend` (spelling is intentional) accepts `{ "command": "010C", "response": "41 0C 1A F8" }`. Successful responses wrap `data.success`, `data.command`, `data.rawResponse`, and `data.analysis`; the latter combines parsed values and Gemini output. It requires the external Gemini service and was not live-tested. A service exception currently becomes a server error; no 502 guarantee is made.

The existing remote-health client also uses these routes, all under `/health/vehicles/{vehicleId}`: `GET /profile`, `PUT /profile`, `POST /migrate`, `DELETE` the vehicle health data, `POST /dtcs/observations`, `GET /dtcs`, `POST`/`GET /sensors`, `GET /maintenance`, and `PUT`/`DELETE /maintenance/{recordId}`. `GET /health/vehicles/profiles` lists profiles. The observations endpoint requires a previously saved scan and accepts `scanId`, `codes`, `observedAt`, `source`, optional `ecu`, `protocol`, `raw`, `freezeFrameCodes`, and `state`; it returns updated DTC records. Sensors accept `{readings:[...]}`; reads accept `key`, `since`, and `limit`, and return `data.results`. Maintenance writes accept the full client record. Deletes may return HTTP 204 with no JSON body. See [FRONTEND_API_REVIEW.md](FRONTEND_API_REVIEW.md) and the corresponding schemas in `models/health.ts` for full existing health model fields; these routes have not all been retested in this change.

## Frontend workflow and error handling

1. Collect and register or select a vehicle; retain its returned public ID. Use a stable client-generated scan ID and a consistent health identity, such as `vehicle:<public-id>`.
2. Save the observed scan with POST or PUT, and consider it remotely saved only after a successful response. Disable repeat submissions while a request is in flight. Retry a failed first write with the same ID; on 409 fetch the record rather than creating a new ID blindly.
3. Analyze decoded DTCs; retain per-code failures. GET the saved scan and PATCH its analysis using `updatedAt`. On 412 reload and resolve conflicts. Refresh history after successful writes.
4. Display an empty state when `results` is empty, loading while requests are pending, and server-provided validation messages for 400/409/422. Use bounded backoff for transient network/429/5xx failures; do not blindly retry conflicting updates. Never claim a local scan was remotely saved before receiving success.

The review says the shipping app still defaults to `LocalHealthRecordRepository`. The frontend must explicitly configure and use `RemoteHealthRecordRepository`, implement the new PATCH call and its conflict handling, and send optional snapshots if historical vehicle/measurement data is needed. The existing frontend does not currently supply these snapshots or automatically use the new PATCH route.

## Verification and remaining limitations

An isolated MongoDB integration test exercised vehicle registration/search/telemetry, profile updates, repeated scan POST, detail retrieval, null MIL, snapshots, VIN mismatch, unknown registered vehicle, invalid time ordering, conditional analysis update and stale rejection, sensors, DTC observations, and maintenance. The test uses a generated disposable database when `FRONTEND_TEST_DATABASE_URL` is set; it is skipped otherwise. Lint and type checks are reported in the task handoff. No deployed API, live Gemini call, Flutter application, account-authorization behavior, migration conflict, or cursor pagination was verified. Existing legacy full scan updates can overwrite observations, migrations and multi-collection operations are not transactional, and the history API does not enforce authentication, ownership, or immutable records. Deploying the local code and enabling remote storage in the frontend are separate steps.
