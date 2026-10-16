import e, { inferInput, inferOutput } from "validator";
import { InputDocument, Mongo, ObjectId, OutputDocument } from "mongo";

export const InputSendcoomendSchema = e.object({
  // Your user prompted properties go here...
});

export const SendcoomendSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
  createdAt: e.optional(e.date()).default(() => new Date()),
  updatedAt: e.optional(e.date()).default(() => new Date()),
  createdBy: e.instanceOf(ObjectId, { instantiate: true }),
  account: e.instanceOf(ObjectId, { instantiate: true }),
  // Write any private/system properties here...
}).extends(InputSendcoomendSchema);

export type TSendcoomendInput = InputDocument<
  inferInput<typeof SendcoomendSchema>
>;
export type TSendcoomendOutput = OutputDocument<
  inferOutput<typeof SendcoomendSchema>
>;

export const SendcoomendModel = Mongo.model(
  "sendcoomend",
  SendcoomendSchema,
);

SendcoomendModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});
