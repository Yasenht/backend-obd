// deno-lint-ignore-file no-explicit-any
import "../index.d.ts";
import { Env, Loader } from "@Core/common/mod.ts";
import { createAppServer } from "@Core/server.ts";

// Run only against an explicitly supplied disposable database.
const databaseUrl = Deno.env.get("FRONTEND_TEST_DATABASE_URL");

Deno.test({
  name: "frontend vehicle and remote health contracts",
  ignore: !databaseUrl,
  async fn() {
    const db = new URL(databaseUrl!);
    db.pathname = `/frontend_contract_${
      crypto.randomUUID().replaceAll("-", "")
    }`;
    Env.configuration = {
      ...Env.getAll(),
      DATABASE_CONNECTION_STRING: db.toString(),
    };
    await Loader.load({ excludeTypes: ["templates", "models"] });
    const server = createAppServer();
    const { port } = await server.start();
    const base = `http://localhost:${port}/api`;
    const request = async (method: string, path: string, body?: unknown) => {
      const response = await server.fetch(new URL(base + path), {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response) throw new Error(`No response for ${method} ${path}`);
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${method} ${path}: ${response.status} ${text}`);
      }
      return text ? (JSON.parse(text) as { data: any }).data : null;
    };
    const check = (condition: unknown, message: string) => {
      if (!condition) throw new Error(message);
    };
    try {
      const vehicle = await request("POST", "/vehicles/", {
        vin: "1HGCM82633A004352",
        vehicle_name: "Integration test",
        make: " Honda ",
        model: " Accord ",
        year: 2020,
      });
      check(
        vehicle.make === "Honda" && vehicle.model === "Accord" &&
          vehicle.year === 2020,
        "Vehicle details must be saved",
      );
      const search = await request(
        "GET",
        "/vehicles/search/?vin=1HGCM82633A004352&offset=0&limit=20&includeTotalCount=true",
      );
      check(search.totalCount === 1, "Vehicle search must return totalCount");
      await request("POST", `/vehicles/${vehicle.id}/telemetry/`, {
        speed: 50,
        batteryVoltage: 12.6,
        recordedAt: new Date().toISOString(),
      });
      const telemetry = await request(
        "GET",
        `/vehicles/${vehicle.id}/telemetry/?offset=0&limit=20&includeTotalCount=true`,
      );
      check(telemetry.results.length === 1, "Telemetry must round-trip");
      const vehicleDetails = await request("GET", `/vehicles/${vehicle.id}/`);
      check(
        vehicleDetails.latestTelemetry?.speed === 50,
        "Vehicle detail must include latest telemetry",
      );
      const id = `vehicle:${vehicle.id}`;
      const path = `/health/vehicles/${encodeURIComponent(id)}`;
      const profile = await request("GET", `${path}/profile`);
      check(
        profile.make === "Honda" && profile.model === "Accord" &&
          profile.year === 2020,
        "Vehicle details must reach the health profile",
      );
      const now = new Date().toISOString();
      await request("PUT", `${path}/profile`, {
        id,
        displayName: "Integration test",
        vin: vehicle.vin,
        make: null,
        model: null,
        year: null,
        firstScanAt: null,
        lastScanAt: null,
        createdAt: now,
        updatedAt: now,
        notes: "",
      });
      const scan = {
        id: "scan-1",
        vehicleId: id,
        mode: "dtcScan",
        startedAt: now,
        completedAt: now,
        status: "completed",
        readOnly: true,
        protocol: "",
        adapterName: "",
        vin: null,
        vehicleSnapshot: {
          vin: vehicle.vin,
          vehicle_name: "Integration test",
          make: "Honda",
          model: "Accord",
          year: 2020,
        },
        sensorReadings: [{ key: "rpm", value: 800, unit: "rpm" }],
        modules: [],
        rawRecords: [{
          id: "raw-1",
          command: "03",
          rawResponse: "43 00 00",
          recordedAt: now,
          source: "ecu",
          quality: "good",
          error: null,
        }],
        dtcCodes: [],
        freezeFrameCodes: [],
        milOn: null,
        dtcCount: null,
        readinessIncomplete: [],
        unavailable: [],
        dtcAnalysis: null,
        dataCoverage: 0,
        notes: "",
      };
      const reject = async (
        method: string,
        url: string,
        payload: unknown,
        status: number,
      ) => {
        const response = await server.fetch(new URL(base + url), {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        check(
          response?.status === status,
          `Expected ${status} for ${url}, got ${response?.status}`,
        );
      };
      await reject("POST", `${path}/scans`, {
        ...scan,
        vin: "1HGCM82633A004353",
      }, 409);
      await reject("POST", "/health/vehicles/vehicle%3Aveh_missing/scans", {
        ...scan,
        vehicleId: "vehicle:veh_missing",
      }, 404);
      await reject("POST", `${path}/scans`, {
        ...scan,
        completedAt: "2000-01-01T00:00:00Z",
      }, 400);
      await request("POST", `${path}/scans`, scan);
      await request("POST", `${path}/scans`, {
        ...scan,
        dtcAnalysis: { success: true },
      });
      const scans = await request("GET", `${path}/scans?limit=100`);
      check(
        scans.results.length === 1 && scans.results[0].dtcAnalysis.success &&
          scans.results[0].rawRecords.length === 1 &&
          scans.results[0].milOn === null,
        "Scan updates must preserve a single full scan and unknown MIL status",
      );
      const detail = await request("GET", `${path}/scans/scan-1`);
      check(
        detail.id === "scan-1" && detail.dtcAnalysis.success &&
          detail.vehicleSnapshot?.model === "Accord" &&
          detail.sensorReadings?.[0]?.value === 800,
        "Scan details must retain analysis and snapshots",
      );
      const patchAnalysis = (version: string) =>
        server.fetch(new URL(base + `${path}/scans/scan-1/analysis`), {
          method: "PATCH",
          headers: { "content-type": "application/json", "if-match": version },
          body: JSON.stringify({
            dtcAnalysis: { success: true, title: "updated" },
          }),
        });
      const changed = await patchAnalysis(detail.updatedAt);
      check(
        changed?.status === 200,
        "Analysis update must succeed for current version",
      );
      const stale = await patchAnalysis(detail.updatedAt);
      check(
        stale?.status === 412,
        "Analysis update must reject stale versions",
      );
      const updated = await request("GET", `${path}/scans/scan-1`);
      check(
        updated.dtcAnalysis.title === "updated" &&
          updated.rawRecords.length === 1,
        "Analysis update must preserve observations",
      );
      await reject("POST", `${path}/scans`, {
        ...scan,
        startedAt: "2000-01-01T00:00:00Z",
      }, 409);
      const otherVehicle = await request("POST", "/vehicles/", {
        vin: "1HGCM82633A004353",
        vehicle_name: "Other",
      });
      const otherPath = `/health/vehicles/${
        encodeURIComponent(`vehicle:${otherVehicle.id}`)
      }`;
      const otherHistory = await request("GET", `${otherPath}/scans`);
      check(
        otherHistory.results.length === 0,
        "Scan history must be separate for each vehicle",
      );
      await request("POST", `${path}/sensors`, {
        readings: [{
          id: "reading-1",
          vehicleId: id,
          key: "rpm",
          label: "RPM",
          value: 800,
          unit: "rpm",
          recordedAt: now,
          source: "ecu",
          pid: 12,
          quality: "good",
          scanId: null,
          raw: "",
        }],
      });
      const readings = await request("GET", `${path}/sensors?limit=4000`);
      check(
        readings.results[0]?.vehicleId === id,
        "Sensor responses must include vehicleId",
      );
      await request("POST", `${path}/dtcs/observations`, {
        scanId: "scan-1",
        codes: [],
        observedAt: now,
        source: "ecu",
        ecu: "",
        protocol: "",
        raw: "",
        freezeFrameCodes: [],
        state: "stored",
      });
      await request("PUT", `${path}/maintenance/maintenance-1`, {
        id: "maintenance-1",
        vehicleId: id,
        type: "maintenance",
        title: "Service",
        description: "",
        performedAt: now,
        createdAt: now,
        odometerKm: null,
        partsReplaced: [],
        workshop: "",
        notes: "",
        scoreBefore: null,
        confidenceBefore: null,
        dtcCodesBefore: [],
        scanIdBefore: null,
        verification: null,
      });
      const maintenance = await request("GET", `${path}/maintenance`);
      check(maintenance.results.length === 1, "Maintenance must round-trip");
      await request("POST", `${path}/migrate`, {
        fromVehicleId: "profile:missing",
        targetProfile: null,
      }).then(() => {
        throw new Error("Missing source must return 404");
      }, (error) => {
        check(
          String(error).includes("404"),
          "Null targetProfile must pass validation",
        );
      });
      const dtc = await request("POST", "/analyze/dtc", { codes: ["invalid"] });
      check(
        dtc.success && dtc.faults[0]?.success === false,
        "Invalid DTC should fail per code",
      );
    } finally {
      await server.end();
    }
  },
});
