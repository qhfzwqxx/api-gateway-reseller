"use client";

import { resolveApiBaseUrl, toApiV1BaseUrl } from "./public-config";

function resolveApiRequestBaseUrl() {
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    return "/api";
  }

  return resolveApiBaseUrl();
}

export const apiBaseUrl = resolveApiBaseUrl();
export const apiV1BaseUrl = toApiV1BaseUrl(apiBaseUrl);
export const apiAuthFailureEvent = "gateway:api-auth-failure";
const apiRequestBaseUrl = resolveApiRequestBaseUrl();

export type ApiAuthFailureDetail = {
  error: ApiError;
  token: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export function getToken() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(tokenKey());
}

export function setToken(token: string) {
  window.localStorage.setItem(tokenKey(), token);
}

export function clearToken() {
  window.localStorage.removeItem(tokenKey());
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const hasTokenOverride = Object.prototype.hasOwnProperty.call(init, "token");
  const token = hasTokenOverride ? init.token : getToken();
  const { token: _tokenOverride, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  if (requestInit.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiRequestBaseUrl}${path}`, {
    ...requestInit,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    const parsed = parseResponsePayload(text);
    const error = new ApiError(
      errorMessageFromResponse(text, response.status),
      response.status,
      parsed,
    );
    if (typeof window !== "undefined" && token && isAuthError(error)) {
      window.dispatchEvent(
        new CustomEvent<ApiAuthFailureDetail>(apiAuthFailureEvent, {
          detail: { error, token },
        }),
      );
    }
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function isAuthError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return false;
  }
  if (error.status === 401) {
    return true;
  }
  if (error.status !== 403) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("unauthorized") ||
    message.includes("session expired") ||
    message.includes("authentication required") ||
    message.includes("invalid token") ||
    message.includes("token expired")
  );
}

export function apiFieldError(error: unknown, field: string) {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== "object") {
    return null;
  }

  const issues = "issues" in error.payload ? error.payload.issues : null;
  if (!Array.isArray(issues)) {
    return null;
  }

  const issue = issues.find((item) => {
    if (!item || typeof item !== "object" || !("path" in item)) {
      return false;
    }
    return (
      Array.isArray(item.path) &&
      item.path.some((part: unknown) => String(part) === field)
    );
  });

  if (!issue || typeof issue !== "object" || !("message" in issue)) {
    return null;
  }

  return typeof issue.message === "string" && issue.message.trim()
    ? issue.message.trim()
    : null;
}

function errorMessageFromResponse(text: string, status: number) {
  if (!text) {
    return `请求失败（HTTP ${status}）`;
  }

  try {
    const parsed = JSON.parse(text) as {
      message?: string;
      issues?: Array<{
        path?: Array<string | number>;
        message?: string;
      }>;
      error?: {
        message?: string;
      };
    };

    if (parsed.issues?.length) {
      return parsed.issues
        .map((issue) => {
          const field = issue.path?.join(".");
          return field ? `${field}: ${issue.message}` : issue.message;
        })
        .filter(Boolean)
        .join("；");
    }

    return safeErrorMessage(
      parsed.message ?? parsed.error?.message ?? text,
      status,
    );
  } catch {
    return safeErrorMessage(text, status);
  }
}

function safeErrorMessage(value: string, status: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return `请求失败（HTTP ${status}）`;
  }
  if (/^<!doctype html|^<html[\s>]/i.test(normalized)) {
    return `服务响应异常（HTTP ${status}）`;
  }
  return normalized.length > 500
    ? `${normalized.slice(0, 500)}…`
    : normalized;
}

function parseResponsePayload(text: string) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function tokenKey() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
    return "gateway_admin_token";
  }

  return "gateway_user_token";
}
