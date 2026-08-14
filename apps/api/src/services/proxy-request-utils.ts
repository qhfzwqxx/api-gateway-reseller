import { createHash } from "node:crypto";
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

type ToolSpecKind = "function" | "custom" | "namespace" | "tool_search";

export type ChatToolSpec = {
  kind: ToolSpecKind;
  name: string;
  chatName: string;
  namespace?: string;
};

export type ToolConversionContext = {
  chatTools: unknown[];
  specsByChatName: Map<string, ChatToolSpec>;
  namespaceNameToChatName: Map<string, string>;
};

export type ProxyTransformContext = {
  toolContext: ToolConversionContext;
};

const customToolInputField = "input";
const toolSearchProxyName = "tool_search";
const chatToolNameMaxLength = 64;

export const proxiedEndpoints = new Set([
  "/v1/chat/completions",
  "/v1/embeddings",
  "/v1/completions",
  "/v1/images/generations",
  "/v1/images/edits",
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
    endpoint === "/images/generations" ||
    endpoint === "/images/edits"
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
      endpoint === "/v1/images/edits" ||
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
      endpoint === "/v1/images/edits" ||
      endpoint === "/v1/responses" ||
      endpoint === "/v1/responses/compact" ||
      endpoint === "/v1/responses/input_tokens")
  );
}

export function parseMultipartProxyBody(
  body: Buffer,
  contentType: string | undefined,
) {
  return {
    model: readMultipartTextField(body, contentType, "model") ?? undefined,
    prompt: readMultipartTextField(body, contentType, "prompt") ?? undefined,
    multipart: true,
  } satisfies ProxyBody;
}

function readMultipartTextField(
  body: Buffer,
  contentType: string | undefined,
  fieldName: string,
) {
  const boundary =
    contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] ??
    contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) {
    return null;
  }

  const text = body.toString("latin1");
  const parts = text.split(`--${boundary}`);
  const fieldPattern = new RegExp(`name="${escapeRegExp(fieldName)}"`);

  for (const part of parts) {
    if (!fieldPattern.test(part)) {
      continue;
    }
    const separatorIndex = part.indexOf("\r\n\r\n");
    if (separatorIndex < 0) {
      continue;
    }
    return part
      .slice(separatorIndex + 4)
      .replace(/\r\n--$/, "")
      .replace(/\r\n$/, "")
      .trim();
  }

  return null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  const entries = Object.entries(value).filter(
    ([, item]) => item !== undefined,
  );
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
  transformContext?: ProxyTransformContext,
) {
  let upstreamBody = body;

  if (
    endpoint === "/v1/responses" &&
    upstreamEndpoint === "/v1/chat/completions"
  ) {
    return withChatStreamUsageOptions(
      buildResponsesToChatCompletionsBody(upstreamBody, transformContext),
    );
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

function withChatStreamUsageOptions(body: ProxyBody): ProxyBody {
  if (!body.stream) {
    return body;
  }

  return {
    ...body,
    stream_options: {
      ...(isPlainObject(body.stream_options) ? body.stream_options : {}),
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
  transformContext?: ProxyTransformContext,
) {
  if (
    endpoint === "/v1/responses" &&
    upstreamEndpoint === "/v1/chat/completions"
  ) {
    return chatCompletionsResponseToResponses(
      responseBody,
      transformContext?.toolContext,
    );
  }

  if (
    endpoint === "/v1/chat/completions" &&
    upstreamEndpoint === "/v1/responses"
  ) {
    return responsesResponseToChatCompletions(responseBody);
  }

  return responseBody;
}

export function createProxyTransformContext(
  endpoint: string,
  body: ProxyBody,
  upstreamEndpoint: string,
): ProxyTransformContext | undefined {
  if (
    endpoint === "/v1/responses" &&
    upstreamEndpoint === "/v1/chat/completions"
  ) {
    return {
      toolContext: buildToolConversionContext(body),
    };
  }

  return undefined;
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
  if (value === "chat_completions" || value === "images_generations") {
    return value;
  }

  return "responses";
}

function buildToolConversionContext(body: ProxyBody): ToolConversionContext {
  const context: ToolConversionContext = {
    chatTools: [],
    specsByChatName: new Map(),
    namespaceNameToChatName: new Map(),
  };

  const addChatTool = (
    chatName: string,
    spec: Omit<ChatToolSpec, "chatName">,
    chatTool: unknown,
  ) => {
    const uniqueChatName = ensureUniqueChatToolName(chatName, context);
    const resolvedSpec = { ...spec, chatName: uniqueChatName };
    const resolvedTool = rewriteChatToolName(chatTool, uniqueChatName);
    context.chatTools.push(resolvedTool);
    context.specsByChatName.set(uniqueChatName, resolvedSpec);
    if (resolvedSpec.namespace) {
      context.namespaceNameToChatName.set(
        namespaceToolKey(resolvedSpec.namespace, resolvedSpec.name),
        uniqueChatName,
      );
    }
  };

  const addResponseTool = (tool: unknown, namespace?: string) => {
    if (typeof tool === "string") {
      addCustomTool({ type: "custom", name: tool });
      return;
    }

    if (!isPlainObject(tool)) {
      return;
    }

    if (tool.type === "function") {
      const name = readResponsesToolName(tool);
      if (!name) {
        return;
      }
      const chatName = namespace
        ? flattenNamespaceToolName(namespace, name)
        : sanitizeChatToolName(name);
      const chatTool = convertResponsesFunctionToolToChatTool(tool, chatName);
      if (!chatTool) {
        return;
      }
      addChatTool(
        chatName,
        {
          kind: namespace ? "namespace" : "function",
          name,
          ...(namespace ? { namespace } : {}),
        },
        chatTool,
      );
      return;
    }

    if (tool.type === "custom") {
      addCustomTool(tool);
      return;
    }

    if (tool.type === "tool_search") {
      addToolSearchTool();
      return;
    }

    if (tool.type === "namespace") {
      const namespaceName = typeof tool.name === "string" ? tool.name : "";
      const children = Array.isArray(tool.tools)
        ? tool.tools
        : Array.isArray(tool.children)
          ? tool.children
          : [];
      if (!namespaceName || children.length === 0) {
        return;
      }
      for (const child of children) {
        addResponseTool(child, namespaceName);
      }
    }
  };

  const addCustomTool = (tool: Record<string, unknown>) => {
    const name = readResponsesToolName(tool);
    if (!name) {
      return;
    }
    const chatName = sanitizeChatToolName(name);
    addChatTool(
      chatName,
      {
        kind: "custom",
        name,
      },
      convertCustomToolToChatFunction(tool, chatName),
    );
  };

  const addToolSearchTool = () => {
    addChatTool(
      toolSearchProxyName,
      {
        kind: "tool_search",
        name: toolSearchProxyName,
      },
      {
        type: "function",
        function: {
          name: toolSearchProxyName,
          description:
            "Search and load Codex tools, plugins, connectors, and MCP namespaces for the current task.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query for tools or connectors to load.",
              },
              limit: {
                type: "integer",
                description: "Maximum number of tool groups to return.",
              },
            },
            required: ["query"],
          },
        },
      },
    );
  };

  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      addResponseTool(tool);
    }
  }

  collectToolSearchOutputTools(body.input, addResponseTool);

  return context;
}

function buildResponsesToChatCompletionsBody(
  body: ProxyBody,
  transformContext?: ProxyTransformContext,
): ProxyBody {
  const { input, instructions, max_output_tokens, output, ...rest } =
    body as ProxyBody & {
      input?: unknown;
      instructions?: unknown;
      max_output_tokens?: unknown;
      output?: unknown;
    };
  const chatBody: ProxyBody = { ...rest };
  const toolContext =
    transformContext?.toolContext ?? buildToolConversionContext(body);

  if (max_output_tokens !== undefined && chatBody.max_tokens === undefined) {
    chatBody.max_tokens = max_output_tokens;
  }

  if (Array.isArray(chatBody.tools) || toolContext.chatTools.length > 0) {
    chatBody.tools = toolContext.chatTools;
  }

  if (chatBody.tool_choice !== undefined) {
    chatBody.tool_choice = convertResponsesToolChoiceToChatToolChoice(
      chatBody.tool_choice,
      toolContext,
    );
  }

  const messages = collapseSystemMessagesToHead(
    buildChatMessages(input, instructions, toolContext),
  );
  if (messages.length > 0) {
    chatBody.messages = messages;
  }

  if (!Array.isArray(chatBody.tools) || chatBody.tools.length === 0) {
    delete chatBody.tools;
    delete chatBody.tool_choice;
    delete chatBody.parallel_tool_calls;
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
      name: sanitizeChatToolName(name),
      ...(typeof description === "string" ? { description } : {}),
      ...(parameters !== undefined ? { parameters } : {}),
      ...(strict !== undefined ? { strict } : {}),
    },
  };
}

function convertResponsesFunctionToolToChatTool(
  tool: Record<string, unknown>,
  chatName: string,
) {
  if (tool.type !== "function") {
    return null;
  }

  if (isPlainObject(tool.function)) {
    return {
      type: "function",
      function: {
        ...tool.function,
        name: chatName,
        ...(tool.strict !== undefined && tool.function.strict === undefined
          ? { strict: tool.strict }
          : {}),
      },
    };
  }

  return {
    type: "function",
    function: {
      name: chatName,
      ...(typeof tool.description === "string"
        ? { description: tool.description }
        : {}),
      ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
      ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    },
  };
}

function convertCustomToolToChatFunction(
  tool: Record<string, unknown>,
  chatName?: string,
) {
  const { name, description } = tool;
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  return {
    type: "function",
    function: {
      name: chatName ?? sanitizeChatToolName(name),
      description:
        typeof description === "string"
          ? `${description}\n\nOriginal tool definition:\n${safeJsonStringify(tool)}\n\nThis tool originally accepted a raw custom-tool input. Put the complete raw input in the string field named input. Preserve formatting exactly.`
          : `Original tool definition:\n${safeJsonStringify(tool)}\n\nCustom tool compatibility wrapper. Put the complete raw input in the string field named input. Preserve formatting exactly.`,
      parameters: {
        type: "object",
        properties: {
          [customToolInputField]: {
            type: "string",
            description: "Raw input for the custom tool.",
          },
        },
        required: [customToolInputField],
        additionalProperties: false,
      },
    },
  };
}

function convertResponsesToolChoiceToChatToolChoice(
  toolChoice: unknown,
  toolContext: ToolConversionContext,
) {
  if (!isPlainObject(toolChoice)) {
    return toolChoice;
  }

  if (toolChoice.type === "tool_search") {
    return {
      type: "function",
      function: { name: toolSearchProxyName },
    };
  }

  if (toolChoice.type !== "function" && toolChoice.type !== "custom") {
    return toolChoice;
  }

  const name = typeof toolChoice.name === "string" ? toolChoice.name : "";
  if (!name) {
    return toolChoice;
  }

  const chatName =
    toolChoice.type === "function"
      ? chatNameForResponsesFunction(
          name,
          typeof toolChoice.namespace === "string"
            ? toolChoice.namespace
            : undefined,
          toolContext,
        )
      : chatNameForCustomTool(name, toolContext);

  return {
    type: "function",
    function: { name: chatName },
  };
}

function readResponsesToolName(tool: Record<string, unknown>) {
  if (typeof tool.name === "string" && tool.name.trim()) {
    return tool.name.trim();
  }

  const fn = isPlainObject(tool.function) ? tool.function : null;
  if (typeof fn?.name === "string" && fn.name.trim()) {
    return fn.name.trim();
  }

  return "";
}

function rewriteChatToolName(tool: unknown, chatName: string) {
  if (!isPlainObject(tool)) {
    return tool;
  }

  const fn = isPlainObject(tool.function) ? tool.function : null;
  if (!fn) {
    return tool;
  }

  return {
    ...tool,
    function: {
      ...fn,
      name: chatName,
    },
  };
}

function collectToolSearchOutputTools(
  value: unknown,
  addResponseTool: (tool: unknown) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectToolSearchOutputTools(item, addResponseTool);
    }
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  if (value.type === "tool_search_output" && Array.isArray(value.tools)) {
    for (const tool of value.tools) {
      addResponseTool(tool);
    }
  }

  for (const item of Object.values(value)) {
    collectToolSearchOutputTools(item, addResponseTool);
  }
}

function namespaceToolKey(namespace: string, name: string) {
  return `${namespace}\u0000${name}`;
}

function chatNameForResponsesFunction(
  name: string,
  namespace: string | undefined,
  toolContext: ToolConversionContext,
) {
  if (namespace) {
    return (
      toolContext.namespaceNameToChatName.get(
        namespaceToolKey(namespace, name),
      ) ?? flattenNamespaceToolName(namespace, name)
    );
  }

  return chatNameForCustomTool(name, toolContext);
}

function chatNameForCustomTool(
  name: string,
  toolContext: ToolConversionContext,
) {
  for (const spec of toolContext.specsByChatName.values()) {
    if (!spec.namespace && spec.name === name) {
      return spec.chatName;
    }
  }

  return sanitizeChatToolName(name);
}

function ensureUniqueChatToolName(
  requestedName: string,
  toolContext: ToolConversionContext,
) {
  const baseName = truncateChatToolName(sanitizeChatToolName(requestedName));
  if (!toolContext.specsByChatName.has(baseName)) {
    return baseName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${baseName.slice(0, chatToolNameMaxLength - suffix.length)}${suffix}`;
    if (!toolContext.specsByChatName.has(candidate)) {
      return candidate;
    }
  }

  return truncateChatToolName(
    `${baseName}_${shortHash(`${baseName}:${Date.now()}`)}`,
  );
}

function flattenNamespaceToolName(namespace: string, name: string) {
  return truncateChatToolName(
    sanitizeChatToolName(`${namespace}__${name}`),
    `${namespace}__${name}`,
  );
}

function sanitizeChatToolName(name: string) {
  const sanitized = name.trim().replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized || "tool";
}

function truncateChatToolName(name: string, hashSource = name) {
  if (name.length <= chatToolNameMaxLength) {
    return name;
  }

  const suffix = `__${shortHash(hashSource)}`;
  return `${name.slice(0, chatToolNameMaxLength - suffix.length)}${suffix}`;
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function collapseSystemMessagesToHead(
  messages: Array<Record<string, unknown>>,
) {
  const systemChunks: string[] = [];
  const rest: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "system" && typeof message.content === "string") {
      const trimmed = message.content.trim();
      if (trimmed) {
        systemChunks.push(message.content);
      }
      continue;
    }
    rest.push(message);
  }

  return systemChunks.length > 0
    ? [{ role: "system", content: systemChunks.join("\n\n") }, ...rest]
    : rest;
}

function buildChatCompletionsToResponsesBody(body: ProxyBody): ProxyBody {
  const { messages, max_tokens, max_completion_tokens, ...rest } =
    body as ProxyBody & {
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

  if (Array.isArray(responsesBody.tools)) {
    responsesBody.tools = responsesBody.tools
      .map(convertChatToolToResponsesTool)
      .filter((tool) => tool !== null);
  }

  responsesBody.tool_choice = convertChatToolChoiceToResponsesToolChoice(
    responsesBody.tool_choice,
  );

  return responsesBody;
}

function convertChatToolToResponsesTool(tool: unknown) {
  if (!isPlainObject(tool)) {
    return null;
  }

  if (tool.type !== "function") {
    return tool;
  }

  if (typeof tool.name === "string") {
    return tool;
  }

  const fn = isPlainObject(tool.function) ? tool.function : null;
  if (!fn || typeof fn.name !== "string" || !fn.name) {
    return null;
  }

  return {
    type: "function",
    name: fn.name,
    ...(typeof fn.description === "string"
      ? { description: fn.description }
      : {}),
    ...(fn.parameters !== undefined ? { parameters: fn.parameters } : {}),
    ...(fn.strict !== undefined ? { strict: fn.strict } : {}),
  };
}

function convertChatToolChoiceToResponsesToolChoice(toolChoice: unknown) {
  if (!isPlainObject(toolChoice)) {
    return toolChoice;
  }

  if (toolChoice.type !== "function") {
    return toolChoice;
  }

  const fn = isPlainObject(toolChoice.function) ? toolChoice.function : null;
  const name = typeof fn?.name === "string" ? fn.name : null;
  if (!name) {
    return toolChoice;
  }

  return {
    type: "function",
    name,
  };
}

function buildChatMessages(
  input: unknown,
  instructions: unknown,
  toolContext: ToolConversionContext,
) {
  const messages: Array<Record<string, unknown>> = [];
  let pendingToolCalls: Array<Record<string, unknown>> = [];

  const flushPendingToolCalls = () => {
    if (pendingToolCalls.length === 0) {
      return;
    }

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: pendingToolCalls,
    });
    pendingToolCalls = [];
  };

  if (typeof instructions === "string" && instructions.trim()) {
    messages.push({ role: "system", content: instructions });
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const toolCall = convertResponsesToolCallInputToChatToolCall(
        item,
        toolContext,
      );
      if (toolCall) {
        pendingToolCalls.push(toolCall);
        continue;
      }

      flushPendingToolCalls();

      const message = convertResponsesInputItemToChatMessage(item);
      if (message) {
        messages.push(message);
      }
    }
  }

  flushPendingToolCalls();

  return messages;
}

function convertResponsesInputItemToChatMessage(item: unknown) {
  if (!isPlainObject(item)) {
    return null;
  }

  const toolOutputMessage = convertResponsesToolOutputToChatMessage(item);
  if (toolOutputMessage) {
    return toolOutputMessage;
  }

  if (
    item.type === "input_text" ||
    item.type === "output_text" ||
    item.type === "input_image" ||
    item.type === "input_file" ||
    item.type === "input_audio"
  ) {
    const role = normalizeChatMessageRole(item.role);
    return {
      role,
      content: convertResponsesContentToChatContent([item]),
    };
  }

  const role = normalizeChatMessageRole(item.role);
  const content = convertResponsesContentToChatContent(item.content);
  if (content === undefined) {
    return null;
  }

  if (role === "tool") {
    const toolCallId = readToolCallId(item);
    if (!toolCallId) {
      return null;
    }

    return {
      role,
      tool_call_id: toolCallId,
      content: stringifyChatToolContent(content),
    };
  }

  return { role, content };
}

function normalizeChatMessageRole(role: unknown) {
  if (role === "developer" || role === "latest_reminder") {
    return "system";
  }

  if (
    role === "system" ||
    role === "user" ||
    role === "assistant" ||
    role === "tool"
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

      if (part.type === "input_text" || part.type === "output_text") {
        return {
          type: "text",
          text: typeof part.text === "string" ? part.text : "",
        };
      }

      if (part.type === "text") {
        return {
          type: "text",
          text: typeof part.text === "string" ? part.text : "",
        };
      }

      return {
        type: "text",
        text: describeOmittedResponsesContentPart(part.type),
      };
    })
    .filter((part) => part !== undefined);

  return converted.length > 0 ? converted : undefined;
}

function describeOmittedResponsesContentPart(type: unknown) {
  if (type === "input_image") {
    return "[Image input omitted: this chat-completions upstream accepts text content only.]";
  }

  if (type === "input_file") {
    return "[File input omitted: this chat-completions upstream accepts text content only.]";
  }

  const label = typeof type === "string" && type ? type : "unknown";
  return `[${label} content omitted: this chat-completions upstream accepts text content only.]`;
}

function convertResponsesToolCallInputToChatToolCall(
  item: unknown,
  toolContext: ToolConversionContext,
) {
  if (!isPlainObject(item)) {
    return null;
  }

  if (
    item.type !== "function_call" &&
    item.type !== "custom_tool_call" &&
    item.type !== "tool_search_call"
  ) {
    return null;
  }

  const name =
    item.type === "tool_search_call"
      ? toolSearchProxyName
      : typeof item.name === "string"
        ? item.name
        : null;
  if (!name) {
    return null;
  }

  const id = readToolCallId(item) ?? `call_${Date.now()}`;
  const rawArguments =
    item.type === "custom_tool_call"
      ? stringifyChatToolArguments({
          [customToolInputField]:
            typeof item.input === "string"
              ? item.input
              : stringifyChatToolContent(item.input),
        })
      : stringifyChatToolArguments(item.arguments);
  const chatName =
    item.type === "function_call"
      ? chatNameForResponsesFunction(
          name,
          typeof item.namespace === "string" ? item.namespace : undefined,
          toolContext,
        )
      : item.type === "custom_tool_call"
        ? chatNameForCustomTool(name, toolContext)
        : toolSearchProxyName;

  return {
    id,
    type: "function",
    function: {
      name: chatName,
      arguments: rawArguments,
    },
  };
}

function convertResponsesToolOutputToChatMessage(
  item: Record<string, unknown>,
) {
  const isToolOutput =
    item.type === "function_call_output" ||
    item.type === "custom_tool_call_output" ||
    item.type === "tool_search_output" ||
    item.type === "tool_call_output" ||
    item.type === "tool_result" ||
    item.role === "tool";
  if (!isToolOutput) {
    return null;
  }

  const toolCallId = readToolCallId(item);
  if (!toolCallId) {
    return null;
  }

  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: stringifyChatToolContent(
      item.output ?? item.content ?? item.result ?? "",
    ),
  };
}

function readToolCallId(item: Record<string, unknown>) {
  if (typeof item.call_id === "string" && item.call_id) {
    return item.call_id;
  }

  if (typeof item.tool_call_id === "string" && item.tool_call_id) {
    return item.tool_call_id;
  }

  if (typeof item.id === "string" && item.id) {
    return item.id;
  }

  return null;
}

function stringifyChatToolArguments(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "{}";
  }

  return safeJsonStringify(value ?? {});
}

function stringifyChatToolContent(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    const text = value
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
    if (text) {
      return text;
    }
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return safeJsonStringify(value);
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function buildResponsesInputFromChatMessages(messages: unknown) {
  if (!Array.isArray(messages)) {
    return messages;
  }

  return messages.flatMap((message) =>
    convertChatMessageToResponsesInputItems(message),
  );
}

function convertChatMessageToResponsesInputItems(message: unknown) {
  if (!isPlainObject(message)) {
    return [];
  }

  const role = typeof message.role === "string" ? message.role : "user";
  if (role === "tool" || typeof message.tool_call_id === "string") {
    const toolCallId = readToolCallId(message);
    if (!toolCallId) {
      return [];
    }

    return [
      {
        type: "function_call_output",
        call_id: toolCallId,
        output: stringifyChatToolContent(message.content),
      },
    ];
  }

  const inputItems: Array<Record<string, unknown>> = [];
  const content = convertChatContentToResponsesContent(message.content);
  if (content !== undefined) {
    inputItems.push({ role, content });
  }

  if (Array.isArray(message.tool_calls)) {
    inputItems.push(
      ...convertChatToolCallsToResponsesOutput(message.tool_calls),
    );
  }

  return inputItems;
}

function convertChatContentToResponsesContent(content: unknown) {
  if (content === null || content === undefined) {
    return undefined;
  }

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

function chatCompletionsResponseToResponses(
  responseBody: unknown,
  toolContext?: ToolConversionContext,
) {
  if (!isPlainObject(responseBody)) {
    return responseBody;
  }

  const choice = Array.isArray(responseBody.choices)
    ? responseBody.choices.find(isPlainObject)
    : undefined;
  const message = isPlainObject(choice?.message) ? choice.message : {};
  const content = extractChatMessageText(message.content);
  const toolCalls = convertChatToolCallsToResponsesOutput(
    message.tool_calls,
    toolContext,
  );
  const finishReason =
    typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  const status =
    finishReason === "length" || finishReason === "content_filter"
      ? "incomplete"
      : "completed";
  const id =
    typeof responseBody.id === "string"
      ? responseBody.id
      : `resp_${Date.now()}`;
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
    status,
    ...(status === "incomplete"
      ? {
          incomplete_details: {
            reason:
              finishReason === "content_filter"
                ? "content_filter"
                : "max_output_tokens",
          },
        }
      : {}),
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

export function convertChatToolCallToResponsesOutput(
  toolCall: unknown,
  index: number,
  toolContext?: ToolConversionContext,
) {
  if (!isPlainObject(toolCall)) {
    return null;
  }

  const fn = isPlainObject(toolCall.function) ? toolCall.function : null;
  const chatName = typeof fn?.name === "string" ? fn.name : null;
  if (!chatName) {
    return null;
  }

  const rawArguments = typeof fn?.arguments === "string" ? fn.arguments : "{}";
  const callId =
    typeof toolCall.id === "string"
      ? toolCall.id
      : `call_${Date.now()}_${index}`;
  const spec = toolContext?.specsByChatName.get(chatName);
  const itemId = responseToolCallItemId(callId, spec);

  if (spec?.kind === "tool_search") {
    return {
      type: "tool_search_call",
      call_id: callId,
      status: "completed",
      execution: "client",
      arguments: parseToolArgumentsObject(rawArguments),
    };
  }

  if (spec?.kind === "custom") {
    return {
      id: itemId,
      type: "custom_tool_call",
      call_id: callId,
      name: spec.name,
      status: "completed",
      input: customToolInputFromChatArguments(rawArguments),
    };
  }

  if (spec) {
    return {
      id: itemId,
      type: "function_call",
      call_id: callId,
      name: spec.name,
      status: "completed",
      ...(spec.namespace ? { namespace: spec.namespace } : {}),
      arguments: rawArguments,
    };
  }

  const customInput = extractCustomToolInput(rawArguments);
  return {
    id: callId,
    type: customInput === null ? "function_call" : "custom_tool_call",
    call_id: callId,
    name: chatName,
    status: "completed",
    ...(customInput === null
      ? { arguments: rawArguments }
      : { input: customInput }),
  };
}

function convertChatToolCallsToResponsesOutput(
  toolCalls: unknown,
  toolContext?: ToolConversionContext,
) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map((toolCall, index) =>
      convertChatToolCallToResponsesOutput(toolCall, index, toolContext),
    )
    .filter((item) => item !== null);
}

export function responseToolCallItemId(callId: string, spec?: ChatToolSpec) {
  return spec?.kind === "custom" ? `ctc_${callId}` : `fc_${callId}`;
}

export function customToolInputFromChatArguments(rawArguments: string) {
  if (!rawArguments.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (
      isPlainObject(parsed) &&
      typeof parsed[customToolInputField] === "string"
    ) {
      return parsed[customToolInputField];
    }
  } catch {
    return rawArguments;
  }

  return rawArguments;
}

function parseToolArgumentsObject(rawArguments: string) {
  if (!rawArguments.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (isPlainObject(parsed)) {
      return parsed;
    }
  } catch {
    return { query: rawArguments };
  }

  return { query: rawArguments };
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
  const toolCalls = convertResponsesOutputToChatToolCalls(responseBody.output);
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
          content: toolCalls.length > 0 && !outputText ? null : outputText,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason:
          responseBody.status === "incomplete"
            ? "length"
            : toolCalls.length > 0
              ? "tool_calls"
              : "stop",
      },
    ],
    usage: responsesUsageToChatUsage(responseBody.usage),
  };
}

function convertResponsesOutputToChatToolCalls(output: unknown) {
  if (!Array.isArray(output)) {
    return [];
  }

  return output
    .map((item, index) => {
      if (!isPlainObject(item)) {
        return null;
      }

      if (item.type !== "function_call" && item.type !== "custom_tool_call") {
        return null;
      }

      const name = typeof item.name === "string" ? item.name : null;
      if (!name) {
        return null;
      }

      const id =
        typeof item.call_id === "string"
          ? item.call_id
          : typeof item.id === "string"
            ? item.id
            : `call_${Date.now()}_${index}`;
      const rawArguments =
        item.type === "custom_tool_call"
          ? JSON.stringify({
              input: typeof item.input === "string" ? item.input : "",
            })
          : typeof item.arguments === "string"
            ? item.arguments
            : "{}";

      return {
        id,
        type: "function",
        function: {
          name,
          arguments: rawArguments,
        },
      };
    })
    .filter((item) => item !== null);
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
export const UPSTREAM_IMAGE_RESPONSE_MAX_BYTES = 80 * 1024 * 1024; // 80MB

type SafeBodyResult =
  | { json: unknown; text: string }
  | { error: { message: string; statusCode: number } };

export function getUpstreamResponseMaxBytes(endpoint: string) {
  if (endpoint === "/v1/responses/compact") {
    return UPSTREAM_COMPACT_RESPONSE_MAX_BYTES;
  }
  if (
    endpoint === "/v1/images/generations" ||
    endpoint === "/v1/images/edits"
  ) {
    return UPSTREAM_IMAGE_RESPONSE_MAX_BYTES;
  }

  return UPSTREAM_RESPONSE_MAX_BYTES;
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

  const bodyBytes = Buffer.byteLength(text, "utf8");
  if (bodyBytes > maxBytes) {
    options?.logger?.warn(
      { bodyBytes, maxBytes },
      "Upstream response body exceeds limit after reading, rejecting",
    );
    return {
      error: {
        message: `Upstream response body too large (${(bodyBytes / 1024 / 1024).toFixed(1)}MB)`,
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
