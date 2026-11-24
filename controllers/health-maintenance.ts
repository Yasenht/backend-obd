// deno-lint-ignore-file no-explicit-any
import {
  BaseController,
  Controller,
  Delete,
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

import {
  DiagnosticScanModel,
  DtcRecordModel,
  HealthAssessmentModel,
  HealthTombstoneModel,
  InputMaintenanceSchema,
  MaintenanceRecordModel,
} from "@Models/health.ts";
import {
  decodePathValue,
  ensureProfile,
  fail,
  findProfile,
  getAccountId,
  isFutureBeyondSkew,
  normalizeDtcCodes,
  scopeVehicleAccount,
} from "@Helpers/health.ts";
import { generateAssessment } from "@Helpers/assessment.ts";
import { optionalAuth } from "@Helpers/auth.ts";

const MaintenanceListQuery = e.deepCast(e.object({
  limit: e.optional(e.number().int().min(1).max(500)).default(100),
  offset: e.optional(e.number().int().min(0)).default(0),
}, { allowUnexpectedProps: true }));

const VerifyBodySchema = e.object({
  scanId: e.string().min(1).max(120),
  verifiedAt: e.optional(e.date()),
}, { allowUnexpectedProps: true });

const AssessmentBodySchema = e.object({
  generatedAt: e.optional(e.date()),
  windowDays: e.optional(e.number().int().min(1).max(3650)).default(30),
  includeMaintenance: e.optional(e.boolean()).default(true),
}, { allowUnexpectedProps: true });

@Controller("/health/", {
  name: "healthMaintenance",
  middlewares: [optionalAuth(), scopeVehicleAccount()],
})
export default class HealthMaintenanceController extends BaseController {
  @Get("/vehicles/:vehicleId/maintenance")
  public listMaintenance(_route: IRoute) {
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

        const Query = await MaintenanceListQuery.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: "health.maintenance.query" },
        );

        const Filter = { vehicleKey: Profile.key };

        const Results = await MaintenanceRecordModel.find(Filter)
          .sort({ performedAt: -1, _id: -1 })
          .skip(Query.offset)
          .limit(Query.limit);

        return Response.data({
          totalCount: await MaintenanceRecordModel.countDocuments(Filter),
          results: Results,
        });
      },
    };
  }

  @Put("/vehicles/:vehicleId/maintenance/:recordId")
  public putMaintenance(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await InputMaintenanceSchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.maintenance.body" },
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

        const RecordId = decodePathValue(ctx.router.params.recordId);

        if (Body.id && Body.id !== RecordId) {
          return fail(
            Status.Conflict,
            "RECORD_ID_MISMATCH",
            "The record id in the body does not match the URL.",
            "id",
          );
        }

        if (isFutureBeyondSkew(Body.performedAt)) {
          return fail(
            422,
            "FUTURE_TIMESTAMP",
            "performedAt cannot be more than five minutes in the future.",
            "performedAt",
          );
        }

        const Account = getAccountId(ctx);

        const Doc = {
          ...Body,
          id: RecordId,
          vehicleId: Profile.key,
          vehicleKey: Profile.key,
          recordId: RecordId,
          dtcCodesBefore: normalizeDtcCodes(Body.dtcCodesBefore ?? []),
          ...(Account ? { account: Account } : {}),
        };

        await MaintenanceRecordModel.updateOne(
          { vehicleKey: Profile.key, recordId: RecordId },
          {
            $set: Doc,
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true },
        );

        const Saved = await MaintenanceRecordModel.findOne({
          vehicleKey: Profile.key,
          recordId: RecordId,
        });

        return Response.data((Saved ?? {}) as Record<string, any>);
      },
    };
  }

  @Delete("/vehicles/:vehicleId/maintenance/:recordId")
  public deleteMaintenance(_route: IRoute) {
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

        const RecordId = decodePathValue(ctx.router.params.recordId);

        const Result = await MaintenanceRecordModel.deleteOne({
          vehicleKey: Profile.key,
          recordId: RecordId,
        });

        if (!Result.deletedCount) {
          return fail(
            Status.NotFound,
            "MAINTENANCE_NOT_FOUND",
            "Maintenance record not found.",
          );
        }

        await HealthTombstoneModel.create({
          entity: "maintenance",
          entityId: RecordId,
          vehicleKey: Profile.key,
          ...(getAccountId(ctx) ? { account: getAccountId(ctx) } : {}),
          deletedAt: new Date(),
        });

        return RawResponse.statusCode(Status.NoContent);
      },
    };
  }

  @Post("/vehicles/:vehicleId/maintenance/:recordId/verify")
  public verifyMaintenance(_route: IRoute) {
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

        const Record = await MaintenanceRecordModel.findOne({
          vehicleKey: Profile.key,
          recordId: decodePathValue(ctx.router.params.recordId),
        });

        if (!Record) {
          return fail(
            Status.NotFound,
            "MAINTENANCE_NOT_FOUND",
            "Maintenance record not found.",
          );
        }

        const Body = await VerifyBodySchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.maintenance.verify.body" },
        );

        const VerifiedAt = Body.verifiedAt ?? new Date();

        if (isFutureBeyondSkew(VerifiedAt)) {
          return fail(
            422,
            "FUTURE_TIMESTAMP",
            "verifiedAt cannot be more than five minutes in the future.",
            "verifiedAt",
          );
        }

        const Scan = await DiagnosticScanModel.findOne({
          vehicleKey: Profile.key,
          scanId: Body.scanId,
        });

        if (!Scan) {
          return fail(
            Status.NotFound,
            "SCAN_NOT_FOUND",
            "The verification scan was not found.",
            "scanId",
          );
        }

        const LatestAssessment = await HealthAssessmentModel.findOne({
          vehicleKey: Profile.key,
        }).sort({ generatedAt: -1, _id: -1 });

        const ActiveDtcs = await DtcRecordModel.find({
          vehicleKey: Profile.key,
          activeInLatestScan: true,
        });

        const CurrentCodes = ActiveDtcs.length
          ? normalizeDtcCodes(ActiveDtcs.map((record: any) => record.code))
          : normalizeDtcCodes(Scan.dtcCodes ?? []);

        const BeforeCodes = normalizeDtcCodes(Record.dtcCodesBefore ?? []);

        const ResolvedCodes = BeforeCodes.filter((code) =>
          !CurrentCodes.includes(code)
        );

        const PersistingCodes = BeforeCodes.filter((code) =>
          CurrentCodes.includes(code)
        );

        const NewCodes = CurrentCodes.filter((code) =>
          !BeforeCodes.includes(code)
        );

        const ScoreBefore = typeof Record.scoreBefore === "number"
          ? Record.scoreBefore
          : null;

        const ScoreAfter = typeof LatestAssessment?.overallScore === "number"
          ? LatestAssessment.overallScore
          : null;

        let Outcome:
          | "improved"
          | "unchanged"
          | "worse"
          | "insufficientData" = "insufficientData";

        if (NewCodes.length) {
          Outcome = "worse";
        } else if (ResolvedCodes.length) {
          Outcome = "improved";
        } else if (ScoreBefore !== null && ScoreAfter !== null) {
          if (ScoreAfter - ScoreBefore > 1) Outcome = "improved";
          else if (ScoreBefore - ScoreAfter > 1) Outcome = "worse";
          else Outcome = "unchanged";
        } else if (
          ScoreBefore === null && ScoreAfter === null &&
          !BeforeCodes.length && !CurrentCodes.length
        ) {
          Outcome = "insufficientData";
        }

        const Verification = {
          verifiedAt: VerifiedAt,
          outcome: Outcome,
          scanId: Body.scanId,
          scoreBefore: ScoreBefore,
          scoreAfter: ScoreAfter,
          confidenceAfter: LatestAssessment?.overallConfidence ?? null,
          resolvedCodes: ResolvedCodes,
          persistingCodes: PersistingCodes,
          newCodes: NewCodes,
          notes:
            "التحقق يعتمد على بيانات هذا الجهاز وقد يتأثر بمسح الأكواد أو دورة القيادة. لا يثبت السبب الجذري.",
        };

        await MaintenanceRecordModel.updateOne(
          { _id: Record._id },
          { $set: { verification: Verification } },
        );

        return Response.data(Verification);
      },
    };
  }

  @Post("/vehicles/:vehicleId/assessments")
  public createAssessment(_route: IRoute) {
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

        const Body = await AssessmentBodySchema.validate(
          await ctx.router.request.body.json().catch(() => ({})),
          { name: "health.assessment.body" },
        );

        const GeneratedAt = Body.generatedAt ?? new Date();

        if (isFutureBeyondSkew(GeneratedAt)) {
          return fail(
            422,
            "FUTURE_TIMESTAMP",
            "generatedAt cannot be more than five minutes in the future.",
            "generatedAt",
          );
        }

        const Account = getAccountId(ctx);

        const Assessment = await generateAssessment(Profile.key, {
          generatedAt: GeneratedAt,
          windowDays: Body.windowDays,
          includeMaintenance: Body.includeMaintenance,
          ...(Account ? { account: Account } : {}),
        });

        const Created = await HealthAssessmentModel.create(Assessment);

        return Response
          .statusCode(Status.Created)
          .data(Created as any);
      },
    };
  }

  @Get("/vehicles/:vehicleId/assessments/latest")
  public latestAssessment(_route: IRoute) {
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

        const Assessment = await HealthAssessmentModel.findOne({
          vehicleKey: Profile.key,
        }).sort({ generatedAt: -1, _id: -1 });

        if (!Assessment) {
          return fail(
            Status.NotFound,
            "ASSESSMENT_NOT_FOUND",
            "No assessment has been generated for this vehicle.",
          );
        }

        return Response.data(Assessment);
      },
    };
  }
}
