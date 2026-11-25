// deno-lint-ignore-file no-explicit-any
import {
  BaseController,
  Controller,
  Get,
  type IRequestContext,
  type IRoute,
  Post,
  RawResponse,
  Response,
} from "@Core/common/mod.ts";
import { type RouterContext, Status } from "oak";
import e from "validator";

import { AccountModel, InputAccountSchema } from "@Models/account.ts";
import {
  accessTokenResponse,
  findRefreshToken,
  hashPassword,
  revokeRefreshToken,
  verifyPassword,
} from "@Helpers/auth.ts";
import { fail, isDuplicateKeyError } from "@Helpers/health.ts";

const LoginSchema = e.object({
  email: e.string().min(3).max(320),
  password: e.string().min(8).max(256),
});

const RefreshSchema = e.object({
  refreshToken: e.string().min(16).max(512),
});

const LogoutSchema = e.object({
  refreshToken: e.string().min(16).max(512),
});

const publicAccount = (account: any) => ({
  id: account._id.toHexString(),
  email: account.email,
  displayName: account.displayName,
  consent: account.consent,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});

@Controller("/auth/", { name: "auth" })
export default class AuthController extends BaseController {
  @Post("/register")
  public register(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await InputAccountSchema.validate(
          await ctx.router.request.body.json(),
          { name: "auth.register.body" },
        );

        const Email = Body.email.trim().toLowerCase();

        const Existing = await AccountModel.findOne({ email: Email });

        if (Existing) {
          return fail(
            Status.Conflict,
            "EMAIL_ALREADY_REGISTERED",
            "An account with this email already exists.",
            "email",
          );
        }

        const Password = await hashPassword(Body.password);

        try {
          const Account = await AccountModel.create({
            email: Email,
            passwordHash: Password.hash,
            passwordSalt: Password.salt,
            displayName: Body.displayName.trim(),
            consent: Body.consent,
          });

          return Response
            .statusCode(Status.Created)
            .data(publicAccount(Account));
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            return fail(
              Status.Conflict,
              "EMAIL_ALREADY_REGISTERED",
              "An account with this email already exists.",
              "email",
            );
          }

          throw error;
        }
      },
    };
  }

  @Post("/login")
  public login(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await LoginSchema.validate(
          await ctx.router.request.body.json(),
          { name: "auth.login.body" },
        );

        const Account = await AccountModel.findOne({
          email: Body.email.trim().toLowerCase(),
        });

        if (!Account) {
          return fail(
            Status.Unauthorized,
            "INVALID_CREDENTIALS",
            "Invalid email or password.",
          );
        }

        const Valid = await verifyPassword(
          Body.password,
          Account.passwordSalt,
          Account.passwordHash,
        );

        if (!Valid) {
          return fail(
            Status.Unauthorized,
            "INVALID_CREDENTIALS",
            "Invalid email or password.",
          );
        }

        return Response.data(await accessTokenResponse(Account));
      },
    };
  }

  @Post("/refresh")
  public refresh(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await RefreshSchema.validate(
          await ctx.router.request.body.json(),
          { name: "auth.refresh.body" },
        );

        const Record = await findRefreshToken(Body.refreshToken);

        if (!Record) {
          return fail(
            Status.Unauthorized,
            "INVALID_REFRESH_TOKEN",
            "The refresh token is invalid or has expired.",
          );
        }

        const Account = await AccountModel.findOne({ _id: Record.account });

        if (!Account) {
          return fail(
            Status.Unauthorized,
            "INVALID_REFRESH_TOKEN",
            "The refresh token is invalid or has expired.",
          );
        }

        await revokeRefreshToken(Body.refreshToken);

        return Response.data(await accessTokenResponse(Account));
      },
    };
  }

  @Post("/logout")
  public logout(_route: IRoute) {
    return {
      handler: async (
        ctx: IRequestContext<RouterContext<string>>,
      ) => {
        const Body = await LogoutSchema.validate(
          await ctx.router.request.body.json(),
          { name: "auth.logout.body" },
        );

        await revokeRefreshToken(Body.refreshToken);

        return RawResponse.statusCode(Status.NoContent);
      },
    };
  }

  @Get("/me")
  public me(_route: IRoute) {
    return {
      handler: () => Response.data({}),
    };
  }
}
