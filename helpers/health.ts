// deno-lint-ignore-file no-explicit-any
import { ObjectId } from "mongo";
import { Response } from "@Core/common/mod.ts";
import { normalizeVin } from "@Models/vehicle.ts";
import { SensorKeys, VehicleProfileModel } from "@Models/health.ts";

export const VinPattern = /^[A-HJ-NPR-Z0-9]{17}$/i;
export const DtcPattern = /^[PBCU][0-9A-F]{4}$/i;

export const ReadOnlyScanModes = new Set([
  "firstConnection",
  "dtcScan",
  "freezeFrame",
]);

export const isObjectIdString = (value: string) =>
  /^[a-f0-9]{24}$/i.test(value);

export const decodePathValue = (value: string) => {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

export const normalizeVehicleKey = async (rawKey: string) => {
  const key = decodePathValue(rawKey);

  if (!key) return null;

  if (isObjectIdString(key)) {
    const Profile = await VehicleProfileModel.findOne({
      _id: new ObjectId(key),
    });
    return Profile?.key ?? `vehicle:${key}`;
  }

  const ByKey = await VehicleProfileModel.findOne({ key });
  if (ByKey) return ByKey.key;

  const ById = await VehicleProfileModel.findOne({ id: key });
  if (ById) return ById.key;

  if (key.startsWith("vin:")) {
    return `vin:${normalizeVin(key.slice(4))}`;
  }

  if (key.startsWith("vehicle:") || key.startsWith("profile:")) {
    return key;
  }

  if (VinPattern.test(key)) return `vin:${normalizeVin(key)}`;

  return key;
};

export const findProfile = async (rawKey: string) => {
  const key = await normalizeVehicleKey(rawKey);
  if (!key) return null;

  return await VehicleProfileModel.findOne({ key });
};

export const ensureProfile = async (
  rawKey: string,
  data?: {
    displayName?: string;
    vin?: string | null;
    make?: string | null;
    model?: string | null;
    year?: number | null;
    notes?: string;
  },
  account?: ObjectId,
) => {
  const key = await normalizeVehicleKey(rawKey);
  if (!key) return null;

  const Existing = await VehicleProfileModel.findOne({ key });

  if (Existing) {
    if (account && !Existing.account) {
      await VehicleProfileModel.updateOne(
        { _id: Existing._id },
        { $set: { account } },
      );

      return await VehicleProfileModel.findOne({ _id: Existing._id });
    }

    return Existing;
  }

  const KeyVin = key.startsWith("vin:") ? normalizeVin(key.slice(4)) : null;
  const Vin = data?.vin ? normalizeVin(data.vin) : KeyVin;

  const Doc = {
    key,
    id: key,
    ...(account ? { account } : {}),
    displayName: data?.displayName?.trim() ||
      (Vin ? `Vehicle ${Vin}` : `Vehicle ${key.replace(/^[^:]+:/, "")}`),
    vin: Vin && VinPattern.test(Vin) ? Vin : null,
    make: data?.make ?? null,
    model: data?.model ?? null,
    year: data?.year ?? null,
    notes: data?.notes ?? "",
    firstScanAt: null,
    lastScanAt: null,
  };

  try {
    return await VehicleProfileModel.create(Doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return await VehicleProfileModel.findOne({ key });
    }

    throw error;
  }
};

export const touchProfileScanTimes = async (
  vehicleKey: string,
  startedAt: Date,
  completedAt?: Date | null,
) => {
  const Profile = await VehicleProfileModel.findOne({ key: vehicleKey });
  if (!Profile) return;

  const First = Profile.firstScanAt instanceof Date
    ? new Date(Math.min(Profile.firstScanAt.getTime(), startedAt.getTime()))
    : startedAt;

  const CandidateLast = completedAt ?? startedAt;

  const Last = Profile.lastScanAt instanceof Date
    ? new Date(
      Math.max(Profile.lastScanAt.getTime(), CandidateLast.getTime()),
    )
    : CandidateLast;

  await VehicleProfileModel.updateOne(
    { key: vehicleKey },
    { $set: { firstScanAt: First, lastScanAt: Last } },
  );
};

export const isDuplicateKeyError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;

  const Candidate = error as { code?: number; message?: string };

  return Candidate.code === 11000 ||
    (typeof Candidate.message === "string" &&
      /E11000|duplicate key/i.test(Candidate.message));
};

export const fail = (
  status: number,
  code: string,
  message: string,
  field?: string,
) =>
  Response
    .statusCode(status)
    .message(message, {
      code,
      ...(field ? { field } : {}),
    });

export const randomId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;

export const sha256Bytes = async (bytes: Uint8Array) => {
  const Digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );

  return Array.from(new Uint8Array(Digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const sha256Hex = (value: string) =>
  sha256Bytes(new TextEncoder().encode(value));

export const bytesToBase64 = (bytes: Uint8Array) => {
  let Binary = "";
  const ChunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += ChunkSize) {
    Binary += String.fromCharCode(
      ...bytes.subarray(index, index + ChunkSize),
    );
  }

  return btoa(Binary);
};

export const base64ToBytes = (value: string) => {
  const Binary = atob(value);
  return Uint8Array.from(Binary, (char) => char.charCodeAt(0));
};

export const getPublicBaseUrl = (ctx: any) =>
  (Deno.env.get("PUBLIC_BASE_URL") ?? `${ctx.router.request.url.origin}/api`)
    .replace(/\/$/, "");

export const nowIso = () => new Date().toISOString();

export const isFutureBeyondSkew = (
  value: Date,
  skewMinutes = 5,
) => value.getTime() > Date.now() + skewMinutes * 60 * 1000;

export const isOlderThanOneYear = (value: Date) =>
  value.getTime() < Date.now() - 365 * 24 * 60 * 60 * 1000;

export const normalizeDtcCode = (value: string) => value.trim().toUpperCase();

export const normalizeDtcCodes = (values: string[]) =>
  Array.from(
    new Set(
      values
        .map(normalizeDtcCode)
        .filter((code) => DtcPattern.test(code)),
    ),
  );

export const containsModifyingCommand = (command: string) => {
  const Normalized = command.replace(/\s+/g, "").toUpperCase();

  if (!Normalized) return false;

  if (Normalized.includes("DTCCLR")) return true;
  if (Normalized.startsWith("04")) return true;
  if (Normalized.startsWith("AT")) return true;
  if (/^(2E|31|34|36|37)/.test(Normalized)) return true;

  return false;
};

export const isAllowedSensorKey = (key: string) =>
  (SensorKeys as readonly string[]).includes(key);

export const bucketSizeMs = (bucket?: string) => {
  switch (bucket) {
    case "1m":
      return 60 * 1000;
    case "5m":
      return 5 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    default:
      return null;
  }
};

export const bucketStart = (date: Date, sizeMs: number) =>
  new Date(Math.floor(date.getTime() / sizeMs) * sizeMs);

export const computeStatistics = (values: number[]) => {
  const Clean = values.filter((value) => Number.isFinite(value)).sort((a, b) =>
    a - b
  );

  if (!Clean.length) {
    return {
      sampleCount: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      std: null,
    };
  }

  const Sum = Clean.reduce((total, value) => total + value, 0);
  const Mean = Sum / Clean.length;
  const Middle = Math.floor(Clean.length / 2);
  const Median = Clean.length % 2
    ? Clean[Middle]
    : (Clean[Middle - 1] + Clean[Middle]) / 2;
  const Variance = Clean.reduce(
    (total, value) => total + (value - Mean) ** 2,
    0,
  ) / Clean.length;

  return {
    sampleCount: Clean.length,
    min: Clean[0],
    max: Clean[Clean.length - 1],
    mean: Mean,
    median: Median,
    std: Math.sqrt(Variance),
  };
};

export const computeTrend = (
  points: Array<{ at: Date; value: number }>,
) => {
  const Clean = points
    .filter((point) => point.at instanceof Date && Number.isFinite(point.value))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  if (Clean.length < 6) return null;

  const Start = Clean[0].at.getTime();
  const SpanDays = (Clean[Clean.length - 1].at.getTime() - Start) /
    (24 * 60 * 60 * 1000);

  if (SpanDays < 2) return null;

  const X = Clean.map((point) =>
    (point.at.getTime() - Start) / (24 * 60 * 60 * 1000)
  );
  const Y = Clean.map((point) => point.value);
  const MeanX = X.reduce((a, b) => a + b, 0) / X.length;
  const MeanY = Y.reduce((a, b) => a + b, 0) / Y.length;

  let Numerator = 0;
  let Denominator = 0;
  let Total = 0;

  for (let index = 0; index < Clean.length; index++) {
    Numerator += (X[index] - MeanX) * (Y[index] - MeanY);
    Denominator += (X[index] - MeanX) ** 2;
    Total += (Y[index] - MeanY) ** 2;
  }

  if (!Denominator) return null;

  const Slope = Numerator / Denominator;
  const R2 = Total ? (Numerator ** 2) / (Denominator * Total) : 0;

  const Interpretation = Math.abs(Slope) < 0.001
    ? "لا يوجد اتجاه واضح ضمن النافذة الزمنية."
    : Slope < 0
    ? "ميل هبوطي ضعيف — يحتاج تأكيداً باختبار حمل."
    : "ميل صاعد ضمن النافذة الزمنية.";

  return {
    slopePerDay: Number(Slope.toFixed(6)),
    r2: Number(R2.toFixed(4)),
    spanDays: Number(SpanDays.toFixed(2)),
    sampleCount: Clean.length,
    interpretation: Interpretation,
  };
};

export const severityForDtc = (code: string) => {
  if (/^U/.test(code)) return "high";
  if (/^(P0300|P0301|P0302|P0303|P0304|P0016|P0017)/.test(code)) return "high";
  if (/^P07/.test(code)) return "medium";
  if (/^C/.test(code)) return "medium";
  if (/^B/.test(code)) return "low";
  return "medium";
};

export const systemForDtc = (code: string) => {
  if (/^U/.test(code)) return "battery";
  if (/^C/.test(code)) return "brakes";
  if (/^B/.test(code)) return "body";
  if (/^P07/.test(code)) return "transmission";
  if (/^(P0128|P0217|P04|P2A)/.test(code)) return "emissions";
  return "engine";
};

export const statusForScore = (
  score: number | null,
): "unknown" | "good" | "attention" | "service" | "critical" => {
  if (score === null) return "unknown";
  if (score >= 90) return "good";
  if (score >= 70) return "attention";
  if (score >= 40) return "service";
  return "critical";
};

export const compact = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;

export const getPagination = (
  query: { limit?: number; offset?: number },
  defaults: { limit?: number; max?: number } = {},
) => {
  const Limit = Math.min(
    Math.max(query.limit ?? defaults.limit ?? 50, 1),
    defaults.max ?? 500,
  );

  const Offset = Math.max(query.offset ?? 0, 0);

  return { limit: Limit, offset: Offset };
};

export const getAccountId = (_ctx: any): ObjectId | undefined => {
  // Authentication is optional in this deployment. The auth middleware stores
  // the account id on Oak's state; handlers reach it through ctx.router.
  const Value = _ctx?.state?.accountId ?? _ctx?.router?.state?.accountId;

  if (Value instanceof ObjectId) return Value;
  if (typeof Value === "string" && ObjectId.isValid(Value)) {
    return new ObjectId(Value);
  }

  return undefined;
};

/**
 * Optional account-scoping guard for routes addressed by an opaque record id.
 * Records without an owner remain accessible for local/development use, but a
 * record owned by another account is treated as missing to avoid leaking its
 * existence.
 */
export const isAccountAllowed = (ctx: any, record: any) => {
  const Account = getAccountId(ctx);

  if (!Account) return true;
  if (!record?.account) return true;

  return String(record.account) === String(Account);
};

/**
 * Oak middleware that rejects cross-account access to a vehicle addressed by
 * `:vehicleId`. Unauthenticated requests keep working, and unowned profiles
 * remain accessible for local use.
 */
export const scopeVehicleAccount =
  () => async (ctx: any, next: () => Promise<unknown>) => {
    const Account = getAccountId(ctx);

    if (!Account) return await next();

    const RawKey = ctx?.params?.vehicleId;

    if (!RawKey) return await next();

    const Key = await normalizeVehicleKey(RawKey);

    if (!Key) return await next();

    const Profile = await VehicleProfileModel.findOne({ key: Key });

    if (
      Profile?.account && String(Profile.account) !== String(Account)
    ) {
      ctx.response.status = 404;
      ctx.response.body = {
        status: false,
        messages: [{
          message: "Vehicle profile not found.",
          code: "VEHICLE_NOT_FOUND",
        }],
      };

      return;
    }

    await next();
  };

export const accountFilter = (
  ctx: any,
  filter: Record<string, unknown> = {},
) => {
  const Account = getAccountId(ctx);

  return Account ? { ...filter, account: Account } : filter;
};

export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
