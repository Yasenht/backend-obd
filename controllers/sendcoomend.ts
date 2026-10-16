import {
  BaseController,
  Controller,
  // Delete,
  // Env,
  // Get,
  type IRequestContext,
  type IRoute,
  // parseQueryParams,
  // Patch,
  Post,
  Response,
  //Store,
  Versioned,
} from "@Core/common/mod.ts";
import { responseValidator } from "@Core/common/validators.ts";
import { type RouterContext, Status } from "oak";
//import e from "validator";
//import { hash } from "ohash";
// import { queryValidator, normalizeFilters } from "@Core/common/validators.ts";
// import { ObjectId } from "mongo";
import { GeminiObdService } from "@Jobs/GeminiObdService.ts";
import { ObdParser } from "@Jobs/ObdParser.ts";
import { AnalyzeObdModel, InputAnalyzeObdSchema } from "@Models/AnalyzeObd.ts";

// import {
//   SendcoomendModel,
//   InputSendcoomendSchema
// } from "@Models/sendcoomend.ts";

@Controller("/sendcoomend/", { name: "sendcoomend" })
export default class SendcoomendController extends BaseController {
  @Post("/")
  public create(route: IRoute) {
    const BodySchema = InputAnalyzeObdSchema;

    return new Versioned().add(
      "1.0.0",
      {
        shape: () => ({
          body: BodySchema.toSample(),

          return: responseValidator(
            AnalyzeObdModel.getSchema(),
          ).toSample(),
        }),

        handler: async (
          ctx: IRequestContext<
            RouterContext<string>
          >,
        ) => {
          const Body = await BodySchema.validate(
            await ctx.router.request.body.json(),
            {
              name: `${route.scope}.body`,
            },
          );

          const parsed = ObdParser.parse(
            Body.command,
            Body.response,
          );

          const gemini = new GeminiObdService();

          const analysis = await gemini.analyze({
            command: Body.command,

            response: Body.response,

            parsed,
          });

          return Response
            .statusCode(Status.OK)
            .data({
              success: true,

              command: Body.command,

              rawResponse: Body.response,

              analysis: {
                ...analysis,

                values: {
                  ...parsed.values,
                  ...(analysis.values ?? {}),
                },

                dtcs: [
                  ...new Set([
                    ...parsed.dtcs,
                    ...(analysis.dtcs ?? []),
                  ]),
                ],
              },
            });
        },
      },
    );
  }

  //   @Patch("/:id/")
  //   public update(route: IRoute) {
  //     // Define Params Schema
  //     const ParamsSchema = e.object({
  //       id: e.instanceOf(ObjectId, { instantiate: true })
  //     });

  //     // Define Body Schema
  //     const BodySchema = e.partial(InputSendcoomendSchema);

  //     return new Versioned().add("1.0.0", {
  //       shape: () => ({
  //         params: ParamsSchema.toSample(),
  //         body: BodySchema.toSample(),
  //         return: responseValidator(e.partial(SendcoomendModel.getSchema())).toSample(),
  //       }),
  //       handler: async (ctx: IRequestContext<RouterContext<string>>) => {
  //         // Params Validation
  //         const Params = await ParamsSchema.validate(ctx.router.params, {
  //           name: `${route.scope}.params`,
  //         });

  //         // Body Validation
  //         const Body = await BodySchema.validate(
  //           await ctx.router.request.body.json(),
  //           { name: `${route.scope}.body` },
  //         );

  //         const { modifications } = await SendcoomendModel.updateOneOrFail(
  //           Params.id,
  //           Body,
  //         );

  //         return Response.data(modifications);
  //       },
  //     });
  //   }

  //   @Get("/:id?/")
  //   public get(route: IRoute) {
  //     // Define Query Schema
  //     const QuerySchema = queryValidator();

  //     // Define Params Schema
  //     const ParamsSchema = e.object({
  //       id: e.optional(e.instanceOf(ObjectId, { instantiate: true }))
  //     });

  //     return Versioned.add("1.0.0", {
  //       shape: () => ({
  //         query: QuerySchema.toSample(),
  //         params: ParamsSchema.toSample(),
  //         return: responseValidator(e.object({
  //           totalCount: e.optional(e.number()),
  //           results: e.array(SendcoomendModel.getSchema())
  //         })).toSample(),
  //       }),
  //       handler: async (ctx: IRequestContext<RouterContext<string>>) => {
  //         // Query Validation
  //         const Query = await QuerySchema.validate(
  //           parseQueryParams(ctx.router.request.url.search),
  //           { name: `${route.scope}.query` },
  //         );

  //         /**
  //          * It is recommended to keep the following validators in place even if you don't want to validate any data.
  //          * It will prevent the client from injecting unexpected data into the request.
  //          */

  //         // Params Validation
  //         const Params = await ParamsSchema.validate(ctx.router.params, {
  //           name: `${route.scope}.params`,
  //         });

  //         const SendcoomendBaseFilters = {
  //           ...normalizeFilters(Query.filters),
  //           ...(Params.id ? { _id: new ObjectId(Params.id) } : {}),
  //           ...(Query.range instanceof Array
  //             ? {
  //               createdAt: {
  //                 $gt: new Date(Query.range[0]),
  //                 $lt: new Date(Query.range[1]),
  //               },
  //             }
  //             : {}),
  //         };

  //         const SendcoomendListQuery = SendcoomendModel
  //           .search(Query.search)
  //           .filter(SendcoomendBaseFilters)
  //           .sort(Query.sort)
  //           .skip(Query.offset)
  //           .limit(Query.limit);

  //         if (Query.project) SendcoomendListQuery.project(Query.project);

  //         return Response.data({
  //           totalCount: Query.includeTotalCount
  //             ? await Store.cache(
  //                 [
  //                   "totalCount",
  //                   "sendcoomend",
  //                   hash(SendcoomendBaseFilters),
  //                 ],
  //                 () => await SendcoomendModel.countDocuments(SendcoomendBaseFilters),
  //                 (await Env.number("GLOBAL_PAGINATION_COUNT_TTL")) * 1000,
  //               )
  //             : undefined,
  //           results: await SendcoomendListQuery,
  //         });
  //       },
  //     });
  //   }

  //   @Delete("/:id/")
  //   public delete(route: IRoute) {
  //     // Define Params Schema
  //     const ParamsSchema = e.object({
  //       id: e.instanceOf(ObjectId, { instantiate: true })
  //     });

  //     return Versioned.add("1.0.0", {
  //       shape: () => ({
  //         params: ParamsSchema.toSample(),
  //         return: responseValidator().toSample(),
  //       }),
  //       handler: async (ctx: IRequestContext<RouterContext<string>>) => {
  //         // Params Validation
  //         const Params = await ParamsSchema.validate(ctx.router.params, {
  //           name: `${route.scope}.params`,
  //         });

  //         await SendcoomendModel.deleteOneOrFail(Params.id);

  //         return Response.true();
  //       },
  //     });
  //   }
}
