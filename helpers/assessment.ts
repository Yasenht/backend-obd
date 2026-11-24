// deno-lint-ignore-file no-explicit-any
import { ObjectId } from "mongo";
import {
  DiagnosticScanModel,
  DtcRecordModel,
  MaintenanceRecordModel,
  SensorReadingModel,
} from "@Models/health.ts";
import {
  severityForDtc,
  statusForScore,
  systemForDtc,
} from "@Helpers/health.ts";

const DayMs = 24 * 60 * 60 * 1000;

const severityPenalty: Record<string, number> = {
  info: 0,
  low: 4,
  medium: 10,
  high: 20,
  critical: 30,
};

interface SystemConfig {
  system: string;
  expectedSignals: string[];
  description: string;
  limitations: string[];
}

const SystemConfigs: SystemConfig[] = [
  {
    system: "engine",
    expectedSignals: [
      "rpm",
      "stft_pct",
      "ltft_pct",
      "engine_load_pct",
      "maf_gps",
      "throttle_pct",
    ],
    description: "أكواد المحرك النشطة وتعديل الوقود ودوران/حمل المحرك.",
    limitations: [
      "لا تُقاس قوة الاحتراق أو ضغط الأسطوانات عبر OBD-II العام.",
    ],
  },
  {
    system: "battery",
    expectedSignals: [
      "battery_v",
      "control_voltage_v",
    ],
    description: "جهد البطارية/التحكم وأكواد U.",
    limitations: [
      "لا تُقدَّر سعة البطارية أو عمرها بلا اختبار حمل.",
    ],
  },
  {
    system: "cooling",
    expectedSignals: [
      "coolant_c",
      "oil_temp_c",
    ],
    description: "حرارة التبريد والزيت وأكواد التبريد.",
    limitations: [
      "لا يمكن الجزم بانسداد الرديتر من قراءة واحدة.",
    ],
  },
  {
    system: "emissions",
    expectedSignals: [
      "fuel_level_pct",
      "stft_pct",
      "ltft_pct",
    ],
    description: "MIL وجهوزية I/M وأكواد الانبعاثات.",
    limitations: [
      "اختبار غير مكتمل لا يعني وجود عطل.",
    ],
  },
  {
    system: "brakes",
    expectedSignals: [],
    description: "أكواد C فقط عند توفرها.",
    limitations: [
      "ABS غير مقروء عبر OBD-II العام؛ غياب الكود لا يثبت السلامة.",
    ],
  },
  {
    system: "transmission",
    expectedSignals: [],
    description: "أكواد ناقل الحركة P07/TCM فقط عند توفرها.",
    limitations: [
      "لا يمكن تقييم انزلاق ناقل الحركة بلا بيانات مصنّعة.",
    ],
  },
  {
    system: "body",
    expectedSignals: [],
    description: "أكواد الهيكل B فقط عند توفرها.",
    limitations: [
      "SRS/BCM غير مقروءة عبر OBD-II العام.",
    ],
  },
];

const latestReadings = (readings: any[]) => {
  const Map = new globalThis.Map<string, any>();

  for (const Reading of readings) {
    const Current = Map.get(Reading.key);

    if (!Current || Reading.recordedAt > Current.recordedAt) {
      Map.set(Reading.key, Reading);
    }
  }

  return Map;
};

const findingForCode = (
  code: string,
  system: string,
) => {
  const Severity = severityForDtc(code);

  return {
    id: `dtc-active-${code}`,
    system,
    kind: "rule" as const,
    severity: Severity as "info" | "low" | "medium" | "high" | "critical",
    title: `كود عطل نشط: ${code}`,
    explanation: "أبلغت وحدة التحكم عن الكود في آخر فحص ناجح.",
    confidence: 0.96,
    evidence: [
      `الكود: ${code}`,
      "المصدر: ECU (رد مباشر)",
    ],
    recommendedTests: [
      "إعادة الفحص بعد دورة قيادة مناسبة.",
      "اتباع خطوات تشخيص الكود قبل استبدال أي قطعة.",
    ],
    relatedCodes: [code],
    ruleId: "dtc-active",
  };
};

const sensorFinding = (
  id: string,
  system: string,
  severity: "low" | "medium" | "high",
  title: string,
  explanation: string,
  evidence: string[],
  ruleId: string,
) => ({
  id,
  system,
  kind: "statistic" as const,
  severity,
  title,
  explanation,
  confidence: 0.72,
  evidence,
  recommendedTests: [
    "تأكيد القراءة باختبار مستقل قبل اعتبارها عطلاً.",
  ],
  relatedCodes: [],
  ruleId,
});

export const generateAssessment = async (
  vehicleKey: string,
  options: {
    generatedAt: Date;
    windowDays: number;
    includeMaintenance: boolean;
    account?: ObjectId;
  },
) => {
  const Since = new Date(
    options.generatedAt.getTime() - options.windowDays * DayMs,
  );

  const [Scans, ActiveDtcs, Readings, _Maintenance] = await Promise.all([
    DiagnosticScanModel.find({
      vehicleKey,
      startedAt: { $gte: Since, $lte: options.generatedAt },
    }).sort({ startedAt: -1 }),
    DtcRecordModel.find({
      vehicleKey,
      activeInLatestScan: true,
    }).sort({ lastSeenAt: -1 }),
    SensorReadingModel.find({
      vehicleKey,
      recordedAt: { $gte: Since, $lte: options.generatedAt },
    }).sort({ recordedAt: 1 }).limit(20000),
    options.includeMaintenance
      ? MaintenanceRecordModel.find({
        vehicleKey,
        performedAt: { $gte: Since, $lte: options.generatedAt },
      }).sort({ performedAt: -1 }).limit(500)
      : Promise.resolve([]),
  ]);

  const Latest = latestReadings(Readings);
  const ActiveCodes = ActiveDtcs.map((record: any) => record.code);
  const Systems: any[] = [];

  let ExpectedSignals = 0;
  let AvailableSignals = 0;

  for (const Config of SystemConfigs) {
    const Available = Config.expectedSignals.filter((key) => Latest.has(key));
    const Codes = ActiveCodes.filter((code) =>
      systemForDtc(code) === Config.system
    );
    const SampleCount = Readings.filter((reading: any) =>
      Config.expectedSignals.includes(reading.key)
    ).length;

    ExpectedSignals += Config.expectedSignals.length;
    AvailableSignals += Available.length;

    const Coverage = Config.expectedSignals.length
      ? Math.min(0.99, Available.length / Config.expectedSignals.length)
      : 0;

    const Findings: any[] = [];

    for (const Code of Codes) {
      Findings.push(findingForCode(Code, Config.system));
    }

    if (Config.system === "battery") {
      const Battery = Latest.get("battery_v")?.value;
      const Control = Latest.get("control_voltage_v")?.value;

      if (typeof Battery === "number" && Battery < 12.2) {
        Findings.push(sensorFinding(
          "sensor-battery-low",
          "battery",
          Battery < 11.8 ? "high" : "medium",
          "جهد بطارية منخفض",
          "قراءة جهد البطارية أقل من النطاق المعتاد أثناء التشغيل.",
          [`آخر جهد بطارية: ${Battery} V`],
          "battery-voltage-low",
        ));
      }

      if (typeof Control === "number" && Control < 12.0) {
        Findings.push(sensorFinding(
          "sensor-control-voltage-low",
          "battery",
          "medium",
          "جهد تحكم منخفض",
          "جهد التحكم أدنى من 12.0V في آخر قراءة.",
          [`آخر جهد تحكم: ${Control} V`],
          "control-voltage-low",
        ));
      }
    }

    if (Config.system === "cooling") {
      const Coolant = Latest.get("coolant_c")?.value;
      const Oil = Latest.get("oil_temp_c")?.value;

      if (typeof Coolant === "number" && Coolant > 105) {
        Findings.push(sensorFinding(
          "sensor-coolant-high",
          "cooling",
          Coolant > 112 ? "high" : "medium",
          "حرارة تبريد مرتفعة",
          "آخر قراءة لحرارة التبريد تتجاوز النطاق المعتاد.",
          [`آخر حرارة تبريد: ${Coolant} °C`],
          "coolant-temperature-high",
        ));
      }

      if (typeof Oil === "number" && Oil > 120) {
        Findings.push(sensorFinding(
          "sensor-oil-temp-high",
          "cooling",
          "high",
          "حرارة زيت مرتفعة",
          "آخر قراءة لحرارة الزيت مرتفعة وتحتاج تأكيداً.",
          [`آخر حرارة زيت: ${Oil} °C`],
          "oil-temperature-high",
        ));
      }
    }

    if (Config.system === "engine") {
      for (const Key of ["stft_pct", "ltft_pct"]) {
        const Value = Latest.get(Key)?.value;

        if (typeof Value === "number" && Math.abs(Value) > 15) {
          Findings.push(sensorFinding(
            `sensor-${Key}-high`,
            "engine",
            "medium",
            Key === "stft_pct"
              ? "تعديل وقود قصير المدى مرتفع"
              : "تعديل وقود طويل المدى مرتفع",
            "تعديل الوقود يتجاوز 15% في آخر قراءة.",
            [`${Key}: ${Value}%`],
            `${Key}-out-of-range`,
          ));
        }
      }
    }

    const Assessable = Available.length > 0 || Codes.length > 0 ||
      SampleCount > 0;

    if (!Assessable) {
      Systems.push({
        system: Config.system,
        score: null,
        status: "unknown",
        confidence: 0,
        coverage: Coverage,
        sampleCount: 0,
        expectedSignals: Config.expectedSignals,
        availableSignals: Available,
        methodology: Config.description,
        findings: [],
        limitations: Config.limitations,
      });

      continue;
    }

    const Penalty = Findings.reduce(
      (total, finding) =>
        total + (severityPenalty[finding.severity] ?? 0),
      0,
    );

    const Score = Math.max(0, Math.min(100, 100 - Penalty));
    const Confidence = Math.min(
      0.95,
      0.25 + Coverage * 0.45 + Math.min(SampleCount / 100, 1) * 0.2 +
        (Codes.length ? 0.03 : 0),
    );

    Systems.push({
      system: Config.system,
      score: Score,
      status: statusForScore(Score),
      confidence: Number(Confidence.toFixed(2)),
      coverage: Number(Coverage.toFixed(2)),
      sampleCount: SampleCount,
      expectedSignals: Config.expectedSignals,
      availableSignals: Available,
      methodology: Config.description,
      findings: Findings,
      limitations: Config.limitations,
    });
  }

  const Scored = Systems.filter((system) => typeof system.score === "number");

  let OverallScore: number | null = null;

  if (Scored.length) {
    const TotalWeight = Scored.reduce(
      (total, system) => total + Math.max(system.confidence, 0.1),
      0,
    );

    OverallScore = Math.round(
      Scored.reduce(
        (total, system) =>
          total + system.score * Math.max(system.confidence, 0.1),
        0,
      ) / TotalWeight,
    );
  }

  const OverallConfidence = Scored.length
    ? Number(
      (Scored.reduce(
        (total, system) => total + system.confidence,
        0,
      ) / Scored.length).toFixed(2),
    )
    : 0;

  const Coverage = ExpectedSignals
    ? Number(Math.min(0.99, AvailableSignals / ExpectedSignals).toFixed(2))
    : 0;

  return {
    vehicleKey,
    ...(options.account ? { account: options.account } : {}),
    generatedAt: options.generatedAt,
    windowDays: options.windowDays,
    includeMaintenance: options.includeMaintenance,
    overallScore: OverallScore,
    overallStatus: statusForScore(OverallScore),
    overallConfidence: OverallConfidence,
    dataCoverage: Coverage,
    scanCount: Scans.length,
    dtcCount: ActiveCodes.length,
    readingCount: Readings.length,
    machineLearningUsed: false,
    methodology:
      "درجات قواعدية/إحصائية مع تغطية وثقة معلنة. لا تُستخدم تواريخ فشل أو نماذج تعلّم آلي غير مُتحقَّقة.",
    limitations: [
      "غياب الكود لا يثبت سلامة الأنظمة غير المقروءة.",
      "لا تُقدَّر تواريخ فشل المكوّنات.",
      "التغطية أقل من 100% عبر OBD-II العام.",
    ],
    systems: Systems,
  };
};
