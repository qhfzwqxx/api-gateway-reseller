export function configuredApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : "http://127.0.0.1:4100";
}

export function resolveApiBaseUrl() {
  const configured = configuredApiBaseUrl();
  if (!configured.includes("127.0.0.1")) {
    return configured;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = new URL(configured).port || "4100";
    return `${protocol}//${hostname}:${port}`;
  }

  return configured;
}

export function toApiV1BaseUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

export function configuredApiV1BaseUrl() {
  return toApiV1BaseUrl(configuredApiBaseUrl());
}
