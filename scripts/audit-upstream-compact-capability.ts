import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@gateway/db";
import { buildUpstreamUrl } from "../apps/api/src/services/upstream.js";
import { resolveStoredUpstreamKey } from "../apps/api/src/services/upstream-key-encryption.js";

type CompactItemType = "compaction" | "compaction_summary";

type HttpResult = {
  ok: boolean;
  status: number | null;
  contentType: string;
  body: unknown;
  error?: string;
  latencyMs: number;
};

type AuditResult = {
  provider: string;
  providerStatus: string;
  baseUrl: string;
  model: string;
  keyName: string | null;
  attemptedKeyCount: number;
  keyAttempts: Array<{
    keyName: string;
    classification: AuditResult["classification"];
    basicStatus: number | null;
    compactStatus: number | null;
    configuredReplayStatus: number | null;
    alternateReplayStatus: number | null;
  }>;
  configuredCompactItemType: CompactItemType;
  classification:
    | "PASS"
    | "PASS_ALTERNATE_TYPE"
    | "NO_ACTIVE_KEY"
    | "RESPONSES_FAILED"
    | "COMPACT_FAILED"
    | "COMPACT_MISSING_ENCRYPTED_CONTENT"
    | "REPLAY_FAILED";
  basic: HttpResult | null;
  compact: HttpResult | null;
  configuredReplay: HttpResult | null;
  alternateReplay: HttpResult | null;
  compactOutputItemTypes: string[];
  encryptedItemCount: number;
  workingCompactItemType: CompactItemType | null;
};

const timeoutMs = readPositiveInteger("AUDIT_TIMEOUT_MS", 45_000);
const concurrency = 4;
const auditMarker = `gateway-compact-audit-${Date.now()}`;

async function main() {
  const configuredKeyIds = readConfiguredKeyIds();
  const providers = await prisma.upstreamProvider.findMany({
    include: {
      keys: {
        where: {
          status: "ACTIVE",
          ...(configuredKeyIds
            ? { id: { in: [...configuredKeyIds] } }
            : {}),
        },
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
    orderBy: { model: "asc" },
  });
  const modelsByProvider = new Map<string, string[]>();
  for (const price of prices) {
    const models = modelsByProvider.get(price.upstreamProvider) ?? [];
    if (!models.includes(price.model)) {
      models.push(price.model);
    }
    modelsByProvider.set(price.upstreamProvider, models);
  }

  const configuredTargets = readConfiguredTargets();
  const jobInputs = providers.flatMap((provider) =>
    (modelsByProvider.get(provider.name) ?? []).map((model) => ({
      provider,
      model,
    })),
  ).filter(
    (input) =>
      configuredTargets === null ||
      configuredTargets.has(targetKey(input.provider.name, input.model)),
  );
  const results: AuditResult[] = new Array(jobInputs.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      const input = jobInputs[index];
      if (!input) {
        return;
      }
      results[index] = await auditProviderModel(input.provider, input.model);
      const result = results[index];
      console.log(
        `[${index + 1}/${jobInputs.length}] ${result.classification} ${result.provider} ${result.model}`,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobInputs.length) }, () =>
      worker(),
    ),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    scope: {
      providers: providers.length,
      providerModelPairs: jobInputs.length,
      keyCoverage: "first active key per provider",
      timeoutMs,
      concurrency,
    },
    summary: Object.fromEntries(
      [...new Set(results.map((result) => result.classification))].map(
        (classification) => [
          classification,
          results.filter((result) => result.classification === classification)
            .length,
        ],
      ),
    ),
    results,
  };
  const outputDir = resolve("tmp");
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(
    outputDir,
    `upstream-compact-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`REPORT_PATH=${outputPath}`);
  console.log(`SUMMARY=${JSON.stringify(report.summary)}`);
}

function readConfiguredTargets() {
  const value = process.env.AUDIT_TARGETS_JSON;
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(value) as Array<{ provider: string; model: string }>;
  return new Set(parsed.map((item) => targetKey(item.provider, item.model)));
}

function readConfiguredKeyIds() {
  const value = process.env.AUDIT_KEY_IDS_JSON;
  if (!value) {
    return null;
  }
  return new Set(JSON.parse(value) as string[]);
}

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function targetKey(provider: string, model: string) {
  return `${provider}\u0000${model}`;
}

async function auditProviderModel(
  provider: Awaited<ReturnType<typeof prisma.upstreamProvider.findMany>>[number] & {
    keys: Array<{
      id: string;
      name: string;
      key: string;
      encryptedKey: string | null;
    }>;
  },
  model: string,
): Promise<AuditResult> {
  if (provider.keys.length === 0) {
    return createEmptyResult(provider, model, null);
  }

  const keyAttempts: AuditResult["keyAttempts"] = [];
  let bestResult: AuditResult | null = null;
  for (const key of provider.keys) {
    const result = await auditProviderModelKey(provider, model, key);
    keyAttempts.push({
      keyName: key.name,
      classification: result.classification,
      basicStatus: result.basic?.status ?? null,
      compactStatus: result.compact?.status ?? null,
      configuredReplayStatus: result.configuredReplay?.status ?? null,
      alternateReplayStatus: result.alternateReplay?.status ?? null,
    });
    if (!bestResult || failureRank(result) > failureRank(bestResult)) {
      bestResult = result;
    }
    if (
      result.classification === "PASS" ||
      result.classification === "PASS_ALTERNATE_TYPE"
    ) {
      return {
        ...result,
        attemptedKeyCount: keyAttempts.length,
        keyAttempts,
      };
    }
  }

  return {
    ...(bestResult ?? createEmptyResult(provider, model, null)),
    attemptedKeyCount: keyAttempts.length,
    keyAttempts,
  };
}

async function auditProviderModelKey(
  provider: Parameters<typeof auditProviderModel>[0],
  model: string,
  key: Parameters<typeof auditProviderModel>[0]["keys"][number],
): Promise<AuditResult> {
  const configuredCompactItemType = normalizeCompactItemType(
    provider.compactItemType,
  );
  const result = createEmptyResult(provider, model, key.name);
  result.configuredCompactItemType = configuredCompactItemType;

  const apiKey = resolveStoredUpstreamKey(key);
  result.basic = await postJson(provider.baseUrl, apiKey, "/v1/responses", {
    model,
    instructions: "Reply only with OK.",
    input: [{ role: "user", content: "OK" }],
    reasoning: { effort: "low" },
    store: false,
    stream: true,
  });
  if (!result.basic.ok) {
    result.classification = "RESPONSES_FAILED";
    return result;
  }

  result.compact = await postJson(
    provider.baseUrl,
    apiKey,
    "/v1/responses/compact",
    {
      model,
      instructions: "Compact this conversation while preserving the audit marker.",
      input: buildCompactInput(),
    },
  );
  if (!result.compact.ok) {
    result.classification = "COMPACT_FAILED";
    return result;
  }

  const compactOutput = extractCompactOutput(result.compact.body);
  result.compactOutputItemTypes = compactOutput
    .map((item) => (isRecord(item) ? String(item.type ?? "") : ""))
    .filter(Boolean);
  result.encryptedItemCount = collectEncryptedItemCount(compactOutput);
  if (result.encryptedItemCount === 0) {
    result.classification = "COMPACT_MISSING_ENCRYPTED_CONTENT";
    return result;
  }

  result.configuredReplay = await replayCompactOutput({
    providerBaseUrl: provider.baseUrl,
    apiKey,
    model,
    output: compactOutput,
    itemType: configuredCompactItemType,
  });
  if (result.configuredReplay.ok) {
    result.classification = "PASS";
    result.workingCompactItemType = configuredCompactItemType;
    return result;
  }

  const alternateType: CompactItemType =
    configuredCompactItemType === "compaction"
      ? "compaction_summary"
      : "compaction";
  result.alternateReplay = await replayCompactOutput({
    providerBaseUrl: provider.baseUrl,
    apiKey,
    model,
    output: compactOutput,
    itemType: alternateType,
  });
  if (result.alternateReplay.ok) {
    result.classification = "PASS_ALTERNATE_TYPE";
    result.workingCompactItemType = alternateType;
    return result;
  }

  result.classification = "REPLAY_FAILED";
  return result;
}

function createEmptyResult(
  provider: Parameters<typeof auditProviderModel>[0],
  model: string,
  keyName: string | null,
): AuditResult {
  return {
    provider: provider.name,
    providerStatus: provider.status,
    baseUrl: provider.baseUrl,
    model,
    keyName,
    attemptedKeyCount: keyName ? 1 : 0,
    keyAttempts: [],
    configuredCompactItemType: normalizeCompactItemType(
      provider.compactItemType,
    ),
    classification: "NO_ACTIVE_KEY",
    basic: null,
    compact: null,
    configuredReplay: null,
    alternateReplay: null,
    compactOutputItemTypes: [],
    encryptedItemCount: 0,
    workingCompactItemType: null,
  };
}

function failureRank(result: AuditResult) {
  switch (result.classification) {
    case "PASS":
      return 7;
    case "PASS_ALTERNATE_TYPE":
      return 6;
    case "REPLAY_FAILED":
      return 5;
    case "COMPACT_MISSING_ENCRYPTED_CONTENT":
      return 4;
    case "COMPACT_FAILED":
      return 3;
    case "RESPONSES_FAILED":
      return 2;
    case "NO_ACTIVE_KEY":
      return 1;
  }
}

function buildCompactInput() {
  const context = Array.from(
    { length: 40 },
    (_, index) => `Context line ${index + 1}: preserve ${auditMarker}.`,
  ).join("\n");
  return [
    { role: "user", content: `Remember this context:\n${context}` },
    { role: "assistant", content: `I will preserve ${auditMarker}.` },
    { role: "user", content: "Please compact the conversation now." },
  ];
}

async function replayCompactOutput(input: {
  providerBaseUrl: string;
  apiKey: string;
  model: string;
  output: unknown[];
  itemType: CompactItemType;
}) {
  const replayOutput = rewriteCompactItems(input.output, input.itemType);
  return postJson(input.providerBaseUrl, input.apiKey, "/v1/responses", {
    model: input.model,
    instructions: "Reply only with OK.",
    input: [
      ...replayOutput,
      { role: "user", content: "Reply only with OK." },
    ],
    reasoning: { effort: "low" },
    store: false,
    stream: true,
  });
}

async function postJson(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: unknown,
): Promise<HttpResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildUpstreamUrl(baseUrl, path), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      body: redactSensitiveJson(parseResponseBody(text, contentType)),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      contentType: "",
      body: null,
      error: sanitizeText(error instanceof Error ? error.message : String(error)),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseResponseBody(text: string, contentType: string) {
  if (contentType.includes("text/event-stream") || text.includes("data:")) {
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
      try {
        payloads.push(JSON.parse(data));
      } catch {
        payloads.push(sanitizeText(data));
      }
    }
    return payloads;
  }
  try {
    return JSON.parse(text);
  } catch {
    return sanitizeText(text);
  }
}

function extractCompactOutput(body: unknown): unknown[] {
  const candidates: unknown[] = [];
  visit(body, (record) => {
    if (Array.isArray(record.output)) {
      candidates.push(...record.output);
    }
    if (
      (record.type === "response.output_item.done" ||
        record.type === "response.output_item.added") &&
      record.item !== undefined
    ) {
      candidates.push(record.item);
    }
  });
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectEncryptedItemCount(value: unknown) {
  let count = 0;
  visit(value, (record) => {
    if (
      typeof record.encrypted_content === "string" &&
      record.encrypted_content.length > 0
    ) {
      count += 1;
    }
  });
  return count;
}

function rewriteCompactItems(value: unknown[], itemType: CompactItemType) {
  return value.map((item) => {
    if (!isRecord(item)) {
      return item;
    }
    if (
      item.type !== "compaction" &&
      item.type !== "compaction_summary" &&
      item.type !== "response.compaction_summary"
    ) {
      return item;
    }
    if (
      typeof item.encrypted_content !== "string" ||
      !item.encrypted_content
    ) {
      return item;
    }
    if (itemType === "compaction") {
      const { id: _id, object: _object, ...rest } = item;
      return { ...rest, type: "compaction" };
    }
    return {
      ...item,
      id:
        typeof item.id === "string" && item.id
          ? item.id
          : `compact_audit_${auditMarker}`,
      type: "compaction_summary",
    };
  });
}

function normalizeCompactItemType(value: string): CompactItemType {
  return value === "compaction" ? "compaction" : "compaction_summary";
}

function visit(
  value: unknown,
  callback: (record: Record<string, unknown>) => void,
) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function sanitizeText(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .slice(0, 1500);
}

function redactSensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "encrypted_content" && typeof item === "string") {
      record[key] = `[redacted:${item.length}]`;
      continue;
    }
    record[key] = redactSensitiveJson(item);
  }
  return record;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
