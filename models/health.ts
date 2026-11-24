import e from "validator";
import { Mongo, ObjectId } from "mongo";

/**
 * Shared value sets from the DriveScope health-record contract.
 */
export const SourceSchema = e.in(
  [
    "ecu",
    "adapter",
    "application",
    "user",
    "backend",
    "derived",
  ] as const,
);

export const QualitySchema = e.in(
  [
    "good",
    "partial",
    "unavailable",
    "unknown",
  ] as const,
);

export const ScanModeSchema = e.in(
  [
    "firstConnection",
    "dtcScan",
    "freezeFrame",
    "liveData",
    "manual",
    "other",
  ] as const,
);

export const ScanStatusSchema = e.in(
  [
    "completed",
    "partial",
    "failed",
  ] as const,
);

export const DtcStateSchema = e.in(
  [
    "stored",
    "pending",
    "permanent",
    "historical",
  ] as const,
);

export const MaintenanceTypeSchema = e.in(
  [
    "repair",
    "maintenance",
    "inspection",
    "partReplacement",
  ] as const,
);

export const SensorKeys = [
  "rpm",
  "speed_kph",
  "coolant_c",
  "battery_v",
  "stft_pct",
  "ltft_pct",
  "throttle_pct",
  "intake_air_c",
  "maf_gps",
  "fuel_level_pct",
  "engine_load_pct",
  "control_voltage_v",
  "oil_temp_c",
] as const;

const IdField = e.optional(e.instanceOf(ObjectId, { instantiate: true }));

const TimestampFields = {
  createdAt: e.optional(e.date()).default(() => new Date()),
  updatedAt: e.optional(e.date()).default(() => new Date()),
};

const NullableString = () => e.optional(e.or([e.string(), e.null()]));
const NullableNumber = () => e.optional(e.or([e.number(), e.null()]));
const NullableDate = () => e.optional(e.or([e.date(), e.null()]));

const VinPattern = /^[A-HJ-NPR-Z0-9]{17}$/i;

export const VinSchema = e.string()
  .min(17)
  .max(17)
  .matches(VinPattern);

/* -------------------------------------------------------------------------- */
/* Vehicle profiles                                                           */
/* -------------------------------------------------------------------------- */

export const VehicleProfileInputSchema = e.object({
  displayName: e.string().min(1).max(200),

  vin: e.optional(e.or([VinSchema, e.null()])),

  make: NullableString(),

  model: NullableString(),

  year: e.optional(e.or([
    e.number().int().min(1886).max(3000),
    e.null(),
  ])),

  notes: e.optional(e.string().max(10000)).default(""),
});

export const VehicleProfileSchema = e.object({
  _id: IdField,

  key: e.string().min(1).max(300),

  id: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  migratedTo: NullableString(),

  firstScanAt: NullableDate(),

  lastScanAt: NullableDate(),

  ...TimestampFields,
}).extends(VehicleProfileInputSchema);

export const VehicleProfileModel = Mongo.model(
  "vehicleProfile",
  VehicleProfileSchema,
);

VehicleProfileModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

VehicleProfileModel.createIndex({
  key: { key: 1 },
  name: "profile_key_unique",
  unique: true,
});

VehicleProfileModel.createIndex({
  key: { vin: 1 },
  name: "profile_vin",
  partialFilterExpression: { vin: { $type: "string" } },
});

/* -------------------------------------------------------------------------- */
/* Diagnostic scans                                                           */
/* -------------------------------------------------------------------------- */

export const ScanModuleSchema = e.object({
  id: e.string().min(1).max(80),

  name: e.string().min(1).max(200),

  address: e.optional(e.string().max(80)).default(""),

  protocol: e.optional(e.string().max(80)).default(""),

  reachable: e.boolean(),

  softwareVersion: NullableString(),

  notes: e.optional(e.string().max(2000)).default(""),
}).rest(e.any());

export const RawRecordSchema = e.object({
  id: e.string().min(1).max(120),

  command: e.string().min(1).max(100),

  rawResponse: e.string().max(65536),

  decodedSummary: e.optional(e.string().max(2000)).default(""),

  recordedAt: e.date(),

  source: SourceSchema,

  quality: QualitySchema,

  error: NullableString(),
}).rest(e.any());

export const UnavailableFeatureSchema = e.object({
  feature: e.string().min(1).max(200),

  reason: e.string().min(1).max(2000),

  source: SourceSchema,
}).rest(e.any());

export const InputDiagnosticScanSchema = e.object({
  id: e.string().min(1).max(120),

  vehicleId: e.optional(e.string().max(300)),

  mode: ScanModeSchema,

  startedAt: e.date(),

  completedAt: e.optional(e.or([e.date(), e.null()])),

  status: ScanStatusSchema,

  readOnly: e.boolean(),

  protocol: e.optional(e.string().max(80)).default(""),

  adapterName: e.optional(e.string().max(200)).default(""),

  vin: e.optional(e.or([VinSchema, e.null()])),

  modules: e.optional(e.array(ScanModuleSchema).max(100)).default([]),

  rawRecords: e.optional(e.array(RawRecordSchema).max(5000)).default([]),

  dtcCodes: e.optional(e.array(e.string().max(16)).max(500)).default([]),

  freezeFrameCodes: e.optional(e.array(e.string().max(16)).max(500)).default(
    [],
  ),

  milOn: e.optional(e.boolean()).default(false),

  dtcCount: e.optional(e.number().int().min(0)).default(0),

  readinessIncomplete: e.optional(e.array(e.string().max(100)).max(100))
    .default([]),

  unavailable: e.optional(e.array(UnavailableFeatureSchema).max(100)).default(
    [],
  ),

  dataCoverage: e.optional(e.number().min(0).max(1)).default(0),

  notes: e.optional(e.string().max(5000)).default(""),
}, { allowUnexpectedProps: true });

export const DiagnosticScanSchema = e.object({
  _id: IdField,

  vehicleKey: e.string().min(1).max(300),

  scanId: e.string().min(1).max(120),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  ...TimestampFields,
}).extends(InputDiagnosticScanSchema);

export const DiagnosticScanModel = Mongo.model(
  "diagnosticScan",
  DiagnosticScanSchema,
);

DiagnosticScanModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

DiagnosticScanModel.createIndex({
  key: { vehicleKey: 1, scanId: 1 },
  name: "scan_vehicle_unique",
  unique: true,
});

DiagnosticScanModel.createIndex({
  key: { vehicleKey: 1, completedAt: -1, startedAt: -1 },
  name: "scan_vehicle_time",
});

/* -------------------------------------------------------------------------- */
/* DTC records and observations                                               */
/* -------------------------------------------------------------------------- */

export const DtcRecordSchema = e.object({
  _id: IdField,

  vehicleKey: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  code: e.string().min(3).max(16),

  status: DtcStateSchema,

  firstSeenAt: e.date(),

  lastSeenAt: e.date(),

  lastNotReportedAt: NullableDate(),

  occurrenceCount: e.number().int().min(0),

  scanCount: e.number().int().min(0),

  activeInLatestScan: e.boolean(),

  source: SourceSchema,

  ecu: e.optional(e.string().max(80)).default(""),

  protocol: e.optional(e.string().max(80)).default(""),

  raw: e.optional(e.string().max(65536)).default(""),

  freezeFrame: e.optional(e.boolean()).default(false),

  description: e.optional(e.string().max(2000)).default(""),

  ...TimestampFields,
});

export const DtcRecordModel = Mongo.model("dtcRecord", DtcRecordSchema);

DtcRecordModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

DtcRecordModel.createIndex({
  key: { vehicleKey: 1, code: 1 },
  name: "dtc_vehicle_code_unique",
  unique: true,
});

DtcRecordModel.createIndex({
  key: { vehicleKey: 1, activeInLatestScan: 1, lastSeenAt: -1 },
  name: "dtc_vehicle_active",
});

export const DtcObservationSchema = e.object({
  _id: IdField,

  vehicleKey: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  scanId: e.string().min(1).max(120),

  code: e.string().min(3).max(16),

  observedAt: e.date(),

  source: SourceSchema,

  ecu: e.optional(e.string().max(80)).default(""),

  protocol: e.optional(e.string().max(80)).default(""),

  raw: e.optional(e.string().max(65536)).default(""),

  freezeFrame: e.optional(e.boolean()).default(false),

  state: DtcStateSchema,

  ...TimestampFields,
});

export const DtcObservationModel = Mongo.model(
  "dtcObservation",
  DtcObservationSchema,
);

DtcObservationModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

DtcObservationModel.createIndex({
  key: { vehicleKey: 1, scanId: 1, code: 1 },
  name: "dtc_observation_unique",
  unique: true,
});

DtcObservationModel.createIndex({
  key: { vehicleKey: 1, code: 1, observedAt: -1 },
  name: "dtc_observation_history",
});

/* -------------------------------------------------------------------------- */
/* Sensor time series                                                         */
/* -------------------------------------------------------------------------- */

export const InputSensorReadingSchema = e.object({
  id: e.string().min(1).max(120),

  key: e.string().min(1).max(80),

  label: e.optional(e.string().max(200)).default(""),

  value: e.number(),

  unit: e.string().min(1).max(40),

  recordedAt: e.date(),

  source: SourceSchema,

  pid: e.optional(e.or([e.number().int().min(0).max(255), e.null()])),

  quality: QualitySchema,

  scanId: e.optional(e.or([e.string().max(120), e.null()])),

  raw: e.optional(e.string().max(65536)).default(""),
}, { allowUnexpectedProps: true });

export const InputSensorBatchSchema = e.object({
  readings: e.array(InputSensorReadingSchema).max(100000),

  importHistorical: e.optional(e.boolean()).default(false),
}, { allowUnexpectedProps: true });

export const SensorReadingSchema = e.object({
  _id: IdField,

  vehicleKey: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  readingId: e.string().min(1).max(120),

  ...TimestampFields,
}).extends(InputSensorReadingSchema);

export const SensorReadingModel = Mongo.model(
  "sensorReading",
  SensorReadingSchema,
);

SensorReadingModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

SensorReadingModel.createIndex({
  key: { vehicleKey: 1, readingId: 1 },
  name: "reading_vehicle_unique",
  unique: true,
});

SensorReadingModel.createIndex({
  key: { vehicleKey: 1, key: 1, recordedAt: -1 },
  name: "reading_series",
});

/* -------------------------------------------------------------------------- */
/* Maintenance and repair verification                                        */
/* -------------------------------------------------------------------------- */

export const RepairVerificationSchema = e.object({
  verifiedAt: e.date(),

  outcome: e.in(
    [
      "improved",
      "unchanged",
      "worse",
      "insufficientData",
    ] as const,
  ),

  scanId: e.string().min(1).max(120),

  scoreBefore: NullableNumber(),

  scoreAfter: NullableNumber(),

  confidenceAfter: NullableNumber(),

  resolvedCodes: e.optional(e.array(e.string().max(16))).default([]),

  persistingCodes: e.optional(e.array(e.string().max(16))).default([]),

  newCodes: e.optional(e.array(e.string().max(16))).default([]),

  notes: e.optional(e.string().max(5000)).default(""),
}).rest(e.any());

export const InputMaintenanceSchema = e.object({
  id: e.optional(e.string().min(1).max(120)),

  vehicleId: e.optional(e.string().max(300)),

  type: MaintenanceTypeSchema,

  title: e.string().min(1).max(300),

  description: e.optional(e.string().max(10000)).default(""),

  performedAt: e.date(),

  odometerKm: e.optional(e.or([e.number().min(0), e.null()])),

  partsReplaced: e.optional(e.array(e.string().max(300)).max(200)).default([]),

  workshop: e.optional(e.string().max(300)).default(""),

  notes: e.optional(e.string().max(10000)).default(""),

  scoreBefore: e.optional(e.or([e.number().min(0).max(100), e.null()])),

  confidenceBefore: e.optional(e.or([e.number().min(0).max(1), e.null()])),

  dtcCodesBefore: e.optional(e.array(e.string().max(16)).max(500)).default([]),

  scanIdBefore: e.optional(e.or([e.string().max(120), e.null()])),

  verification: e.optional(e.or([RepairVerificationSchema, e.null()])),
}, { allowUnexpectedProps: true });

export const MaintenanceRecordSchema = e.object({
  _id: IdField,

  vehicleKey: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  recordId: e.string().min(1).max(120),

  verification: e.optional(e.or([RepairVerificationSchema, e.null()])),

  ...TimestampFields,
}).extends(InputMaintenanceSchema);

export const MaintenanceRecordModel = Mongo.model(
  "maintenanceRecord",
  MaintenanceRecordSchema,
);

MaintenanceRecordModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

MaintenanceRecordModel.createIndex({
  key: { vehicleKey: 1, recordId: 1 },
  name: "maintenance_vehicle_unique",
  unique: true,
});

MaintenanceRecordModel.createIndex({
  key: { vehicleKey: 1, performedAt: -1 },
  name: "maintenance_vehicle_time",
});

/* -------------------------------------------------------------------------- */
/* Server-side assessments                                                    */
/* -------------------------------------------------------------------------- */

export const AssessmentFindingSchema = e.object({
  id: e.string().min(1).max(160),

  system: e.string().min(1).max(80),

  kind: e.in(["rule", "statistic", "observation"] as const),

  severity: e.in(["info", "low", "medium", "high", "critical"] as const),

  title: e.string().min(1).max(300),

  explanation: e.string().min(1).max(3000),

  confidence: e.number().min(0).max(1),

  evidence: e.optional(e.array(e.string().max(2000))).default([]),

  recommendedTests: e.optional(e.array(e.string().max(2000))).default([]),

  relatedCodes: e.optional(e.array(e.string().max(16))).default([]),

  ruleId: e.string().min(1).max(120),
}).rest(e.any());

export const AssessmentSystemSchema = e.object({
  system: e.string().min(1).max(80),

  score: e.optional(e.or([e.number().min(0).max(100), e.null()])),

  status: e.in(
    [
      "good",
      "attention",
      "service",
      "critical",
      "unknown",
    ] as const,
  ),

  confidence: e.number().min(0).max(1),

  coverage: e.number().min(0).max(1),

  sampleCount: e.number().int().min(0),

  expectedSignals: e.optional(e.array(e.string().max(120))).default([]),

  availableSignals: e.optional(e.array(e.string().max(120))).default([]),

  methodology: e.optional(e.string().max(3000)).default(""),

  findings: e.optional(e.array(AssessmentFindingSchema)).default([]),

  limitations: e.optional(e.array(e.string().max(3000))).default([]),
}).rest(e.any());

export const HealthAssessmentSchema = e.object({
  _id: IdField,

  vehicleKey: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  generatedAt: e.date(),

  windowDays: e.number().int().min(1).max(3650),

  includeMaintenance: e.boolean(),

  overallScore: e.optional(e.or([e.number().min(0).max(100), e.null()])),

  overallStatus: e.in(
    [
      "good",
      "attention",
      "service",
      "critical",
      "unknown",
    ] as const,
  ),

  overallConfidence: e.number().min(0).max(1),

  dataCoverage: e.number().min(0).max(1),

  scanCount: e.number().int().min(0),

  dtcCount: e.number().int().min(0),

  readingCount: e.number().int().min(0),

  machineLearningUsed: e.optional(e.boolean()).default(false),

  methodology: e.string().max(5000),

  limitations: e.optional(e.array(e.string().max(3000))).default([]),

  systems: e.optional(e.array(AssessmentSystemSchema)).default([]),

  ...TimestampFields,
});

export const HealthAssessmentModel = Mongo.model(
  "healthAssessment",
  HealthAssessmentSchema,
);

HealthAssessmentModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

HealthAssessmentModel.createIndex({
  key: { vehicleKey: 1, generatedAt: -1 },
  name: "assessment_vehicle_time",
});

/* -------------------------------------------------------------------------- */
/* Reports and raw uploads                                                    */
/* -------------------------------------------------------------------------- */

export const InputReportSchema = e.object({
  type: e.in(["diagnostic", "maintenance", "health"] as const),

  format: e.in(["json", "pdf"] as const),

  from: e.optional(e.or([e.date(), e.null()])),

  to: e.optional(e.or([e.date(), e.null()])),

  includeRaw: e.optional(e.boolean()).default(false),

  includeMaintenance: e.optional(e.boolean()).default(true),
}, { allowUnexpectedProps: true });

export const HealthReportSchema = e.object({
  _id: IdField,

  reportId: e.string().min(1).max(120),

  vehicleKey: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  type: e.in(["diagnostic", "maintenance", "health"] as const),

  format: e.in(["json", "pdf"] as const),

  from: NullableDate(),

  to: NullableDate(),

  includeRaw: e.boolean(),

  includeMaintenance: e.boolean(),

  status: e.in(["processing", "ready", "failed"] as const),

  downloadUrl: NullableString(),

  expiresAt: NullableDate(),

  sha256: NullableString(),

  sizeBytes: NullableNumber(),

  contentType: e.string().max(120),

  content: e.optional(e.string().max(50000000)),

  contentEncoding: e.optional(e.in(["utf8", "base64"] as const)).default(
    "utf8",
  ),

  error: NullableString(),

  ...TimestampFields,
});

export const HealthReportModel = Mongo.model(
  "healthReport",
  HealthReportSchema,
);

HealthReportModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

HealthReportModel.createIndex({
  key: { reportId: 1 },
  name: "report_id_unique",
  unique: true,
});

HealthReportModel.createIndex({
  key: { vehicleKey: 1, createdAt: -1 },
  name: "report_vehicle_time",
});

export const InputRawUploadSchema = e.object({
  fileName: e.string().min(1).max(300),

  contentType: e.string().min(1).max(200),

  sizeBytes: e.number().int().min(1).max(100000000),

  sha256: e.string().min(16).max(128),

  containsVin: e.optional(e.boolean()).default(false),

  redact: e.optional(e.boolean()).default(false),
}, { allowUnexpectedProps: true });

export const RawUploadSchema = e.object({
  _id: IdField,

  uploadId: e.string().min(1).max(120),

  vehicleKey: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  fileName: e.string().min(1).max(300),

  contentType: e.string().min(1).max(200),

  sizeBytes: e.number().int().min(1),

  sha256: e.string().min(16).max(128),

  containsVin: e.boolean(),

  redact: e.boolean(),

  status: e.in(["pending", "uploaded", "completed", "failed"] as const),

  uploadUrl: NullableString(),

  content: e.optional(e.string().max(100000000)),

  contentEncoding: e.optional(e.in(["utf8", "base64"] as const)).default(
    "base64",
  ),

  uploadedAt: NullableDate(),

  completedAt: NullableDate(),

  ...TimestampFields,
});

export const RawUploadModel = Mongo.model("rawUpload", RawUploadSchema);

RawUploadModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

RawUploadModel.createIndex({
  key: { uploadId: 1 },
  name: "raw_upload_id_unique",
  unique: true,
});

/* -------------------------------------------------------------------------- */
/* Predictions and feedback                                                   */
/* -------------------------------------------------------------------------- */

export const HealthPredictionSchema = e.object({
  _id: IdField,

  predictionId: e.string().min(1).max(120),

  vehicleKey: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  modelId: e.string().min(1).max(120),

  modelVersion: e.string().min(1).max(60),

  generatedAt: e.date(),

  risk: e.number().min(0).max(1),

  riskBand: e.in(["low", "medium", "high"] as const),

  confidence: e.number().min(0).max(1),

  explanation: e.string().max(5000),

  evidence: e.optional(e.array(e.string().max(3000))).default([]),

  validatedFailureDate: e.optional(e.null()).default(null),

  limitations: e.optional(e.array(e.string().max(3000))).default([]),

  ...TimestampFields,
});

export const HealthPredictionModel = Mongo.model(
  "healthPrediction",
  HealthPredictionSchema,
);

HealthPredictionModel.createIndex({
  key: { predictionId: 1 },
  name: "prediction_id_unique",
  unique: true,
});

export const PredictionFeedbackSchema = e.object({
  _id: IdField,

  predictionId: e.string().min(1).max(120),

  vehicleKey: e.string().min(1).max(300),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  outcome: e.in(["confirmed", "not_observed", "unknown"] as const),

  observedAt: e.optional(e.or([e.date(), e.null()])),

  notes: e.optional(e.string().max(5000)).default(""),

  ...TimestampFields,
});

export const PredictionFeedbackModel = Mongo.model(
  "predictionFeedback",
  PredictionFeedbackSchema,
);

PredictionFeedbackModel.createIndex({
  key: { predictionId: 1, createdAt: -1 },
  name: "prediction_feedback_time",
});

/* -------------------------------------------------------------------------- */
/* Sync tombstones                                                            */
/* -------------------------------------------------------------------------- */

export const HealthTombstoneSchema = e.object({
  _id: IdField,

  entity: e.string().min(1).max(80),

  entityId: e.string().min(1).max(200),

  vehicleKey: e.optional(e.string().max(300)),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  deletedAt: e.date(),

  ...TimestampFields,
});

export const HealthTombstoneModel = Mongo.model(
  "healthTombstone",
  HealthTombstoneSchema,
);

HealthTombstoneModel.createIndex({
  key: { deletedAt: -1 },
  name: "tombstone_time",
});
