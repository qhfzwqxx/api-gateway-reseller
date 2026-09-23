import { isPlainObject, type ProxyBody } from "./proxy-request-utils.js";

export function buildResponsesLiteRetryBody(params: {
  endpoint: string;
  method: string;
  statusCode: number;
  errorText: string;
  body: ProxyBody;
  retryAttempted?: boolean;
}): ProxyBody | null {
  if (
    params.endpoint !== "/v1/responses" ||
    params.method !== "POST" ||
    params.statusCode !== 400 ||
    params.retryAttempted
  ) {
    return null;
  }

  let message = params.errorText;
  try {
    const parsed: unknown = JSON.parse(message);
    if (!isPlainObject(parsed) || !isPlainObject(parsed.error)) {
      return null;
    }
    if (typeof parsed.error.message !== "string") {
      return null;
    }
    message = parsed.error.message;
  } catch {}

  if (
    !/^X-OpenAI-Internal-Codex-Responses-Lite requires `reasoning\.context` to be `all_turns`\.?$/i.test(
      message.trim(),
    )
  ) {
    return null;
  }

  const reasoning = isPlainObject(params.body.reasoning)
    ? params.body.reasoning
    : {};
  if (reasoning.context === "all_turns") {
    return null;
  }

  return {
    ...params.body,
    reasoning: { ...reasoning, context: "all_turns" },
  };
}
