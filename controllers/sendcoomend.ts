import {
  BaseController,
  Controller,
  type IRequestContext,
  type IRoute,
  Post,
  Response,
  Versioned,
} from "@Core/common/mod.ts";
import { responseValidator } from "@Core/common/validators.ts";
import { type RouterContext, Status } from "oak";

import { GeminiObdService } from "@Jobs/GeminiObdService.ts";
import { ObdParser } from "@Jobs/ObdParser.ts";
import { AnalyzeObdModel, InputAnalyzeObdSchema } from "@Models/AnalyzeObd.ts";

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
}
