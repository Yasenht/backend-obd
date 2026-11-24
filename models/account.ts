import e from "validator";
import { Mongo, ObjectId } from "mongo";

export const ConsentSchema = e.object({
  termsVersion: e.string().min(1).max(40),
  privacyVersion: e.string().min(1).max(40),
  acceptedAt: e.date(),
  analyticsOptIn: e.optional(e.boolean()).default(false),
});

export const InputAccountSchema = e.object({
  email: e.string().min(3).max(320).matches(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  ),
  password: e.string().min(8).max(256),
  displayName: e.string().min(1).max(200),
  consent: ConsentSchema,
});

export const AccountSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  email: e.string().min(3).max(320),

  passwordHash: e.string().min(16).max(512),

  passwordSalt: e.string().min(16).max(256),

  displayName: e.string().min(1).max(200),

  consent: ConsentSchema,

  createdAt: e.optional(e.date()).default(() => new Date()),

  updatedAt: e.optional(e.date()).default(() => new Date()),
});

export const AccountModel = Mongo.model("account", AccountSchema);

AccountModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

AccountModel.createIndex({
  key: { email: 1 },
  name: "account_email_unique",
  unique: true,
});

export const RefreshTokenSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),

  account: e.instanceOf(ObjectId, { instantiate: true }),

  tokenHash: e.string().min(32).max(256),

  expiresAt: e.date(),

  revokedAt: e.optional(e.or([e.date(), e.null()])),

  createdAt: e.optional(e.date()).default(() => new Date()),

  updatedAt: e.optional(e.date()).default(() => new Date()),
});

export const RefreshTokenModel = Mongo.model(
  "refreshToken",
  RefreshTokenSchema,
);

RefreshTokenModel.pre("update", (details) => {
  details.updates.$set = {
    ...details.updates.$set,
    updatedAt: new Date(),
  };
});

RefreshTokenModel.createIndex({
  key: { tokenHash: 1 },
  name: "refresh_token_hash_unique",
  unique: true,
});

RefreshTokenModel.createIndex({
  key: { account: 1, expiresAt: -1 },
  name: "refresh_token_account",
});
