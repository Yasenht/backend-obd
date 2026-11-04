import e, { inferInput, inferOutput } from "validator";
import { InputDocument, Mongo, ObjectId, OutputDocument } from "mongo";

// Input Schema
export const InputAnalyzeDtcSchema = e.object({
  codes: e.array(e.string()).min(0).max(100),
});

// كل عطل يتم تحليله بشكل مستقل
export const DtcFaultSchema = e.object({
  code: e.string(),

  category: e.string(),

  type: e.string(),

  nameEn: e.string(),

  title: e.string(),

  description: e.string(),

  system: e.string(),

  meaning: e.string(),

  severity: e.string(),

  severityPercentage: e.number(),

  severityExplanation: e.string(),

  possibleCauses: e.array(e.string()),

  possibleSymptoms: e.array(e.string()),

  diagnosticSteps: e.array(e.string()),

  solutions: e.array(e.string()),

  status: e.string(),

  confidence: e.number(),
});

// Schema الخاص بالنتيجة النهائية
export const AnalyzeDtcSchema = e.object({
  _id: e.optional(
    e.instanceOf(ObjectId, { instantiate: true }),
  ),

  createdAt: e.optional(e.date()).default(() => new Date()),

  updatedAt: e.optional(e.date()).default(() => new Date()),

  createdBy: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  account: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  success: e.boolean(),

  status: e.string(),

  title: e.string(),

  description: e.string(),

  totalFaults: e.number(),

  faults: e.array(DtcFaultSchema),
}).extends(InputAnalyzeDtcSchema);

export type TAnalyzeDtcInput = InputDocument<
  inferInput<typeof AnalyzeDtcSchema>
>;

export type TAnalyzeDtcOutput = OutputDocument<
  inferOutput<typeof AnalyzeDtcSchema>
>;

// Mongo Model
export const AnalyzeDtcModel = Mongo.model(
  "analyzeDtc",
  AnalyzeDtcSchema,
);

AnalyzeDtcModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});
