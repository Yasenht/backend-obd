---
description: Register vehicles, search them, and store live telemetry.
---

# Vehicle Management

The vehicle endpoints are served by `controllers/vehicles.ts` and use the
existing `VehicleModel` and `VehicleTelemetryModel` models.

All successful responses use the standard Epic API response envelope:

```json
{
  "status": true,
  "data": {},
  "metrics": {
    "handledInMs": 1,
    "respondInMs": 2
  }
}
```

Error responses use the same envelope with `"status": false` and one or more
messages.

## Register a vehicle

`POST /api/vehicles/`

Request:

```json
{
  "vin": "1HGCM82633A004352",
  "vehicle_name": "My car",
  "make": "Honda",
  "model": "Accord",
  "year": 2020
}
```

`vin` is required, must be 17 alphanumeric characters (I, O, and Q are not
allowed), and is normalized to uppercase. `vehicle_name` is required and is
trimmed. `vehicle_name` is the user's distinctive name for the vehicle; `make`
is its manufacturer, `model` is its model name, and `year` is its manufacture
year. These three fields are optional for compatibility with existing clients.

Success response (`201 Created`):

```json
{
  "status": true,
  "data": {
    "_id": "6b02ee4d2e55d25879378b67",
    "vin": "1HGCM82633A004352",
    "vehicle_name": "My car",
    "make": "Honda",
    "model": "Accord",
    "year": 2020,
    "createdAt": "2026-11-22T13:29:49.036Z",
    "updatedAt": "2026-11-22T13:29:49.036Z"
  }
}
```

Duplicate VIN (`409 Conflict`):

```json
{
  "status": false,
  "messages": [
    {
      "message": "A vehicle with this VIN already exists."
    }
  ]
}
```

Validation errors, such as a missing name or an invalid VIN, return
`400 Bad Request`.

## Search vehicles

`GET /api/vehicles/search/`

Search parameters:

| Parameter           | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `search`            | Partial name or VIN match. Aliases: `q`, `query`         |
| `vin`               | Exact VIN match (case-insensitive)                       |
| `vehicle_name`      | Partial vehicle name match                               |
| `offset`            | Number of records to skip. Defaults to `0`               |
| `limit`             | Page size. Defaults to `20`, maximum `100`               |
| `includeTotalCount` | Include `totalCount` in the response. Defaults to `true` |

Examples:

```text
GET /api/vehicles/search/?search=accord
GET /api/vehicles/search/?search=1HGCM82633A
GET /api/vehicles/search/?vin=1HGCM82633A004352
GET /api/vehicles/search/?vehicle_name=corolla&limit=10&offset=0
```

`GET /api/vehicles/` is an alias of the same search endpoint. A search parameter
is required; the API never returns the complete vehicle collection without an
explicit query.

Success response (`200 OK`):

```json
{
  "status": true,
  "data": {
    "totalCount": 1,
    "results": [
      {
        "_id": "6b02ee4d2e55d25879378b67",
        "vin": "1HGCM82633A004352",
        "vehicle_name": "Honda Accord",
        "createdAt": "2026-11-22T13:29:49.036Z",
        "updatedAt": "2026-11-22T13:29:49.036Z"
      }
    ]
  }
}
```

No matches return `200 OK` with an empty `results` array and `"totalCount": 0`.

Missing or blank search parameters return `400 Bad Request`.

## Store live data for a selected vehicle

`POST /api/vehicles/:id/telemetry/`

`:id` is the vehicle's MongoDB `_id` returned by the search endpoint.

Request:

```json
{
  "speed": 42.5,
  "batteryVoltage": 12.6
}
```

`recordedAt` is optional and defaults to the current time.

Success response (`201 Created`):

```json
{
  "status": true,
  "data": {
    "_id": "6b02ee4d2e55d25879378b69",
    "speed": 42.5,
    "batteryVoltage": 12.6,
    "recordedAt": "2026-11-22T13:29:49.113Z",
    "vehicle": "6b02ee4d2e55d25879378b67",
    "createdAt": "2026-11-22T13:29:49.114Z",
    "updatedAt": "2026-11-22T13:29:49.114Z"
  }
}
```

An invalid vehicle id returns `400 Bad Request`. A valid id that does not exist
returns `404 Not Found`. Invalid telemetry values return `400 Bad Request`.

## Retrieve live data

`GET /api/vehicles/:id/telemetry/`

Supports the standard query parameters such as `offset`, `limit`, `sort`, and
`includeTotalCount`.

```json
{
  "status": true,
  "data": {
    "totalCount": 1,
    "results": [
      {
        "_id": "6b02ee4d2e55d25879378b69",
        "speed": 42.5,
        "batteryVoltage": 12.6,
        "recordedAt": "2026-11-22T13:29:49.113Z",
        "vehicle": "6b02ee4d2e55d25879378b67",
        "createdAt": "2026-11-22T13:29:49.114Z",
        "updatedAt": "2026-11-22T13:29:49.114Z"
      }
    ]
  }
}
```

`GET /api/vehicles/:id/` returns the vehicle and its latest telemetry record.
