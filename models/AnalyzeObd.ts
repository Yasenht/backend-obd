import e, { inferInput, inferOutput } from "validator";
import { InputDocument, Mongo, ObjectId, OutputDocument } from "mongo";

export const InputAnalyzeObdSchema = e.object({
  command: e.string(),
  response: e.string(),
  createdAt: e.optional(e.date()).default(() => new Date()),
});
export const AnalyzeObdSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
  createdAt: e.optional(e.date()).default(() => new Date()),
  updatedAt: e.optional(e.date()).default(() => new Date()),
  createdBy: e.instanceOf(ObjectId, { instantiate: true }),
  account: e.instanceOf(ObjectId, { instantiate: true }),
  success: e.boolean(),

  command: e.string(),

  rawResponse: e.string(),

  analysis: e.object({
    status: e.string(),

    severity: e.string(),

    title: e.string(),

    explanation: e.string(),

    problem: e.string(),

    recommendation: e.string(),

    values: e.string(),

    dtcs: e.array(e.string()),

    confidence: e.number(),
  }),
  // Write any private/system properties here...
}).extends(InputAnalyzeObdSchema);

export type TAnalyzeObdInput = InputDocument<
  inferInput<typeof AnalyzeObdSchema>
>;
export type TAnalyzeObdOutput = OutputDocument<
  inferOutput<typeof AnalyzeObdSchema>
>;

export const AnalyzeObdModel = Mongo.model(
  "analyzeObd",
  AnalyzeObdSchema,
);

AnalyzeObdModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});
