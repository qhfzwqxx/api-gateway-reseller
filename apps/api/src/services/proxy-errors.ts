import type { Usage } from "../types.js";

export const clientStreamClosedStatusCode = 499;
export const clientStreamClosedMessage =
  "Client closed the stream before the gateway finished sending the response";
export const missingUsageMessage =
  "Upstream response did not include billable token usage";

const upstreamBalanceInsufficientMarkers = [
  "insufficient_user_quota",
  "insufficient_quota",
  "insufficient_balance",
  "insufficient_account_balance",
  "account_balance_insufficient",
  "balance_not_enough",
  "insufficient balance",
  "insufficient account balance",
  "account balance insufficient",
  "balance is insufficient",
  "insufficient credits",
  "not enough balance",
  "not enough credits",
  "out of credits",
  "credit balance",
  "credits exhausted",
  "credits_exhausted",
  "billing hard limit",
  "billing_hard_limit",
  "billing limit reached",
  "payment required",
  "payment_required",
  "prepaid balance",
  "exceeded your current quota",
  "check your plan and billing details",
  "预扣费额度失败",
  "余额不足",
  "额度不足",
  "用户额度不足",
  "账户余额不足",
  "剩余额度",
  "欠费",
];

export function isClosedControllerError(error: unknown) {
  if (!(error instanceof TypeError)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("controller is already closed") ||
    (message.includes("invalid state") && message.includes("closed"))
  );
}

export function createClientStreamClosedError() {
  const error = new Error(clientStreamClosedMessage);
  error.name = "ClientStreamClosedError";
  return error;
}

export function isClientStreamClosedError(error: unknown) {
  if (error instanceof Error && error.name === "ClientStreamClosedError") {
    return true;
  }

  if (isClosedControllerError(error)) {
    return true;
  }

  if (getErrorCode(error) === "ERR_STREAM_PREMATURE_CLOSE") {
    return true;
  }

  return error instanceof Error && error.message === "Premature close";
}

export function isRetryableUpstreamFailure(
  statusCode: number,
  responseBody?: unknown,
) {
  return (
    statusCode === 401 ||
    statusCode === 403 ||
    statusCode === 404 ||
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode >= 500 ||
    isTransientUpstreamNginxBadRequest(statusCode, responseBody) ||
    isUpstreamQuotaExhaustedError(responseBody) ||
    isInvalidFunctionSchemaError(statusCode, responseBody)
  );
}

export function isInvalidFunctionSchemaError(
  statusCode: number,
  responseBody?: unknown,
) {
  if (statusCode !== 400) {
    return false;
  }

  const text =
    typeof responseBody === "string"
      ? responseBody
      : JSON.stringify(responseBody ?? "");
  return (
    /invalid_function_parameters/iu.test(text) &&
    /invalid schema for function/iu.test(text)
  );
}

export function isTransientUpstreamNginxBadRequest(
  statusCode: number,
  responseBody?: unknown,
) {
  if (statusCode !== 400 || typeof responseBody !== "string") {
    return false;
  }

  return (
    /<title>\s*400 Bad Request\s*<\/title>/iu.test(responseBody) &&
    /<center>\s*nginx\s*<\/center>/iu.test(responseBody)
  );
}

export function isUpstreamQuotaExhaustedError(value: unknown) {
  return isUpstreamBalanceInsufficientError(value);
}

export function isUpstreamBalanceInsufficientError(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const normalized = text.toLowerCase();
  return upstreamBalanceInsufficientMarkers.some((marker) =>
    normalized.includes(marker),
  );
}

export function isRetryableProxyError(error: unknown, endpoint?: string) {
  if (endpoint === "/v1/responses/compact" && isMissingUsageError(error)) {
    return true;
  }

  return error instanceof TypeError || isAbortError(error);
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function createMissingUsageError() {
  const error = new Error(missingUsageMessage);
  error.name = "MissingUsageError";
  return error;
}

export function isMissingUsageError(error: unknown) {
  return error instanceof Error && error.name === "MissingUsageError";
}

export function assertBillableUsage(usage: Usage) {
  if (usage.totalTokens > 0) {
    return;
  }

  throw createMissingUsageError();
}

function getErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
