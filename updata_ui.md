# Frontend handoff: vehicle diagnostic logging

This document continues the existing vehicle and DTC integration. It describes
the backend code in this workspace; it does not confirm that these changes have
been deployed to Render. Use the existing vehicle API, DTC service, health
models, and `RemoteHealthRecordRepository` where possible. Keep local history
working while adding remote persistence.

## Configuration and access

- Default frontend base URL: `https://backend-obd.onrender.com/api`. Make the
  base URL configurable for development, staging, and production.
- JSON requests use `Content-Type: application/json; charset=utf-8` and
  `Accept: application/json`.
- These endpoints are currently public. They do not require JWT verification or
  enforce account ownership. A bearer header does not make the data private.
  Do not present remote health history as protected per-user storage.
- The current frontend review says `AppController` defaults to
  `LocalHealthRecordRepository`. Explicitly configure the remote repository if
  remote storage is desired; implementing a backend API alone does not switch
  the app from local storage. The Flutter source was not available in this
  workspace to verify or change that composition.

Responses normally have `{ "status": true, "data": ... }`. For non-2xx
responses, display `messages[*].message` where available. Message objects may
also contain `code` and `field`. `metrics` may appear and its values vary.
Some existing delete endpoints return `204` with no JSON body. Do not infer
success from a completed local save or an HTTP 2xx response whose JSON reports
`status: false`.

## Workflow

1. Register or select a vehicle using the existing vehicle service. Retain its
   public `data.id` (`veh_...`) and VIN. The existing frontend uses the health
   identity `vehicle:<public-id>`; keep that identity consistent in the path
   and scan body. URL-encode it as one path segment, for example
   `vehicle%3Aveh_123`. Encode the scan ID as a separate path segment too.
2. Create one stable, unique scan ID when a scan starts. Record the actual
   start/completion times, readings, raw responses, and locally decoded codes.
   Keep the same ID and original `startedAt` on retries.
3. Save the complete scan with the existing POST endpoint or the PUT endpoint
   below. Show a pending/syncing state until the server confirms the save; show
   a separate error if remote saving fails. A successful local write alone
   must not be labelled as a server save.
4. Call the existing DTC analysis endpoint when appropriate. Check each fault's
   `success` field as well as the top-level result. Fetch the saved scan and
   attach the analysis with the conditional PATCH endpoint; do not use a second
   full POST just to attach analysis when the PATCH is available.
5. Refresh the selected vehicle's history after a confirmed save or analysis
   update. Fetch scan details when opening a historical entry. Render saved
   observations and saved analysis, not the current live readings, in a
   historical view.

## Vehicle registration

`POST /vehicles/` accepts the existing fields `vin` and `vehicle_name`, plus
optional `make`, `model`, and integer `year`. `vehicle_name` is the user's
distinctive name; `make` and `model` describe the vehicle. The VIN must be 17
characters and cannot contain I, O, or Q. Example request:

```json
{
  "vin": "1HGCM82633A004352",
  "vehicle_name": "My car",
  "make": "Honda",
  "model": "Accord",
  "year": 2020
}
```

On `201`, read `data.id`, `data.vin`, `data.vehicle_name`, and the optional
vehicle details. Existing clients may omit the new details. Search using
`GET /vehicles/search/?vin=...&offset=0&limit=20&includeTotalCount=true`, or
use the `search` query parameter; parse `data.results` and `data.totalCount`.
Handle a duplicate registration as a `409` conflict, not a new vehicle.

## Save a diagnostic scan

Use either:

- `POST /health/vehicles/{vehicleId}/scans`
- `PUT /health/vehicles/{vehicleId}/scans/{scanId}`

Both accept a complete scan and currently return `201` for both creation and
update. The response `data` is the stored scan. `PUT` requires the body `id`
to match `{scanId}`. A repeated POST with the same vehicle and scan ID updates
the existing record. The database has a unique `(vehicleKey, scanId)` index;
a concurrent first write may receive `409 SCAN_CONFLICT`. Treat full POST/PUT
as whole-record updates: they are not protected by `If-Match` and can replace
observations. Preserve the complete existing session when using them.

Example JSON, with fictional IDs. Replace them with the selected vehicle and
real session data; the VIN must match the registered vehicle:

```json
{
  "id": "scan-123",
  "vehicleId": "vehicle:veh_123",
  "vin": "1HGCM82633A004352",
  "mode": "dtcScan",
  "startedAt": "2026-11-25T10:00:00Z",
  "completedAt": "2026-11-25T10:00:04Z",
  "status": "completed",
  "readOnly": true,
  "protocol": "CAN",
  "adapterName": "OBD adapter",
  "vehicleSnapshot": {
    "vin": "1HGCM82633A004352",
    "vehicle_name": "My car",
    "make": "Honda",
    "model": "Accord",
    "year": 2020
  },
  "sensorReadings": [{ "key": "rpm", "value": 800, "unit": "rpm" }],
  "modules": [],
  "rawRecords": [],
  "dtcCodes": ["P0300"],
  "freezeFrameCodes": [],
  "milOn": null,
  "dtcCount": null,
  "readinessIncomplete": [],
  "unavailable": [],
  "dtcAnalysis": null,
  "dataCoverage": 0,
  "notes": ""
}
```

Required fields are `id`, `mode`, `startedAt`, `status`, and `readOnly`.
Allowed modes: `firstConnection`, `dtcScan`, `freezeFrame`, `liveData`,
`manual`, `other`. Allowed statuses: `completed`, `partial`, `failed`.
`completedAt` may be null or absent; if supplied, it cannot precede
`startedAt`. Times more than five minutes in the future are rejected. The first
three scan modes must be read-only, and modifying commands in raw records are
rejected. If body `vehicleId` is supplied, its decoded value must match the
path value exactly. A supplied VIN or snapshot VIN must match a registered
`veh_...` vehicle.

Send `milOn: null` when unknown: omitting it currently defaults to `false`.
`dtcCount` is the ECU-reported count, not the number of decoded codes; leave
it null or absent if unavailable. `vehicleSnapshot` and `sensorReadings` are
optional caller-supplied historical snapshots. Each snapshot reading requires
`key` and numeric `value`, with optional `unit` and `recordedAt`. The backend
does not automatically collect snapshots or embed separately saved sensors in a
scan. `rawRecords` can contain up to 5,000 entries; each entry requires `id`,
`command`, `rawResponse`, `recordedAt`, `source`, and `quality`.

## Read vehicle history and scan detail

`GET /health/vehicles/{vehicleId}/scans?limit=20&offset=0` returns
`data.results` (also repeated as `data.scans`), `data.count`, and
`data.totalCount`. An existing profile with no scans returns empty arrays and
zero counts. `limit` defaults to 100 and is capped at 500; `offset` defaults to
0. Optional filters are `mode`, `from`, and `to`. Results are sorted by
completion time, start time, then database ID, descending. There is no cursor
pagination. Since new records can shift offsets, refresh from offset 0 when
updating a visible history list.

`GET /health/vehicles/{vehicleId}/scans/{scanId}` returns the stored scan in
`data`, including raw records, optional snapshots, `dtcAnalysis`, and
`updatedAt`. Missing profiles or scans return `404`. Optional snapshots may be
absent on older records. The backend does not guarantee that all historical
records contain VIN, sensor readings, or analysis.

## Analyze codes and attach the result safely

`POST /analyze/dtc` accepts `{ "codes": ["P0300"] }`, with at most 100
strings. Its successful `data` includes `success`, `codes`, `status`, `title`,
`description`, `totalFaults`, and `faults`. Each fault may independently
report `success: false` and an `error`, including when the external AI service
fails. The endpoint does not save the analysis or receive vehicle context.
Empty codes produce a healthy-shaped response, which must not be presented as
proof that the entire vehicle is fault-free.

To save the full analysis response without replacing raw observations:

1. GET the saved scan and retain its exact `data.updatedAt` timestamp.
2. Send `PATCH /health/vehicles/{vehicleId}/scans/{scanId}/analysis` with
   header `If-Match: <updatedAt>` and JSON body
   `{ "dtcAnalysis": <analysis-data-object-or-null> }`.
3. On `200`, read the updated scan from `data` and replace the locally cached
   timestamp with its new `updatedAt`.
4. On `412 SCAN_VERSION_MISMATCH`, reload the scan and resolve the conflict
   before retrying. A stale analysis must not silently overwrite a newer one.

Example (replace the path and timestamp with values actually returned by the
server):

```http
PATCH /api/health/vehicles/vehicle%3Aveh_123/scans/scan-123/analysis
Content-Type: application/json
If-Match: 2026-11-25T10:00:05.000Z

{"dtcAnalysis":{"success":true,"faults":[]}}
```

The analysis value must be an object or null, and its serialized JSON is
limited to 262,144 characters. Missing or invalid `If-Match` returns 400;
missing profile/scan returns 404. This conditional protection applies to the
PATCH endpoint, not the legacy full-scan POST/PUT endpoints.

## Other existing data-logging routes

- `POST /health/vehicles/{vehicleId}/dtcs/observations` records observations
  for a scan that already exists. `GET .../dtcs` returns DTC history.
- `POST /health/vehicles/{vehicleId}/sensors` accepts `{ "readings": [...] }`;
  `GET .../sensors?limit=4000` returns `data.results`. These records remain
  separate from `sensorReadings` embedded in scan snapshots.
- `GET`/`PUT /health/vehicles/{vehicleId}/profile` reads or updates a profile.
  The existing remote repository treats a profile 404 as absent.
- Existing maintenance and migration routes remain available. Deleting health
  data is a separate explicit user action and is not part of saving a scan.

Continue using existing repository payload models for these routes. Detailed
field definitions and additional endpoint notes are in
`frontend_api_responses.md` and the existing health schemas. Generic OBD
analysis remains `POST /sendcoomend` (the spelling is intentional); it does
not save a scan.

## Errors and UI state

- `400`: invalid payload, invalid scan times, read-only violation, missing or
  invalid `If-Match`, or invalid analysis. Show the server's messages and allow
  correction.
- `404`: registered vehicle, profile, or scan not found. Refresh selection or
  show an unavailable-record state.
- `409`: VIN mismatch, body/path ID mismatch, conflicting scan ID, or a
  concurrent first submission. Preserve the local draft; reload the server
  record and resolve the conflict before another write.
- `412`: analysis update used an outdated version. Reload and resolve the
  conflict before resubmitting.
- `422`: future scan timestamp beyond the allowed skew.
- `429`, network errors, and `5xx`: keep unsynced data and offer retry with
  bounded backoff. Avoid duplicate taps and use the same scan ID on retries.

Do not assume all errors have a `code`, and do not log full VINs, raw OBD
responses, or tokens to ordinary client logs. Surface partial AI failures even
when the overall DTC response is successful.

## Verification and remaining work

The backend changes were tested against an isolated MongoDB instance for
vehicle registration, vehicle-specific scan history, repeated scan writes,
VIN mismatch, scan detail and snapshots, and successful/stale conditional
analysis updates. Backend lint, type checks, and OBD parser tests passed during
the previous task. The Flutter integration, deployed Render service, and live
Gemini response were not tested. Deploy the backend changes, configure the
remote frontend repository, add the PATCH request and conflict handling, and
verify the full workflow in the target environment before presenting remote
logging as complete.

Current limitations: public endpoints have no ownership enforcement; scan
records are not immutable; full POST/PUT updates can replace observations;
and no cursor pagination or automatic scan sensor snapshot is provided.
