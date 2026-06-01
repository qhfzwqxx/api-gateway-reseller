import { sanitizeJsonForPostgres } from "../lib/db-sanitize.js";
import type { FastifyRequest } from "fastify";

export type ProxyBody = {
  model?: string;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  [key: string]: unknown;
};

export const proxiedEndpoints = new Set([
  "/v1/chat/completions",
  "/v1/embeddings",
  "/v1/completions",
  "/v1/images/generations",
]);

export function normalizeEndpoint(endpoint: string) {
  if (endpoint.startsWith("/v1/")) {
    return endpoint;
  }

  if (
    endpoint === "/responses" ||
    endpoint.startsWith("/responses/") ||
    endpoint === "/response" ||
    endpoint.startsWith("/response/")
  ) {
    const normalizedEndpoint =
      endpoint === "/response" || endpoint.startsWith("/response/")
        ? endpoint.replace(/^\/response/, "/responses")
        : endpoint;
    return `/v1${normalizedEndpoint}`;
  }

  if (
    endpoint === "/chat/completions" ||
    endpoint === "/embeddings" ||
    endpoint === "/completions" ||
    endpoint === "/images/generations"
  ) {
    return `/v1${endpoint}`;
  }

  return endpoint;
}

export function normalizeRequestUrl(url: string) {
  const [path = "", query] = url.split("?");
  const normalizedPath = normalizeEndpoint(path);
  return query ? `${normalizedPath}?${query}` : normalizedPath;
}

export function isSupportedEndpoint(endpoint: string) {
  return proxiedEndpoints.has(endpoint) || isResponsesEndpoint(endpoint);
}

export function isAllowedMethod(endpoint: string, method: string) {
  if (!isResponsesEndpoint(endpoint)) {
    return method === "POST";
  }

  if (endpoint === "/v1/responses") {
    return method === "POST";
  }

  if (endpoint === "/v1/responses/compact") {
    return method === "POST";
  }

  if (endpoint === "/v1/responses/input_tokens") {
    return method === "POST";
  }

  if (/^\/v1\/responses\/[^/]+\/cancel$/.test(endpoint)) {
    return method === "POST";
  }

  if (/^\/v1\/responses\/[^/]+\/input_items$/.test(endpoint)) {
    return method === "GET";
  }

  return (
    /^\/v1\/responses\/[^/]+$/.test(endpoint) &&
    (method === "GET" || method === "DELETE")
  );
}

export function shouldReturnApiKeyNotice(endpoint: string, method: string) {
  return method === "POST" && isNoticeResponseEndpoint(endpoint);
}

export function isNoticeResponseEndpoint(endpoint: string) {
  return (
    endpoint === "/v1/chat/completions" ||
    endpoint === "/v1/completions" ||
    endpoint === "/v1/responses"
  );
}

export function isNoticeStreamEndpoint(endpoint: string) {
  return isNoticeResponseEndpoint(endpoint);
}

export function shouldCheckNewRequestLimits(endpoint: string, method: string) {
  return (
    method === "POST" &&
    (endpoint === "/v1/chat/completions" ||
      endpoint === "/v1/completions" ||
      endpoint === "/v1/embeddings" ||
      endpoint === "/v1/images/generations" ||
      endpoint === "/v1/responses")
  );
}

export function isBillableEndpoint(endpoint: string, method: string) {
  return (
    method === "POST" &&
    (endpoint === "/v1/chat/completions" ||
      endpoint === "/v1/completions" ||
      endpoint === "/v1/embeddings" ||
      endpoint === "/v1/images/generations" ||
      endpoint === "/v1/responses" ||
      endpoint === "/v1/responses/compact" ||
      endpoint === "/v1/responses/input_tokens")
  );
}

export function inferModelFromEndpoint(endpoint: string) {
  if (endpoint.startsWith("/v1/responses")) {
    return "responses-meta";
  }

  return "unknown";
}

export function isResponsesEndpoint(endpoint: string) {
  return (
    endpoint === "/v1/responses" ||
    endpoint === "/v1/responses/compact" ||
    endpoint === "/v1/responses/input_tokens" ||
    /^\/v1\/responses\/[^/]+$/.test(endpoint) ||
    /^\/v1\/responses\/[^/]+\/cancel$/.test(endpoint) ||
    /^\/v1\/responses\/[^/]+\/input_items$/.test(endpoint)
  );
}

export function shouldStreamResponse(
  upstreamResponse: Response,
  body: ProxyBody,
  requestUrl: string,
  endpoint?: string,
) {
  if (endpoint === "/v1/responses/compact") {
    return false;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";

  return (
    requestAsksForStream(body, requestUrl) ||
    contentType.includes("text/event-stream")
  );
}

export function requestAsksForStream(body: ProxyBody, requestUrl: string) {
  const url = new URL(requestUrl, "http://gateway.local");
  return body.stream === true || url.searchParams.get("stream") === "true";
}

export function redactBodyForLog(body: ProxyBody) {
  return sanitizeJsonForPostgres(redactLogValue(body));
}

const logSensitiveKeyPattern =
  /(?:api[_-]?key|authorization|token|secret|password|credential|cookie|session)$/i;
const maxLoggedStringLength = 1200;
const maxLoggedArrayItems = 12;
const maxLoggedObjectKeys = 80;
const maxLoggedDepth = 8;

function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > maxLoggedDepth) {
    return "[TRUNCATED_DEPTH]";
  }

  if (typeof value === "string") {
    return truncateLogString(value);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const items =
      value.length > maxLoggedArrayItems
        ? value.slice(-maxLoggedArrayItems)
        : value;
    const redacted = items.map((item) => redactLogValue(item, depth + 1));
    return value.length > maxLoggedArrayItems
      ? [
          {
            omittedItems: value.length - maxLoggedArrayItems,
            reason: "log_array_truncated",
          },
          ...redacted,
        ]
      : redacted;
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  const visibleEntries = entries.slice(0, maxLoggedObjectKeys);
  const redacted = Object.fromEntries(
    visibleEntries.map(([key, item]) => [
      key,
      logSensitiveKeyPattern.test(key)
        ? "[REDACTED]"
        : redactLogValue(item, depth + 1),
    ]),
  );

  if (entries.length > maxLoggedObjectKeys) {
    redacted.__logTruncatedKeys = entries.length - maxLoggedObjectKeys;
  }

  return redacted;
}

function truncateLogString(value: string) {
  if (/^data:[^;]+;base64,/.test(value)) {
    return `[REDACTED_DATA_URL length=${value.length}]`;
  }

  if (value.length <= maxLoggedStringLength) {
    return value;
  }

  return `${value.slice(0, maxLoggedStringLength)}...[truncated ${value.length - maxLoggedStringLength} chars]`;
}

export function pickHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).find(Boolean) ?? null;
  }

  return value?.trim() || null;
}

export function pickForwardedFor(value: string | string[] | undefined) {
  const raw = pickHeaderValue(value);
  if (!raw) {
    return null;
  }

  return (
    raw
      .split(",")
      .map((item) => item.trim())
      .find(Boolean) ?? null
  );
}

export function getClientIp(request: FastifyRequest) {
  const headers = request.headers;

  const headerCandidates = [
    pickHeaderValue(headers["cf-connecting-ip"]),
    pickHeaderValue(headers["x-real-ip"]),
    pickHeaderValue(headers["x-client-ip"]),
    pickHeaderValue(headers["true-client-ip"]),
    pickForwardedFor(headers["x-forwarded-for"]),
  ];

  for (const candidate of headerCandidates) {
    if (candidate) {
      return candidate;
    }
  }

  return request.ip || request.socket.remoteAddress || null;
}

export function buildUpstreamBody(
  endpoint: string,
  body: ProxyBody,
  provider: { name: string; baseUrl: string },
  upstreamEndpoint = endpoint,
) {
  let upstreamBody = body;

  if (
    endpoint === "/v1/responses" &&
    upstreamEndpoint === "/v1/chat/completions"
  ) {
    return buildResponsesToChatCompletionsBody(upstreamBody);
  }

  if (
    endpoint === "/v1/chat/completions" &&
    upstreamEndpoint === "/v1/responses"
  ) {
    return buildChatCompletionsToResponsesBody(upstreamBody);
  }

  if (endpoint === "/v1/responses") {
    upstreamBody = normalizeResponsesCreateBody(upstreamBody);
  }

  if (endpoint === "/v1/responses/compact" && isPlainObject(upstreamBody)) {
    upstreamBody = { ...upstreamBody };
    delete upstreamBody.stream;
    delete upstreamBody.stream_options;
  }

  if (
    endpoint === "/v1/responses" &&
    needsResponsesCompatibilityBody(provider)
  ) {
    upstreamBody = buildResponsesCompatibilityBody(upstreamBody);
  }

  if (!upstreamBody.stream || endpoint.startsWith("/v1/responses")) {
    return upstreamBody;
  }

  return {
    ...upstreamBody,
    stream_options: {
      ...(upstreamBody.stream_options ?? {}),
      include_usage: true,
    },
  };
}

export function resolveUpstreamRequestUrl(
  endpoint: string,
  upstreamRequestUrl: string,
  price?: { upstreamEndpoint?: string | null } | null,
) {
  if (
    endpoint === "/v1/responses" &&
    normalizeUpstreamEndpointSetting(price?.upstreamEndpoint) ===
      "chat_completions"
  ) {
    return replaceRequestPath(upstreamRequestUrl, "/v1/chat/completions");
  }

  if (
    endpoint === "/v1/chat/completions" &&
    normalizeUpstreamEndpointSetting(price?.upstreamEndpoint) === "responses"
  ) {
    return replaceRequestPath(upstreamRequestUrl, "/v1/responses");
  }

  return upstreamRequestUrl;
}

export function resolveUpstreamEndpoint(upstreamRequestUrl: string) {
  const [path = ""] = upstreamRequestUrl.split("?");
  return path;
}

export function transformProxyResponseBody(
  endpoint: string,
  upstreamEndpoint: string,
  responseBody: unknown,
) {
  if (
    endpoint === "/v1/responses" &&
    upstreamEndpoint === "/v1/chat/completions"
  ) {
    return chatCompletionsResponseToResponses(responseBody);
  }

  if (
    endpoint === "/v1/chat/completions" &&
    upstreamEndpoint === "/v1/responses"
  ) {
    return responsesResponseToChatCompletions(responseBody);
  }

  return responseBody;
}

function normalizeResponsesCreateBody(body: ProxyBody): ProxyBody {
  const normalized: ProxyBody = { ...body };

  if (!Object.prototype.hasOwnProperty.call(normalized, "instructions")) {
    normalized.instructions = "";
  }

  return normalized;
}

function needsResponsesCompatibilityBody(provider: {
  name: string;
  baseUrl: string;
}) {
  try {
    const host = new URL(provider.baseUrl).hostname.toLowerCase();
    return (
      host === "share-api.com" ||
      host.endsWith(".share-api.com") ||
      host === "toltol.me" ||
      host.endsWith(".toltol.me")
    );
  } catch {
    return (
      provider.name.includes("share-api.com") ||
      provider.baseUrl.includes("share-api.com") ||
      provider.name.includes("toltol.me") ||
      provider.baseUrl.includes("toltol.me")
    );
  }
}

function buildResponsesCompatibilityBody(body: ProxyBody): ProxyBody {
  const normalized: ProxyBody = { ...body };

  delete normalized.max_output_tokens;
  delete normalized.output;

  if (typeof normalized.input === "string") {
    normalized.input = [{ role: "user", content: normalized.input }];
  }

  return normalized;
}

function replaceRequestPath(requestUrl: string, nextPath: string) {
  const [, query] = requestUrl.split("?");
  return query ? `${nextPath}?${query}` : nextPath;
}

function normalizeUpstreamEndpointSetting(value: string | null | undefined) {
  return value === "chat_completions" ? value : "responses";
}

function buildResponsesToChatCompletionsBody(body: ProxyBody): ProxyBody {
  const {
    input,
    instructions,
    max_output_tokens,
    output,
    ...rest
  } = body as ProxyBody & {
    input?: unknown;
    instructions?: unknown;
    max_output_tokens?: unknown;
    output?: unknown;
  };
  const chatBody: ProxyBody = { ...rest };

  if (max_output_tokens !== undefined && chatBody.max_tokens === undefined) {
    chatBody.max_tokens = max_output_tokens;
  }

  if (Array.isArray(chatBody.tools)) {
    chatBody.tools = chatBody.tools
      .map(convertResponsesToolToChatTool)
      .filter((tool) => tool !== null);
  }

  if (
    isPlainObject(chatBody.tool_choice) &&
    typeof chatBody.tool_choice.name === "string"
  ) {
    chatBody.tool_choice = {
      type: "function",
      function: { name: chatBody.tool_choice.name },
    };
  }

  const messages = buildChatMessages(input, instructions);
  if (messages.length > 0) {
    chatBody.messages = messages;
  }

  return chatBody;
}

function convertResponsesToolToChatTool(tool: unknown) {
  if (!isPlainObject(tool)) {
    return null;
  }

  if (tool.type !== "function") {
    if (tool.type === "custom") {
      return convertCustomToolToChatFunction(tool);
    }

    return null;
  }

  if (isPlainObject(tool.function)) {
    return tool;
  }

  const { type, name, description, parameters, strict } = tool;
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  return {
    type,
    function: {
      name,
      ...(typeof description === "string" ? { description } : {}),
      ...(parameters !== undefined ? { parameters } : {}),
      ...(strict !== undefined ? { strict } : {}),
    },
  };
}

function convertCustomToolToChatFunction(tool: Record<string, unknown>) {
  const { name, description } = tool;
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  return {
    type: "function",
    function: {
      name,
      description:
        typeof description === "string"
          ? `${description}\n\nThis tool originally accepted a raw custom-tool input. Put the complete raw input in the string field named input.`
          : "Custom tool compatibility wrapper. Put the complete raw input in the string field named input.",
      parameters: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Raw input for the custom tool.",
          },
        },
        required: ["input"],
        additionalProperties: false,
      },
    },
  };
}

function buildChatCompletionsToResponsesBody(body: ProxyBody): ProxyBody {
  const {
    messages,
    max_tokens,
    max_completion_tokens,
    ...rest
  } = body as ProxyBody & {
    messages?: unknown;
    max_tokens?: unknown;
    max_completion_tokens?: unknown;
  };
  const responsesBody: ProxyBody = { ...rest };

  if (responsesBody.input === undefined) {
    responsesBody.input = buildResponsesInputFromChatMessages(messages);
  }

  const outputTokenLimit = max_completion_tokens ?? max_tokens;
  if (
    outputTokenLimit !== undefined &&
    responsesBody.max_output_tokens === undefined
  ) {
    responsesBody.max_output_tokens = outputTokenLimit;
  }

  return responsesBody;
}

function buildChatMessages(input: unknown, instructions: unknown) {
  const messages: Array<Record<string, unknown>> = [];
  if (typeof instructions === "string" && instructions.trim()) {
    messages.push({ role: "system", content: instructions });
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const message = convertResponsesInputItemToChatMessage(item);
      if (message) {
        messages.push(message);
      }
    }
  }

  return messages;
}

function convertResponsesInputItemToChatMessage(item: unknown) {
  if (!isPlainObject(item)) {
    return null;
  }

  const role = normalizeChatMessageRole(item.role);
  const content = convertResponsesContentToChatContent(item.content);
  if (content === undefined) {
    return null;
  }

  return { role, content };
}

function normalizeChatMessageRole(role: unknown) {
  if (role === "developer") {
    return "system";
  }

  if (
    role === "system" ||
    role === "user" ||
    role === "assistant" ||
    role === "tool" ||
    role === "latest_reminder"
  ) {
    return role;
  }

  return "user";
}

function convertResponsesContentToChatContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const converted = content
    .map((part) => {
      if (!isPlainObject(part)) {
        return part;
      }

      if (part.type === "input_text") {
        return { ...part, type: "text" };
      }

      return part;
    })
    .filter((part) => part !== undefined);

  return converted.length > 0 ? converted : undefined;
}

function buildResponsesInputFromChatMessages(messages: unknown) {
  if (!Array.isArray(messages)) {
    return messages;
  }

  return messages
    .map((message) => {
      if (!isPlainObject(message)) {
        return null;
      }

      const role = typeof message.role === "string" ? message.role : "user";
      const content = convertChatContentToResponsesContent(message.content);
      if (content === undefined) {
        return null;
      }

      return { role, content };
    })
    .filter((message) => message !== null);
}

function convertChatContentToResponsesContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const converted = content
    .map((part) => {
      if (!isPlainObject(part)) {
        return part;
      }

      if (part.type === "text") {
        return { ...part, type: "input_text" };
      }

      return part;
    })
    .filter((part) => part !== undefined);

  return converted.length > 0 ? converted : undefined;
}

function chatCompletionsResponseToResponses(responseBody: unknown) {
  if (!isPlainObject(responseBody)) {
    return responseBody;
  }

  const choice = Array.isArray(responseBody.choices)
    ? responseBody.choices.find(isPlainObject)
    : undefined;
  const message = isPlainObject(choice?.message) ? choice.message : {};
  const content = extractChatMessageText(message.content);
  const toolCalls = convertChatToolCallsToResponsesOutput(message.tool_calls);
  const id =
    typeof responseBody.id === "string" ? responseBody.id : `resp_${Date.now()}`;
  const model =
    typeof responseBody.model === "string" ? responseBody.model : undefined;
  const createdAt =
    typeof responseBody.created === "number"
      ? responseBody.created
      : Math.floor(Date.now() / 1000);

  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "completed",
    model,
    output: [
      ...(content
        ? [
            {
              id: `${id}_msg`,
              type: "message",
              status: "completed",
              role:
                typeof message.role === "string" ? message.role : "assistant",
              content: [
                {
                  type: "output_text",
                  text: content,
                  annotations: [],
                },
              ],
            },
          ]
        : []),
      ...toolCalls,
    ],
    output_text: content,
    usage: chatUsageToResponsesUsage(responseBody.usage),
  };
}

function convertChatToolCallsToResponsesOutput(toolCalls: unknown) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map((toolCall, index) => {
      if (!isPlainObject(toolCall)) {
        return null;
      }

      const fn = isPlainObject(toolCall.function) ? toolCall.function : null;
      const name = typeof fn?.name === "string" ? fn.name : null;
      if (!name) {
        return null;
      }

      const rawArguments =
        typeof fn?.arguments === "string" ? fn.arguments : "{}";
      const customInput = extractCustomToolInput(rawArguments);

      return {
        id:
          typeof toolCall.id === "string"
            ? toolCall.id
            : `call_${Date.now()}_${index}`,
        type: customInput === null ? "function_call" : "custom_tool_call",
        call_id:
          typeof toolCall.id === "string"
            ? toolCall.id
            : `call_${Date.now()}_${index}`,
        name,
        status: "completed",
        ...(customInput === null
          ? { arguments: rawArguments }
          : { input: customInput }),
      };
    })
    .filter((item) => item !== null);
}

function extractCustomToolInput(rawArguments: string) {
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (
      isPlainObject(parsed) &&
      typeof parsed.input === "string" &&
      Object.keys(parsed).every((key) => key === "input")
    ) {
      return parsed.input;
    }
  } catch {
    return null;
  }

  return null;
}

function responsesResponseToChatCompletions(responseBody: unknown) {
  if (!isPlainObject(responseBody)) {
    return responseBody;
  }

  const id =
    typeof responseBody.id === "string"
      ? responseBody.id
      : `chatcmpl_${Date.now()}`;
  const outputText = extractResponsesOutputText(responseBody);
  const model =
    typeof responseBody.model === "string" ? responseBody.model : undefined;
  const created =
    typeof responseBody.created_at === "number"
      ? responseBody.created_at
      : Math.floor(Date.now() / 1000);

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: outputText,
        },
        finish_reason:
          responseBody.status === "incomplete" ? "length" : "stop",
      },
    ],
    usage: responsesUsageToChatUsage(responseBody.usage),
  };
}

function extractChatMessageText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (isPlainObject(part) && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");
}

function extractResponsesOutputText(responseBody: Record<string, unknown>) {
  if (typeof responseBody.output_text === "string") {
    return responseBody.output_text;
  }

  const output = responseBody.output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) =>
      isPlainObject(item) && Array.isArray(item.content) ? item.content : [],
    )
    .map((part) =>
      isPlainObject(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

function chatUsageToResponsesUsage(usage: unknown) {
  if (!isPlainObject(usage)) {
    return undefined;
  }

  const promptTokens = readNumber(usage.prompt_tokens);
  const completionTokens = readNumber(usage.completion_tokens);
  const totalTokens = readNumber(usage.total_tokens);
  const cachedTokens = isPlainObject(usage.prompt_tokens_details)
    ? readNumber(usage.prompt_tokens_details.cached_tokens)
    : 0;

  return {
    input_tokens: promptTokens,
    input_tokens_details: {
      cached_tokens: cachedTokens,
    },
    output_tokens: completionTokens,
    output_tokens_details: {
      reasoning_tokens: 0,
    },
    total_tokens: totalTokens || promptTokens + completionTokens,
  };
}

function responsesUsageToChatUsage(usage: unknown) {
  if (!isPlainObject(usage)) {
    return undefined;
  }

  const inputTokens = readNumber(usage.input_tokens);
  const outputTokens = readNumber(usage.output_tokens);
  const totalTokens = readNumber(usage.total_tokens);
  const cachedTokens = isPlainObject(usage.input_tokens_details)
    ? readNumber(usage.input_tokens_details.cached_tokens)
    : 0;

  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens || inputTokens + outputTokens,
    prompt_tokens_details: {
      cached_tokens: cachedTokens,
    },
  };
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const UPSTREAM_RESPONSE_MAX_BYTES = 5 * 1024 * 1024; // 5MB
export const UPSTREAM_COMPACT_RESPONSE_MAX_BYTES = 16 * 1024 * 1024; // 16MB

type SafeBodyResult =
  | { json: unknown; text: string }
  | { error: { message: string; statusCode: number } };

export function getUpstreamResponseMaxBytes(endpoint: string) {
  return endpoint === "/v1/responses/compact"
    ? UPSTREAM_COMPACT_RESPONSE_MAX_BYTES
    : UPSTREAM_RESPONSE_MAX_BYTES;
}

export async function safeReadUpstreamBody(
  response: Response,
  options?: {
    logger?: { warn: (value: unknown, message?: string) => void };
    maxBytes?: number;
  },
): Promise<SafeBodyResult> {
  const maxBytes = options?.maxBytes ?? UPSTREAM_RESPONSE_MAX_BYTES;
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = Number(contentLength);
    if (Number.isFinite(size) && size > maxBytes) {
      options?.logger?.warn(
        { contentLength: size, maxBytes },
        "Upstream response body too large, rejecting",
      );
      return {
        error: {
          message: `Upstream response body too large (${(size / 1024 / 1024).toFixed(1)}MB)`,
          statusCode: 502,
        },
      };
    }
  }

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    return {
      error: {
        message: `Failed to read upstream response body: ${err instanceof Error ? err.message : "unknown error"}`,
        statusCode: 502,
      },
    };
  }

  if (text.length > maxBytes) {
    options?.logger?.warn(
      { bodyBytes: text.length, maxBytes },
      "Upstream response body exceeds limit after reading, rejecting",
    );
    return {
      error: {
        message: `Upstream response body too large (${(text.length / 1024 / 1024).toFixed(1)}MB)`,
        statusCode: 502,
      },
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return { json: JSON.parse(text), text };
    } catch (_err) {
      options?.logger?.warn(
        { bodyBytes: text.length },
        "Upstream returned invalid JSON, returning as text",
      );
    }
  }

  return { json: text, text };
}
