import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@gateway/db";
import { buildUpstreamUrl } from "../apps/api/src/services/upstream.js";
import { resolveStoredUpstreamKey } from "../apps/api/src/services/upstream-key-encryption.js";

type JsonRecord = Record<string, unknown>;

type AttemptClassification =
  | "PASS"
  | "PASS_WITHOUT_REASONING"
  | "PASS_WITH_MALFORMED_REASONING"
  | "FIRST_TURN_FAILED"
  | "SECOND_TURN_FAILED";

type TurnResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  completed: boolean;
  failedEvent: boolean;
  error: string | null;
  eventTypes: string[];
  outputItemTypes: string[];
  reasoningItemCount: number;
  encryptedReasoningItemCount: number;
  outputItems: unknown[];
};

type Attempt = {
  keyName: string;
  classification: AttemptClassification;
  firstTurn: Omit<TurnResult, "outputItems">;
  secondTurn: Omit<TurnResult, "outputItems"> | null;
};

type AuditResult = {
  provider: string;
  providerStatus: string;
  baseUrl: string;
  model: string;
  classification:
    | AttemptClassification
    | "NO_ACTIVE_KEY"
    | "NO_HEALTHY_KEY"
    | "LIVE_NOT_RUN";
  workingKeyName: string | null;
  attemptedKeyCount: number;
  attempts: Attempt[];
  keyHealth: {
    activeKeyCount: number;
    successfulHealthChecks: number;
    failedHealthChecks: number;
    unknownHealthChecks: number;
    latestCheckedAt: string | null;
  };
  productionEvidence: {
    windowDays: number;
    successCount: number;
    failedCount: number;
    pendingCount: number;
    latestSuccessAt: string | null;
    latestFailureAt: string | null;
  };
  operationalAssessment:
    | "PRODUCTION_CONFIRMED"
    | "LIVE_ROUNDTRIP_PASS"
    | "UNVERIFIED_OR_UNAVAILABLE";
};

const timeoutMs = Number(process.env.AUDIT_TIMEOUT_MS ?? 45_000);
const concurrency = Number(process.env.AUDIT_CONCURRENCY ?? 3);
const maxKeysPerProvider = Number(
  process.env.AUDIT_MAX_KEYS_PER_PROVIDER ?? Number.POSITIVE_INFINITY,
);
const maxResponseBytes = 4 * 1024 * 1024;
const skipLive = process.env.AUDIT_SKIP_LIVE === "1";
const requireHealthyKey = process.env.AUDIT_REQUIRE_HEALTHY_KEY === "1";
const productionWindowDays = Number(
  process.env.AUDIT_PRODUCTION_WINDOW_DAYS ?? 30,
);
const auditMarker = `gateway-codex-roundtrip-${Date.now()}`;
const probeToolName = "gateway_codex_roundtrip_probe";

async function main() {
  const providers = await prisma.upstreamProvider.findMany({
    include: {
      keys: {
        where: { status: "ACTIVE" },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });
  const prices = await prisma.modelPrice.findMany({
    where: {
      enabled: true,
      upstreamEndpoint: "responses",
      model: { not: { startsWith: "gpt-image" } },
    },
    select: { upstreamProvider: true, model: true },
    orderBy: [{ upstreamProvider: "asc" }, { model: "asc" }],
  });
  const providerByName = new Map(
    providers.map((provider) => [provider.name, provider]),
  );
  const configuredTargets = readConfiguredTargets();
  const productionEvidence = await loadProductionEvidence();
  const jobs = prices
    .map((price) => ({
      provider: providerByName.get(price.upstreamProvider),
      model: price.model,
    }))
    .filter(
      (
        input,
      ): input is {
        provider: (typeof providers)[number];
        model: string;
      } => Boolean(input.provider),
    )
    .filter(
      (input) =>
        configuredTargets === null ||
        configuredTargets.has(targetKey(input.provider.name, input.model)),
    );
  const results: AuditResult[] = new Array(jobs.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      const job = jobs[index];
      if (!job) {
        return;
      }
      results[index] = await auditProviderModel(
        job.provider,
        job.model,
        productionEvidence.get(targetKey(job.provider.name, job.model)) ??
          emptyProductionEvidence(),
      );
      console.log(
        `[${index + 1}/${jobs.length}] ${results[index].classification} ${job.provider.name} ${job.model}`,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      purpose:
        "Codex-style Responses API session roundtrip; this does not use /v1/responses/compact and does not treat foreign encrypted blobs as provider capability tests.",
      liveProbeEnabled: !skipLive,
      requireHealthyKey,
      firstTurn:
        "Send a small streaming Responses request with store=false, reasoning=null, include=[], and a function tool.",
      secondTurn:
        "Replay the first provider's own output items using the minimal item fields emitted by current Codex clients, add the tool output or a user continuation, and require response.completed.",
      interpretation: {
        PASS: "Two turns completed and every reasoning item carried encrypted_content.",
        PASS_WITHOUT_REASONING:
          "Two turns completed, but the probe did not produce a reasoning item, so encrypted reasoning replay was not exercised.",
        PASS_WITH_MALFORMED_REASONING:
          "Two turns completed, but at least one reasoning item lacked encrypted_content; same-provider use may work, while switching to a stricter upstream is unsafe without gateway sanitization.",
        FIRST_TURN_FAILED: "The initial Codex-style Responses request failed.",
        SECOND_TURN_FAILED:
          "The provider created a response but failed when its own output items were replayed.",
        PRODUCTION_CONFIRMED:
          "At least one real Codex request completed successfully on this exact provider-model pair during the production evidence window; this takes precedence over a transient live probe failure.",
      },
    },
    scope: {
      providerModelPairs: jobs.length,
      timeoutMs,
      concurrency,
      keyPolicy: Number.isFinite(maxKeysPerProvider)
        ? `Try up to ${maxKeysPerProvider} active keys, prioritizing the latest successful health check, until a two-turn pass classification is found.`
        : "Try active keys, prioritizing the latest successful health check, until a two-turn pass classification is found; all active keys are tried when the provider-model pair fails.",
    },
    summary: summarizeResults(results),
    operationalSummary: summarizeOperationalAssessments(results),
    results,
  };
  await mkdir(resolve("tmp"), { recursive: true });
  const outputPath = resolve("tmp/upstream-codex-roundtrip-audit-final.json");
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`REPORT_PATH=${outputPath}`);
  console.log(`SUMMARY=${JSON.stringify(report.summary)}`);
}

async function auditProviderModel(
  provider: Awaited<
    ReturnType<typeof prisma.upstreamProvider.findMany>
  >[number] & {
    keys: Array<{
      name: string;
      key: string;
      encryptedKey: string | null;
      priority: number;
      lastUsedAt: Date | null;
      lastCheckStatus: string | null;
      lastCheckedAt: Date | null;
    }>;
  },
  model: string,
  productionEvidence: AuditResult["productionEvidence"],
): Promise<AuditResult> {
  const result: AuditResult = {
    provider: provider.name,
    providerStatus: provider.status,
    baseUrl: provider.baseUrl,
    model,
    classification: skipLive
      ? "LIVE_NOT_RUN"
      : provider.keys.length === 0
        ? "NO_ACTIVE_KEY"
        : requireHealthyKey &&
            !provider.keys.some((key) => key.lastCheckStatus === "SUCCESS")
          ? "NO_HEALTHY_KEY"
          : "FIRST_TURN_FAILED",
    workingKeyName: null,
    attemptedKeyCount: 0,
    attempts: [],
    keyHealth: summarizeKeyHealth(provider.keys),
    productionEvidence,
    operationalAssessment:
      productionEvidence.successCount > 0
        ? "PRODUCTION_CONFIRMED"
        : "UNVERIFIED_OR_UNAVAILABLE",
  };

  if (
    skipLive ||
    result.classification === "NO_ACTIVE_KEY" ||
    result.classification === "NO_HEALTHY_KEY"
  ) {
    return result;
  }

  const candidateKeys = requireHealthyKey
    ? provider.keys.filter((key) => key.lastCheckStatus === "SUCCESS")
    : provider.keys;
  const keys = sortProviderKeys(candidateKeys).slice(0, maxKeysPerProvider);
  for (const key of keys) {
    result.attemptedKeyCount += 1;
    console.log(
      `[TRY] ${provider.name} ${model} key=${key.name} health=${key.lastCheckStatus ?? "unknown"}`,
    );
    const attempt = await runRoundtrip({
      baseUrl: provider.baseUrl,
      apiKey: resolveStoredUpstreamKey(key),
      keyName: key.name,
      model,
    });
    result.attempts.push(attempt);
    result.classification = chooseBetterClassification(
      result.classification,
      attempt.classification,
    );
    if (isPass(attempt.classification)) {
      result.classification = attempt.classification;
      result.workingKeyName = key.name;
      if (result.operationalAssessment !== "PRODUCTION_CONFIRMED") {
        result.operationalAssessment = "LIVE_ROUNDTRIP_PASS";
      }
      return result;
    }
  }

  return result;
}

function summarizeKeyHealth(
  keys: Array<{ lastCheckStatus: string | null; lastCheckedAt: Date | null }>,
): AuditResult["keyHealth"] {
  let successfulHealthChecks = 0;
  let failedHealthChecks = 0;
  let unknownHealthChecks = 0;
  let latestCheckedAt: string | null = null;
  for (const key of keys) {
    if (key.lastCheckStatus === "SUCCESS") {
      successfulHealthChecks += 1;
    } else if (key.lastCheckStatus === "FAILED") {
      failedHealthChecks += 1;
    } else {
      unknownHealthChecks += 1;
    }
    latestCheckedAt = laterIso(
      latestCheckedAt,
      key.lastCheckedAt?.toISOString() ?? null,
    );
  }
  return {
    activeKeyCount: keys.length,
    successfulHealthChecks,
    failedHealthChecks,
    unknownHealthChecks,
    latestCheckedAt,
  };
}

function sortProviderKeys<
  T extends {
    priority: number;
    lastUsedAt: Date | null;
    lastCheckStatus: string | null;
  },
>(keys: T[]) {
  const healthRank = (value: string | null) =>
    value === "SUCCESS" ? 2 : value === "FAILED" ? 0 : 1;
  return [...keys].sort((left, right) => {
    const healthDifference =
      healthRank(right.lastCheckStatus) - healthRank(left.lastCheckStatus);
    if (healthDifference !== 0) {
      return healthDifference;
    }
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return (
      (right.lastUsedAt?.getTime() ?? 0) - (left.lastUsedAt?.getTime() ?? 0)
    );
  });
}

async function loadProductionEvidence() {
  const since = new Date(
    Date.now() - productionWindowDays * 24 * 60 * 60 * 1000,
  );
  const rows = await prisma.apiRequest.groupBy({
    by: ["upstreamProvider", "model", "status"],
    where: {
      createdAt: { gte: since },
      endpoint: "/v1/responses",
      userAgent: { contains: "Codex", mode: "insensitive" },
    },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const evidence = new Map<string, AuditResult["productionEvidence"]>();
  for (const row of rows) {
    const key = targetKey(row.upstreamProvider, row.model);
    const current = evidence.get(key) ?? emptyProductionEvidence();
    const count = row._count._all;
    const latestAt = row._max.createdAt?.toISOString() ?? null;
    if (row.status === "SUCCESS") {
      current.successCount += count;
      current.latestSuccessAt = laterIso(current.latestSuccessAt, latestAt);
    } else if (row.status === "FAILED") {
      current.failedCount += count;
      current.latestFailureAt = laterIso(current.latestFailureAt, latestAt);
    } else {
      current.pendingCount += count;
    }
    evidence.set(key, current);
  }
  return evidence;
}

function emptyProductionEvidence(): AuditResult["productionEvidence"] {
  return {
    windowDays: productionWindowDays,
    successCount: 0,
    failedCount: 0,
    pendingCount: 0,
    latestSuccessAt: null,
    latestFailureAt: null,
  };
}

function laterIso(left: string | null, right: string | null) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

async function runRoundtrip(input: {
  baseUrl: string;
  apiKey: string;
  keyName: string;
  model: string;
}): Promise<Attempt> {
  const firstTurn = await postResponses({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    body: buildFirstTurnBody(input.model),
  });
  if (!firstTurn.ok) {
    return {
      keyName: input.keyName,
      classification: "FIRST_TURN_FAILED",
      firstTurn: redactTurn(firstTurn),
      secondTurn: null,
    };
  }

  const replayItems = firstTurn.outputItems
    .map(normalizeCodexReplayItem)
    .filter((item): item is JsonRecord => item !== null);
  const continuation = buildContinuation(replayItems);
  const secondTurn = await postResponses({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    body: buildSecondTurnBody(input.model, replayItems, continuation),
  });
  if (!secondTurn.ok) {
    return {
      keyName: input.keyName,
      classification: "SECOND_TURN_FAILED",
      firstTurn: redactTurn(firstTurn),
      secondTurn: redactTurn(secondTurn),
    };
  }

  const reasoningItemCount =
    firstTurn.reasoningItemCount + secondTurn.reasoningItemCount;
  const encryptedReasoningItemCount =
    firstTurn.encryptedReasoningItemCount +
    secondTurn.encryptedReasoningItemCount;
  const classification: AttemptClassification =
    reasoningItemCount === 0
      ? "PASS_WITHOUT_REASONING"
      : encryptedReasoningItemCount < reasoningItemCount
        ? "PASS_WITH_MALFORMED_REASONING"
        : "PASS";

  return {
    keyName: input.keyName,
    classification,
    firstTurn: redactTurn(firstTurn),
    secondTurn: redactTurn(secondTurn),
  };
}

function buildFirstTurnBody(model: string) {
  return {
    model,
    instructions:
      "You are a protocol health check. Call gateway_codex_roundtrip_probe exactly once. Do not answer before calling the tool.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Call ${probeToolName} with marker ${auditMarker}.`,
          },
        ],
      },
    ],
    tools: [buildProbeTool()],
    tool_choice: "auto",
    parallel_tool_calls: false,
    include: [],
    reasoning: null,
    store: false,
    stream: true,
  };
}

function buildSecondTurnBody(
  model: string,
  replayItems: JsonRecord[],
  continuation: JsonRecord,
) {
  return {
    model,
    instructions:
      "You are a protocol health check. After receiving the tool output or continuation, reply with exactly OK.",
    input: [...replayItems, continuation],
    tools: [buildProbeTool()],
    tool_choice: "auto",
    parallel_tool_calls: false,
    include: [],
    reasoning: null,
    store: false,
    stream: true,
  };
}

function buildProbeTool() {
  return {
    type: "function",
    name: probeToolName,
    description: "Return the protocol audit marker.",
    parameters: {
      type: "object",
      properties: {
        marker: { type: "string" },
      },
      required: ["marker"],
      additionalProperties: false,
    },
    strict: true,
  };
}

function buildContinuation(replayItems: JsonRecord[]) {
  const functionCall = replayItems.find(
    (item) =>
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      item.call_id,
  );
  if (functionCall && typeof functionCall.call_id === "string") {
    return {
      type: "function_call_output",
      call_id: functionCall.call_id,
      output: JSON.stringify({ marker: auditMarker, value: "ok" }),
    };
  }

  return {
    role: "user",
    content: [
      {
        type: "input_text",
        text: `Continue the ${auditMarker} protocol check and reply with exactly OK.`,
      },
    ],
  };
}

async function postResponses(input: {
  baseUrl: string;
  apiKey: string;
  body: unknown;
}): Promise<TurnResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      buildUpstreamUrl(input.baseUrl, "/v1/responses"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
        },
        body: JSON.stringify(input.body),
        signal: controller.signal,
      },
    );
    const contentType = response.headers.get("content-type") ?? "";
    const text = await readUntilTerminal(response, controller.signal);
    const parsed = parseResponsesPayload(text, contentType);
    const httpOk = response.ok;
    const ok = httpOk && parsed.completed && !parsed.failedEvent;
    return {
      ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      completed: parsed.completed,
      failedEvent: parsed.failedEvent,
      error: ok ? null : (parsed.error ?? extractError(text)),
      eventTypes: parsed.eventTypes,
      outputItemTypes: parsed.outputItems.map((item) =>
        isRecord(item) ? String(item.type ?? "unknown") : typeof item,
      ),
      reasoningItemCount: parsed.outputItems.filter(
        (item) => isRecord(item) && item.type === "reasoning",
      ).length,
      encryptedReasoningItemCount: parsed.outputItems.filter(
        (item) =>
          isRecord(item) &&
          item.type === "reasoning" &&
          typeof item.encrypted_content === "string" &&
          item.encrypted_content.length > 0,
      ).length,
      outputItems: parsed.outputItems,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Math.round(performance.now() - startedAt),
      completed: false,
      failedEvent: false,
      error: sanitizeText(
        error instanceof Error ? error.message : String(error),
      ),
      eventTypes: [],
      outputItemTypes: [],
      reasoningItemCount: 0,
      encryptedReasoningItemCount: 0,
      outputItems: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readUntilTerminal(response: Response, signal: AbortSignal) {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (
      !signal.aborted &&
      Buffer.byteLength(text, "utf8") < maxResponseBytes
    ) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      text += decoder.decode(next.value, { stream: true });
      if (
        text.includes("response.completed") ||
        text.includes("response.failed") ||
        text.includes('"status":"completed"') ||
        text.includes('"status":"failed"') ||
        text.includes("[DONE]")
      ) {
        break;
      }
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

function parseResponsesPayload(text: string, contentType: string) {
  const payloads =
    contentType.includes("text/event-stream") || text.includes("data:")
      ? parseSsePayloads(text)
      : [parseJson(text)].filter((value) => value !== null);
  const eventTypes: string[] = [];
  const outputItems: unknown[] = [];
  let completed = false;
  let failedEvent = false;
  let error: string | null = null;

  for (const payload of payloads) {
    if (!isRecord(payload)) {
      continue;
    }
    const type = typeof payload.type === "string" ? payload.type : "";
    if (type) {
      eventTypes.push(type);
    }
    if (type === "response.completed") {
      completed = true;
    }
    if (type === "response.failed" || type === "error") {
      failedEvent = true;
      error = extractError(JSON.stringify(payload));
    }
    if (type === "response.output_item.done" && payload.item !== undefined) {
      outputItems.push(payload.item);
    }
    const response = isRecord(payload.response) ? payload.response : payload;
    if (response.status === "completed") {
      completed = true;
    }
    if (response.status === "failed") {
      failedEvent = true;
      error = extractError(JSON.stringify(response));
    }
    if (Array.isArray(response.output)) {
      outputItems.push(...response.output);
    }
  }

  return {
    completed,
    failedEvent,
    error,
    eventTypes: [...new Set(eventTypes)],
    outputItems: deduplicateOutputItems(outputItems),
  };
}

function parseSsePayloads(text: string) {
  const payloads: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") {
      continue;
    }
    const parsed = parseJson(data);
    if (parsed !== null) {
      payloads.push(parsed);
    }
  }
  return payloads;
}

function deduplicateOutputItems(items: unknown[]) {
  const output: unknown[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

function normalizeCodexReplayItem(value: unknown): JsonRecord | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "reasoning") {
    return {
      type: "reasoning",
      summary: Array.isArray(value.summary) ? value.summary : [],
      ...(typeof value.encrypted_content === "string"
        ? { encrypted_content: value.encrypted_content }
        : {}),
      ...(Array.isArray(value.content) ? { content: value.content } : {}),
    };
  }
  if (value.type === "function_call") {
    if (typeof value.name !== "string" || typeof value.call_id !== "string") {
      return null;
    }
    return {
      type: "function_call",
      name: value.name,
      call_id: value.call_id,
      arguments:
        typeof value.arguments === "string"
          ? value.arguments
          : JSON.stringify(value.arguments ?? {}),
    };
  }
  if (value.type === "custom_tool_call") {
    if (typeof value.name !== "string" || typeof value.call_id !== "string") {
      return null;
    }
    return {
      type: "custom_tool_call",
      name: value.name,
      call_id: value.call_id,
      input: typeof value.input === "string" ? value.input : "",
    };
  }
  if (value.type === "message") {
    return {
      type: "message",
      role: "assistant",
      content: Array.isArray(value.content) ? value.content : [],
      ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
    };
  }
  return null;
}

function redactTurn(turn: TurnResult): Omit<TurnResult, "outputItems"> {
  const { outputItems: _outputItems, ...safe } = turn;
  return safe;
}

function readConfiguredTargets() {
  const value = process.env.AUDIT_TARGETS_JSON;
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(value) as Array<{
    provider: string;
    model: string;
  }>;
  return new Set(parsed.map((item) => targetKey(item.provider, item.model)));
}

function targetKey(provider: string, model: string) {
  return `${provider}\u0000${model}`;
}

function summarizeResults(results: AuditResult[]) {
  const summary: Record<string, number> = {};
  for (const result of results) {
    summary[result.classification] = (summary[result.classification] ?? 0) + 1;
  }
  return summary;
}

function summarizeOperationalAssessments(results: AuditResult[]) {
  const summary: Record<string, number> = {};
  for (const result of results) {
    summary[result.operationalAssessment] =
      (summary[result.operationalAssessment] ?? 0) + 1;
  }
  return summary;
}

function isPass(classification: AttemptClassification) {
  return (
    classification === "PASS" ||
    classification === "PASS_WITHOUT_REASONING" ||
    classification === "PASS_WITH_MALFORMED_REASONING"
  );
}

function chooseBetterClassification(
  current: AuditResult["classification"],
  next: AttemptClassification,
): AuditResult["classification"] {
  const rank: Record<AuditResult["classification"], number> = {
    PASS: 6,
    PASS_WITHOUT_REASONING: 5,
    PASS_WITH_MALFORMED_REASONING: 4,
    SECOND_TURN_FAILED: 3,
    FIRST_TURN_FAILED: 2,
    NO_ACTIVE_KEY: 1,
    NO_HEALTHY_KEY: 1,
    LIVE_NOT_RUN: 0,
  };
  return rank[next] > rank[current] ? next : current;
}

function extractError(text: string) {
  const parsed = parseJson(text);
  if (parsed !== null) {
    const values: string[] = [];
    visit(parsed, (record) => {
      if (typeof record.message === "string") {
        values.push(record.message);
      }
      if (typeof record.code === "string") {
        values.push(record.code);
      }
    });
    if (values.length > 0) {
      return sanitizeText([...new Set(values)].join(" | "));
    }
  }
  return sanitizeText(text);
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function visit(value: unknown, callback: (record: JsonRecord) => void) {
  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, callback);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  callback(value);
  for (const item of Object.values(value)) {
    visit(item, callback);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function sanitizeText(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/[A-Za-z0-9+/=_-]{200,}/g, "[opaque-content-redacted]")
    .slice(0, 1200);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
