import e, { inferInput, inferOutput } from "validator";
import { InputDocument, Mongo, ObjectId, OutputDocument } from "mongo";

/**
 * A VIN is 17 characters long and never contains the letters I, O, or Q.
 */
const VinPattern = /^[A-HJ-NPR-Z0-9]{17}$/i;

export const normalizeVin = (vin: string) => vin.trim().toUpperCase();

export const normalizeVehicleName = (vehicleName: string) => vehicleName.trim();

/**
 * Normalizes the public vehicle fields before validation and persistence.
 * Keeping this logic in one place makes the API case-insensitive for VINs.
 */
export const normalizeVehicleFields = <
  T extends { vin?: unknown; vehicle_name?: unknown },
>(data: T) => ({
  ...data,

  vin: typeof data.vin === "string" ? normalizeVin(data.vin) : data.vin,

  vehicle_name: typeof data.vehicle_name === "string"
    ? normalizeVehicleName(data.vehicle_name)
    : data.vehicle_name,
});

export const InputVehicleSchema = e.object({
  vin: e.string().min(1).max(17).matches(VinPattern).describe(
    "Vehicle Identification Number (17 characters, excluding I, O, and Q)",
  ),

  vehicle_name: e.string().min(1).max(120).describe(
    "The display name of the vehicle",
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

VehicleModel.pre("create", ({ data }) => normalizeVehicleFields(data));

VehicleModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

// Enforce VIN uniqueness at the database level as well as in the controller.
// The partial filter keeps legacy documents without a VIN out of the index.
VehicleModel.createIndex({
  key: { vin: 1 },
  name: "vin_unique",
  unique: true,
  partialFilterExpression: { vin: { $type: "string" } },
});

// Supports searching vehicles by their display name.
VehicleModel.createIndex({
  key: { vehicle_name: 1 },
  name: "vehicle_name",
});
