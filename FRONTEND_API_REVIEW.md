# Frontend API Review

## Scope and method

This review is derived only from the Flutter source, its tests, and the checked-in project documentation as they exist in this repository. It does not assert that an endpoint is deployed or reachable. Paths below are relative to the configured default base URL unless they are shown as an absolute URL.

The project is a Flutter OBD-II/BLE application. Its main execution path is:

```text
UI screens -> AppController -> repositories/services -> HTTP or BLE
                                      |
                                      +-> local SharedPreferences (default health/history storage)
```

`lib/main.dart` constructs `AppController` with its defaults. Consequently, vehicle registration/search, DTC analysis, and generic OBD-response analysis make real HTTP calls; health-record operations use `LocalHealthRecordRepository` by default and therefore do **not** make HTTP calls in the shipping/default composition. `RemoteHealthRecordRepository` is an injectable, tested client for a future health API.

## Architecture and implemented functionality

| Layer | Primary files | Implemented responsibility |
| --- | --- | --- |
| Application state | `lib/controllers/app_controller.dart`, `lib/controllers/app_scope.dart` | Coordinates BLE connection, command execution, vehicle selection, DTC workflow, history, health records, reporting, UI loading/error state, and disposal. |
| UI | `lib/screens/`, `lib/widgets/` | Five tabs: Home, faults, vehicle health, history, and settings. The UI is Arabic/RTL, with light/dark/system themes. |
| Device integration | `lib/ble_obd_service.dart`, `lib/obd_protocol.dart` | BLE scan/connect/disconnect; text OBD/ELM commands; local parsing of VIN, DTC, MIL/readiness and PIDs. BLE is not an HTTP backend API. |
| Active HTTP services | `lib/services/vehicle_management_api.dart`, `lib/services/dtc_analysis_service.dart`, `lib/obd_analysis_api.dart` | Vehicle management, decoded-DTC analysis, and generic command/response analysis respectively. |
| Health persistence | `lib/data/health_record_repository.dart`, `lib/data/local_health_repository.dart`, `lib/data/remote_health_repository.dart` | Local repository is the default. Remote implementation exposes an HTTP contract but is not instantiated by default. |
| Domain models | `lib/models/vehicle_management.dart`, `lib/models/dtc_analysis.dart`, `lib/models/vehicle_health.dart` | Request serialization and tolerant response parsing. |
| Local persistence/output | `lib/history_repository.dart`, `shared_preferences`, `lib/services/report_service.dart` | Stores recent command history and health data locally; builds/shares a PDF locally. No report-upload HTTP call exists. |

Key user features are BLE device discovery and connection; safe/read-oriented OBD commands; manual terminal; vehicle registration/search; DTC and freeze-frame retrieval; DTC explanation; live PID display; command history; local PDF report generation; health scoring/trends; and maintenance records. ECU commands and local storage must not be mistaken for backend calls.

## Network-wide conventions observed in code

| Client | Default endpoint/base | Headers | Timeout | Authentication |
| --- | --- | --- | --- | --- |
| Vehicle management | `https://backend-obd.onrender.com/api` | `Content-Type: application/json; charset=utf-8`, `Accept: application/json` | 30 seconds | None sent |
| DTC analysis | `https://backend-obd.onrender.com/api/analyze/dtc` | Same JSON/Accept headers | 90 seconds | None sent |
| Generic OBD analysis | `https://backend-obd.onrender.com/api/sendcoomend` | Same JSON/Accept headers | 30 seconds | None sent |
| Remote health (inactive by default) | `https://backend-obd.onrender.com/api` | Same JSON/Accept headers; optional `Authorization: Bearer <trimmed token>` | 30 seconds | Optional config value only |

All HTTP bodies are UTF-8 JSON. IDs placed in remote health/vehicle path segments are URI-encoded. No retry, refresh-token flow, request idempotency key, caching policy, cancellation, or global HTTP interceptor is implemented.

## Active API endpoints

### 1. Vehicle management

Client: `HttpVehicleManagementApi` in `lib/services/vehicle_management_api.dart`; wrapped by `VehicleDetailsRepository`.

The client requires the response envelope below for every successful vehicle request; a 2xx response with `status` not exactly boolean `true` is treated as an error.

```json
{ "status": true, "data": { "...": "..." } }
```

Error messages are read from `messages` (strings or objects with `message`/`msg`) and then `message`.

| Method and path | Request | Expected successful `data` | Actual caller and user function |
| --- | --- | --- | --- |
| `POST /vehicles/` | `{ "vin": "<uppercase 17-char VIN>", "vehicle_name": "<trimmed nonempty name>" }` | Vehicle object: `_id` (or `id`), `vin`, `vehicle_name` (or `vehicleName`), `createdAt`, `updatedAt`. | `AppController.saveVehicleDetails` -> `VehicleDetailsRepository.register`; Home vehicle-details form. A successful record enables DTC diagnostics. |
| `GET /vehicles/search/` | Query always includes `offset` (default `0`), `limit` (default `20`, 1–100), and `includeTotalCount` (default `true`). It includes one or more of `search`, normalized `vin`, or `vehicle_name`. | `{ "results": [Vehicle...], "totalCount": <number optional> }`. A result item uses the Vehicle fields above. | `AppController.searchVehicles` -> repository; Home search UI, then `selectVehicle`. A full valid VIN is sent as `vin`; all other nonempty text as `search`. |
| `POST /vehicles/{vehicleId}/telemetry/` | `{ "speed": <finite number>, "batteryVoltage": <finite number>, "recordedAt": "<UTC ISO-8601>" }`; `recordedAt` is omitted when not supplied. | Telemetry object: `_id`/`id`, `speed`, `batteryVoltage` (or `battery_voltage`), `recordedAt`, `vehicle` (ID or object), `createdAt`, `updatedAt`. | Implemented public API only. No production `AppController`/screen call was found. |
| `GET /vehicles/{vehicleId}/telemetry/` | Query: `offset`, `limit` (1–100), `includeTotalCount`, optional `sort`. | `{ "results": [Telemetry...], "totalCount": <number optional> }`. | Implemented public API only; no production call found. |
| `GET /vehicles/{vehicleId}/` | No body/query. | Either a Vehicle object itself or `{ "vehicle": Vehicle, "latestTelemetry"` (also accepts `latest_telemetry`/`telemetry`) `: Telemetry|null`. | Implemented public API only; no production call found. |

Client-side validation prevents a request for blank vehicle IDs; invalid VINs (anything other than 17 `[A-HJ-NPR-Z0-9]` characters); blank vehicle names; empty searches; invalid offsets; invalid limits; and non-finite telemetry values. A duplicate `409` becomes `VehicleApiException.isConflict`; `404` becomes `isNotFound`; `400` becomes `isValidationError`.

### 2. Decoded DTC analysis

Client: `DtcAnalysisService` in `lib/services/dtc_analysis_service.dart`.

| Method and path | Request | Expected successful response | Call sites and user function |
| --- | --- | --- | --- |
| `POST /analyze/dtc` | `{ "codes": ["P0108", "P0109"] }` | Either the result object directly, or `{ "data": <result> }`. The outer/result map must contain `faults` as a list or a `success` field. The parsed result expects `success: true`, `status`, `title`, `description`, `totalFaults`, `codes`, and `faults`. Each fault can contain `code`, `success`, `error`, `category`, `type`, `nameEn`, `title`, `description`, `system`, `meaning`, `severity`, `severityPercentage`, `severityExplanation`, `possibleCauses`, `possibleSymptoms`, `diagnosticSteps`, `solutions`, `status`, and `confidence`. | `AppController.readDtc` and `readDtcFreezeFrame` call it after local DTC decoding. `generateReportPdf` waits for it or starts it before building a local report. `FaultDetailsScreen` also calls it for a manually entered code. Fault screens display the result. |

Before request, the client trims and uppercases codes, removes duplicates, drops empty strings, and caps the list at 100. It does not validate the DTC pattern beyond those transformations. An empty list is still posted. Per-code failures can be represented by a fault object with `success: false` and `error`; only a top-level `success != true` fails the operation.

### 3. Generic OBD command/response analysis

Client: `ObdAnalysisApi` in `lib/obd_analysis_api.dart`.

| Method and absolute URL | Request | Required successful response | Call sites and user function |
| --- | --- | --- | --- |
| `POST https://backend-obd.onrender.com/api/sendcoomend` | `{ "command": "<normalized OBD command>", "response": "<locally encoded raw OBD response>" }` | `{ "status": true, "data": { "success": true, "analysis": { "...": "..." } } }`. The returned value is the `analysis` map only. | `AppController.executeCommand` starts `_runApiAnalysis` in the background after a successful BLE command. Home's smart-analysis card displays the loading/error/result state. |

The call is skipped for `03`, `DTCS?`, and `DTC?` (those use `/analyze/dtc`); `AT...` setup commands; empty/unencodable responses; and detected OBD error responses. It is fire-and-forget, so it does not delay the BLE command result. `command` is uppercase/trimmed with prompt/newline characters removed; `response` is produced by `ObdParser.toRawObdResponse`, not sent verbatim from BLE.

## Remote health API surface (implemented, but inactive by default)

Client: `RemoteHealthRecordRepository` in `lib/data/remote_health_repository.dart`. `AppController` defaults to `LocalHealthRecordRepository`; use of every row below requires explicit injection of the remote repository and, for protected APIs, a configured bearer token. The default app therefore does not call these endpoints.

For a 2xx response, the client accepts either a direct JSON value or a map containing `data`; it does **not** require/check a success/status field. Collections may be direct arrays or a map with `results`, `items`, or `records`. All list response items are parsed using the listed domain model. `GET profile` and `DELETE vehicle data` explicitly turn `404` into a non-error (`null` and successful no-op respectively).

| Method and path | Request/query | Expected response data and application use |
| --- | --- | --- |
| `GET /health/vehicles/profiles` | None. | List of `VehicleHealthProfile`; public repository method only, not called by `AppController`. Profile keys: `id`, `displayName`, optional `vin/make/model/year/firstScanAt/lastScanAt`, `createdAt`, `updatedAt`, `notes`. |
| `GET /health/vehicles/{vehicleId}/profile` | None. | A profile object or 404. Used by `_ensureHealthProfile` during startup/health refresh. |
| `PUT /health/vehicles/{vehicleId}/profile` | Full `VehicleHealthProfile` JSON. | Any successful JSON/body is accepted; response is ignored. Used to create/update a profile during health loading and after scans. |
| `POST /health/vehicles/{vehicleId}/migrate` | `{ "fromVehicleId": "<old identity>", "targetProfile": <profile or null> }`. | Any successful body. Used when the controller upgrades identity (adapter/profile/VIN to registered vehicle). |
| `DELETE /health/vehicles/{vehicleId}` | No body. | Any successful body or 404. Used by the Health tab's delete-record workflow. |
| `GET /health/vehicles/{vehicleId}/scans?limit={limit}` | `limit` default 100. | List/paged list of `DiagnosticScanSession`; used on health-data load and when finding a just-saved DTC scan to attach analysis. |
| `POST /health/vehicles/{vehicleId}/scans` | Full `DiagnosticScanSession` JSON. | Any successful body. Used to store automatic/normal DTC and freeze-frame scans, and again to overwrite/attach `dtcAnalysis` according to the client assumption. |
| `GET /health/vehicles/{vehicleId}/dtcs` | None. | List of `DtcRecord`; used on health-data load. |
| `POST /health/vehicles/{vehicleId}/dtcs/observations` | `{ "scanId", "codes", "observedAt": "UTC ISO-8601", "source", "ecu", "protocol", "raw", "freezeFrameCodes", "state" }`. | List of updated `DtcRecord` objects; used after scan persistence. |
| `GET /health/vehicles/{vehicleId}/sensors?key=&since=&limit={limit}` | Optional `key`, optional UTC ISO-8601 `since`, `limit` default 2000. | List of `SensorReading`; used on health-data load (with `limit=4000`). |
| `POST /health/vehicles/{vehicleId}/sensors` | `{ "readings": [SensorReading...] }`, grouped into one request per vehicle identity. | Any successful body; used when the buffered live/fixed readings are flushed. |
| `GET /health/vehicles/{vehicleId}/maintenance` | None. | List of `MaintenanceRecord`; used on health-data load. |
| `PUT /health/vehicles/{vehicleId}/maintenance/{recordId}` | Full `MaintenanceRecord` JSON. | Any successful body; used to create/edit a maintenance item and to save repair verification changes. |
| `DELETE /health/vehicles/{vehicleId}/maintenance/{recordId}` | No body. | Any successful body; used by Health tab deletion. |

### Health payload model details

All dates serialized by these models are ISO-8601 strings; controller-created timestamps are UTC. The remote client sends null-valued optional model keys rather than removing them, except for the special-purpose request bodies noted above.

- `DiagnosticScanSession`: `id`, `vehicleId`, `mode`, `startedAt`, `completedAt`, `status`, `readOnly`, `protocol`, `adapterName`, `vin`, `modules`, `rawRecords`, `dtcCodes`, `freezeFrameCodes`, `milOn`, `dtcCount`, `readinessIncomplete`, `unavailable`, `dtcAnalysis`, `dataCoverage`, `notes`. Nested module/raw/unavailable records serialize their own fields. `dtcAnalysis` is the saved full parsed DTC-analysis response.
- `DtcRecord`: `code`, `status`, `firstSeenAt`, `lastSeenAt`, `lastNotReportedAt`, `occurrenceCount`, `scanCount`, `activeInLatestScan`, `source`, `ecu`, `protocol`, `raw`, `freezeFrame`, `description`.
- `SensorReading`: `id`, `vehicleId`, `key`, `label`, `value`, `unit`, `recordedAt`, `source`, `pid`, `quality`, `scanId`, `raw`. On reading it requires nonempty `id`, `vehicleId`, and `key`, plus a numeric `value` and parseable `recordedAt`; otherwise parsing fails.
- `MaintenanceRecord`: `id`, `vehicleId`, `type`, `title`, `description`, `performedAt`, `createdAt`, `odometerKm`, `partsReplaced`, `workshop`, `notes`, `scoreBefore`, `confidenceBefore`, `dtcCodesBefore`, `scanIdBefore`, `verification`. `verification`, if present, includes `verifiedAt`, `outcome`, `scanId`, before/after score/confidence, code lists, and `notes`.

## Error handling behavior

| Client | HTTP/error behavior exposed to UI |
| --- | --- |
| Vehicle management | 30-second timeout, client/network errors, malformed JSON, bad envelope, and non-2xx all become `VehicleApiException`. Server messages are retained. Controller catches it and writes Arabic error text to vehicle registration/search UI state. |
| DTC analysis | Non-2xx produces `DtcAnalysisException` with only HTTP status; timeout, network client exception, and malformed JSON are converted to Arabic messages. A valid JSON result with top-level `success != true` fails with its `message` if present. Controller and manual detail screen display/retry it. |
| Generic OBD analysis | Non-2xx, malformed JSON, `status != true`, `data.success == false`, missing `data`, or missing `analysis` all throw generic `Exception`. The background controller task sets `apiError`; BLE command result/history remains available. |
| Remote health | Non-2xx creates `HealthRepositoryException` with status and message from `messages`, `message`, or `error`; timeout becomes a specific error. Other failures (including malformed/invalid successful data) are wrapped as connection errors. Health UI stores/display errors in `healthError`. A 2xx `{status: false}` is currently accepted unless subsequent model parsing fails. |

## Integration findings and conflicts for backend review

1. **No bearer authentication on currently active APIs.** Vehicle, DTC-analysis, and generic-analysis clients never send `Authorization`. Only the inactive health client has an optional bearer-token configuration. If deployed endpoints require the Bearer authentication described in `BACKEND_REQUIREMENTS*.md`, the default frontend will receive authorization failures and has no login/token-refresh implementation.

2. **The generic endpoint spelling is exactly `sendcoomend`.** `ObdAnalysisApi` and `firmware_patch/README.md` use `/api/sendcoomend` (double `o`); no code uses `/api/sendcommand`. Backend routing must preserve this spelling or the client must be changed in a future implementation task.

3. **Health identity is not a raw server vehicle ID.** After vehicle selection, `AppController` uses `vehicle:<server-id>` as its health identity and the remote client URL-encodes it. It also may use `vin:<VIN>`, `profile:<...>`, or `adapter:<...>`. This conflicts with `BACKEND_REQUIREMENTS2.md`, which says `{vehicleId}` is the server vehicle ID (for example `veh_123`). A backend that accepts only the raw ID will reject URLs such as `/health/vehicles/vehicle%3Aveh_123/...`.

4. **Scan update semantics are unsafe unless POST is an upsert.** The remote client uses `POST /scans` both for initial storage and later to attach `dtcAnalysis` to the same `scan.id`. The checked-in health requirements recommend `PUT /scans/{scanId}` and say a POST compatibility route must upsert by `id`; otherwise the application can create duplicate scans.

5. **Health success-envelope semantics differ from vehicle semantics.** Vehicle endpoints require `{status: true, data: ...}`. The remote health client accepts any 2xx direct/data response and ignores a 2xx `status: false`, while its comments/examples also use string `status: "success"`. Backend should not rely on a failed operation being surfaced through a 2xx envelope to this client.

6. **Vehicle document mismatch: `count` vs `totalCount`.** `BACKEND_REQUIREMENTS2.md` shows search `count`, but the actual client parses only `totalCount`; `docs/vehicle-management.md` and tests use `totalCount`. A server returning only `count` will still render results but frontend total count becomes null.

7. **Vehicle telemetry endpoints are client-complete but product-unwired.** They are covered by unit tests but no production call stores or retrieves telemetry. Current Home live metrics come directly from BLE, and health readings use the health repository. Backend teams should not expect telemetry traffic until a caller is added.

8. **DTC analysis accepts two envelope shapes, generic analysis accepts one.** `/analyze/dtc` can be direct or nested under `data`; `/sendcoomend` requires `status: true -> data -> analysis`. Standardizing a documented envelope would eliminate endpoint-specific handling.

9. **No remote report upload exists.** The UI produces PDF locally. Although `BACKEND_REQUIREMENTS2.md` describes a possible reports endpoint, no source code requests it.

10. **Potential sensitivity exposure.** Raw OBD responses and VIN are sent in requests where relevant and are logged by the controller in debug messages. The analysis documents do not implement redaction, token storage, or transport-level certificate pinning; all configured defaults are HTTPS URLs.

## Verification evidence

- `test/vehicle_management_api_test.dart` verifies HTTP methods, URL construction, serialized vehicle/telemetry payloads, validation, response envelope behavior, and conflict parsing.
- `test/remote_health_repository_test.dart` verifies bearer-header injection, profile 404 handling, scan and DTC request paths/payloads, grouped sensor writes, errors, and delete-404 behavior.
- `test/dtc_analysis_test.dart` verifies parsing of the DTC response model.

No code was changed as part of this review other than adding this documentation file.
