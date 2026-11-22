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
import { queryValidator, responseValidator } from "@Core/common/validators.ts";
import { type RouterContext, Status } from "oak";
import e from "validator";
import { ObjectId } from "mongo";

import {
  InputVehicleSchema,
  normalizeVehicleFields,
  VehicleModel,
} from "@Models/vehicle.ts";
import {
  InputVehicleTelemetrySchema,
  VehicleTelemetryModel,
} from "@Models/vehicle-telemetry.ts";

const ParamsSchema = e.object({
  id: e.instanceOf(ObjectId, { instantiate: true }),
});

const SearchQuerySchema = e.deepCast(e.object(
  {
    search: e.optional(e.string().min(1).max(120)).describe(
      "Partial vehicle name or VIN search term",
    ),
    q: e.optional(e.string().min(1).max(120)).describe(
      "Alias of the search parameter",
    ),
    query: e.optional(e.string().min(1).max(120)).describe(
      "Alias of the search parameter",
    ),
    vin: e.optional(e.string().min(1).max(17)).describe(
      "Exact VIN to search for",
    ),
    vehicle_name: e.optional(e.string().min(1).max(120)).describe(
      "Partial vehicle name to search for",
    ),
    offset: e.optional(e.number().min(0)).default(0),
    limit: e.optional(e.number().min(1).max(100)).default(20),
    includeTotalCount: e.optional(e.boolean()).default(true),
  },
  { allowUnexpectedProps: true },
));

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isDuplicateKeyError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: number }).code === 11000;

/**
 * Search vehicles by name or VIN.
 *
 * This handler is shared by `GET /vehicles/` and `GET /vehicles/search/`.
 * A search term is always required so that the API never returns the
 * complete vehicle collection by accident.
 */
const buildSearchHandler = (route: IRoute) =>
  new Versioned().add("1.0.0", {
    shape: () => ({
      query: SearchQuerySchema.toSample(),

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
      const Query = await SearchQuerySchema.validate(
        parseQueryParams(ctx.router.request.url.search),
        { name: `${route.scope}.query` },
      );

      const SearchTerm = (Query.search ?? Query.q ?? Query.query ?? "")
        .trim();

      const Vin = (Query.vin ?? "").trim().toUpperCase();

      const VehicleName = (Query.vehicle_name ?? "").trim();

      if (!SearchTerm && !Vin && !VehicleName) {
        return Response
          .statusCode(Status.BadRequest)
          .message(
            "A search query is required. Provide 'search' (or 'q'/'query'), 'vin', or 'vehicle_name'.",
          );
      }

      const Conditions: Array<Record<string, unknown>> = [];

      if (SearchTerm) {
        const Pattern = new RegExp(escapeRegExp(SearchTerm), "i");

        Conditions.push({
          $or: [
            { vin: Pattern },
            { vehicle_name: Pattern },
          ],
        });
      }

      if (Vin) Conditions.push({ vin: Vin });

      if (VehicleName) {
        Conditions.push({
          vehicle_name: new RegExp(escapeRegExp(VehicleName), "i"),
        });
      }

      const Filters: Record<string, unknown> = { $and: Conditions };

      const Results = await VehicleModel
        .find(Filters)
        .sort({ createdAt: -1, _id: -1 })
        .skip(Query.offset)
        .limit(Query.limit);

      return Response.data({
        totalCount: Query.includeTotalCount
          ? await VehicleModel.countDocuments(Filters)
          : undefined,

        results: Results,
      });
    },
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
          normalizeVehicleFields(
            await ctx.router.request.body.json(),
          ),
          { name: `${route.scope}.body` },
        );

        const Existing = await VehicleModel.findOne({
          vin: Body.vin,
        });

        if (Existing) {
          return Response
            .statusCode(Status.Conflict)
            .message(
              "A vehicle with this VIN already exists.",
            );
        }

        try {
          return Response
            .statusCode(Status.Created)
            .data(
              await VehicleModel.create(Body),
            );
        } catch (error) {
          // Handles the race between the duplicate check above and the
          // database-level unique index on `vin`.
          if (isDuplicateKeyError(error)) {
            return Response
              .statusCode(Status.Conflict)
              .message(
                "A vehicle with this VIN already exists.",
              );
          }

          throw error;
        }
      },
    });
  }

  @Get("/search/", {
    description: "Search vehicles by name or VIN",
  })
  public search(route: IRoute) {
    return buildSearchHandler(route);
  }

  /**
   * Kept for backwards compatibility with the existing `/vehicles/` route.
   * It now requires an explicit search query and never lists all vehicles.
   */
  @Get("/", {
    description: "Search vehicles by name or VIN",
  })
  public list(route: IRoute) {
    return buildSearchHandler(route);
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
