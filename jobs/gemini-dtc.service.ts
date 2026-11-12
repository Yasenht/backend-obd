import { GoogleGenAI } from "@google/genai";
import { Env } from "@Core/common/mod.ts";

export type TGeminiDtcAnalysis = {
  code: string;
  category: string;
  type: string;
  nameEn: string;
  title: string;
  description: string;
  system: string;
  meaning: string;
  severity: string;
  severityPercentage: number;
  severityExplanation: string;
  possibleCauses: string[];
  possibleSymptoms: string[];
  diagnosticSteps: string[];
  solutions: string[];
  status: string;
  confidence: number;
};

export class GeminiDtcService {
  async analyzeDtc(
    code: string,
    vehicle?: unknown,
  ): Promise<TGeminiDtcAnalysis> {
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
أنت مهندس متخصص في تشخيص أعطال السيارات Automotive Diagnostic Engineer.

لديك خبرة متقدمة في:

- OBD-II / EOBD.
- SAE J2012.
- SAE J1979.
- DTC Diagnostic Trouble Codes.
- ECU / PCM / TCM / ABS / SRS.
- CAN Bus.
- ELM327.
- تشخيص أعطال المحركات وأنظمة السيارات.

مهمتك تحليل رمز العطل التالي وتقديم تقرير تشخيصي احترافي باللغة العربية.

━━━━━━━━━━━━━━━━━━
1. رمز العطل
━━━━━━━━━━━━━━━━━━

DTC Code:
${code}

Vehicle Information:
${JSON.stringify(vehicle ?? {}, null, 2)}

━━━━━━━━━━━━━━━━━━
2. قواعد التحليل
━━━━━━━━━━━━━━━━━━

1. حلل رمز العطل المرسل فقط.
2. لا تضف رموز أعطال أخرى.
3. لا تخترع معلومات غير مؤكدة.
4. لا تعتبر كل سبب محتمل عطلاً مؤكداً.
5. إذا كان الرمز خاصاً بالشركة المصنعة ولا تتوفر معلومات السيارة، وضح ذلك.
6. ميّز بين Generic DTC وManufacturer Specific DTC.
7. اشرح معنى الرمز باللغة العربية.
8. اذكر الاسم الفني باللغة الإنجليزية.
9. حدد النظام المرتبط بالعطل.
10. لا توصي بتغيير أي قطعة قبل إجراء الفحوصات اللازمة.
11. إذا لم تكن المعلومات كافية استخدم unknown.
12. اجعل جميع الشروحات باللغة العربية.

━━━━━━━━━━━━━━━━━━
3. تصنيف رمز العطل
━━━━━━━━━━━━━━━━━━

حدد نوع الرمز:

- P: Powertrain
- B: Body
- C: Chassis
- U: Network

وحدد ما إذا كان:

- generic
- manufacturer_specific
- unknown

━━━━━━━━━━━━━━━━━━
4. تحليل العطل
━━━━━━━━━━━━━━━━━━

اشرح:

- الاسم الفني للعطل.
- الترجمة العربية.
- المعنى التقني.
- النظام الذي يراقبه ECU.
- كيف يكتشف الكمبيوتر هذا العطل؟
- ما الظروف التي تؤدي إلى تسجيل الكود؟

━━━━━━━━━━━━━━━━━━
5. الأسباب المحتملة
━━━━━━━━━━━━━━━━━━

استخرج الأسباب المحتملة مرتبة حسب الأولوية.

يجب أن تكون الأسباب واقعية ومرتبطة بالرمز.

لا تفترض تلف القطعة المذكورة في اسم الكود.

━━━━━━━━━━━━━━━━━━
6. الأعراض المحتملة
━━━━━━━━━━━━━━━━━━

اذكر الأعراض التي يمكن أن تظهر نتيجة هذا العطل، مثل:

- ضعف أداء المحرك.
- زيادة استهلاك الوقود.
- اهتزاز المحرك.
- صعوبة التشغيل.
- ارتفاع الانبعاثات.
- إضاءة Check Engine.

لا تفترض أن جميع هذه الأعراض موجودة بالفعل.

━━━━━━━━━━━━━━━━━━
7. مستوى الخطورة
━━━━━━━━━━━━━━━━━━

حدد مستوى الخطورة:

- critical
- high
- medium
- low
- unknown

واحسب severityPercentage من 0 إلى 100.

النسبة تقدير تشخيصي وليست مقياساً معيارياً رسمياً.

اشرح سبب اختيار مستوى الخطورة.

━━━━━━━━━━━━━━━━━━
8. خطوات التشخيص
━━━━━━━━━━━━━━━━━━

قدم خطوات عملية مرتبة لفحص العطل.

ابدأ بالفحوصات البسيطة ثم انتقل إلى الفحوصات المتقدمة.

لكل خطوة وضح ما يجب فحصه.

لا توصي باستبدال أي قطعة دون اختبارها.

━━━━━━━━━━━━━━━━━━
9. الحلول المقترحة
━━━━━━━━━━━━━━━━━━

قدم الحلول المحتملة بناءً على طبيعة العطل.

يجب أن تكون الحلول عملية وقابلة للتنفيذ.

لا تجعل تغيير قطعة معينة هو الحل الوحيد إذا كانت هناك احتمالات أخرى.

━━━━━━━━━━━━━━━━━━
10. درجة الثقة
━━━━━━━━━━━━━━━━━━

confidence يجب أن تكون رقماً بين 0 و1.

تعبر عن مدى الثقة في تفسير معنى الرمز والأسباب المحتملة.

لا تجعل الثقة في معنى الكود تعني التأكد من سبب العطل الفعلي.

━━━━━━━━━━━━━━━━━━
11. JSON OUTPUT
━━━━━━━━━━━━━━━━━━

أخرج JSON صحيحاً فقط دون Markdown أو نص خارجه.

التزم بأسماء الحقول التالية:

{
  "code": "${code}",
  "category": "P | B | C | U | unknown",
  "type": "generic | manufacturer_specific | unknown",
  "nameEn": "English technical name",
  "title": "عنوان العطل باللغة العربية",
  "description": "وصف مختصر للعطل",
  "system": "النظام المرتبط",
  "meaning": "الشرح الفني المفصل",
  "severity": "critical | high | medium | low | unknown",
  "severityPercentage": 0,
  "severityExplanation": "سبب تصنيف الخطورة",
  "possibleCauses": [],
  "possibleSymptoms": [],
  "diagnosticSteps": [],
  "solutions": [],
  "status": "unknown",
  "confidence": 0.0
}

قواعد إضافية:

- جميع المصفوفات يجب أن تكون Arrays.
- لا تضع null بدلاً من المصفوفات.
- لا تستخدم نصوصاً خارج JSON.
- severityPercentage بين 0 و100.
- confidence بين 0 و1.
- لا تخترع حالة الكود الحالية.
- إذا لم تتوفر حالة الكود استخدم unknown.
- لا تضف بيانات غير موجودة.
- يجب أن يكون JSON قابلاً للتحليل باستخدام JSON.parse().

ابدأ بتحليل الرمز المرسل.
`;

    const response = await ai.models.generateContent({
      model,

      contents: prompt,

      config: {
        responseMimeType: "application/json",

        responseSchema: {
          type: "object",

          properties: {
            code: {
              type: "string",
            },

            category: {
              type: "string",
            },

            type: {
              type: "string",
            },

            nameEn: {
              type: "string",
            },

            title: {
              type: "string",
            },

            description: {
              type: "string",
            },

            system: {
              type: "string",
            },

            meaning: {
              type: "string",
            },

            severity: {
              type: "string",
            },

            severityPercentage: {
              type: "number",
            },

            severityExplanation: {
              type: "string",
            },

            possibleCauses: {
              type: "array",
              items: {
                type: "string",
              },
            },

            possibleSymptoms: {
              type: "array",
              items: {
                type: "string",
              },
            },

            diagnosticSteps: {
              type: "array",
              items: {
                type: "string",
              },
            },

            solutions: {
              type: "array",
              items: {
                type: "string",
              },
            },

            status: {
              type: "string",
            },

            confidence: {
              type: "number",
            },
          },

          required: [
            "code",
            "category",
            "type",
            "nameEn",
            "title",
            "description",
            "system",
            "meaning",
            "severity",
            "severityPercentage",
            "severityExplanation",
            "possibleCauses",
            "possibleSymptoms",
            "diagnosticSteps",
            "solutions",
            "status",
            "confidence",
          ],
        },
      },
    });

    if (!response.text) {
      throw new Error(
        "Gemini returned an empty DTC analysis",
      );
    }

    const analysis = JSON.parse(
      response.text,
    ) as TGeminiDtcAnalysis;

    if (analysis.code.toUpperCase() !== code.toUpperCase()) {
      throw new Error(
        "Gemini returned a different DTC code",
      );
    }

    analysis.severityPercentage = Math.min(
      100,
      Math.max(0, analysis.severityPercentage),
    );

    analysis.confidence = Math.min(
      1,
      Math.max(0, analysis.confidence),
    );

    return analysis;
  }
}
