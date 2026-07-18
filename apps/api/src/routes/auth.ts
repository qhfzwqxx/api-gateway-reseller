import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { randomBytes, randomInt } from "node:crypto";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { hashSecret } from "../lib/crypto.js";
import {
  isSmtpConfigured,
  readAuthSettings,
  toPublicAuthSettings,
} from "../services/auth-settings.js";
import { hashPassword, requireUser, verifyPassword } from "../services/auth.js";
import { syncUserSubscriptionState } from "../services/subscriptions.js";
import { applyReferralForNewUser } from "../services/referrals.js";
import { sendEmailLoginCode } from "../services/mailer.js";
import { getClientIp } from "../services/proxy-request-utils.js";
import { unlockWhitelistFilterUser } from "../services/whitelist-filter-settings.js";

const emailCodeSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
});

const emailCodeLoginSchema = emailCodeSchema.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
  referralCode: z.string().trim().min(1).max(80).optional(),
});

const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
const whitelistFilterUnlockSchema = z.object({
  secret: z.string().trim().min(1).max(256),
});

const adminLoginMaxFailures = 5;
const adminLoginWindowSeconds = 15 * 60;

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/settings", async () => {
    const settings = await readAuthSettings();
    return { settings: toPublicAuthSettings(settings) };
  });

  app.post("/auth/register", async (request, reply) => {
    return reply.status(410).send({
      message:
        "用户账号只支持邮箱验证码进入，请获取邮箱验证码完成登录或自动创建账号。",
    });
  });

  app.post("/auth/email-code/send", async (request, reply) => {
    const body = emailCodeSchema.parse(request.body);
    const settings = await readAuthSettings();

    if (!settings.emailCodeLoginEnabled) {
      return reply.status(403).send({ message: "邮箱验证码登录已关闭" });
    }

    if (!isSmtpConfigured(settings)) {
      return reply.status(503).send({ message: "SMTP is not configured" });
    }

    const cooldownKey = emailCodeCooldownKey(body.email);
    const cooldownSet = await app.redis.set(
      cooldownKey,
      "1",
      "EX",
      settings.emailCodeCooldownSeconds,
      "NX",
    );
    if (!cooldownSet) {
      return reply
        .status(429)
        .send({ message: "验证码发送太频繁，请稍后再试。" });
    }

    const code = String(randomInt(100000, 1000000));
    const ttlSeconds = settings.emailCodeTtlSeconds;
    const ttlMinutes = Math.max(1, Math.ceil(ttlSeconds / 60));

    await app.redis.set(
      emailCodeKey(body.email),
      hashEmailCode(body.email, code),
      "EX",
      ttlSeconds,
    );
    await app.redis.del(emailCodeAttemptsKey(body.email));

    try {
      await sendEmailLoginCode(settings, {
        to: body.email,
        code,
        ttlMinutes,
      });
    } catch (error) {
      await app.redis.del(emailCodeKey(body.email), cooldownKey);
      app.log.error(
        { error, email: body.email },
        "Failed to send email login code",
      );
      return reply
        .status(502)
        .send({ message: "验证码邮件发送失败，请检查 SMTP 设置。" });
    }

    return {
      ok: true,
      expiresInSeconds: ttlSeconds,
      cooldownSeconds: settings.emailCodeCooldownSeconds,
    };
  });

  app.post("/auth/email-code/login", async (request, reply) => {
    const body = emailCodeLoginSchema.parse(request.body);
    const settings = await readAuthSettings();
    const clientIp = getClientIp(request);

    if (!settings.emailCodeLoginEnabled) {
      await writeLoginLog({
        method: "email_code",
        email: body.email,
        success: false,
        failureReason: "email_code_login_disabled",
        ip: clientIp,
        userAgent: request.headers["user-agent"],
      });
      return reply.status(403).send({ message: "邮箱验证码登录已关闭" });
    }

    const attemptsKey = emailCodeAttemptsKey(body.email);
    const attempts = await app.redis.incr(attemptsKey);
    if (attempts === 1) {
      await app.redis.expire(attemptsKey, settings.emailCodeTtlSeconds);
    }

    if (attempts > 5) {
      await writeLoginLog({
        method: "email_code",
        email: body.email,
        success: false,
        failureReason: "too_many_code_attempts",
        ip: clientIp,
        userAgent: request.headers["user-agent"],
      });
      return reply
        .status(429)
        .send({ message: "验证码尝试次数过多，请重新获取。" });
    }

    const storedHash = await app.redis.get(emailCodeKey(body.email));
    if (!storedHash || storedHash !== hashEmailCode(body.email, body.code)) {
      await writeLoginLog({
        method: "email_code",
        email: body.email,
        success: false,
        failureReason: "invalid_or_expired_code",
        ip: clientIp,
        userAgent: request.headers["user-agent"],
      });
      return reply.status(400).send({ message: "验证码无效或已过期。" });
    }

    let user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (user && !["ACTIVE", "TRIAL"].includes(user.status)) {
      await writeLoginLog({
        method: "email_code",
        userId: user.id,
        email: body.email,
        success: false,
        failureReason: `user_status_${user.status}`,
        ip: clientIp,
        userAgent: request.headers["user-agent"],
      });
      return reply.status(401).send({ message: "User is disabled" });
    }

    if (!user) {
      if (!settings.emailCodeAutoRegisterEnabled) {
        await writeLoginLog({
          method: "email_code",
          email: body.email,
          success: false,
          failureReason: "auto_register_disabled",
          ip: clientIp,
          userAgent: request.headers["user-agent"],
        });
        return reply.status(403).send({ message: "邮箱验证码自动注册已关闭" });
      }

      const passwordHash = await hashPassword(
        randomBytes(32).toString("base64url"),
      );
      const newUserBonus = new Decimal(settings.newUserBonusUsd);

      try {
        user = await prisma.$transaction(async (tx) => {
          const created = await createPublicUser(tx, {
            email: body.email,
            passwordHash,
            newUserBonus,
          });
          await applyReferralForNewUser(tx, {
            inviteeUserId: created.id,
            referralCode: body.referralCode,
          });
          return created;
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          user = await prisma.user.findUniqueOrThrow({
            where: { email: body.email },
          });
        } else {
          throw error;
        }
      }
    }

    await app.redis.del(
      emailCodeKey(body.email),
      attemptsKey,
      emailCodeCooldownKey(body.email),
    );
    await writeLoginLog({
      method: "email_code",
      userId: user.id,
      email: body.email,
      success: true,
      ip: clientIp,
      userAgent: request.headers["user-agent"],
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return authResponse(app, user);
  });

  app.post("/auth/login", async (request, reply) => {
    return reply.status(410).send({
      message: "用户账号不支持密码登录，请使用邮箱验证码登录。",
    });
  });

  app.post("/auth/admin-login", async (request, reply) => {
    const body = adminLoginSchema.parse(request.body);
    const clientIp = getClientIp(request);
    const throttleKey = adminLoginThrottleKey(body.username, clientIp);
    const failures = Number(await app.redis.get(throttleKey));
    if (Number.isFinite(failures) && failures >= adminLoginMaxFailures) {
      await writeLoginLog({
        method: "admin_password",
        username: body.username,
        success: false,
        failureReason: "too_many_login_attempts",
        ip: clientIp,
        userAgent: request.headers["user-agent"],
      });
      return reply.status(429).send({
        message: "登录失败次数过多，请稍后再试。",
      });
    }

    const user = await prisma.user.findUnique({
      where: { username: body.username },
    });

    if (
      !user ||
      user.role !== "ADMIN" ||
      !["ACTIVE", "TRIAL"].includes(user.status)
    ) {
      await recordAdminLoginFailure(app, {
        throttleKey,
        user,
        username: body.username,
        reason: !user ? "user_not_found" : `user_status_or_role_${user.status}`,
        ip: clientIp,
        userAgent: request.headers["user-agent"],
      });
      return reply
        .status(401)
        .send({ message: "Invalid username or password" });
    }

    const valid = await verifyPassword(body.password, user.passwordHash);

    if (!valid) {
      await recordAdminLoginFailure(app, {
        throttleKey,
        user,
        username: body.username,
        reason: "invalid_password",
        ip: clientIp,
        userAgent: request.headers["user-agent"],
      });
      return reply
        .status(401)
        .send({ message: "Invalid username or password" });
    }

    await Promise.all([
      app.redis.del(throttleKey),
      writeLoginLog({
        method: "admin_password",
        userId: user.id,
        username: body.username,
        email: user.email,
        success: true,
        ip: clientIp,
        userAgent: request.headers["user-agent"],
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);
    return authResponse(app, user);
  });

  app.get("/auth/me", { preHandler: requireUser }, async (request) => {
    const jwtUser = request.user as { sub: string };
    await prisma.$transaction((tx) =>
      syncUserSubscriptionState(tx, jwtUser.sub),
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: jwtUser.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        allowedModels: true,
        rateLimitPerMinute: true,
        concurrencyLimit: true,
        tokenVersion: true,
        wallet: true,
      },
    });

    return { user };
  });

  app.post(
    "/auth/whitelist-filter/unlock",
    { preHandler: requireUser },
    async (request, reply) => {
      const body = whitelistFilterUnlockSchema.parse(request.body);
      const jwtUser = request.user as { sub: string };
      const result = await unlockWhitelistFilterUser(app, jwtUser.sub, body.secret);

      if (result.ok) {
        return { ok: true };
      }

      if (result.reason === "disabled") {
        return reply.status(409).send({ message: "白名单过滤功能未开启。" });
      }

      return reply.status(400).send({ message: "密钥不正确或已失效。" });
    },
  );
}

async function recordAdminLoginFailure(
  app: FastifyInstance,
  input: {
    throttleKey: string;
    user: { id: string; email: string } | null;
    username: string;
    reason: string;
    ip: string | null;
    userAgent?: string | string[];
  },
) {
  const attempts = await app.redis.incr(input.throttleKey);
  if (attempts === 1) {
    await app.redis.expire(input.throttleKey, adminLoginWindowSeconds);
  }

  await writeLoginLog({
    method: "admin_password",
    userId: input.user?.id,
    username: input.username,
    email: input.user?.email,
    success: false,
    failureReason: input.reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

async function writeLoginLog(input: {
  method: string;
  success: boolean;
  userId?: string | null;
  email?: string | null;
  username?: string | null;
  failureReason?: string | null;
  ip?: string | null;
  userAgent?: string | string[];
}) {
  await prisma.loginLog.create({
    data: {
      method: input.method,
      success: input.success,
      userId: input.userId,
      email: input.email,
      username: input.username,
      failureReason: input.failureReason,
      ip: input.ip,
      userAgent: Array.isArray(input.userAgent)
        ? input.userAgent.join(", ")
        : input.userAgent,
    },
  });
}

function adminLoginThrottleKey(username: string, ip: string | null) {
  return `admin-login-failures:${username.trim().toLowerCase()}:${ip ?? "unknown"}`;
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

type PublicUser = {
  id: string;
  email: string;
  role: string;
  allowedModels: string[];
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  tokenVersion: number;
};

function authResponse(app: FastifyInstance, user: PublicUser) {
  const token = app.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  return {
    token,
    user: serializeAuthUser(user),
  };
}

function serializeAuthUser(user: PublicUser) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    allowedModels: user.allowedModels,
    rateLimitPerMinute: user.rateLimitPerMinute,
    concurrencyLimit: user.concurrencyLimit,
  };
}

async function createPublicUser(
  tx: Prisma.TransactionClient,
  input: {
    email: string;
    passwordHash: string;
    newUserBonus: Decimal;
  },
) {
  const bonus =
    input.newUserBonus.isFinite() && input.newUserBonus.gt(0)
      ? input.newUserBonus
      : new Decimal(0);
  const created = await tx.user.create({
    data: {
      email: input.email,
      passwordHash: input.passwordHash,
      role: "USER",
      status: "ACTIVE",
      wallet: {
        create: {
          balance: bonus.toFixed(8),
        },
      },
    },
  });

  if (bonus.gt(0)) {
    await tx.walletTransaction.create({
      data: {
        userId: created.id,
        type: "RECHARGE",
        source: "NEW_USER_BONUS",
        amount: bonus.toFixed(8),
        balanceBefore: "0",
        balanceAfter: bonus.toFixed(8),
        remark: "New user bonus",
      },
    });
  }

  return created;
}

function emailCodeKey(email: string) {
  return `auth:email-code:${email}`;
}

function emailCodeCooldownKey(email: string) {
  return `auth:email-code-cooldown:${email}`;
}

function emailCodeAttemptsKey(email: string) {
  return `auth:email-code-attempts:${email}`;
}

function hashEmailCode(email: string, code: string) {
  return hashSecret(`${email}:${code}`);
}
