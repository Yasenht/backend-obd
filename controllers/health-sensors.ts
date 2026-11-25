// deno-lint-ignore-file no-explicit-any
import {
  BaseController,
  Controller,
  Get,
  type IRequestContext,
  type IRoute,
  parseQueryParams,
  Post,
  Response,
} from "@Core/common/mod.ts";
import { type RouterContext, Status } from "oak";
import e from "validator";

import {
  DiagnosticScanModel,
  DtcObservationModel,
  HealthAssessmentModel,
  InputSensorBatchSchema,
  MaintenanceRecordModel,
  SensorReadingModel,
} from "@Models/health.ts";
import {
  bucketSizeMs,
  bucketStart,
  computeStatistics,
  computeTrend,
  decodePathValue,
  ensureProfile,
  fail,
  findProfile,
  getAccountId,
  isAllowedSensorKey,
  isFutureBeyondSkew,
  isOlderThanOneYear,
  scopeVehicleAccount,
  severityForDtc,
} from "@Helpers/health.ts";

const SensorListQuery = e.deepCast(e.object({
  key: e.optional(e.string().max(500)),
  since: e.optional(e.date()),
  until: e.optional(e.date()),
  limit: e.optional(e.number().int().min(1).max(10000)).default(2000),
  order: e.optional(e.in(["asc", "desc"] as const)).default("asc"),
  bucket: e.optional(e.in(["1m", "5m", "1h", "1d"] as const)),
  agg: e.optional(e.in(["avg", "min", "max", "last"] as const)).default("avg"),
}, { allowUnexpectedProps: true }));

const SummaryQuery = e.deepCast(e.object({
  days: e.optional(e.number().int().min(1).max(3650)).default(30),
}, { allowUnexpectedProps: true }));

const TimelineQuery = e.deepCast(e.object({
  from: e.optional(e.date()),
  to: e.optional(e.date()),
  types: e.optional(e.string().max(200)),
  limit: e.optional(e.number().int().min(1).max(500)).default(100),
  offset: e.optional(e.number().int().min(0)).default(0),
}, { allowUnexpectedProps: true }));

const timelineTypes = [
  "scan",
  "dtc",
  "reading",
  "maintenance",
  "assessment",
] as const;

type TimelineType = typeof timelineTypes[number];

@Controller("/health/", {
  name: "healthSensors",
  middlewares: [scopeVehicleAccount()],
})
export default class HealthSensorsController extends BaseController {
  @Post("/vehicles/:vehicleId/sensors")
  public createReadings(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const RawBody = await ctx.router.request.body.json();

        if (
          RawBody && typeof RawBody === "object" &&
          Array.isArray((RawBody as any).readings) &&
          (RawBody as any).readings.length > 5000
        ) {
          return fail(
            Status.RequestEntityTooLarge,
            "BATCH_TOO_LARGE",
            "A sensor batch cannot contain more than 5,000 readings.",
            "readings",
          );
        }

        const Body = await InputSensorBatchSchema.validate(
          RawBody,
          { name: "health.sensors.body" },
        );

        const Profile = await ensureProfile(
          ctx.router.params.vehicleId,
          undefined,
          getAccountId(ctx),
        );

        if (!Profile) {
          return fail(
            Status.BadRequest,
            "INVALID_VEHICLE_ID",
            "A valid vehicle id is required.",
            "vehicleId",
          );
        }

        const Account = getAccountId(ctx);
        const Now = new Date();

        for (let index = 0; index < Body.readings.length; index++) {
          const Reading = Body.readings[index];

          if (!isAllowedSensorKey(Reading.key)) {
            return fail(
              Status.BadRequest,
              "INVALID_SENSOR_KEY",
              `'${Reading.key}' is not a supported sensor key.`,
              `readings[${index}].key`,
            );
          }

          if (!Number.isFinite(Reading.value)) {
            return fail(
              Status.BadRequest,
              "INVALID_READING",
              "Sensor values must be finite numbers.",
              `readings[${index}].value`,
            );
          }

          if (isFutureBeyondSkew(Reading.recordedAt)) {
            return fail(
              422,
              "FUTURE_TIMESTAMP",
              "Sensor readings cannot be more than five minutes in the future.",
              `readings[${index}].recordedAt`,
            );
          }

          if (
            !Body.importHistorical &&
            isOlderThanOneYear(Reading.recordedAt)
          ) {
            return fail(
              422,
              "READING_TOO_OLD",
              "Readings older than one year require an explicit historical import.",
              `readings[${index}].recordedAt`,
            );
          }

          const Doc = {
            ...Reading,
            vehicleId: Profile.key,
            vehicleKey: Profile.key,
            readingId: Reading.id,
            ...(Account ? { account: Account } : {}),
          };

          await SensorReadingModel.updateOne(
            { vehicleKey: Profile.key, readingId: Reading.id },
            {
              $set: Doc,
              $setOnInsert: { createdAt: Now },
            },
            { upsert: true },
          );
        }

        return Response.statusCode(Status.Created).data({
          accepted: Body.readings.length,
          vehicleKey: Profile.key,
        });
      },
    };
  }

  @Get("/vehicles/:vehicleId/sensors")
  public listReadings(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Profile = await findProfile(ctx.router.params.vehicleId);

        if (!Profile) {
          return fail(
            Status.NotFound,
            "VEHICLE_NOT_FOUND",
            "Vehicle profile not found.",
          );
        }

        const Query = await SensorListQuery.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: "health.sensors.query" },
        );

        const Keys = (Query.key ?? "")
          .split(",")
          .map((key) => key.trim())
          .filter(Boolean);

        const Filter: Record<string, any> = { vehicleKey: Profile.key };

        if (Keys.length) Filter.key = { $in: Keys };

        if (Query.since || Query.until) {
          Filter.recordedAt = {
            ...(Query.since ? { $gte: Query.since } : {}),
            ...(Query.until ? { $lte: Query.until } : {}),
          };
        }

        const Direction = Query.order === "desc" ? -1 : 1;
        const BucketMs = bucketSizeMs(Query.bucket);

        if (!BucketMs) {
          const Results = await SensorReadingModel.find(Filter)
            .sort({ recordedAt: Direction, _id: Direction })
            .limit(Query.limit);

          return Response.data({
            totalCount: await SensorReadingModel.countDocuments(Filter),
            results: Results.map((reading) => ({
              ...reading,
              vehicleId: reading.vehicleId ?? Profile.key,
            })),
          });
        }

        const Readings = await SensorReadingModel.find(Filter)
          .sort({ recordedAt: 1, _id: 1 })
          .limit(10000);

        const Groups = new Map<
          string,
          {
            key: string;
            unit: string;
            buckets: Map<number, Array<{ at: Date; value: number }>>;
          }
        >();

        for (const Reading of Readings) {
          const Entry = Groups.get(Reading.key) ?? {
            key: Reading.key,
            unit: Reading.unit,
            buckets: new Map(),
          };

          const At = bucketStart(Reading.recordedAt, BucketMs);
          const Bucket = Entry.buckets.get(At.getTime()) ?? [];
          Bucket.push({ at: Reading.recordedAt, value: Reading.value });
          Entry.buckets.set(At.getTime(), Bucket);
          Groups.set(Reading.key, Entry);
        }

        const series = Array.from(Groups.values()).map((Group) => {
          const points = Array.from(Group.buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([timestamp, Values]) => {
              const Numeric = Values.map((item) => item.value);

              let Value = 0;

              switch (Query.agg) {
                case "min":
                  Value = Math.min(...Numeric);
                  break;
                case "max":
                  Value = Math.max(...Numeric);
                  break;
                case "last":
                  Value = Values[Values.length - 1].value;
                  break;
                default:
                  Value = Numeric.reduce((total, item) => total + item, 0) /
                    Numeric.length;
              }

              return {
                at: new Date(timestamp),
                value: Number(Value.toFixed(4)),
                count: Values.length,
              };
            });

          return {
            key: Group.key,
            unit: Group.unit,
            bucket: Query.bucket,
            agg: Query.agg,
            points,
          };
        });

        if (series.length <= 1) {
          return Response.data(
            series[0] ?? {
              key: Keys.length === 1 ? Keys[0] : null,
              unit: null,
              bucket: Query.bucket,
              agg: Query.agg,
              points: [],
            },
          );
        }

        return Response.data({ series });
      },
    };
  }

  @Get("/vehicles/:vehicleId/sensors/:key/summary")
  public sensorSummary(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Profile = await findProfile(ctx.router.params.vehicleId);

        if (!Profile) {
          return fail(
            Status.NotFound,
            "VEHICLE_NOT_FOUND",
            "Vehicle profile not found.",
          );
        }

        const Query = await SummaryQuery.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: "health.sensors.summary.query" },
        );

        const Key = decodePathValue(ctx.router.params.key);
        const Since = new Date(Date.now() - Query.days * 24 * 60 * 60 * 1000);

        const Readings = await SensorReadingModel.find({
          vehicleKey: Profile.key,
          key: Key,
          recordedAt: { $gte: Since },
        }).sort({ recordedAt: 1, _id: 1 });

        const Stats = computeStatistics(
          Readings.map((reading: any) => reading.value),
        );

        const Points = Readings.map((reading: any) => ({
          at: reading.recordedAt,
          value: reading.value,
        }));

        const Trend = computeTrend(Points);

        return Response.data({
          key: Key,
          unit: Readings[0]?.unit ?? null,
          sampleCount: Stats.sampleCount,
          firstAt: Readings[0]?.recordedAt ?? null,
          lastAt: Readings.length
            ? Readings[Readings.length - 1].recordedAt
            : null,
          latest: Readings.length ? Readings[Readings.length - 1].value : null,
          min: Stats.min,
          max: Stats.max,
          mean: Stats.mean,
          median: Stats.median,
          std: Stats.std,
          trend: Trend,
          unavailable: Readings.length ? null : [{
            feature: `Sensor summary for ${Key}`,
            reason: "No readings were recorded in the requested window.",
            source: "application",
          }],
          limitations: [
            "الاتجاه إحصائي وصفي وليس تنبؤاً بتاريخ فشل.",
          ],
        });
      },
    };
  }

  @Get("/vehicles/:vehicleId/timeline")
  public timeline(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Profile = await findProfile(ctx.router.params.vehicleId);

        if (!Profile) {
          return fail(
            Status.NotFound,
            "VEHICLE_NOT_FOUND",
            "Vehicle profile not found.",
          );
        }

        const Query = await TimelineQuery.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: "health.timeline.query" },
        );

        const Requested = new Set<TimelineType>(
          (Query.types ?? timelineTypes.join(","))
            .split(",")
            .map((value) => value.trim())
            .filter((value): value is TimelineType =>
              timelineTypes.includes(value as TimelineType)
            ),
        );

        const Range: Record<string, any> = {};

        if (Query.from) Range.$gte = Query.from;
        if (Query.to) Range.$lte = Query.to;

        const [Scans, Dtcs, Readings, Maintenance, Assessments] = await Promise
          .all([
            Requested.has("scan")
              ? DiagnosticScanModel.find({
                vehicleKey: Profile.key,
                ...(Query.from || Query.to
                  ? {
                    $or: [
                      { completedAt: Range },
                      { completedAt: null, startedAt: Range },
                    ],
                  }
                  : {}),
              }).sort({ startedAt: -1 }).limit(Query.limit * 2)
              : [],
            Requested.has("dtc")
              ? DtcObservationModel.find({
                vehicleKey: Profile.key,
                ...(Query.from || Query.to ? { observedAt: Range } : {}),
              }).sort({ observedAt: -1 }).limit(Query.limit * 2)
              : [],
            Requested.has("reading")
              ? SensorReadingModel.find({
                vehicleKey: Profile.key,
                ...(Query.from || Query.to ? { recordedAt: Range } : {}),
              }).sort({ recordedAt: -1 }).limit(Query.limit * 2)
              : [],
            Requested.has("maintenance")
              ? MaintenanceRecordModel.find({
                vehicleKey: Profile.key,
                ...(Query.from || Query.to ? { performedAt: Range } : {}),
              }).sort({ performedAt: -1 }).limit(Query.limit * 2)
              : [],
            Requested.has("assessment")
              ? HealthAssessmentModel.find({
                vehicleKey: Profile.key,
                ...(Query.from || Query.to ? { generatedAt: Range } : {}),
              }).sort({ generatedAt: -1 }).limit(Query.limit * 2)
              : [],
          ]);

        const Events: any[] = [];

        for (const Scan of Scans as any[]) {
          Events.push({
            id: `evt-scan-${Scan.scanId}`,
            type: "scan",
            at: Scan.completedAt ?? Scan.startedAt,
            title: "فحص تشخيصي",
            summary: `${Scan.dtcCount ?? 0} كود عطل، تغطية ${
              Math.round((Scan.dataCoverage ?? 0) * 100)
            }%`,
            source: "ecu",
            refId: Scan.scanId,
            severity: Scan.status === "failed"
              ? "error"
              : (Scan.dtcCount ?? 0) > 0
              ? "warning"
              : "info",
          });
        }

        for (const Dtc of Dtcs as any[]) {
          Events.push({
            id: `evt-dtc-${Dtc.scanId}-${Dtc.code}`,
            type: "dtc",
            at: Dtc.observedAt,
            title: `كود عطل ${Dtc.code}`,
            summary: Dtc.freezeFrame
              ? "ظهر الكود مع إطار تجميد."
              : "تمت ملاحظة الكود في فحص.",
            source: Dtc.source,
            refId: Dtc.code,
            severity: severityForDtc(Dtc.code),
          });
        }

        for (const Reading of Readings as any[]) {
          Events.push({
            id: `evt-reading-${Reading.readingId}`,
            type: "reading",
            at: Reading.recordedAt,
            title: Reading.label || Reading.key,
            summary: `${Reading.value} ${Reading.unit}`,
            source: Reading.source,
            refId: Reading.readingId,
            severity: "info",
          });
        }

        for (const Record of Maintenance as any[]) {
          Events.push({
            id: `evt-maint-${Record.recordId}`,
            type: "maintenance",
            at: Record.performedAt,
            title: Record.title,
            summary: Record.verification
              ? `نتيجة التحقق: ${Record.verification.outcome}`
              : "بانتظار التحقق بفحص لاحق",
            source: "user",
            refId: Record.recordId,
            severity: "info",
          });
        }

        for (const Assessment of Assessments as any[]) {
          Events.push({
            id: `evt-assessment-${Assessment._id}`,
            type: "assessment",
            at: Assessment.generatedAt,
            title: "تقييم صحي خادمي",
            summary: Assessment.overallScore === null
              ? "لا توجد درجة قابلة للحساب."
              : `الدرجة ${Assessment.overallScore} — ${Assessment.overallStatus}`,
            source: "backend",
            refId: String(Assessment._id),
            severity: Assessment.overallStatus === "critical"
              ? "error"
              : Assessment.overallStatus === "attention"
              ? "warning"
              : "info",
          });
        }

        Events.sort((a, b) =>
          new Date(b.at).getTime() - new Date(a.at).getTime()
        );

        const Page = Events.slice(Query.offset, Query.offset + Query.limit);

        return Response.data({
          events: Page,
          nextCursor: Events.length > Query.offset + Query.limit
            ? String(Query.offset + Query.limit)
            : null,
        });
      },
    };
  }
}
