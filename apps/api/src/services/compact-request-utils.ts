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

export function isCodexCompactionRequest(params: {
  endpoint: string;
  requestBody?: unknown;
}) {
  return (
    params.endpoint === "/v1/responses/compact" ||
    isCompactionTriggerRequestBody(params.requestBody)
  );
}

export function shouldBypassPolicyRecoveryForCompact(params: {
  endpoint: string;
  requestBody?: unknown;
}) {
  return isCodexCompactionRequest(params);
}

export function normalizeCodexCompactionOutput<T>(value: T) {
  const normalized = normalizeCompactionValue(value);
  return {
    value: normalized.value as T,
    replacements: normalized.replacements,
  };
}

export function normalizeCodexDirectCompactionResponse(value: unknown) {
  const normalized = normalizeCodexCompactionOutput(value);
  const unwrapped = unwrapDirectCompactionResponse(normalized.value);
  return {
    value: unwrapped.value,
    replacements: normalized.replacements,
    unwrappedResponseEnvelope: unwrapped.unwrapped,
  };
}

export function normalizeCodexCompactionSseText(text: string) {
  let replacements = 0;
  const value = text.replace(
    /([^]*?)(\r?\n\r?\n|$)/gu,
    (match, frame: string, separator: string) => {
      if (!frame) {
        return match;
      }

      const newline = frame.includes("\r\n") ? "\r\n" : "\n";
      const lines = frame.split(/\r?\n/u);
      const dataIndexes: number[] = [];
      const dataLines: string[] = [];
      lines.forEach((line, index) => {
        if (line.startsWith("data:")) {
          dataIndexes.push(index);
          dataLines.push(line.slice("data:".length).trimStart());
        }
      });
      const raw = dataLines.join("\n");
      if (!raw || raw === "[DONE]") {
        return match;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return match;
      }

      const normalized = normalizeCodexCompactionOutput(payload);
      if (normalized.replacements <= 0) {
        return match;
      }

      replacements += normalized.replacements;
      const firstDataIndex = dataIndexes[0];
      if (firstDataIndex === undefined) {
        return match;
      }
      const extraDataIndexes = new Set(dataIndexes.slice(1));
      const normalizedLines = lines.filter(
        (_, index) => !extraDataIndexes.has(index),
      );
      normalizedLines[firstDataIndex] = `data: ${JSON.stringify(normalized.value)}`;
      return `${normalizedLines.join(newline)}${separator}`;
    },
  );

  return { text: value, replacements };
}

export function inspectRemoteCompactionOutput(value: unknown) {
  const streamedOutputItems = Array.isArray(value)
    ? value.flatMap((payload) => {
        if (
          !isPlainRecord(payload) ||
          payload.type !== "response.output_item.done" ||
          !isPlainRecord(payload.item)
        ) {
          return [];
        }
        return [payload.item];
      })
    : [];
  const outputItems = streamedOutputItems.length > 0
    ? streamedOutputItems
    : Array.isArray(value)
      ? value.flatMap(readResponseOutputItems)
      : readResponseOutputItems(value);
  return inspectCompactionItems(outputItems);
}

export function inspectDirectCompactionOutput(value: unknown) {
  const outputItems = isPlainRecord(value) && Array.isArray(value.output)
    ? value.output
    : [];
  return inspectCompactionItems(outputItems);
}

function normalizeCompactionValue(
  value: unknown,
): { value: unknown; replacements: number } {
  if (Array.isArray(value)) {
    let replacements = 0;
    const items = value.map((item) => {
      const normalized = normalizeCompactionValue(item);
      replacements += normalized.replacements;
      return normalized.value;
    });
    return { value: replacements > 0 ? items : value, replacements };
  }

  if (!isPlainRecord(value)) {
    return { value, replacements: 0 };
  }

  if (
    (value.type === "compaction" ||
      value.type === "compaction_summary" ||
      value.type === "response.compaction_summary" ||
      value.object === "compaction_summary") &&
    typeof value.encrypted_content === "string" &&
    value.encrypted_content.length > 0
  ) {
    const { id: _id, object: _object, ...rest } = value;
    const normalized = {
      ...rest,
      type: "compaction",
      encrypted_content: value.encrypted_content,
    };
    const changed =
      value.type !== "compaction" ||
      Object.prototype.hasOwnProperty.call(value, "id") ||
      Object.prototype.hasOwnProperty.call(value, "object");
    return {
      value: changed ? normalized : value,
      replacements: changed ? 1 : 0,
    };
  }

  let replacements = 0;
  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const child = normalizeCompactionValue(item);
    replacements += child.replacements;
    normalized[key] = child.value;
  }
  return {
    value: replacements > 0 ? normalized : value,
    replacements,
  };
}

function unwrapDirectCompactionResponse(value: unknown) {
  if (isPlainRecord(value) && Array.isArray(value.output)) {
    return { value, unwrapped: false };
  }

  if (
    isPlainRecord(value) &&
    isPlainRecord(value.response) &&
    Array.isArray(value.response.output)
  ) {
    return { value: value.response, unwrapped: true };
  }

  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const payload = value[index];
      if (
        isPlainRecord(payload) &&
        payload.type === "response.completed" &&
        isPlainRecord(payload.response) &&
        Array.isArray(payload.response.output)
      ) {
        return { value: payload.response, unwrapped: true };
      }
    }
  }

  return { value, unwrapped: false };
}

function inspectCompactionItems(outputItems: unknown[]) {
  const outputItemTypes = outputItems.map((item) =>
    isPlainRecord(item) && typeof item.type === "string"
      ? item.type
      : "unknown",
  );
  const compactionOutputItems = outputItems.filter(
    (item): item is Record<string, unknown> =>
      isPlainRecord(item) &&
      item.type === "compaction" &&
      typeof item.encrypted_content === "string" &&
      item.encrypted_content.length > 0,
  );

  return {
    outputItemCount: outputItems.length,
    compactionOutputItemCount: compactionOutputItems.length,
    outputItemTypes,
    compactionOutputItems,
  };
}

export function isProtectedPolicyRecoveryRequest(value: unknown) {
  return isPlainRecord(value) && value.enabled === true;
}

function readResponseOutputItems(value: unknown) {
  if (!isPlainRecord(value)) {
    return [];
  }
  if (Array.isArray(value.output)) {
    return value.output;
  }
  if (isPlainRecord(value.response) && Array.isArray(value.response.output)) {
    return value.response.output;
  }
  return [];
}

function hasCompactResponseUsage(value: unknown) {
  if (!isPlainRecord(value)) {
    return false;
  }

  return value.gatewayCompactKind === "normal";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
