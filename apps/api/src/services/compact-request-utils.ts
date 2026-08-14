export function isCompactionTriggerRequestBody(value: unknown) {
  return (
    isPlainRecord(value) &&
    Array.isArray(value.input) &&
    value.input.some(
      (item) => isPlainRecord(item) && item.type === "compaction_trigger",
    )
  );
}

export function prepareCompactEndpointRequestBody(value: unknown) {
  if (!isPlainRecord(value)) {
    return value;
  }

  const compactBody = { ...value };
  if (Array.isArray(compactBody.input)) {
    compactBody.input = compactBody.input.filter(
      (item) =>
        !isPlainRecord(item) || item.type !== "compaction_trigger",
    );
  }
  delete compactBody.stream;
  delete compactBody.stream_options;
  return compactBody;
}

export function isProtectedCompactRequest(params: {
  endpoint: string;
  requestBody?: unknown;
  responseUsage?: unknown;
}) {
  return (
    params.endpoint === "/v1/responses/compact" ||
    isCompactionTriggerRequestBody(params.requestBody) ||
    hasCompactResponseUsage(params.responseUsage)
  );
}

function hasCompactResponseUsage(value: unknown) {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    value.gatewayCompactFallback === true ||
    value.gatewayCompactKind === "normal" ||
    value.gatewayCompactKind === "fallback"
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
