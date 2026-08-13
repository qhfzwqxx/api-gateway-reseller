import type { FastifyRequest } from "fastify";
import type { ApiKey, User } from "@gateway/db";

export type AuthenticatedUser = Pick<
  User,
  | "id"
  | "email"
  | "role"
  | "status"
  | "statusReason"
  | "allowedModels"
  | "rateLimitPerMinute"
  | "concurrencyLimit"
  | "charityEnabled"
  | "charityIpRateLimitEnabled"
  | "charityIpRateLimitPerMinute"
  | "tierId"
  | "tokenVersion"
>;

export type ApiKeyAuth = {
  apiKey: ApiKey;
  user: AuthenticatedUser;
};

export type ApiRequestWithUser = FastifyRequest & {
  apiAuth?: ApiKeyAuth;
};

export type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  billableRequestCount?: number;
  raw?: unknown;
};
