import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@gateway/db";
import { applyReasoningEffortTransform } from "../apps/api/src/services/reasoning-effort-transform-settings.js";
import {
  buildUpstreamBody,
  type ProxyBody,
} from "../apps/api/src/services/proxy-request-utils.js";
import { buildUpstreamUrl } from "../apps/api/src/services/upstream.js";
import { resolveStoredUpstreamKey } from "../apps/api/src/services/upstream-key-encryption.js";

type JsonRecord = Record<string, unknown>;
type CompactItemType = "compaction" | "compaction_summary";

type AttemptClassification =
  | "PASS"
  | "PASS_ALTERNATE_TYPE"
  | "TRIGGER_REJECTED"
  | "TRIGGER_NO_COMPACT_ITEM"
  | "TRIGGER_FAILED"
  | "REPLAY_FAILED"
  | "RESPONSES_FAILED"
  | "TRANSIENT_FAILURE";

type AuditClassification =
  | AttemptClassification
  | "NO_ACTIVE_KEY"
  | "PROVIDER_DISABLED"
  | "LIVE_NOT_RUN";

type CompactItemSummary = {
  type: string;
  encryptedContentLength: number;
  hasId: boolean;
};

type TurnResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  completed: boolean;
  failedEvent: boolean;
  error: string | null;
  eventTypes: string[];
  outputItemTypes: string[];
  compactItems: Array<{ encryptedContent: string; item: JsonRecord }>;
  outputItems: unknown[];
};

type SafeTurnResult = Omit<TurnResult, "compactItems" | "outputItems"> & {
  compactItems: CompactItemSummary[];
};

type ReplayAttempt = {
  itemType: CompactItemType;
  result: SafeTurnResult;
};

type Attempt = {
  keyName: string;
  classification: AttemptClassification;
  emittedCompactTypes: string[];
  workingReplayType: CompactItemType | null;
  trigger: SafeTurnResult;
  replayAttempts: ReplayAttempt[];
  basicCheck: SafeTurnResult | null;
};

type ProductionEvidence = {
  windowDays: number;
  triggerSuccessCount: number;
  triggerFailedCount: number;
  triggerPendingCount: number;
  replaySuccessCount: number;
  replayFailedCount: number;
  replayPendingCount: number;
  observedReplayTypes: string[];
  latestTriggerSuccessAt: string | null;
  latestTriggerFailureAt: string | null;
  latestReplaySuccessAt: string | null;
  latestReplayFailureAt: string | null;
};

type OperationalAssessment =
  | "LIVE_AND_PRODUCTION_CONFIRMED"
  | "LIVE_ROUNDTRIP_PASS"
  | "PRODUCTION_CONFIRMED"
  | "PARTIAL_PRODUCTION_EVIDENCE"
  | "UNVERIFIED_OR_UNAVAILABLE";

type AuditResult = {
  provider: string;
  providerStatus: string;
  baseUrl: string;
  model: string;
  configuredCompactItemType: CompactItemType;
  classification: AuditClassification;
  workingKeyName: string | null;
  workingReplayType: CompactItemType | null;
  attemptedKeyCount: number;
  attempts: Attempt[];
  keyHealth: {
    activeKeyCount: number;
    successfulHealthChecks: number;
    failedHealthChecks: number;
    unknownHealthChecks: number;
    latestCheckedAt: string | null;
  };
  productionEvidence: ProductionEvidence;
  operationalAssessment: OperationalAssessment;
};

type ProductionCountRow = {
  provider: string;
  model: string;
  status: string;
  count: bigint;
  latest: Date | null;
};

type ProductionReplayRow = ProductionCountRow & {
  itemType: string;
};

const timeoutMs = Number(process.env.AUDIT_TIMEOUT_MS ?? 45_000);
const concurrency = Math.max(1, Number(process.env.AUDIT_CONCURRENCY ?? 3));
const maxKeysPerProvider = Math.max(
  1,
  Number(process.env.AUDIT_MAX_KEYS_PER_PROVIDER ?? 2),
);
const productionWindowDays = Math.max(
  1,
  Number(process.env.AUDIT_PRODUCTION_WINDOW_DAYS ?? 30),
);
const skipLive = process.env.AUDIT_SKIP_LIVE === "1";
const includeDisabled = process.env.AUDIT_INCLUDE_DISABLED === "1";
const maxResponseBytes = 4 * 1024 * 1024;
const auditMarker = `gateway-codex-compaction-v2-${Date.now()}`;
const auditUserAgent =
  process.env.AUDIT_USER_AGENT ??
  "Codex Desktop/0.141.0 (Ubuntu 22.4.0; x86_64) unknown (Codex Desktop; 26.715.31925)";

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
    )
    .filter((input) => includeDisabled || input.provider.status === "ACTIVE");

  const results: AuditResult[] = new Array(jobs.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      const job = jobs[index];
      if (!job) return;
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
        "Current Codex remote compaction v2 capability audit using /v1/responses with a terminal compaction_trigger, followed immediately by same-key replay of the fresh encrypted compaction item.",
      liveProbeEnabled: !skipLive,
      trigger:
        "Send a streaming Responses request whose final input item is {type: 'compaction_trigger'} and require a completed response containing compaction encrypted_content.",
      replay:
        "Replay the fresh item as the Codex-standard {type: 'compaction', encrypted_content}, then try compaction_summary only if the standard replay fails.",
      productionEvidence:
        "Count real Codex compaction_trigger requests and later encrypted compaction replay requests separately; only exact current provider-model names are attributed.",
      userAgent: auditUserAgent,
      interpretation: {
        PASS: "The provider generated a fresh compact item and accepted Codex-standard compaction replay.",
        PASS_ALTERNATE_TYPE:
          "The provider generated a fresh compact item but only compaction_summary replay succeeded; gateway type rewriting is required.",
        TRIGGER_REJECTED:
          "Normal Responses worked, but the provider rejected compaction_trigger or incorrectly required encrypted_content on the trigger item.",
        TRIGGER_NO_COMPACT_ITEM:
          "The trigger request completed but did not return an encrypted compaction item.",
        REPLAY_FAILED:
          "The provider generated an encrypted compaction item but could not replay its own fresh item using either supported item type.",
        TRANSIENT_FAILURE:
          "The live check hit a timeout, rate limit, or retryable 5xx failure; this is not classified as protocol incompatibility.",
      },
    },
    scope: {
      providerModelPairs: jobs.length,
      timeoutMs,
      concurrency,
      maxKeysPerProvider,
      includeDisabled,
      productionWindowDays,
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
  console.log(
    `OPERATIONAL_SUMMARY=${JSON.stringify(report.operationalSummary)}`,
  );
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
  productionEvidence: ProductionEvidence,
): Promise<AuditResult> {
  const result: AuditResult = {
    provider: provider.name,
    providerStatus: provider.status,
    baseUrl: provider.baseUrl,
    model,
    configuredCompactItemType: normalizeCompactItemType(
      provider.compactItemType,
    ),
    classification:
      provider.status !== "ACTIVE"
        ? "PROVIDER_DISABLED"
        : skipLive
          ? "LIVE_NOT_RUN"
          : provider.keys.length === 0
            ? "NO_ACTIVE_KEY"
            : "RESPONSES_FAILED",
    workingKeyName: null,
    workingReplayType: null,
    attemptedKeyCount: 0,
    attempts: [],
    keyHealth: summarizeKeyHealth(provider.keys),
    productionEvidence,
    operationalAssessment: assessOperationalState(
      "LIVE_NOT_RUN",
      productionEvidence,
    ),
  };

  if (
    result.classification === "PROVIDER_DISABLED" ||
    result.classification === "LIVE_NOT_RUN" ||
    result.classification === "NO_ACTIVE_KEY"
  ) {
    result.operationalAssessment = assessOperationalState(
      result.classification,
      productionEvidence,
    );
    return result;
  }

  const keys = sortProviderKeys(provider.keys).slice(0, maxKeysPerProvider);
  for (const key of keys) {
    result.attemptedKeyCount += 1;
    console.log(
      `[TRY] ${provider.name} ${model} key=${key.name} health=${key.lastCheckStatus ?? "unknown"}`,
    );
    const attempt = await runCompactionRoundtrip({
      provider,
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
      result.workingReplayType = attempt.workingReplayType;
      break;
    }
  }

  result.operationalAssessment = assessOperationalState(
    result.classification,
    productionEvidence,
  );
  return result;
}

async function runCompactionRoundtrip(input: {
  provider: { name: string; baseUrl: string };
  apiKey: string;
  keyName: string;
  model: string;
}): Promise<Attempt> {
  const trigger = await postResponses({
    provider: input.provider,
    apiKey: input.apiKey,
    body: buildCompactionTriggerBody(input.model),
  });
  if (!trigger.ok) {
    const basicCheck = await postResponses({
      provider: input.provider,
      apiKey: input.apiKey,
      body: buildBasicResponsesBody(input.model),
    });
    return {
      keyName: input.keyName,
      classification: classifyTriggerFailure(trigger, basicCheck),
      emittedCompactTypes: trigger.compactItems.map((item) =>
        String(item.item.type ?? "unknown"),
      ),
      workingReplayType: null,
      trigger: redactTurn(trigger),
      replayAttempts: [],
      basicCheck: redactTurn(basicCheck),
    };
  }

  if (trigger.compactItems.length === 0) {
    return {
      keyName: input.keyName,
      classification: "TRIGGER_NO_COMPACT_ITEM",
      emittedCompactTypes: [],
      workingReplayType: null,
      trigger: redactTurn(trigger),
      replayAttempts: [],
      basicCheck: null,
    };
  }

  const sourceItem = trigger.compactItems[0];
  const replayAttempts: ReplayAttempt[] = [];
  const replayTypes: CompactItemType[] = ["compaction", "compaction_summary"];
  for (const itemType of replayTypes) {
    const replay = await postResponses({
      provider: input.provider,
      apiKey: input.apiKey,
      body: buildReplayBody(
        input.model,
        normalizeCompactItem(sourceItem.item, itemType),
      ),
    });
    replayAttempts.push({ itemType, result: redactTurn(replay) });
    if (replay.ok) {
      return {
        keyName: input.keyName,
        classification:
          itemType === "compaction" ? "PASS" : "PASS_ALTERNATE_TYPE",
        emittedCompactTypes: trigger.compactItems.map((item) =>
          String(item.item.type ?? "unknown"),
        ),
        workingReplayType: itemType,
        trigger: redactTurn(trigger),
        replayAttempts,
        basicCheck: null,
      };
    }
  }

  return {
    keyName: input.keyName,
    classification: replayAttempts.some((attempt) =>
      isTransientTurn(attempt.result),
    )
      ? "TRANSIENT_FAILURE"
      : "REPLAY_FAILED",
    emittedCompactTypes: trigger.compactItems.map((item) =>
      String(item.item.type ?? "unknown"),
    ),
    workingReplayType: null,
    trigger: redactTurn(trigger),
    replayAttempts,
    basicCheck: null,
  };
}

function buildCompactionTriggerBody(model: string): ProxyBody {
  const historyText = Array.from(
    { length: 28 },
    (_, index) =>
      `Context line ${index + 1}: preserve the audit marker ${auditMarker}, channel switching behavior, cached migration semantics, and prior conversation facts.`,
  ).join("\n");

  return {
    model,
    instructions:
      "Preserve the supplied conversation faithfully when the protocol requests compaction.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: historyText }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: `Acknowledged ${auditMarker}. The conversation facts are retained.`,
          },
        ],
      },
      { type: "compaction_trigger" },
    ],
    include: [],
    reasoning: null,
    store: false,
    stream: true,
  };
}

function buildReplayBody(model: string, compactItem: JsonRecord): ProxyBody {
  return {
    model,
    instructions: "Reply with exactly OK.",
    input: [
      compactItem,
      {
        role: "user",
        content: [{ type: "input_text", text: "Reply with exactly OK." }],
      },
    ],
    include: [],
    reasoning: null,
    store: false,
    stream: true,
  };
}

function buildBasicResponsesBody(model: string): ProxyBody {
  return {
    model,
    instructions: "Reply with exactly OK.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "Reply with exactly OK." }],
      },
    ],
    include: [],
    reasoning: null,
    store: false,
    stream: true,
  };
}

async function postResponses(input: {
  provider: { name: string; baseUrl: string };
  apiKey: string;
  body: ProxyBody;
}): Promise<TurnResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstreamBody = await applyReasoningEffortTransform(
      buildUpstreamBody(
        "/v1/responses",
        input.body,
        input.provider,
        "/v1/responses",
      ),
      { endpoint: "/v1/responses" },
    );
    const response = await fetch(
      buildUpstreamUrl(input.provider.baseUrl, "/v1/responses"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
          "User-Agent": auditUserAgent,
        },
        body: JSON.stringify(upstreamBody),
        signal: controller.signal,
      },
    );
    const contentType = response.headers.get("content-type") ?? "";
    const text = await readUntilTerminal(response, controller.signal);
    const parsed = parseResponsesPayload(text, contentType);
    const ok = response.ok && parsed.completed && !parsed.failedEvent;
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
      compactItems: extractCompactItems(parsed.outputItems),
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
      compactItems: [],
      outputItems: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readUntilTerminal(response: Response, signal: AbortSignal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (
      !signal.aborted &&
      Buffer.byteLength(text, "utf8") < maxResponseBytes
    ) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
      if (
        (text.includes('"type":"response.completed"') ||
          text.includes('"type":"response.failed"') ||
          text.includes("event: response.completed") ||
          text.includes("event: response.failed") ||
          text.includes("[DONE]")) &&
        (/\r?\n\r?\n$/.test(text) || text.endsWith("[DONE]"))
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
    if (!isRecord(payload)) continue;
    const type = typeof payload.type === "string" ? payload.type : "";
    if (type) eventTypes.push(type);
    if (type === "response.completed") completed = true;
    if (type === "response.failed" || type === "error") {
      failedEvent = true;
      error = extractError(JSON.stringify(payload));
    }
    if (payload.item !== undefined && type.includes("output_item")) {
      outputItems.push(payload.item);
    }
    const response = isRecord(payload.response) ? payload.response : payload;
    if (response.status === "completed") completed = true;
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
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const parsed = parseJson(data);
    if (parsed !== null) payloads.push(parsed);
  }
  return payloads;
}

function extractCompactItems(items: unknown[]) {
  const output: Array<{ encryptedContent: string; item: JsonRecord }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || !isCompactItemType(item.type)) continue;
    if (typeof item.encrypted_content !== "string" || !item.encrypted_content) {
      continue;
    }
    const hash = sha256(item.encrypted_content);
    if (seen.has(hash)) continue;
    seen.add(hash);
    output.push({
      encryptedContent: item.encrypted_content,
      item,
    });
  }
  return output;
}

function normalizeCompactItem(
  item: JsonRecord,
  itemType: CompactItemType,
): JsonRecord {
  const encryptedContent = item.encrypted_content;
  if (typeof encryptedContent !== "string" || !encryptedContent) {
    return item;
  }
  if (itemType === "compaction") {
    return {
      type: "compaction",
      encrypted_content: encryptedContent,
    };
  }
  return {
    id:
      typeof item.id === "string" && item.id
        ? item.id
        : `compact_${sha256(encryptedContent).slice(0, 24)}`,
    type: "compaction_summary",
    encrypted_content: encryptedContent,
  };
}

function redactTurn(turn: TurnResult): SafeTurnResult {
  return {
    ok: turn.ok,
    status: turn.status,
    latencyMs: turn.latencyMs,
    completed: turn.completed,
    failedEvent: turn.failedEvent,
    error: turn.error,
    eventTypes: turn.eventTypes,
    outputItemTypes: turn.outputItemTypes,
    compactItems: turn.compactItems.map((item) => ({
      type: String(item.item.type ?? "unknown"),
      encryptedContentLength: item.encryptedContent.length,
      hasId: typeof item.item.id === "string" && Boolean(item.item.id),
    })),
  };
}

function classifyTriggerFailure(
  trigger: TurnResult,
  basicCheck: TurnResult,
): AttemptClassification {
  if (isTransientTurn(redactTurn(trigger))) return "TRANSIENT_FAILURE";
  if (!basicCheck.ok) {
    return isTransientTurn(redactTurn(basicCheck))
      ? "TRANSIENT_FAILURE"
      : "RESPONSES_FAILED";
  }
  if (isCompactionTriggerRejection(trigger.error)) return "TRIGGER_REJECTED";
  return "TRIGGER_FAILED";
}

function isCompactionTriggerRejection(error: string | null) {
  const text = (error ?? "").toLowerCase();
  return (
    (text.includes("compaction_trigger") &&
      (text.includes("unsupported") ||
        text.includes("unknown") ||
        text.includes("invalid") ||
        text.includes("not allowed") ||
        text.includes("unexpected"))) ||
    (text.includes("encrypted_content") &&
      (text.includes("missing") || text.includes("required")))
  );
}

function isTransientTurn(turn: SafeTurnResult) {
  if (turn.status === null) return true;
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(turn.status)) {
    return true;
  }
  const text = (turn.error ?? "").toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("temporarily unavailable") ||
    text.includes("concurrency limit") ||
    text.includes("rate limit") ||
    text.includes("too many requests")
  );
}

async function loadProductionEvidence() {
  const triggerRows = await prisma.$queryRaw<ProductionCountRow[]>`
    SELECT r."upstreamProvider" AS provider,
           r."model",
           r."status"::text AS status,
           COUNT(*)::bigint AS count,
           MAX(r."createdAt") AS latest
    FROM "ApiRequest" r
    WHERE r."userAgent" ILIKE 'Codex%'
      AND r."createdAt" >= NOW() - (${productionWindowDays} * INTERVAL '1 day')
      AND r."endpoint" = '/v1/responses'
      AND jsonb_path_exists(
        CASE
          WHEN jsonb_typeof(r."requestBody"->'input') = 'array'
            THEN r."requestBody"->'input'
          ELSE '[]'::jsonb
        END,
        '$[*] ? (@.type == "compaction_trigger")'
      )
    GROUP BY r."upstreamProvider", r."model", r."status"
  `;
  const replayRows = await prisma.$queryRaw<ProductionReplayRow[]>`
    SELECT r."upstreamProvider" AS provider,
           r."model",
           r."status"::text AS status,
           item->>'type' AS "itemType",
           COUNT(DISTINCT r."id")::bigint AS count,
           MAX(r."createdAt") AS latest
    FROM "ApiRequest" r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(r."requestBody"->'input') = 'array'
          THEN r."requestBody"->'input'
        ELSE '[]'::jsonb
      END
    ) item
    WHERE r."userAgent" ILIKE 'Codex%'
      AND r."createdAt" >= NOW() - (${productionWindowDays} * INTERVAL '1 day')
      AND r."endpoint" = '/v1/responses'
      AND item->>'type' IN ('compaction', 'compaction_summary')
      AND COALESCE(item->>'encrypted_content', '') <> ''
    GROUP BY r."upstreamProvider", r."model", r."status", item->>'type'
  `;

  const evidence = new Map<string, ProductionEvidence>();
  for (const row of triggerRows) {
    const key = targetKey(row.provider, row.model);
    const current = evidence.get(key) ?? emptyProductionEvidence();
    applyProductionCount(current, "trigger", row);
    evidence.set(key, current);
  }
  for (const row of replayRows) {
    const key = targetKey(row.provider, row.model);
    const current = evidence.get(key) ?? emptyProductionEvidence();
    applyProductionCount(current, "replay", row);
    if (!current.observedReplayTypes.includes(row.itemType)) {
      current.observedReplayTypes.push(row.itemType);
      current.observedReplayTypes.sort();
    }
    evidence.set(key, current);
  }
  return evidence;
}

function applyProductionCount(
  evidence: ProductionEvidence,
  kind: "trigger" | "replay",
  row: ProductionCountRow,
) {
  const count = Number(row.count);
  const latest = row.latest?.toISOString() ?? null;
  if (kind === "trigger") {
    if (row.status === "SUCCESS") {
      evidence.triggerSuccessCount += count;
      evidence.latestTriggerSuccessAt = laterIso(
        evidence.latestTriggerSuccessAt,
        latest,
      );
    } else if (row.status === "FAILED") {
      evidence.triggerFailedCount += count;
      evidence.latestTriggerFailureAt = laterIso(
        evidence.latestTriggerFailureAt,
        latest,
      );
    } else {
      evidence.triggerPendingCount += count;
    }
    return;
  }

  if (row.status === "SUCCESS") {
    evidence.replaySuccessCount += count;
    evidence.latestReplaySuccessAt = laterIso(
      evidence.latestReplaySuccessAt,
      latest,
    );
  } else if (row.status === "FAILED") {
    evidence.replayFailedCount += count;
    evidence.latestReplayFailureAt = laterIso(
      evidence.latestReplayFailureAt,
      latest,
    );
  } else {
    evidence.replayPendingCount += count;
  }
}

function emptyProductionEvidence(): ProductionEvidence {
  return {
    windowDays: productionWindowDays,
    triggerSuccessCount: 0,
    triggerFailedCount: 0,
    triggerPendingCount: 0,
    replaySuccessCount: 0,
    replayFailedCount: 0,
    replayPendingCount: 0,
    observedReplayTypes: [],
    latestTriggerSuccessAt: null,
    latestTriggerFailureAt: null,
    latestReplaySuccessAt: null,
    latestReplayFailureAt: null,
  };
}

function assessOperationalState(
  classification: AuditClassification,
  evidence: ProductionEvidence,
): OperationalAssessment {
  const livePass = isPass(classification);
  const productionPass =
    evidence.triggerSuccessCount > 0 && evidence.replaySuccessCount > 0;
  if (livePass && productionPass) return "LIVE_AND_PRODUCTION_CONFIRMED";
  if (livePass) return "LIVE_ROUNDTRIP_PASS";
  if (productionPass) return "PRODUCTION_CONFIRMED";
  if (evidence.triggerSuccessCount > 0 || evidence.replaySuccessCount > 0) {
    return "PARTIAL_PRODUCTION_EVIDENCE";
  }
  return "UNVERIFIED_OR_UNAVAILABLE";
}

function summarizeKeyHealth(
  keys: Array<{ lastCheckStatus: string | null; lastCheckedAt: Date | null }>,
): AuditResult["keyHealth"] {
  let successfulHealthChecks = 0;
  let failedHealthChecks = 0;
  let unknownHealthChecks = 0;
  let latestCheckedAt: string | null = null;
  for (const key of keys) {
    if (key.lastCheckStatus === "SUCCESS") successfulHealthChecks += 1;
    else if (key.lastCheckStatus === "FAILED") failedHealthChecks += 1;
    else unknownHealthChecks += 1;
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
    lastCheckedAt: Date | null;
  },
>(keys: T[]) {
  const healthRank = (value: string | null) =>
    value === "SUCCESS" ? 2 : value === "FAILED" ? 0 : 1;
  return [...keys].sort((left, right) => {
    const healthDifference =
      healthRank(right.lastCheckStatus) - healthRank(left.lastCheckStatus);
    if (healthDifference !== 0) return healthDifference;
    const checkDifference =
      (right.lastCheckedAt?.getTime() ?? 0) -
      (left.lastCheckedAt?.getTime() ?? 0);
    if (checkDifference !== 0) return checkDifference;
    if (left.priority !== right.priority) return left.priority - right.priority;
    return (
      (right.lastUsedAt?.getTime() ?? 0) - (left.lastUsedAt?.getTime() ?? 0)
    );
  });
}

function chooseBetterClassification(
  current: AuditClassification,
  next: AttemptClassification,
): AuditClassification {
  const rank: Record<AuditClassification, number> = {
    PASS: 100,
    PASS_ALTERNATE_TYPE: 95,
    TRIGGER_NO_COMPACT_ITEM: 60,
    REPLAY_FAILED: 55,
    TRIGGER_REJECTED: 50,
    TRIGGER_FAILED: 40,
    TRANSIENT_FAILURE: 30,
    RESPONSES_FAILED: 20,
    NO_ACTIVE_KEY: 10,
    PROVIDER_DISABLED: 5,
    LIVE_NOT_RUN: 0,
  };
  return rank[next] > rank[current] ? next : current;
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

function isPass(classification: AuditClassification) {
  return classification === "PASS" || classification === "PASS_ALTERNATE_TYPE";
}

function normalizeCompactItemType(value: unknown): CompactItemType {
  return value === "compaction" ? "compaction" : "compaction_summary";
}

function isCompactItemType(value: unknown) {
  return (
    value === "compaction" ||
    value === "compaction_summary" ||
    value === "response.compaction_summary"
  );
}

function readConfiguredTargets() {
  const value = process.env.AUDIT_TARGETS_JSON;
  if (!value) return null;
  const parsed = JSON.parse(value) as Array<{
    provider: string;
    model: string;
  }>;
  return new Set(parsed.map((item) => targetKey(item.provider, item.model)));
}

function targetKey(provider: string, model: string) {
  return `${provider}\u0000${model}`;
}

function laterIso(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function deduplicateOutputItems(items: unknown[]) {
  const output: unknown[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function extractError(text: string) {
  const parsed = parseJson(text);
  let message = "";
  visit(parsed, (record) => {
    if (!message && typeof record.message === "string") {
      message = record.message;
    }
  });
  if (message) return sanitizeText(message);
  const dataMessages = parseSsePayloads(text)
    .map((payload) => {
      let candidate = "";
      visit(payload, (record) => {
        if (!candidate && typeof record.message === "string") {
          candidate = record.message;
        }
      });
      return candidate;
    })
    .filter(Boolean);
  return sanitizeText(dataMessages[0] ?? text);
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function visit(value: unknown, callback: (record: JsonRecord) => void) {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback);
    return;
  }
  if (!isRecord(value)) return;
  callback(value);
  for (const item of Object.values(value)) visit(item, callback);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeText(value: string) {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
