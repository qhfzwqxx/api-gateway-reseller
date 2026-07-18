import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@gateway/db";
import { hashSecret } from "../lib/crypto.js";
import { sendApiError } from "../lib/errors.js";
import type { ApiRequestWithUser } from "../types.js";

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  const tokenUser = request.user as { sub?: string; tokenVersion?: number } | undefined;
  if (!tokenUser?.sub) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  const user = await prisma.user.findUnique({
    where: { id: tokenUser.sub },
    select: {
      id: true,
      status: true,
      statusReason: true,
      tokenVersion: true,
    },
  });

  if (!user || !["ACTIVE", "TRIAL"].includes(user.status)) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  if ((tokenUser.tokenVersion ?? 0) !== user.tokenVersion) {
    return reply.status(401).send({ message: "Session expired, please login again" });
  }
}

export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (error?: Error) => void,
) {
  const user = request.user as { role?: string } | undefined;

  if (!user || user.role !== "ADMIN") {
    reply.status(403).send({ message: "Admin permission required" });
    return;
  }

  done();
}

export async function requireApiKey(
  app: FastifyInstance,
  request: ApiRequestWithUser,
  reply: FastifyReply,
  options: { allowBannedUser?: boolean } = {},
) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : undefined;

  if (!token) {
    return sendApiError(reply, 401, "Missing API key", "authentication_error");
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashSecret(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          statusReason: true,
          allowedModels: true,
          rateLimitPerMinute: true,
          concurrencyLimit: true,
          charityEnabled: true,
          charityIpRateLimitEnabled: true,
          charityIpRateLimitPerMinute: true,
          tierId: true,
          tokenVersion: true,
        },
      },
    },
  });

  if (!apiKey || apiKey.status !== "ACTIVE") {
    return sendApiError(reply, 401, "Invalid API key", "authentication_error");
  }

  if (!["ACTIVE", "TRIAL"].includes(apiKey.user.status)) {
    if (options.allowBannedUser && apiKey.user.status === "BANNED") {
      request.apiAuth = {
        apiKey,
        user: apiKey.user,
      };
      return;
    }

    return sendApiError(reply, 401, "Invalid API key", "authentication_error");
  }

  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: {
        status: "DISABLED",
        disabledReason: "Expired",
        disabledAt: new Date(),
      },
    });
    return sendApiError(reply, 401, "API key expired and has been disabled", "authentication_error");
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  request.apiAuth = {
    apiKey,
    user: apiKey.user,
  };
}
