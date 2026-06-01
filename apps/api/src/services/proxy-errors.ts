import type { Usage } from "../types.js";

export const clientStreamClosedStatusCode = 499;
export const clientStreamClosedMessage =
  "Client closed the stream before the gateway finished sending the response";
export const missingUsageMessage =
  "Upstream response did not include billable token usage";

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
    isUpstreamQuotaExhaustedError(responseBody)
  );
}

export function isUpstreamQuotaExhaustedError(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const normalized = text.toLowerCase();
  return (
    normalized.includes("insufficient_user_quota") ||
    normalized.includes("预扣费额度失败")
  );
}

export function isUpstreamBalanceInsufficientError(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const normalized = text.toLowerCase();
  return (
    normalized.includes("insufficient_user_quota") ||
    normalized.includes("insufficient balance") ||
    normalized.includes("insufficient credits") ||
    normalized.includes("credit balance") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("billing hard limit") ||
    normalized.includes("payment required") ||
    normalized.includes("预扣费额度失败") ||
    normalized.includes("余额不足") ||
    normalized.includes("额度不足")
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
