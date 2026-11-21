import e, { inferInput, inferOutput } from "validator";
import { InputDocument, Mongo, ObjectId, OutputDocument } from "mongo";

export const InputVehicleTelemetrySchema = e.object({
  speed: e.number().min(0).max(400).describe(
    "The current vehicle speed in km/h",
  ),

  batteryVoltage: e.number().min(0).max(60).describe(
    "The current battery voltage in volts",
  ),

  recordedAt: e.optional(e.date()).default(() => new Date()),
});

export const VehicleTelemetrySchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  vehicle: e.instanceOf(ObjectId, { instantiate: true }),

  createdAt: e.optional(e.date()).default(() => new Date()),

  updatedAt: e.optional(e.date()).default(() => new Date()),
}).extends(InputVehicleTelemetrySchema);

export type TVehicleTelemetryInput = InputDocument<
  inferInput<typeof VehicleTelemetrySchema>
>;

export type TVehicleTelemetryOutput = OutputDocument<
  inferOutput<typeof VehicleTelemetrySchema>
>;

export const VehicleTelemetryModel = Mongo.model(
  "vehicleTelemetry",
  VehicleTelemetrySchema,
);

VehicleTelemetryModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});
