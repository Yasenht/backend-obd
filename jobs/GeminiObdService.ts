import { GoogleGenAI } from "@google/genai";
import { Env } from "@Core/common/mod.ts";

export type TGeminiObdAnalysis = {
  status: string;
  severity: string;
  title: string;
  explanation: string;
  problem: string;
  recommendation: string;
  values: Record<string, unknown>;
  dtcs: string[];
  confidence: number;
};

export class GeminiObdService {
  async analyze(data: {
    command: string;
    response: string;
    parsed: unknown;
    device?: unknown;
    vehicle?: unknown;
    protocol?: string;
  }): Promise<TGeminiObdAnalysis> {
    const apiKey = await Env.get("GEMINI_API_KEY");

    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured",
      );
    }

    const model = (await Env.get("GEMINI_MODEL")) ??
      "gemini-3.5-flash-lite";

    const ai = new GoogleGenAI({
      apiKey,
    });

    const prompt = `
أنت خبير متخصص في OBD-II و ELM327 و CAN
وجهاز Freematics ONE+.

حلل بيانات OBD التالية.

قواعد مهمة:

- لا تخترع أي بيانات.
- لا تفترض أن ECU تالف لمجرد وجود NO DATA.
- لا تفترض أن قطعة معينة تالفة بشكل مؤكد.
- إذا كانت البيانات غير كافية استخدم unknown.
- فرّق بين مشكلة الاتصال ومشكلة السيارة.
- إذا كان هناك DTC فاشرح معناه.
- إذا كانت القراءة طبيعية فلا تخترع عطلًا.
- اشرح النتيجة باللغة العربية.
- confidence يجب أن يكون بين 0 و 1.

Command:
${data.command}

Raw response:
${data.response}

Parsed OBD data:
${
      JSON.stringify(
        data.parsed,
        null,
        2,
      )
    }

Device:
${
      JSON.stringify(
        data.device ?? {},
        null,
        2,
      )
    }

Vehicle:
${
      JSON.stringify(
        data.vehicle ?? {},
        null,
        2,
      )
    }

Protocol:
${data.protocol ?? "unknown"}
`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,

      config: {
        responseMimeType: "application/json",

        responseSchema: {
          type: "object",

          properties: {
            status: {
              type: "string",
            },

            severity: {
              type: "string",
            },

            title: {
              type: "string",
            },

            explanation: {
              type: "string",
            },

            problem: {
              type: "string",
            },

            recommendation: {
              type: "string",
            },

            values: {
              type: "object",
              properties: {},
            },

            dtcs: {
              type: "array",
              items: {
                type: "string",
              },
            },

            confidence: {
              type: "number",
            },
          },

          required: [
            "status",
            "severity",
            "title",
            "explanation",
            "problem",
            "recommendation",
            "values",
            "dtcs",
            "confidence",
          ],
        },
      },
    });

    if (!response.text) {
      throw new Error(
        "Gemini returned an empty response",
      );
    }

    return JSON.parse(
      response.text,
    ) as TGeminiObdAnalysis;
  }
}
