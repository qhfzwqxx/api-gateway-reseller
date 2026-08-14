import type { PolicyRecoverySnapshot } from "./policy-recovery-settings.js";
import {
  getForwardableUpstreamResponseHeaders,
  type ProxyBody,
} from "./proxy-request-utils.js";

export type PolicyBlockSignal = {
  source: "status" | "header" | "json" | "sse";
  code: string;
  summary: string;
};

export type PolicyRecoveryAttemptAudit = {
  channelId: string | null;
  provider: string;
  upstreamProviderKeyId: string | null;
  recoveryAttempt: number;
  signal: PolicyBlockSignal | null;
  httpStatus: number | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type PolicyRecoveryAudit = {
  enabled: boolean;
  profileId: PolicyRecoverySnapshot["activeProfile"];
  profileName: string;
  templateVersion: number;
  mergedSha256: string;
  recovered: boolean;
  finalOutcome: "not_triggered" | "recovered" | "exhausted" | "aborted";
  totalRecoveries: number;
  attempts: PolicyRecoveryAttemptAudit[];
};

export type PolicyRecoveryContext = {
  settings: PolicyRecoverySnapshot;
  originalBody: ProxyBody;
  audit: PolicyRecoveryAudit;
  accumulatedInputTokens: number;
  accumulatedCachedInputTokens: number;
  accumulatedOutputTokens: number;
};

const supportedEndpoints = new Set([
  "/v1/responses",
  "/v1/chat/completions",
]);

const policyRetryBeginMarker = "[GPT56_POLICY_RETRY_V2]";
const policyRetryEndMarker = "[/GPT56_POLICY_RETRY_V2]";

export const policyRecoveryExhaustedStatusCode = 502;

const strongPolicyTexts = [
  "invalid prompt: we've limited access to this content for safety reasons",
  "无法显示此内容",
  "申请可信访问权限",
  "网络安全相关请求",
  "内容已被安全策略拦截",
  "请求已被安全策略拦截",
  "request was rejected by our safety system",
  "request was blocked by our safety system",
  "request was blocked by the safety system",
  "request was blocked by a safety system",
  "apply for trusted access",
  "request trusted access",
  "cyber safety policy",
  "cybersecurity safety policy",
];

const policyCodes = new Set([
  "cyberpolicy",
  "cybersafetyblocked",
  "policyblocked",
  "requestblocked",
  "safetyblocked",
  "moderationblocked",
  "contentpolicyblocked",
  "policyviolation",
  "contentpolicyviolation",
  "safetyviolation",
]);

const policyWords = [
  "content policy",
  "safety policy",
  "policy violation",
  "policy blocked",
  "moderation blocked",
  "策略拦截",
  "违反安全策略",
  "内容安全策略",
];

const blockWords = ["block", "violation", "reject", "denied"];

const cyberVerificationKeys = new Set([
  "verification",
  "verifications",
  "verificationrecommendation",
  "openaiverificationrecommendation",
]);

const cyberVerificationValues = new Set(["trustedaccessforcyber"]);

export function supportsPolicyRecovery(endpoint: string, method: string, multipart: boolean) {
  return method === "POST" && !multipart && supportedEndpoints.has(endpoint);
}

export function createPolicyRecoveryContext(
  body: ProxyBody,
  settings: PolicyRecoverySnapshot,
): PolicyRecoveryContext {
  return {
    settings,
    originalBody: cloneBody(body),
    accumulatedInputTokens: 0,
    accumulatedCachedInputTokens: 0,
    accumulatedOutputTokens: 0,
    audit: {
      enabled: true,
      profileId: settings.activeProfile,
      profileName: settings.activeProfileName,
      templateVersion: settings.version,
      mergedSha256: settings.mergedSha256,
      recovered: false,
      finalOutcome: "not_triggered",
      totalRecoveries: 0,
      attempts: [],
    },
  };
}

export function buildPolicyRecoveryBody(params: {
  context: PolicyRecoveryContext;
  baseBody?: ProxyBody;
  endpoint: string;
  recoveryAttempt: number;
  signal?: PolicyBlockSignal | null;
  provider: string;
  model: string;
  chatInstructionRole?: "developer" | "system";
}) {
  const body = injectPolicyInstructions(
    cloneBody(params.baseBody ?? params.context.originalBody),
    params.endpoint,
    params.context.settings.baseInstructions,
    params.chatInstructionRole ?? "developer",
  );
  if (params.recoveryAttempt <= 0) return body;
  const recoveryInstructions = params.recoveryAttempt > 0
    ? renderRetryInstructions(params.context.settings.retryInstructionsTemplate, {
        attempt: params.recoveryAttempt,
        maxAttempts: params.context.settings.maxRecoveries,
        signal: params.signal?.summary ?? params.signal?.code ?? "structured policy block",
        provider: params.provider,
        model: params.model,
      })
    : "";
  return injectPolicyRetryInstructions(
    body,
    params.endpoint,
    recoveryInstructions,
    params.chatInstructionRole ?? "developer",
  );
}

export function injectPolicyInstructions(
  body: ProxyBody,
  endpoint: string,
  instructions: string,
  chatInstructionRole: "developer" | "system" = "developer",
) {
  if (chatInstructionRole !== "developer" && chatInstructionRole !== "system") {
    throw new Error("Chat policy recovery role must be developer or system");
  }
  if (endpoint === "/v1/responses" || endpoint === "/v1/responses/compact") {
    const existing = body.instructions;
    if (existing === undefined) body.instructions = instructions;
    else if (typeof existing === "string") body.instructions = existing
      ? `${instructions}\n\n[调用方原始 instructions]\n${existing}`
      : instructions;
    else if (Array.isArray(existing)) body.instructions = [instructions, ...existing];
    else throw new Error("Responses instructions must be a string or array");
    return body;
  }
  if (endpoint !== "/v1/chat/completions") {
    throw new Error(`Unsupported policy recovery endpoint: ${endpoint}`);
  }
  if (!Array.isArray(body.messages)) {
    throw new Error("Chat Completions messages must be an array");
  }
  body.messages = [{ role: chatInstructionRole, content: instructions }, ...body.messages];
  return body;
}

export function injectPolicyRetryInstructions(
  body: ProxyBody,
  endpoint: string,
  retryInstructions: string,
  chatInstructionRole: "developer" | "system" = "developer",
) {
  if (chatInstructionRole !== "developer" && chatInstructionRole !== "system") {
    throw new Error("Chat policy recovery role must be developer or system");
  }
  if (endpoint === "/v1/responses" || endpoint === "/v1/responses/compact") {
    const existing = body.instructions;
    if (existing === undefined) body.instructions = retryInstructions;
    else if (typeof existing === "string") {
      body.instructions = replacePolicyRetryInstructions(existing, retryInstructions)
        ?? `${retryInstructions}\n\n[重试前 instructions 原文]\n${existing}`;
    } else if (Array.isArray(existing)) {
      const updated = [...existing];
      const replacement = typeof updated[0] === "string"
        ? replacePolicyRetryInstructions(updated[0], retryInstructions)
        : null;
      if (replacement !== null) updated[0] = replacement;
      else updated.unshift(retryInstructions);
      body.instructions = updated;
    } else {
      throw new Error("Responses instructions must be a string or array");
    }
    return body;
  }
  if (endpoint !== "/v1/chat/completions") {
    throw new Error(`Unsupported policy recovery endpoint: ${endpoint}`);
  }
  if (!Array.isArray(body.messages)) {
    throw new Error("Chat Completions messages must be an array");
  }
  const first = body.messages[0];
  if (
    first &&
    typeof first === "object" &&
    (first.role === "developer" || first.role === "system") &&
    typeof first.content === "string"
  ) {
    const replacement = replacePolicyRetryInstructions(first.content, retryInstructions);
    if (replacement !== null) {
      body.messages[0] = { ...first, content: replacement };
      return body;
    }
  }
  body.messages = [{ role: chatInstructionRole, content: retryInstructions }, ...body.messages];
  return body;
}

export function formatPolicyRecoveryExhaustedMessage(signal: PolicyBlockSignal) {
  return `授权范围内已达到透明恢复上限，上游仍返回策略拦截：${signal.summary}`;
}

export function detectPolicyBlock(params: {
  statusCode: number;
  headers: Headers | Record<string, string | string[] | undefined>;
  body: unknown;
  source: "json" | "sse";
}): PolicyBlockSignal | null {
  const headerSignal = detectHeaderSignal(params.headers, params.statusCode);
  if (headerSignal) return headerSignal;
  return params.source === "sse"
    ? detectSseSignal(params.body, params.statusCode)
    : detectStructuredSignal(params.body, "json", params.statusCode);
}

export function sanitizePolicyResponseHeaders(headers: Headers) {
  const sanitized = new Headers(headers);
  const entries: Array<[string, string]> = [];
  sanitized.forEach((value, name) => entries.push([name, value]));
  for (const [name, value] of entries) {
    if (cyberResponseHeaderKind(name, value)) sanitized.delete(name);
  }
  return sanitized;
}

function sanitizeReconstructedResponseHeaders(headers: Headers) {
  return new Headers(
    getForwardableUpstreamResponseHeaders(
      sanitizePolicyResponseHeaders(headers),
    ),
  );
}

export function sanitizePolicyResponseBody(value: unknown): unknown {
  return removeCyberVerification(value)[0];
}

export function createPolicySseSanitizer() {
  let pending = "";
  return {
    push(text: string) {
      pending += text;
      let output = "";
      for (;;) {
        const match = /\r?\n\r?\n/u.exec(pending);
        if (!match) break;
        const end = match.index + match[0].length;
        output += sanitizePolicySseText(pending.slice(0, end));
        pending = pending.slice(end);
      }
      return output;
    },
    flush() {
      const output = sanitizePolicySseText(pending);
      pending = "";
      return output;
    },
  };
}

export function sanitizePolicySseText(text: string) {
  return text.replace(/([^]*?)(\r?\n\r?\n|$)/gu, (match, frame: string, separator: string) => {
    if (!frame) return match;
    const newline = frame.includes("\r\n") ? "\r\n" : "\n";
    const lines = frame.split(/\r?\n/u);
    const dataIndexes: number[] = [];
    const dataLines: string[] = [];
    lines.forEach((line, index) => {
      if (line.startsWith("data:")) {
        dataIndexes.push(index);
        dataLines.push(line.slice(5).trimStart());
      }
    });
    const raw = dataLines.join("\n");
    if (!raw || raw === "[DONE]") return match;
    try {
      const sanitized = sanitizePolicyResponseBody(JSON.parse(raw));
      if (JSON.stringify(sanitized) === JSON.stringify(JSON.parse(raw))) return match;
      const firstIndex = dataIndexes[0] ?? lines.length;
      const filtered = lines.filter((_line, index) => !dataIndexes.includes(index));
      filtered.splice(firstIndex, 0, `data: ${JSON.stringify(sanitized)}`);
      return `${filtered.join(newline)}${separator}`;
    } catch {
      return match;
    }
  });
}

export async function probePolicyRecoveryStream(
  response: Response,
  maxBytes: number,
): Promise<{ response: Response; signal: PolicyBlockSignal | null; text: string }> {
  if (!response.body) return { response, signal: null, text: "" };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let text = "";
  let ended = false;
  const decoder = new TextDecoder();
  let signal: PolicyBlockSignal | null = detectHeaderSignal(response.headers, response.status);
  while (!signal && total < maxBytes) {
    const result = await reader.read();
    if (result.done) {
      ended = true;
      break;
    }
    chunks.push(result.value);
    total += result.value.byteLength;
    text += decoder.decode(result.value, { stream: true });
    signal = detectPolicyBlock({
      statusCode: response.status,
      headers: response.headers,
      body: text,
      source: "sse",
    });
    if (signal || hasSubstantiveSseOutput(text)) break;
  }
  text += decoder.decode();
  if (!signal && ended && !hasCompletedSseOutput(text)) {
    signal = {
      source: "sse",
      code: "sse_validation_indeterminate",
      summary: "SSE validation: indeterminate",
    };
  }
  if (signal) {
    await reader.cancel().catch(() => undefined);
    return { response, signal, text };
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      const pump = (): void => {
        void reader.read().then((result) => {
          if (result.done) controller.close();
          else { controller.enqueue(result.value); pump(); }
        }).catch((error) => controller.error(error));
      };
      pump();
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return {
    response: new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: sanitizeReconstructedResponseHeaders(response.headers),
    }),
    signal: null,
    text,
  };
}

export function renderRetryInstructions(template: string, values: {
  attempt: number;
  maxAttempts: number;
  signal: string;
  provider: string;
  model: string;
}) {
  return template.replace(/\{\{(attempt|maxAttempts|signal|provider|model)\}\}/g, (_, key: keyof typeof values) => String(values[key]));
}

function detectHeaderSignal(headers: Headers | Record<string, string | string[] | undefined>, statusCode: number) {
  const entries: Array<[string, string | string[] | undefined]> = [];
  if (headers instanceof Headers) headers.forEach((value, name) => entries.push([name, value]));
  else entries.push(...Object.entries(headers));
  for (const [name, rawValue] of entries) {
    const kind = cyberResponseHeaderKind(name, rawValue);
    if (kind === "block") {
      return { source: "header" as const, code: "cyber_policy", summary: `upstream header ${name}` };
    }
    if (kind === "recommendation" && statusCode >= 400) {
      return { source: "header" as const, code: "trusted_access_for_cyber", summary: `upstream header ${name}` };
    }
  }
  return null;
}

function detectStructuredSignal(
  value: unknown,
  source: "json" | "sse",
  statusCode: number,
): PolicyBlockSignal | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const signal = detectStructuredSignal(child, source, statusCode);
      if (signal) return signal;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const keyCode = canonical(key);
    const valueCode = typeof child === "string" ? canonical(child) : "";
    if (keyCode === "codexerrorinfo" && valueCode === "cyberpolicy") {
      return { source, code: "cyber_policy", summary: `${key}: ${String(child)}` };
    }
    if (keyCode === "moderationresponse" && isCyberModeration(child)) {
      return { source, code: "cyber_moderation_block", summary: "moderation_response blocked cyber request" };
    }
    const nested = detectStructuredSignal(child, source, statusCode);
    if (nested) return nested;
  }
  const strings = collectStrings(value);
  for (const item of strings) {
    const last = canonical(item.path.at(-1));
    if (["code", "reason", "type"].includes(last)) continue;
    const normalized = item.value.trim().toLowerCase();
    const identifier = canonical(item.value);
    if (policyCodes.has(identifier) || policyCodes.has(normalized)) {
      return { source, code: "structured_policy_block", summary: `policy code: ${item.value}` };
    }
    if (
      policyWords.some((word) => identifier.includes(canonical(word))) &&
      blockWords.some((word) => identifier.includes(canonical(word)))
    ) {
      return { source, code: "structured_policy_block", summary: `policy code: ${item.value}` };
    }
  }
  const joined = strings.map((item) => item.value).join("\n").toLowerCase();
  const strongText = strongPolicyTexts.find((text) => joined.includes(text));
  const structuredPath = strings.some((item) => item.path.some((part) =>
    ["blocked", "refusal", "moderation", "error", "incompletedetails", "statusdetails", "denied"].includes(canonical(part)),
  ));
  const failedEvent = strings.some((item) => {
    const last = canonical(item.path.at(-1));
    return ["type", "event", "status"].includes(last) && /response\.(failed|incomplete)|message_stop|error/iu.test(item.value);
  });
  if (strongText && (structuredPath || statusCode >= 400 || failedEvent)) {
    return { source, code: "policy_text_block", summary: `policy text: ${strongText}` };
  }
  if (strongText && ["申请可信访问权限", "无法显示此内容"].includes(strongText)) {
    return { source, code: "policy_text_block", summary: `policy text: ${strongText}` };
  }
  const policyWord = policyWords.find((word) => joined.includes(word.toLowerCase()));
  if (
    policyWord &&
    (joined.includes("cyber") || joined.includes("网络安全")) &&
    (structuredPath || statusCode >= 400 || failedEvent)
  ) {
    return { source, code: "policy_text_block", summary: `policy text: ${policyWord}` };
  }
  return null;
}

function detectSseSignal(value: unknown, statusCode: number): PolicyBlockSignal | null {
  for (const frame of normalizeSseFrames(value)) {
    const nested = detectStructuredSignal(
      { event: frame.event, data: frame.data },
      "sse",
      statusCode,
    );
    if (nested) {
      return {
        ...nested,
        source: "sse",
        summary: `SSE ${nested.summary}`,
      };
    }
    const joined = `${frame.event}\n${frame.dataText}`.toLowerCase();
    const failedEvent = /(^|\.)(failed|incomplete|error)$|message_stop|content_block/iu.test(frame.event);
    const strongText = strongPolicyTexts.find((text) => joined.includes(text));
    if ((failedEvent || statusCode >= 400) && strongText) {
      return {
        source: "sse",
        code: "sse_policy_text",
        summary: `SSE policy text: ${strongText}`,
      };
    }
    if (
      (failedEvent || statusCode >= 400) &&
      /cyber|trusted\s*access|网络安全/iu.test(joined) &&
      /policy|safety|blocked|refusal|moderation|策略|拦截/iu.test(joined)
    ) {
      return {
        source: "sse",
        code: "sse_cyber_policy_context",
        summary: "SSE cyber policy context",
      };
    }
  }
  return null;
}

function cyberResponseHeaderKind(name: string, rawValue: string | string[] | undefined) {
  const nameCode = canonical(name);
  const value = Array.isArray(rawValue) ? rawValue.join(" ") : String(rawValue ?? "");
  const valueCode = canonical(value);
  if (
    nameCode.includes("codexerrorinfo") &&
    ["trustedaccessforcyber", "cyberpolicy"].some((token) => valueCode.includes(token))
  ) return "block" as const;
  if (
    nameCode.includes("verificationrecommendation") &&
    ["trustedaccessforcyber", "cyberpolicy"].some((token) => valueCode.includes(token))
  ) return "recommendation" as const;
  return null;
}

function isCyberModeration(value: unknown) {
  if (!isRecord(value) || value.blocked !== true) return false;
  const metadata = isRecord(value.metadata)
    ? value.metadata
    : isRecord(value.Metadata)
      ? value.Metadata
      : {};
  const protection = canonical(metadata.protection_type ?? metadata.protectionType);
  return protection === "cyber" && (metadata.safety_limited === true || metadata.safetyLimited === true);
}

function removeCyberVerification(value: unknown): [unknown, boolean] {
  if (Array.isArray(value)) {
    let changed = false;
    const items: unknown[] = [];
    for (const child of value) {
      if (typeof child === "string" && cyberVerificationValues.has(canonical(child))) {
        changed = true;
        continue;
      }
      const [filtered, childChanged] = removeCyberVerification(child);
      items.push(filtered);
      changed ||= childChanged;
    }
    return [changed ? items : value, changed];
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && cyberVerificationValues.has(canonical(value))) {
      return [null, true];
    }
    return [value, false];
  }
  let changed = false;
  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const keyCode = canonical(key);
    if (typeof child === "string" && cyberVerificationValues.has(canonical(child))) {
      changed = true;
      continue;
    }
    if (cyberVerificationKeys.has(keyCode)) {
      const [filtered, removed] = removeCyberVerification(child);
      if (removed) changed = true;
      if (!removed) cleaned[key] = child;
      else if (keyCode === "verifications" || !isEmptySanitizedValue(filtered)) cleaned[key] = filtered;
      continue;
    }
    const [filtered, childChanged] = removeCyberVerification(child);
    cleaned[key] = filtered;
    changed ||= childChanged;
  }
  return [changed ? cleaned : value, changed];
}

function parseSseFrames(text: string) {
  const values: Array<{ event: string; data: unknown; dataText: string }> = [];
  for (const frame of text.split(/\r?\n\r?\n/u)) {
    if (!frame.trim()) continue;
    let event = "";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/u)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    const dataText = dataLines.join("\n");
    if (!dataText || dataText === "[DONE]") continue;
    let data: unknown = dataText;
    try { data = JSON.parse(dataText); } catch { /* preserve raw SSE data */ }
    values.push({ event, data, dataText });
  }
  return values;
}

function normalizeSseFrames(value: unknown) {
  if (typeof value === "string") return parseSseFrames(value);
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (isRecord(item) && Object.prototype.hasOwnProperty.call(item, "data")) {
      const data = item.data;
      return {
        event: typeof item.event === "string" ? item.event : "",
        data,
        dataText: serializeSseData(data),
      };
    }
    return { event: "", data: item, dataText: serializeSseData(item) };
  });
}

function serializeSseData(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function hasSubstantiveSseOutput(text: string) {
  return /response\.(?:output_text|reasoning_text|reasoning_summary_text|function_call_arguments)\.delta|response\.output_item\.added|response\.(?:file_search_call|web_search_call)/iu.test(text);
}

function hasCompletedSseOutput(text: string) {
  return /(?:^|\n)event:\s*(?:response\.completed|message_stop)\s*(?:\n|$)/iu.test(text)
    || /(?:^|\n)data:\s*\[DONE\]\s*(?:\n|$)/iu.test(text);
}

function replacePolicyRetryInstructions(value: string, replacement: string) {
  if (!value.startsWith(policyRetryBeginMarker)) return null;
  const end = value.indexOf(policyRetryEndMarker, policyRetryBeginMarker.length);
  if (end < 0) return null;
  const candidate = value.slice(0, end + policyRetryEndMarker.length);
  if (
    !candidate.includes("前一次上游响应属于结构化策略拦截") ||
    !candidate.includes("显式授权词：") ||
    !candidate.includes("授权范围：")
  ) {
    return null;
  }
  return `${replacement}${value.slice(end + policyRetryEndMarker.length)}`;
}

function cloneBody(body: ProxyBody): ProxyBody {
  return JSON.parse(JSON.stringify(body)) as ProxyBody;
}

function canonical(value: unknown) {
  return String(value ?? "").replace(/[\s_-]/g, "").toLowerCase();
}

function collectStrings(value: unknown, path: string[] = [], result: Array<{ path: string[]; value: string }> = []) {
  if (typeof value === "string") result.push({ path, value });
  else if (Array.isArray(value)) value.forEach((child, index) => collectStrings(child, [...path, String(index)], result));
  else if (isRecord(value)) Object.entries(value).forEach(([key, child]) => collectStrings(child, [...path, key], result));
  return result;
}

function isEmptySanitizedValue(value: unknown) {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
