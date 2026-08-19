import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { redis } from "./lib/redis.js";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { accessTierRoutes } from "./routes/access-tiers.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { walletRoutes } from "./routes/wallet.js";
import { usageRoutes } from "./routes/usage.js";
import { redeemCodeRoutes } from "./routes/redeem-codes.js";
import { referralRoutes } from "./routes/referrals.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { proxyRoutes } from "./routes/proxy.js";
import { adminRoutes } from "./routes/admin.js";
import { publicRoutes } from "./routes/public.js";
import { startModelPoolHealthScheduler } from "./services/model-pool-health.js";
import {
  cleanupStalePendingRequests,
  startPendingRequestCleanupScheduler,
} from "./services/pending-request-cleanup.js";
import { startExternalAlertScheduler } from "./services/operational-alerts.js";
import { startRequestBodyRetentionScheduler } from "./services/request-body-retention-settings.js";
import { assertDatabaseCompatibility } from "./services/database-compatibility.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: typeof redis;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      role: string;
      tokenVersion?: number;
    };
    user: {
      sub: string;
      email: string;
      role: string;
      tokenVersion?: number;
    };
  }
}

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
  trustProxy: true,
  bodyLimit: 20 * 1024 * 1024,
});

app.addContentTypeParser(
  /^multipart\/form-data/i,
  { parseAs: "buffer", bodyLimit: 80 * 1024 * 1024 },
  (_request, body, done) => {
    done(null, body);
  },
);
let stopModelPoolHealthScheduler: (() => void) | undefined;
let stopPendingRequestCleanupScheduler: (() => void) | undefined;
let stopExternalAlertScheduler: (() => void) | undefined;
let stopRequestBodyRetentionScheduler: (() => void) | undefined;
let shuttingDown = false;

app.decorate("redis", redis);

const allowedOrigins = new Set(
  env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed"), false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
});
await app.register(helmet, {
  contentSecurityPolicy: false,
});
await app.register(jwt, {
  secret: env.JWT_SECRET,
  sign: {
    expiresIn: "7d",
  },
});

app.setErrorHandler((error, _request, reply) => {
  if (reply.sent || reply.raw.headersSent || reply.raw.destroyed) {
    app.log.error(error);
    return;
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: "Validation error",
      issues: error.issues,
    });
  }

  if (hasStatusCode(error)) {
    return reply.status(error.statusCode).send({
      message: error.message,
    });
  }

  app.log.error(error);
  return reply.status(500).send({
    message: "Internal server error",
  });
});

app.get("/", async () => ({
  ok: true,
  service: "api-gateway-reseller",
  health: "/health",
}));

app.get("/health", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(accessTierRoutes);
await app.register(apiKeyRoutes);
await app.register(walletRoutes);
await app.register(usageRoutes);
await app.register(redeemCodeRoutes);
await app.register(referralRoutes);
await app.register(subscriptionRoutes);
await app.register(proxyRoutes);
await app.register(adminRoutes);
await app.register(publicRoutes);

app.addHook("onClose", async () => {
  stopModelPoolHealthScheduler?.();
  stopPendingRequestCleanupScheduler?.();
  stopExternalAlertScheduler?.();
  stopRequestBodyRetentionScheduler?.();
  redis.disconnect();
});

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Gracefully shutting down API");

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "API graceful shutdown failed");
    process.exit(1);
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("message", (message) => {
  if (message === "shutdown") {
    void shutdown("shutdown");
  }
});

async function start() {
  try {
    await assertDatabaseCompatibility();
    await redis.connect().catch((error: unknown) => {
      app.log.warn(
        { error },
        "Redis connect failed, API key rate limit may fail",
      );
    });
    await app.listen({
      host: env.API_HOST,
      port: env.API_PORT,
    });
    if (typeof process.send === "function") {
      process.send("ready");
    }
    if (process.env.DEPLOY_SMOKE_TEST === "true") {
      return;
    }
    const stalePendingResult = await cleanupStalePendingRequests();
    if (stalePendingResult.count > 0) {
      app.log.info(
        stalePendingResult,
        "Stale pending API requests marked failed on startup",
      );
    }
    stopPendingRequestCleanupScheduler = startPendingRequestCleanupScheduler(
      app.log,
    );
    stopModelPoolHealthScheduler = startModelPoolHealthScheduler(app.log);
    stopExternalAlertScheduler = startExternalAlertScheduler(app, app.log);
    stopRequestBodyRetentionScheduler = startRequestBodyRetentionScheduler(
      app.log,
    );
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();

function hasStatusCode(
  error: unknown,
): error is { statusCode: number; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
