import e, { inferInput, inferOutput } from "validator";
import { InputDocument, Mongo, ObjectId, OutputDocument } from "mongo";

export const InputVehicleSchema = e.object({
  name: e.string().min(1).max(120).describe("The name of the vehicle"),

  chassisNumber: e.string().min(1).max(64).describe(
    "The chassis number of the vehicle",
  ),
});

export const VehicleSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  createdAt: e.optional(e.date()).default(() => new Date()),

  updatedAt: e.optional(e.date()).default(() => new Date()),
}).extends(InputVehicleSchema);

export type TVehicleInput = InputDocument<
  inferInput<typeof VehicleSchema>
>;

export type TVehicleOutput = OutputDocument<
  inferOutput<typeof VehicleSchema>
>;

export const VehicleModel = Mongo.model(
  "vehicle",
  VehicleSchema,
);

VehicleModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});
