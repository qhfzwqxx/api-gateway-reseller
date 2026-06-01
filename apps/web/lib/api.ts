"use client";

function resolveApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;

  if (configured && !configured.includes("127.0.0.1")) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = configured ? new URL(configured).port || "4100" : "4100";
    return `${protocol}//${hostname}:${port}`;
  }

  return "http://127.0.0.1:4100";
}

function resolveApiRequestBaseUrl() {
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    return "/api";
  }

  return resolveApiBaseUrl();
}

export const apiBaseUrl = resolveApiBaseUrl();
const apiRequestBaseUrl = resolveApiRequestBaseUrl();

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
  const token = init.token ?? getToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiRequestBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(errorMessageFromResponse(text, response.status));
  }

  return response.json() as Promise<T>;
}

function errorMessageFromResponse(text: string, status: number) {
  if (!text) {
    return `Request failed: ${status}`;
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

    return parsed.message ?? parsed.error?.message ?? text;
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
