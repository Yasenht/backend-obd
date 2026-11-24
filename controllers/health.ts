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
  DtcObservationModel,
  DtcRecordModel,
  DtcStateSchema,
  HealthAssessmentModel,
  HealthPredictionModel,
  HealthReportModel,
  HealthTombstoneModel,
  InputDiagnosticScanSchema,
  MaintenanceRecordModel,
  PredictionFeedbackModel,
  RawUploadModel,
  ScanModeSchema,
  SensorReadingModel,
  VehicleProfileInputSchema,
  VehicleProfileModel,
  VinSchema,
} from "@Models/health.ts";
import {
  accountFilter,
  containsModifyingCommand,
  decodePathValue,
  DtcPattern,
  ensureProfile,
  fail,
  findProfile,
  getAccountId,
  isAccountAllowed,
  isDuplicateKeyError,
  isFutureBeyondSkew,
  normalizeDtcCodes,
  normalizeVehicleKey,
  ReadOnlyScanModes,
  scopeVehicleAccount,
  touchProfileScanTimes,
} from "@Helpers/health.ts";
import { optionalAuth } from "@Helpers/auth.ts";

const ProfileListQuery = e.deepCast(e.object({
  search: e.optional(e.string().min(1).max(200)),
  vin: e.optional(e.string().min(1).max(17)),
  limit: e.optional(e.number().min(1).max(500)).default(50),
  offset: e.optional(e.number().min(0)).default(0),
}, { allowUnexpectedProps: true }));

const ScanListQuery = e.deepCast(e.object({
  mode: e.optional(ScanModeSchema),
  from: e.optional(e.date()),
  to: e.optional(e.date()),
  limit: e.optional(e.number().min(1).max(500)).default(100),
  offset: e.optional(e.number().min(0)).default(0),
}, { allowUnexpectedProps: true }));

const DtcListQuery = e.deepCast(e.object({
  active: e.optional(e.boolean()),
  state: e.optional(DtcStateSchema),
  from: e.optional(e.date()),
  to: e.optional(e.date()),
  limit: e.optional(e.number().min(1).max(500)).default(100),
  offset: e.optional(e.number().min(0)).default(0),
}, { allowUnexpectedProps: true }));

const HistoryQuery = e.deepCast(e.object({
  limit: e.optional(e.number().min(1).max(500)).default(100),
  offset: e.optional(e.number().min(0)).default(0),
}, { allowUnexpectedProps: true }));

const DtcObservationInputSchema = e.object({
  scanId: e.string().min(1).max(120),
  codes: e.array(e.string().min(1).max(16)).max(500),
  observedAt: e.date(),
  source: e.in(
    ["ecu", "adapter", "application", "user", "backend", "derived"] as const,
  ),
  ecu: e.optional(e.string().max(80)).default(""),
  protocol: e.optional(e.string().max(80)).default(""),
  raw: e.optional(e.string().max(65536)).default(""),
  freezeFrameCodes: e.optional(e.array(e.string().max(16)).max(500)).default(
    [],
  ),
  state: e.optional(DtcStateSchema).default("stored"),
}, { allowUnexpectedProps: true });

const MigrationBodySchema = e.object({
  fromVehicleId: e.string().min(1).max(300),
  targetProfile: e.optional(e.object({
    displayName: e.optional(e.string().min(1).max(200)),
    vin: e.optional(e.or([VinSchema, e.null()])),
    make: e.optional(e.or([e.string(), e.null()])),
    model: e.optional(e.or([e.string(), e.null()])),
    year: e.optional(e.or([e.number().int().min(1886).max(3000), e.null()])),
    notes: e.optional(e.string().max(10000)),
  })),
}, { allowUnexpectedProps: true });

type DtcState = "stored" | "pending" | "permanent" | "historical";

const moveRecords = async (
  model: any,
  fromKey: string,
  toKey: string,
) => {
  const Records = await model.find({ vehicleKey: fromKey });
  let Moved = 0;

  for (const Record of Records) {
    try {
      await model.updateOne(
        { _id: Record._id },
        { $set: { vehicleKey: toKey } },
      );
      Moved++;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;

      // The target already has the same uniquely-keyed record. The source
      // copy is therefore redundant.
      await model.deleteOne({ _id: Record._id });
      Moved++;
    }
  }

  return Moved;
};

const rebuildDtcRecords = async (vehicleKey: string) => {
  const Observations = await DtcObservationModel.find({ vehicleKey })
    .sort({ observedAt: 1 });

  const Existing = await DtcRecordModel.find({ vehicleKey });
  const ExistingByCode = new Map(
    Existing.map((record: any) => [record.code, record]),
  );

  const LatestScan = await DiagnosticScanModel.findOne({ vehicleKey })
    .sort({ completedAt: -1, startedAt: -1 });

  const LatestCodes = normalizeDtcCodes(LatestScan?.dtcCodes ?? []);
  const Groups = new Map<string, any[]>();

  for (const Observation of Observations) {
    const Group = Groups.get(Observation.code) ?? [];
    Group.push(Observation);
    Groups.set(Observation.code, Group);
  }

  for (const [Code, Group] of Groups) {
    const ScanIds = new Set(Group.map((item) => item.scanId));
    const Last = Group[Group.length - 1];
    const Previous = ExistingByCode.get(Code);
    const Active = LatestScan
      ? LatestCodes.includes(Code)
      : !!Previous?.activeInLatestScan;

    await DtcRecordModel.updateOne(
      { vehicleKey, code: Code },
      {
        $set: {
          vehicleKey,
          code: Code,
          status: Active ? Last.state : "historical",
          firstSeenAt: Group[0].observedAt,
          lastSeenAt: Last.observedAt,
          lastNotReportedAt: Active
            ? null
            : Previous?.lastNotReportedAt ?? null,
          occurrenceCount: ScanIds.size,
          scanCount: ScanIds.size,
          activeInLatestScan: Active,
          source: Last.source,
          ecu: Last.ecu ?? "",
          protocol: Last.protocol ?? "",
          raw: Last.raw ?? "",
          freezeFrame: Group.some((item) => item.freezeFrame),
          description: Previous?.description ?? "",
        },
      },
      { upsert: true },
    );
  }

  return Groups.size;
};

@Controller("/health/", {
  name: "health",
  middlewares: [optionalAuth(), scopeVehicleAccount()],
})
export default class HealthController extends BaseController {
  /* ---------------------------------------------------------------------- */
  /* Vehicle profiles                                                       */
  /* ---------------------------------------------------------------------- */

  @Get("/vehicles/profiles")
  public listProfiles(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Query = await ProfileListQuery.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: "health.profiles.query" },
        );

        const Filter: Record<string, any> = accountFilter(ctx, {});

        if (Query.vin) Filter.vin = Query.vin.trim().toUpperCase();

        if (Query.search) {
          const Pattern = new RegExp(
            Query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
          );

          Filter.$or = [
            { displayName: Pattern },
            { vin: Pattern },
            { key: Pattern },
          ];
        }

        const Results = await VehicleProfileModel.find(Filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(Query.offset)
          .limit(Query.limit);

        return Response.data({
          totalCount: await VehicleProfileModel.countDocuments(Filter),
          results: Results,
        });
      },
    };
  }

  @Get("/vehicles/:vehicleId/profile")
  public getProfile(_route: IRoute) {
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

        return Response.data(Profile);
      },
    };
  }

  @Put("/vehicles/:vehicleId/profile")
  public putProfile(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await VehicleProfileInputSchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.profile.body" },
        );

        const Key = await normalizeVehicleKey(ctx.router.params.vehicleId);

        if (!Key) {
          return fail(
            Status.BadRequest,
            "INVALID_VEHICLE_ID",
            "A valid vehicle id is required.",
            "vehicleId",
          );
        }

        const Vin = Body.vin ? Body.vin.trim().toUpperCase() : null;

        if (Vin) {
          const VinOwner = await VehicleProfileModel.findOne({
            vin: Vin,
            key: { $ne: Key },
          });

          if (VinOwner) {
            return fail(
              Status.Conflict,
              "VIN_ALREADY_REGISTERED",
              "This VIN is already linked to another vehicle profile.",
              "vin",
            );
          }
        }

        const Existing = await VehicleProfileModel.findOne({ key: Key });
        const Account = getAccountId(ctx);

        if (Existing) {
          const Changes = {
            displayName: Body.displayName.trim(),
            vin: Vin,
            make: Body.make ?? null,
            model: Body.model ?? null,
            year: Body.year ?? null,
            notes: Body.notes ?? "",
          };

          await VehicleProfileModel.updateOne(
            { _id: Existing._id },
            { $set: Changes },
          );

          const Updated = await VehicleProfileModel.findOne({
            _id: Existing._id,
          });

          return Response.data((Updated ?? {}) as Record<string, any>);
        }

        const Created = await VehicleProfileModel.create({
          key: Key,
          id: Key,
          ...(Account ? { account: Account } : {}),
          displayName: Body.displayName.trim(),
          vin: Vin,
          make: Body.make ?? null,
          model: Body.model ?? null,
          year: Body.year ?? null,
          notes: Body.notes ?? "",
          firstScanAt: null,
          lastScanAt: null,
        });

        return Response.statusCode(Status.OK).data(Created);
      },
    };
  }

  @Post("/vehicles/:vehicleId/migrate")
  public migrateVehicle(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await MigrationBodySchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.migrate.body" },
        );

        const FromKey = await normalizeVehicleKey(Body.fromVehicleId);
        const ToKey = await normalizeVehicleKey(ctx.router.params.vehicleId);

        if (!FromKey || !ToKey) {
          return fail(
            Status.BadRequest,
            "INVALID_VEHICLE_ID",
            "Both source and target vehicle ids are required.",
            "vehicleId",
          );
        }

        if (FromKey === ToKey) {
          return fail(
            Status.BadRequest,
            "INVALID_MIGRATION",
            "Source and target vehicle ids must be different.",
            "fromVehicleId",
          );
        }

        const Target = await ensureProfile(
          ToKey,
          Body.targetProfile,
          getAccountId(ctx),
        );

        if (!Target) {
          return fail(
            Status.BadRequest,
            "INVALID_TARGET_VEHICLE",
            "The target vehicle profile could not be created.",
            "targetProfile",
          );
        }

        const FromProfile = await VehicleProfileModel.findOne({
          key: FromKey,
        });

        if (!FromProfile) {
          return fail(
            Status.NotFound,
            "VEHICLE_NOT_FOUND",
            "Source vehicle profile not found.",
            "fromVehicleId",
          );
        }

        if (!isAccountAllowed(ctx, FromProfile)) {
          return fail(
            Status.NotFound,
            "VEHICLE_NOT_FOUND",
            "Source vehicle profile not found.",
            "fromVehicleId",
          );
        }

        const Moved: Record<string, number> = {};

        Moved.scans = await moveRecords(DiagnosticScanModel, FromKey, ToKey);
        Moved.observations = await moveRecords(
          DtcObservationModel,
          FromKey,
          ToKey,
        );
        Moved.readings = await moveRecords(SensorReadingModel, FromKey, ToKey);
        Moved.maintenance = await moveRecords(
          MaintenanceRecordModel,
          FromKey,
          ToKey,
        );
        Moved.assessments = await moveRecords(
          HealthAssessmentModel,
          FromKey,
          ToKey,
        );
        Moved.reports = await moveRecords(HealthReportModel, FromKey, ToKey);
        Moved.rawUploads = await moveRecords(RawUploadModel, FromKey, ToKey);
        Moved.predictions = await moveRecords(
          HealthPredictionModel,
          FromKey,
          ToKey,
        );
        Moved.predictionFeedback = await moveRecords(
          PredictionFeedbackModel,
          FromKey,
          ToKey,
        );
        Moved.tombstones = await moveRecords(
          HealthTombstoneModel,
          FromKey,
          ToKey,
        );

        const RebuiltDtcs = await rebuildDtcRecords(ToKey);

        const SourceDtcs = await DtcRecordModel.find({ vehicleKey: FromKey });

        if (SourceDtcs.length) {
          await DtcRecordModel.deleteMany({ vehicleKey: FromKey });
          Moved.dtcs = RebuiltDtcs;
        } else {
          Moved.dtcs = RebuiltDtcs;
        }

        await VehicleProfileModel.updateOne(
          { key: FromKey },
          { $set: { migratedTo: ToKey } },
        );

        return Response.data({
          fromVehicleId: FromKey,
          toVehicleId: ToKey,
          migrated: Moved,
          profile: await VehicleProfileModel.findOne({ key: ToKey }),
        });
      },
    };
  }

  @Delete("/vehicles/:vehicleId")
  public deleteVehicle(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Key = await normalizeVehicleKey(ctx.router.params.vehicleId);
        const Profile = Key
          ? await VehicleProfileModel.findOne({ key: Key })
          : null;

        if (!Key || !Profile) {
          return fail(
            Status.NotFound,
            "VEHICLE_NOT_FOUND",
            "Vehicle profile not found.",
          );
        }

        await Promise.all([
          DiagnosticScanModel.deleteMany({ vehicleKey: Key }),
          DtcObservationModel.deleteMany({ vehicleKey: Key }),
          DtcRecordModel.deleteMany({ vehicleKey: Key }),
          SensorReadingModel.deleteMany({ vehicleKey: Key }),
          MaintenanceRecordModel.deleteMany({ vehicleKey: Key }),
          HealthAssessmentModel.deleteMany({ vehicleKey: Key }),
          HealthReportModel.deleteMany({ vehicleKey: Key }),
          RawUploadModel.deleteMany({ vehicleKey: Key }),
          HealthPredictionModel.deleteMany({ vehicleKey: Key }),
          PredictionFeedbackModel.deleteMany({ vehicleKey: Key }),
        ]);

        await HealthTombstoneModel.create({
          entity: "vehicle",
          entityId: Key,
          vehicleKey: Key,
          ...(getAccountId(ctx) ? { account: getAccountId(ctx) } : {}),
          deletedAt: new Date(),
        });

        await VehicleProfileModel.deleteOne({ key: Key });

        return RawResponse.statusCode(Status.NoContent);
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Diagnostic scans                                                       */
  /* ---------------------------------------------------------------------- */

  @Post("/vehicles/:vehicleId/scans")
  public createScan(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await InputDiagnosticScanSchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.scan.body" },
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

        if (isFutureBeyondSkew(Body.startedAt)) {
          return fail(
            422,
            "FUTURE_TIMESTAMP",
            "startedAt cannot be more than five minutes in the future.",
            "startedAt",
          );
        }

        if (Body.completedAt && isFutureBeyondSkew(Body.completedAt)) {
          return fail(
            422,
            "FUTURE_TIMESTAMP",
            "completedAt cannot be more than five minutes in the future.",
            "completedAt",
          );
        }

        if (Body.readOnly !== true && ReadOnlyScanModes.has(Body.mode)) {
          return fail(
            Status.BadRequest,
            "READ_ONLY_VIOLATION",
            "First-connection, DTC, and freeze-frame scans must be readOnly=true.",
            "readOnly",
          );
        }

        const ModifyingRecord = Body.rawRecords.find((record) =>
          containsModifyingCommand(record.command)
        );

        if (ModifyingRecord) {
          return fail(
            Status.BadRequest,
            "READ_ONLY_VIOLATION",
            "A scan cannot contain a modifying or ECU-configuration command.",
            "rawRecords",
          );
        }

        const ScanId = Body.id.trim();

        const Doc = {
          ...Body,
          vehicleKey: Profile.key,
          scanId: ScanId,
          ...(getAccountId(ctx) ? { account: getAccountId(ctx) } : {}),
          vin: Body.vin ? Body.vin.trim().toUpperCase() : null,
          dtcCodes: normalizeDtcCodes(Body.dtcCodes),
          freezeFrameCodes: normalizeDtcCodes(Body.freezeFrameCodes),
        };

        const Existing = await DiagnosticScanModel.findOne({
          vehicleKey: Profile.key,
          scanId: ScanId,
        });

        if (Existing) {
          await DiagnosticScanModel.updateOne(
            { _id: Existing._id },
            { $set: Doc },
          );
        } else {
          await DiagnosticScanModel.create(Doc);
        }

        await touchProfileScanTimes(
          Profile.key,
          Body.startedAt,
          Body.completedAt ?? null,
        );

        const Saved = await DiagnosticScanModel.findOne({
          vehicleKey: Profile.key,
          scanId: ScanId,
        });

        return Response
          .statusCode(Status.Created)
          .data((Saved ?? {}) as Record<string, any>);
      },
    };
  }

  @Get("/vehicles/:vehicleId/scans")
  public listScans(_route: IRoute) {
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

        const Query = await ScanListQuery.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: "health.scans.query" },
        );

        const Filter: Record<string, any> = { vehicleKey: Profile.key };

        if (Query.mode) Filter.mode = Query.mode;

        if (Query.from || Query.to) {
          Filter.completedAt = {
            ...(Query.from ? { $gte: Query.from } : {}),
            ...(Query.to ? { $lte: Query.to } : {}),
          };
        }

        const Results = await DiagnosticScanModel.find(Filter)
          .sort({ completedAt: -1, startedAt: -1, _id: -1 })
          .skip(Query.offset)
          .limit(Query.limit)
          .project({ rawRecords: 0 });

        return Response.data({
          totalCount: await DiagnosticScanModel.countDocuments(Filter),
          results: Results,
        });
      },
    };
  }

  @Get("/vehicles/:vehicleId/scans/:scanId")
  public getScan(_route: IRoute) {
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

        const Scan = await DiagnosticScanModel.findOne({
          vehicleKey: Profile.key,
          scanId: decodePathValue(ctx.router.params.scanId),
        });

        if (!Scan) {
          return fail(
            Status.NotFound,
            "SCAN_NOT_FOUND",
            "Diagnostic scan not found.",
          );
        }

        return Response.data(Scan);
      },
    };
  }

  @Get("/vehicles/:vehicleId/scans/:scanId/freeze-frame")
  public getFreezeFrame(_route: IRoute) {
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

        const Scan = await DiagnosticScanModel.findOne({
          vehicleKey: Profile.key,
          scanId: decodePathValue(ctx.router.params.scanId),
        });

        if (!Scan) {
          return fail(
            Status.NotFound,
            "SCAN_NOT_FOUND",
            "Diagnostic scan not found.",
          );
        }

        const FreezeFrameCodes = normalizeDtcCodes(Scan.freezeFrameCodes ?? []);

        const normalizeHex = (value: string | undefined) =>
          (value ?? "").replace(/\s+/g, "").toUpperCase();

        const FreezeFrameHex = FreezeFrameCodes.map((code) =>
          normalizeHex(code.slice(1))
        );

        return Response.data({
          scanId: Scan.scanId,
          freezeFrameCodes: FreezeFrameCodes,
          rawRecords: (Scan.rawRecords ?? []).filter((record: any) => {
            const Command = normalizeHex(record.command);
            const ResponseText = normalizeHex(record.rawResponse);

            return FreezeFrameCodes.includes(record.command) ||
              Command.startsWith("02") ||
              /freeze/i.test(record.decodedSummary ?? "") ||
              FreezeFrameHex.some((hex) =>
                Command.includes(hex) || ResponseText.includes(hex)
              );
          }),
          available: FreezeFrameCodes.length > 0,
          unavailable: FreezeFrameCodes.length ? [] : [{
            feature: "Freeze frame",
            reason: "The ECU did not report freeze-frame data in this scan.",
            source: "application",
          }],
        });
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* DTCs                                                                   */
  /* ---------------------------------------------------------------------- */

  @Post("/vehicles/:vehicleId/dtcs/observations")
  public observeDtcs(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await DtcObservationInputSchema.validate(
          await ctx.router.request.body.json(),
          { name: "health.dtcs.body" },
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

        const ScanId = Body.scanId.trim();

        const Scan = await DiagnosticScanModel.findOne({
          vehicleKey: Profile.key,
          scanId: ScanId,
        });

        if (!Scan) {
          return fail(
            Status.NotFound,
            "SCAN_NOT_FOUND",
            "The referenced diagnostic scan was not found.",
            "scanId",
          );
        }

        if (isFutureBeyondSkew(Body.observedAt)) {
          return fail(
            422,
            "FUTURE_TIMESTAMP",
            "observedAt cannot be more than five minutes in the future.",
            "observedAt",
          );
        }

        const Codes = normalizeDtcCodes(Body.codes);

        const InvalidCode = Body.codes
          .map((code) => code.trim().toUpperCase())
          .find((code) => !DtcPattern.test(code));

        if (InvalidCode) {
          return fail(
            Status.BadRequest,
            "INVALID_DTC_CODE",
            `'${InvalidCode}' is not a valid OBD-II diagnostic trouble code.`,
            "codes",
          );
        }

        const FreezeFrameCodes = normalizeDtcCodes(Body.freezeFrameCodes ?? []);
        const State = (Body.state ?? "stored") as DtcState;

        for (const Code of Codes) {
          const ExistingObservation = await DtcObservationModel.findOne({
            vehicleKey: Profile.key,
            scanId: ScanId,
            code: Code,
          });

          const Observation = {
            vehicleKey: Profile.key,
            scanId: ScanId,
            code: Code,
            observedAt: Body.observedAt,
            source: Body.source,
            ecu: Body.ecu ?? "",
            protocol: Body.protocol ?? "",
            raw: Body.raw ?? "",
            freezeFrame: FreezeFrameCodes.includes(Code),
            state: State,
            ...(getAccountId(ctx) ? { account: getAccountId(ctx) } : {}),
          };

          if (ExistingObservation) {
            await DtcObservationModel.updateOne(
              { _id: ExistingObservation._id },
              { $set: Observation },
            );
          } else {
            try {
              await DtcObservationModel.create(Observation);
            } catch (error) {
              if (!isDuplicateKeyError(error)) throw error;
            }
          }

          const ExistingRecord = await DtcRecordModel.findOne({
            vehicleKey: Profile.key,
            code: Code,
          });

          if (!ExistingRecord) {
            await DtcRecordModel.create({
              vehicleKey: Profile.key,
              ...(getAccountId(ctx) ? { account: getAccountId(ctx) } : {}),
              code: Code,
              status: State,
              firstSeenAt: Body.observedAt,
              lastSeenAt: Body.observedAt,
              lastNotReportedAt: null,
              occurrenceCount: 1,
              scanCount: 1,
              activeInLatestScan: true,
              source: Body.source,
              ecu: Body.ecu ?? "",
              protocol: Body.protocol ?? "",
              raw: Body.raw ?? "",
              freezeFrame: FreezeFrameCodes.includes(Code),
              description: "",
            });
          } else if (!ExistingObservation) {
            await DtcRecordModel.updateOne(
              { _id: ExistingRecord._id },
              {
                $inc: { occurrenceCount: 1, scanCount: 1 },
                $set: {
                  status: State,
                  lastSeenAt: Body.observedAt,
                  lastNotReportedAt: null,
                  activeInLatestScan: true,
                  freezeFrame: FreezeFrameCodes.includes(Code),
                  source: Body.source,
                  ecu: Body.ecu ?? "",
                  protocol: Body.protocol ?? "",
                  raw: Body.raw ?? "",
                },
              },
            );
          } else {
            await DtcRecordModel.updateOne(
              { _id: ExistingRecord._id },
              {
                $set: {
                  status: State,
                  lastSeenAt: Body.observedAt,
                  lastNotReportedAt: null,
                  activeInLatestScan: true,
                  freezeFrame: FreezeFrameCodes.includes(Code),
                  source: Body.source,
                  ecu: Body.ecu ?? "",
                  protocol: Body.protocol ?? "",
                  raw: Body.raw ?? "",
                },
              },
            );
          }
        }

        if (Scan.status !== "failed") {
          await DtcRecordModel.updateMany(
            {
              vehicleKey: Profile.key,
              code: { $nin: Codes },
              activeInLatestScan: true,
            },
            {
              $set: {
                activeInLatestScan: false,
                lastNotReportedAt: Body.observedAt,
                status: "historical",
              },
            },
          );
        }

        const Records = await DtcRecordModel.find({
          vehicleKey: Profile.key,
        }).sort({ activeInLatestScan: -1, lastSeenAt: -1 });

        return Response.data(Records);
      },
    };
  }

  @Get("/vehicles/:vehicleId/dtcs")
  public listDtcs(_route: IRoute) {
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

        const Query = await DtcListQuery.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: "health.dtcs.query" },
        );

        const Filter: Record<string, any> = { vehicleKey: Profile.key };

        if (typeof Query.active === "boolean") {
          Filter.activeInLatestScan = Query.active;
        }

        if (Query.state) Filter.status = Query.state;

        if (Query.from || Query.to) {
          Filter.lastSeenAt = {
            ...(Query.from ? { $gte: Query.from } : {}),
            ...(Query.to ? { $lte: Query.to } : {}),
          };
        }

        const Results = await DtcRecordModel.find(Filter)
          .sort({ activeInLatestScan: -1, lastSeenAt: -1, _id: -1 })
          .skip(Query.offset)
          .limit(Query.limit);

        return Response.data({
          totalCount: await DtcRecordModel.countDocuments(Filter),
          results: Results,
        });
      },
    };
  }

  @Get("/vehicles/:vehicleId/dtcs/:code/history")
  public dtcHistory(_route: IRoute) {
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

        const Query = await HistoryQuery.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: "health.dtc-history.query" },
        );

        const Code = decodePathValue(ctx.router.params.code).toUpperCase();

        const Filter = { vehicleKey: Profile.key, code: Code };

        const Observations = await DtcObservationModel.find(Filter)
          .sort({ observedAt: -1, _id: -1 })
          .skip(Query.offset)
          .limit(Query.limit);

        return Response.data({
          code: Code,
          totalCount: await DtcObservationModel.countDocuments(Filter),
          observations: Observations,
        });
      },
    };
  }
}
