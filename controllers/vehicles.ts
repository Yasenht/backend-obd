import {
  BaseController,
  Controller,
  Get,
  type IRequestContext,
  type IRoute,
  parseQueryParams,
  Post,
  Response,
  Versioned,
} from "@Core/common/mod.ts";
import {
  normalizeFilters,
  queryValidator,
  responseValidator,
} from "@Core/common/validators.ts";
import { type RouterContext, Status } from "oak";
import e from "validator";
import { ObjectId } from "mongo";

import { InputVehicleSchema, VehicleModel } from "@Models/vehicle.ts";
import {
  InputVehicleTelemetrySchema,
  VehicleTelemetryModel,
} from "@Models/vehicle-telemetry.ts";

const ParamsSchema = e.object({
  id: e.instanceOf(ObjectId, { instantiate: true }),
});

@Controller("/vehicles/", { name: "vehicles" })
export default class VehiclesController extends BaseController {
  @Post("/")
  public create(route: IRoute) {
    const BodySchema = InputVehicleSchema;

    return new Versioned().add("1.0.0", {
      shape: () => ({
        body: BodySchema.toSample(),

        return: responseValidator(
          VehicleModel.getSchema(),
        ).toSample(),
      }),

      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await BodySchema.validate(
          await ctx.router.request.body.json(),
          { name: `${route.scope}.body` },
        );

        const ChassisNumber = Body.chassisNumber.trim().toUpperCase();

        const Existing = await VehicleModel.findOne({
          chassisNumber: ChassisNumber,
        });

        if (Existing) {
          return Response
            .statusCode(Status.Conflict)
            .message(
              "A vehicle with this chassis number already exists.",
            );
        }

        return Response
          .statusCode(Status.Created)
          .data(
            await VehicleModel.create({
              ...Body,
              chassisNumber: ChassisNumber,
            }),
          );
      },
    });
  }

  @Get("/")
  public list(route: IRoute) {
    const QuerySchema = queryValidator();

    return new Versioned().add("1.0.0", {
      shape: () => ({
        query: QuerySchema.toSample(),

        return: responseValidator(
          e.object({
            totalCount: e.optional(e.number()),

            results: e.array(VehicleModel.getSchema()),
          }),
        ).toSample(),
      }),

      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Query = await QuerySchema.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: `${route.scope}.query` },
        );

        const BaseFilters = normalizeFilters(Query.filters);

        const ListQuery = VehicleModel
          .find(BaseFilters)
          .sort(Query.sort)
          .skip(Query.offset)
          .limit(Query.limit);

        if (Query.project) ListQuery.project(Query.project);

        return Response.data({
          totalCount: Query.includeTotalCount
            ? await VehicleModel.countDocuments(BaseFilters)
            : undefined,

          results: await ListQuery,
        });
      },
    });
  }

  @Get("/:id/")
  public get(route: IRoute) {
    return new Versioned().add("1.0.0", {
      shape: () => ({
        params: ParamsSchema.toSample(),

        return: responseValidator(
          e.object({
            vehicle: VehicleModel.getSchema(),

            latestTelemetry: e.optional(
              VehicleTelemetryModel.getSchema(),
            ),
          }),
        ).toSample(),
      }),

      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Params = await ParamsSchema.validate(
          ctx.router.params,
          { name: `${route.scope}.params` },
        );

        const Vehicle = await VehicleModel.findOne({
          _id: Params.id,
        });

        if (!Vehicle) {
          return Response
            .statusCode(Status.NotFound)
            .message("Vehicle not found.");
        }

        const LatestTelemetry = await VehicleTelemetryModel
          .findOne({ vehicle: Params.id })
          .sort({ recordedAt: -1 });

        return Response.data({
          vehicle: Vehicle,

          latestTelemetry: LatestTelemetry ?? undefined,
        });
      },
    });
  }

  @Post("/:id/telemetry/")
  public createTelemetry(route: IRoute) {
    const BodySchema = InputVehicleTelemetrySchema;

    return new Versioned().add("1.0.0", {
      shape: () => ({
        params: ParamsSchema.toSample(),

        body: BodySchema.toSample(),

        return: responseValidator(
          VehicleTelemetryModel.getSchema(),
        ).toSample(),
      }),

      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Params = await ParamsSchema.validate(
          ctx.router.params,
          { name: `${route.scope}.params` },
        );

        const Body = await BodySchema.validate(
          await ctx.router.request.body.json(),
          { name: `${route.scope}.body` },
        );

        const Vehicle = await VehicleModel.findOne({
          _id: Params.id,
        });

        if (!Vehicle) {
          return Response
            .statusCode(Status.NotFound)
            .message("Vehicle not found.");
        }

        return Response
          .statusCode(Status.Created)
          .data(
            await VehicleTelemetryModel.create({
              ...Body,
              vehicle: Params.id,
            }),
          );
      },
    });
  }

  @Get("/:id/telemetry/")
  public listTelemetry(route: IRoute) {
    const QuerySchema = queryValidator();

    return new Versioned().add("1.0.0", {
      shape: () => ({
        params: ParamsSchema.toSample(),

        query: QuerySchema.toSample(),

        return: responseValidator(
          e.object({
            totalCount: e.optional(e.number()),

            results: e.array(
              VehicleTelemetryModel.getSchema(),
            ),
          }),
        ).toSample(),
      }),

      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Params = await ParamsSchema.validate(
          ctx.router.params,
          { name: `${route.scope}.params` },
        );

        const Query = await QuerySchema.validate(
          parseQueryParams(ctx.router.request.url.search),
          { name: `${route.scope}.query` },
        );

        const Vehicle = await VehicleModel.findOne({
          _id: Params.id,
        });

        if (!Vehicle) {
          return Response
            .statusCode(Status.NotFound)
            .message("Vehicle not found.");
        }

        const BaseFilters = {
          ...normalizeFilters(Query.filters),

          vehicle: Params.id,
        };

        const ListQuery = VehicleTelemetryModel
          .find(BaseFilters)
          .sort(Query.sort)
          .skip(Query.offset)
          .limit(Query.limit);

        if (Query.project) ListQuery.project(Query.project);

        return Response.data({
          totalCount: Query.includeTotalCount
            ? await VehicleTelemetryModel.countDocuments(
              BaseFilters,
            )
            : undefined,

          results: await ListQuery,
        });
      },
    });
  }
}
