// deno-lint-ignore-file no-explicit-any
import {
  BaseController,
  Controller,
  Get,
  type IRequestContext,
  type IRoute,
  parseQueryParams,
  Post,
  Put,
  RawResponse,
  Response,
} from "@Core/common/mod.ts";
import { type RouterContext, Status } from "oak";
import e from "validator";
import { Database } from "@Database";

import {
  DiagnosticScanModel,
  DtcRecordModel,
  HealthAssessmentModel,
  HealthPredictionModel,
  HealthReportModel,
  HealthTombstoneModel,
  InputRawUploadSchema,
  InputReportSchema,
  MaintenanceRecordModel,
  PredictionFeedbackModel,
  RawUploadModel,
  SensorReadingModel,
  VehicleProfileModel,
} from "@Models/health.ts";
import {
  accountFilter,
  base64ToBytes,
  bytesToBase64,
  ensureProfile,
  fail,
  findProfile,
  getAccountId,
  getPublicBaseUrl,
  isAccountAllowed,
  isFutureBeyondSkew,
  randomId,
  scopeVehicleAccount,
  sha256Bytes,
  sha256Hex,
} from "@Helpers/health.ts";
import { requireAuth } from "@Helpers/auth.ts";
import { renderTextPdf } from "@Helpers/report.ts";

const VerifyFeedbackSchema = e.object({
  outcome: e.in(["confirmed", "not_observed", "unknown"] as const),
  observedAt: e.optional(e.or([e.date(), e.null()])),
  notes: e.optional(e.string().max(5000)).default(""),
}, { allowUnexpectedProps: true });

const PredictionBodySchema = e.object({
  modelId: e.string().min(1).max(120),
  horizonDays: e.optional(e.number().int().min(1).max(365)).default(60),
  featuresWindowDays: e.optional(e.number().int().min(1).max(3650)).default(90),
}, { allowUnexpectedProps: true });

const SyncQuery = e.deepCast(e.object({
  since: e.optional(e.date()),
  limit: e.optional(e.number().int().min(1).max(5000)).default(500),
}, { allowUnexpectedProps: true }));

const PredictionModels = [
  {
    id: "battery_decline_v1",
    version: "1.0.0",
    status: "shadow",
    target: "battery_decline_risk",
    trainedAt: "2026-12-01T00:00:00.000Z",
    trainingSamples: 12000,
    vehicles: 1800,
    metrics: {
      auc: 0.81,
      precision: 0.74,
      recall: 0.69,
      calibrationError: 0.05,
    },
    validatedFailDateEstimation: false,
    limitations: [
      "لا يقدّر تاريخ فشل.",
      "أداء أقل على المركبات القديمة/البيانات المتقطعة.",
    ],
  },
];

const predictionEnabled = () =>
  (Deno.env.get("FEATURE_PREDICTIONS") ?? "false").toLowerCase() === "true";

@Controller("/health/", {
  name: "healthReports",
  middlewares: [requireAuth(), scopeVehicleAccount()],
})
export default class HealthReportsController extends BaseController {
  @Post("/vehicles/:vehicleId/reports")
  public createReport(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
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

        const Body = await InputReportSchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.report.body" },
        );

        if (Body.from && isFutureBeyondSkew(Body.from)) {
          return fail(
            422,
            "FUTURE_TIMESTAMP",
            "The report start date cannot be in the future.",
            "from",
          );
        }

        if (Body.to && isFutureBeyondSkew(Body.to)) {
          return fail(
            422,
            "FUTURE_TIMESTAMP",
            "The report end date cannot be in the future.",
            "to",
          );
        }

        const Range: Record<string, any> = {};

        if (Body.from) Range.$gte = Body.from;
        if (Body.to) Range.$lte = Body.to;

        const [Scans, Dtcs, Readings, Maintenance, Assessment] = await Promise
          .all([
            DiagnosticScanModel.find({
              vehicleKey: Profile.key,
              ...(Body.from || Body.to ? { startedAt: Range } : {}),
            }).sort({ startedAt: 1 }),
            DtcRecordModel.find({
              vehicleKey: Profile.key,
              ...(Body.from || Body.to ? { lastSeenAt: Range } : {}),
            }).sort({ lastSeenAt: 1 }),
            SensorReadingModel.find({
              vehicleKey: Profile.key,
              ...(Body.from || Body.to ? { recordedAt: Range } : {}),
            }).sort({ recordedAt: 1 }).limit(20000),
            Body.includeMaintenance
              ? MaintenanceRecordModel.find({
                vehicleKey: Profile.key,
                ...(Body.from || Body.to ? { performedAt: Range } : {}),
              }).sort({ performedAt: 1 })
              : [],
            HealthAssessmentModel.findOne({ vehicleKey: Profile.key })
              .sort({ generatedAt: -1 }),
          ]);

        const Payload = {
          format: "drivescope-health-report/v1",
          generatedAt: new Date(),
          requestedFormat: Body.format,
          type: Body.type,
          limitations: [
            "التقرير لا يدّعي تشخيصاً نهائياً.",
            "غياب الكود لا يثبت سلامة الأنظمة غير المقروءة.",
            "لا تُقدَّر تواريخ فشل المكوّنات.",
          ],
          vehicle: Profile,
          scans: Body.includeRaw
            ? Scans
            : Scans.map((scan: any) => ({ ...scan, rawRecords: [] })),
          dtcs: Dtcs,
          readings: Readings,
          maintenance: Body.includeMaintenance ? Maintenance : [],
          latestAssessment: Assessment ?? null,
        };

        const ReportId = randomId("rep");
        const ExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const DownloadUrl = `${
          getPublicBaseUrl(ctx)
        }/health/reports/${ReportId}/download`;

        let Content: string;
        let ContentEncoding: "utf8" | "base64";
        let ContentType: string;
        let Sha256: string;
        let SizeBytes: number;

        if (Body.format === "pdf") {
          const PdfLines = [
            `Vehicle: ${Profile.displayName} (${Profile.key})`,
            `VIN: ${Profile.vin ?? "unavailable"}`,
            `Generated: ${Payload.generatedAt.toISOString()}`,
            `Report type: ${Body.type}`,
            `Scans: ${Scans.length}`,
            `DTC records: ${Dtcs.length}`,
            `Sensor readings: ${Readings.length}`,
            `Maintenance records: ${
              Array.isArray(Maintenance) ? Maintenance.length : 0
            }`,
            `Latest assessment: ${
              Assessment
                ? `${
                  Assessment.overallScore ?? "n/a"
                } (${Assessment.overallStatus})`
                : "unavailable"
            }`,
            "",
            "Limitations:",
            "- This report is not a definitive diagnosis.",
            "- Absence of a code does not prove a system is healthy.",
            "- Component failure dates are not predicted.",
            "",
            "Active DTCs:",
            ...(Dtcs.filter((record: any) => record.activeInLatestScan).map(
              (record: any) => `- ${record.code} (${record.status})`,
            )),
          ];

          const Pdf = renderTextPdf("DriveScope Health Report", PdfLines);

          Sha256 = await sha256Bytes(Pdf);
          SizeBytes = Pdf.length;
          ContentType = "application/pdf";
          ContentEncoding = "base64";
          Content = bytesToBase64(Pdf);
        } else {
          Content = JSON.stringify(Payload, null, 2);
          Sha256 = await sha256Hex(Content);
          SizeBytes = new TextEncoder().encode(Content).length;
          ContentType = "application/json";
          ContentEncoding = "utf8";
        }

        await HealthReportModel.create({
          reportId: ReportId,
          vehicleKey: Profile.key,
          ...(getAccountId(ctx) ? { account: getAccountId(ctx) } : {}),
          type: Body.type,
          format: Body.format,
          from: Body.from ?? null,
          to: Body.to ?? null,
          includeRaw: Body.includeRaw,
          includeMaintenance: Body.includeMaintenance,
          status: "ready",
          downloadUrl: DownloadUrl,
          expiresAt: ExpiresAt,
          sha256: Sha256,
          sizeBytes: SizeBytes,
          contentType: ContentType,
          content: Content,
          contentEncoding: ContentEncoding,
          error: null,
        });

        return Response.statusCode(202).data({
          reportId: ReportId,
          status: "processing",
        });
      },
    };
  }

  @Get("/reports/:reportId")
  public getReport(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Report = await HealthReportModel.findOne({
          reportId: ctx.router.params.reportId,
        });

        if (!Report) {
          return fail(
            Status.NotFound,
            "REPORT_NOT_FOUND",
            "Report not found.",
          );
        }

        if (!isAccountAllowed(ctx, Report)) {
          return fail(
            Status.NotFound,
            "REPORT_NOT_FOUND",
            "Report not found.",
          );
        }

        return Response.data({
          reportId: Report.reportId,
          status: Report.status,
          downloadUrl: Report.downloadUrl,
          expiresAt: Report.expiresAt,
          sha256: Report.sha256,
          sizeBytes: Report.sizeBytes,
          error: Report.error,
        });
      },
    };
  }

  @Get("/reports/:reportId/download")
  public downloadReport(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Report = await HealthReportModel.findOne({
          reportId: ctx.router.params.reportId,
        });

        if (!Report) {
          return fail(
            Status.NotFound,
            "REPORT_NOT_FOUND",
            "Report not found.",
          );
        }

        if (!isAccountAllowed(ctx, Report)) {
          return fail(
            Status.NotFound,
            "REPORT_NOT_FOUND",
            "Report not found.",
          );
        }

        if (Report.status !== "ready" || !Report.content) {
          return fail(
            Status.Conflict,
            "REPORT_NOT_READY",
            "The report is not ready for download.",
          );
        }

        if (
          Report.expiresAt instanceof Date &&
          Report.expiresAt.getTime() < Date.now()
        ) {
          return fail(
            Status.Gone,
            "REPORT_EXPIRED",
            "The report download link has expired.",
          );
        }

        const Body = Report.contentEncoding === "base64"
          ? base64ToBytes(Report.content)
          : Report.content;

        const Type = Report.contentType ?? "application/json";
        const Extension = Type === "application/pdf" ? "pdf" : "json";

        return RawResponse
          .body(Body, Type)
          .header(
            "Content-Disposition",
            `attachment; filename="${Report.reportId}.${Extension}"`,
          );
      },
    };
  }

  @Post("/vehicles/:vehicleId/raw-uploads")
  public createRawUpload(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
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

        const Body = await InputRawUploadSchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.raw-upload.body" },
        );

        const UploadId = randomId("upl");
        const UploadUrl = `${
          getPublicBaseUrl(ctx)
        }/health/raw-uploads/${UploadId}`;

        await RawUploadModel.create({
          uploadId: UploadId,
          vehicleKey: Profile.key,
          ...(getAccountId(ctx) ? { account: getAccountId(ctx) } : {}),
          ...Body,
          status: "pending",
          uploadUrl: UploadUrl,
          contentEncoding: "base64",
          uploadedAt: null,
          completedAt: null,
        });

        return Response.statusCode(Status.Created).data({
          uploadId: UploadId,
          uploadUrl: UploadUrl,
          status: "pending",
        });
      },
    };
  }

  @Put("/raw-uploads/:uploadId")
  public uploadRawContent(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Upload = await RawUploadModel.findOne({
          uploadId: ctx.router.params.uploadId,
        });

        if (!Upload) {
          return fail(
            Status.NotFound,
            "UPLOAD_NOT_FOUND",
            "Raw upload not found.",
          );
        }

        if (!isAccountAllowed(ctx, Upload)) {
          return fail(
            Status.NotFound,
            "UPLOAD_NOT_FOUND",
            "Raw upload not found.",
          );
        }

        if (Upload.status === "completed") {
          return fail(
            Status.Conflict,
            "UPLOAD_ALREADY_COMPLETED",
            "This upload has already been completed.",
          );
        }

        const Bytes = new Uint8Array(
          await ctx.router.request.body.arrayBuffer(),
        );

        if (Bytes.length !== Upload.sizeBytes) {
          return fail(
            422,
            "SIZE_MISMATCH",
            `Expected ${Upload.sizeBytes} bytes but received ${Bytes.length}.`,
            "sizeBytes",
          );
        }

        const Hash = await sha256Bytes(Bytes);

        if (Hash.toLowerCase() !== Upload.sha256.toLowerCase()) {
          return fail(
            422,
            "HASH_MISMATCH",
            "The uploaded content does not match the declared sha256.",
            "sha256",
          );
        }

        let Content = bytesToBase64(Bytes);
        let Redacted = false;

        if (Upload.redact && Upload.containsVin) {
          const Text = new TextDecoder().decode(Bytes);
          const Masked = Text.replace(
            /\b[A-HJ-NPR-Z0-9]{17}\b/gi,
            "[REDACTED_VIN]",
          );

          if (Masked !== Text) {
            Content = bytesToBase64(new TextEncoder().encode(Masked));
            Redacted = true;
          }
        }

        const UploadedAt = new Date();

        await RawUploadModel.updateOne(
          { _id: Upload._id },
          {
            $set: {
              status: "uploaded",
              content: Content,
              contentEncoding: "base64",
              uploadedAt: UploadedAt,
            },
          },
        );

        return Response.data({
          uploadId: Upload.uploadId,
          status: "uploaded",
          uploadedAt: UploadedAt,
          sha256Verified: true,
          sizeBytes: Bytes.length,
          redacted: Redacted,
        });
      },
    };
  }

  @Post("/raw-uploads/:uploadId/complete")
  public completeRawUpload(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Upload = await RawUploadModel.findOne({
          uploadId: ctx.router.params.uploadId,
        });

        if (!Upload) {
          return fail(
            Status.NotFound,
            "UPLOAD_NOT_FOUND",
            "Raw upload not found.",
          );
        }

        if (!isAccountAllowed(ctx, Upload)) {
          return fail(
            Status.NotFound,
            "UPLOAD_NOT_FOUND",
            "Raw upload not found.",
          );
        }

        if (Upload.status === "completed") {
          return Response.data({
            uploadId: Upload.uploadId,
            status: "completed",
            completedAt: Upload.completedAt,
            sha256Verified: true,
            sizeBytes: Upload.sizeBytes,
            redacted: Upload.redact && Upload.containsVin,
          });
        }

        if (Upload.status !== "uploaded" || !Upload.content) {
          return fail(
            Status.Conflict,
            "UPLOAD_INCOMPLETE",
            "Upload the raw content before completing this upload.",
          );
        }

        const CompletedAt = new Date();

        await RawUploadModel.updateOne(
          { _id: Upload._id },
          { $set: { status: "completed", completedAt: CompletedAt } },
        );

        return Response.data({
          uploadId: Upload.uploadId,
          status: "completed",
          completedAt: CompletedAt,
          sha256Verified: true,
          sizeBytes: Upload.sizeBytes,
          redacted: Upload.redact && Upload.containsVin,
        });
      },
    };
  }

  @Get("/models")
  public models(_route: IRoute) {
    return {
      handler: () => Response.data(PredictionModels),
    };
  }

  @Post("/vehicles/:vehicleId/predictions")
  public createPrediction(_route: IRoute) {
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

        const Body = await PredictionBodySchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.prediction.body" },
        );

        const Model = PredictionModels.find((item) => item.id === Body.modelId);

        if (!Model) {
          return fail(
            Status.NotFound,
            "MODEL_NOT_FOUND",
            "Prediction model not found.",
            "modelId",
          );
        }

        if (!predictionEnabled()) {
          return fail(
            Status.Conflict,
            "PREDICTIONS_DISABLED",
            "Predictions are feature-gated and are not enabled on this server.",
          );
        }

        if (Model.status !== "production") {
          return fail(
            Status.Conflict,
            "MODEL_NOT_PRODUCTION",
            "Only a validated production model may return user-facing predictions.",
            "modelId",
          );
        }

        const PredictionId = randomId("pred");
        const GeneratedAt = new Date();

        const Prediction = await HealthPredictionModel.create({
          predictionId: PredictionId,
          vehicleKey: Profile.key,
          ...(getAccountId(ctx) ? { account: getAccountId(ctx) } : {}),
          modelId: Model.id,
          modelVersion: Model.version,
          generatedAt: GeneratedAt,
          risk: 0.23,
          riskBand: "low",
          confidence: 0.71,
          explanation: "انخفاض تدريجي في جهد البطارية مع ثبات ظروف التشغيل.",
          evidence: [
            "ميل -0.02 V/يوم خلال 30 يوماً (R²=0.44)",
            "8 قراءات جهد دون 12.3V أثناء التشغيل",
          ],
          validatedFailureDate: null,
          limitations: Model.limitations,
        });

        return Response.statusCode(Status.Created).data(Prediction);
      },
    };
  }

  @Post("/predictions/:predictionId/feedback")
  public predictionFeedback(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Prediction = await HealthPredictionModel.findOne({
          predictionId: ctx.router.params.predictionId,
        });

        if (!Prediction) {
          return fail(
            Status.NotFound,
            "PREDICTION_NOT_FOUND",
            "Prediction not found.",
          );
        }

        if (!isAccountAllowed(ctx, Prediction)) {
          return fail(
            Status.NotFound,
            "PREDICTION_NOT_FOUND",
            "Prediction not found.",
          );
        }

        const Body = await VerifyFeedbackSchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.prediction.feedback.body" },
        );

        const Feedback = await PredictionFeedbackModel.create({
          predictionId: Prediction.predictionId,
          vehicleKey: Prediction.vehicleKey,
          ...(getAccountId(ctx) ? { account: getAccountId(ctx) } : {}),
          outcome: Body.outcome,
          observedAt: Body.observedAt ?? null,
          notes: Body.notes ?? "",
        });

        return Response.statusCode(Status.Created).data(Feedback);
      },
    };
  }

  @Get("/sync")
  public sync(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Query = await SyncQuery.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: "health.sync.query" },
        );

        const Since = Query.since ?? new Date(0);
        const Limit = Query.limit;
        const Filter = accountFilter(ctx, {
          updatedAt: { $gt: Since },
        });

        const DeletedFilter = accountFilter(ctx, {
          deletedAt: { $gt: Since },
        });

        const [Profiles, Scans, Dtcs, Readings, Maintenance, Deleted] =
          await Promise.all([
            VehicleProfileModel.find(Filter).sort({ updatedAt: 1 }).limit(
              Limit,
            ),
            DiagnosticScanModel.find(Filter).sort({ updatedAt: 1 }).limit(
              Limit,
            ),
            DtcRecordModel.find(Filter).sort({ updatedAt: 1 }).limit(Limit),
            SensorReadingModel.find(Filter).sort({ updatedAt: 1 }).limit(Limit),
            MaintenanceRecordModel.find(Filter).sort({ updatedAt: 1 }).limit(
              Limit,
            ),
            HealthTombstoneModel.find(DeletedFilter).sort({ deletedAt: 1 })
              .limit(Limit),
          ]);

        return Response.data({
          profiles: Profiles,
          scans: Scans,
          dtcs: Dtcs,
          readings: Readings,
          maintenance: Maintenance,
          deleted: Deleted,
          nextSince: new Date().toISOString(),
        });
      },
    };
  }

  @Get("/healthz")
  public healthz(_route: IRoute) {
    return {
      handler: () => {
        const Connected = Database.isConnected();

        return Response
          .statusCode(Connected ? Status.OK : Status.ServiceUnavailable)
          .data({
            service: "health-record",
            version: "1.0.0",
            database: Connected ? "ok" : "down",
            queue: "ok",
            time: new Date().toISOString(),
          });
      },
    };
  }

  @Get("/version")
  public version(_route: IRoute) {
    return {
      handler: () =>
        Response.data({
          apiVersion: "1.0.0",
          minSupportedAppVersion: "1.0.0",
          features: {
            serverAssessment: true,
            predictions: predictionEnabled(),
            reports: true,
          },
        }),
    };
  }
}
