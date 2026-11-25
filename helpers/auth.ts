// deno-lint-ignore-file no-explicit-any
import { ObjectId } from "mongo";
import { Env } from "@Core/common/env.ts";
import { AccountModel, RefreshTokenModel } from "@Models/account.ts";
import { sha256Hex } from "@Helpers/health.ts";

const Encoder = new TextEncoder();
const Decoder = new TextDecoder();

const JwtSecret = () => {
  const Secret = Env.getAll().JWT_SECRET;

  if (!Secret || Secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be configured and at least 32 characters long.",
    );
  }

  return Secret;
};

/** Validate authentication configuration during application startup. */
export const assertAuthConfiguration = () => {
  JwtSecret();
};

const JwtIssuer = () =>
  Env.getAll().JWT_ISSUER ?? "https://backend-obd.onrender.com";

const JwtAudience = () => Env.getAll().JWT_AUDIENCE ?? "drive_scope";

const AccessTtl = () => Number(Env.getAll().JWT_ACCESS_TTL ?? "1800") || 1800;

const RefreshTtl = () =>
  Number(Env.getAll().JWT_REFRESH_TTL ?? "2592000") || 2592000;

const base64UrlEncode = (value: Uint8Array | string) => {
  const Bytes = typeof value === "string" ? Encoder.encode(value) : value;

  let Binary = "";

  for (const Byte of Bytes) Binary += String.fromCharCode(Byte);

  return btoa(Binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

const base64UrlDecode = (value: string) => {
  const Padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );

  const Binary = atob(Padded);
  return Uint8Array.from(Binary, (char) => char.charCodeAt(0));
};

const hmacKey = () =>
  crypto.subtle.importKey(
    "raw",
    Encoder.encode(JwtSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

export const signJwt = async (payload: Record<string, unknown>) => {
  const Now = Math.floor(Date.now() / 1000);
  const Header = base64UrlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const Body = base64UrlEncode(JSON.stringify({
    iss: JwtIssuer(),
    aud: JwtAudience(),
    iat: Now,
    exp: Now + AccessTtl(),
    ...payload,
  }));

  const Signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    Encoder.encode(`${Header}.${Body}`),
  );

  return `${Header}.${Body}.${base64UrlEncode(new Uint8Array(Signature))}`;
};

export const verifyJwt = async (token: string) => {
  const Parts = token.split(".");

  if (Parts.length !== 3) return null;

  const [Header, Body, Signature] = Parts;

  const Valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    base64UrlDecode(Signature),
    Encoder.encode(`${Header}.${Body}`),
  ).catch(() => false);

  if (!Valid) return null;

  try {
    const Payload = JSON.parse(
      Decoder.decode(base64UrlDecode(Body)),
    ) as Record<string, any>;

    const Now = Math.floor(Date.now() / 1000);

    if (typeof Payload.exp !== "number" || Payload.exp <= Now) return null;
    if (Payload.iss !== JwtIssuer()) return null;
    if (Payload.aud !== JwtAudience()) return null;

    return Payload;
  } catch {
    return null;
  }
};

export const hashPassword = async (
  password: string,
  salt?: string,
) => {
  const Salt = salt ??
    base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  const Key = await crypto.subtle.importKey(
    "raw",
    Encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const Bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64UrlDecode(Salt),
      iterations: 120000,
      hash: "SHA-256",
    },
    Key,
    256,
  );

  return {
    salt: Salt,
    hash: base64UrlEncode(new Uint8Array(Bits)),
  };
};

export const verifyPassword = async (
  password: string,
  salt: string,
  hash: string,
) => {
  const Candidate = await hashPassword(password, salt);

  if (Candidate.hash.length !== hash.length) return false;

  let Difference = 0;

  for (let index = 0; index < hash.length; index++) {
    Difference |= Candidate.hash.charCodeAt(index) ^ hash.charCodeAt(index);
  }

  return Difference === 0;
};

export const createRefreshToken = async (account: ObjectId) => {
  const Token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));

  await RefreshTokenModel.create({
    account,
    tokenHash: await sha256Hex(Token),
    expiresAt: new Date(Date.now() + RefreshTtl() * 1000),
    revokedAt: null,
  });

  return Token;
};

export const findRefreshToken = async (token: string) => {
  return await RefreshTokenModel.findOne({
    tokenHash: await sha256Hex(token),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
};

export const revokeRefreshToken = async (token: string) => {
  const Record = await findRefreshToken(token);

  if (!Record) return false;

  await RefreshTokenModel.updateOne(
    { _id: Record._id },
    { $set: { revokedAt: new Date() } },
  );

  return true;
};

export const getBearerToken = (ctx: any) => {
  const Header = ctx?.request?.headers?.get("authorization") ??
    ctx?.router?.request?.headers?.get("authorization") ??
    "";

  const Match = /^Bearer\s+(.+)$/i.exec(Header);
  return Match?.[1]?.trim() ?? null;
};

export const accountFromRequest = async (ctx: any) => {
  const Token = getBearerToken(ctx);

  if (!Token) return null;

  const Payload = await verifyJwt(Token);
  if (!Payload?.sub) return null;

  if (!ObjectId.isValid(String(Payload.sub))) return null;

  return await AccountModel.findOne({ _id: new ObjectId(String(Payload.sub)) });
};

/**
 * Require a valid bearer token and expose its account id to downstream
 * handlers. Health records and AI diagnostics are user data, so allowing an
 * anonymous request would bypass all account scoping.
 */
export const requireAuth =
  () => async (ctx: any, next: () => Promise<unknown>) => {
    const Account = await accountFromRequest(ctx).catch(() => null);

    if (!Account?._id) {
      ctx.response.status = 401;
      ctx.response.body = {
        status: false,
        messages: [{
          message: "A valid bearer token is required.",
          code: "UNAUTHENTICATED",
        }],
      };
      return;
    }

    ctx.state.accountId = Account._id;

    await next();
  };

export const accessTokenResponse = async (
  account: { _id: ObjectId; email: string; displayName: string },
) => {
  const AccessToken = await signJwt({
    sub: account._id.toHexString(),
    email: account.email,
    name: account.displayName,
  });

  const RefreshToken = await createRefreshToken(account._id);

  return {
    accessToken: AccessToken,
    accessExpiresIn: AccessTtl(),
    refreshToken: RefreshToken,
    account: {
      id: account._id.toHexString(),
      email: account.email,
      displayName: account.displayName,
    },
  };
};

export { JwtAudience, JwtIssuer };
