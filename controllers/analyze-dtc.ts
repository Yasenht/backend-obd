import {
  BaseController,
  Controller,
  type IRequestContext,
  type IRoute,
  Post,
  Response,
  Versioned,
} from "@Core/common/mod.ts";
import { type RouterContext, Status } from "oak";
import { AnalyzeDtcModel, InputAnalyzeDtcSchema } from "@Models/analyze-dtc.ts";

import { GeminiDtcService } from "@Jobs/gemini-dtc.service.ts";

import { responseValidator } from "@Core/common/validators.ts";

@Controller("/analyze/dtc/", { name: "analyzeDtc" })
export default class AnalyzeDtcController extends BaseController {
  @Post("/")
  public create(route: IRoute) {
    const BodySchema = InputAnalyzeDtcSchema;

    return new Versioned().add(
      "1.0.0",
      {
        shape: () => ({
          body: BodySchema.toSample(),

          return: responseValidator(
            AnalyzeDtcModel.getSchema(),
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

          // إذا لم توجد رموز أعطال
          if (Body.codes.length === 0) {
            return Response
              .statusCode(Status.OK)
              .data({
                success: true,

                codes: [],

                status: "healthy",

                title: "السيارة سليمة",

                description: "لم يتم العثور على أي رموز أعطال في السيارة.",

                totalFaults: 0,

                faults: [],
              });
          }

          const gemini = new GeminiDtcService();

          const faults = [];

          for (const code of Body.codes) {
            try {
              const analysis = await gemini.analyzeDtc(code);

              faults.push({
                ...analysis,

                severityPercentage: Math.min(
                  100,
                  Math.max(0, analysis.severityPercentage),
                ),

                confidence: Math.min(
                  1,
                  Math.max(0, analysis.confidence),
                ),
              });
            } catch {
              faults.push({
                code,
                success: false,
                error: "تعذر تحليل رمز العطل",
              });
            }
          }
          return Response
            .statusCode(Status.OK)
            .data({
              success: true,

              codes: Body.codes,

              status: "faults_detected",

              title: "تم اكتشاف أعطال",

              description: `تم تحليل ${faults.length} رمز عطل في السيارة.`,

              totalFaults: faults.length,

              faults,
            });
        },
      },
    );
  }
}
