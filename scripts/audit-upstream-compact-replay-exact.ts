import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@gateway/db";
import { buildUpstreamUrl } from "../apps/api/src/services/upstream.js";
import { resolveStoredUpstreamKey } from "../apps/api/src/services/upstream-key-encryption.js";

type CompactItemType = "compaction" | "compaction_summary";
type JsonRecord = Record<string, unknown>;

type Attempt = {
  keyName: string;
  itemType: CompactItemType;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
};

type Result = {
  provider: string;
  providerStatus: string;
  baseUrl: string;
  model: string;
  configuredCompactItemType: CompactItemType;
  classification: "PASS" | "PASS_ALTERNATE_TYPE" | "REPLAY_FAILED" | "NO_ACTIVE_KEY";
  workingKeyName: string | null;
  workingCompactItemType: CompactItemType | null;
  attemptedKeyCount: number;
  attempts: Attempt[];
};

const sampleRequestId =
  process.env.COMPACT_REPLAY_SAMPLE_REQUEST_ID ?? "cmrsq2gkw004f7zc914k6074o";
const timeoutMs = 45_000;
const concurrency = 4;
const sourceOnly = process.env.COMPACT_REPLAY_SOURCE_ONLY === "1";

async function main() {
  const sample = await loadSample();
  const providers = await prisma.upstreamProvider.findMany({
    where: sourceOnly ? { name: sample.sourceProvider } : undefined,
    include: {
      keys: {
        where: {
          status: "ACTIVE",
          ...(sourceOnly && sample.sourceKeyId
            ? { id: sample.sourceKeyId }
            : {}),
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });
  const supportedProviders = new Set(
    (
      await prisma.modelPrice.findMany({
        where: {
          enabled: true,
          model: sample.model,
          upstreamEndpoint: "responses",
        },
        select: { upstreamProvider: true },
      })
    ).map((price) => price.upstreamProvider),
  );
  const jobs = providers.filter((provider) =>
    supportedProviders.has(provider.name),
  );
  const results: Result[] = new Array(jobs.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      const provider = jobs[index];
      if (!provider) return;
      results[index] = await auditProvider(provider, sample);
      console.log(
        `[${index + 1}/${jobs.length}] ${results[index].classification} ${provider.name}`,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    sample: {
      requestId: sampleRequestId,
      sourceProvider: sample.sourceProvider,
      model: sample.model,
      compactIndex: sample.compactIndex,
      sourceCompactType: sample.sourceCompactType,
      encryptedContentLength: sample.encryptedContentLength,
      mode: "exact original request body; only compact item type is rewritten",
      sourceOnly,
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
  await mkdir(resolve("tmp"), { recursive: true });
  const path = resolve("tmp/upstream-compact-replay-exact-final.json");
  await writeFile(path, JSON.stringify(report, null, 2), "utf8");
  console.log(`REPORT_PATH=${path}`);
  console.log(`SUMMARY=${JSON.stringify(report.summary)}`);
}

async function loadSample() {
  const row = await prisma.apiRequest.findUnique({
    where: { id: sampleRequestId },
    select: {
      model: true,
      upstreamProvider: true,
      upstreamProviderKeyId: true,
      requestBody: true,
    },
  });
  if (!row || !isRecord(row.requestBody) || !Array.isArray(row.requestBody.input)) {
    throw new Error("exact replay sample request body is unavailable");
  }
  const input = row.requestBody.input as unknown[];
  if (input.some(isLogTruncationMarker)) {
    throw new Error(
      "exact replay sample was truncated for request logging; use the standard compact replay audit",
    );
  }
  if (containsLogRedaction(row.requestBody)) {
    throw new Error(
      "exact replay sample was redacted for request logging; use the standard compact replay audit",
    );
  }
  const compactIndex = input.findIndex(
    (item) =>
      isRecord(item) &&
      isCompactType(item.type) &&
      typeof item.encrypted_content === "string" &&
      item.encrypted_content.length > 0,
  );
  if (compactIndex < 0) {
    throw new Error("exact replay sample has no encrypted compaction item");
  }
  const item = input[compactIndex] as JsonRecord;
  return {
    model: row.model,
    sourceProvider: row.upstreamProvider,
    sourceKeyId: row.upstreamProviderKeyId,
    body: row.requestBody as JsonRecord,
    compactIndex,
    sourceCompactType: String(item.type),
    encryptedContentLength: String(item.encrypted_content).length,
  };
}

async function auditProvider(
  provider: Awaited<ReturnType<typeof prisma.upstreamProvider.findMany>>[number] & {
    keys: Array<{ name: string; key: string; encryptedKey: string | null }>;
  },
  sample: Awaited<ReturnType<typeof loadSample>>,
): Promise<Result> {
  const configured = normalizeType(provider.compactItemType);
  const result: Result = {
    provider: provider.name,
    providerStatus: provider.status,
    baseUrl: provider.baseUrl,
    model: sample.model,
    configuredCompactItemType: configured,
    classification: provider.keys.length ? "REPLAY_FAILED" : "NO_ACTIVE_KEY",
    workingKeyName: null,
    workingCompactItemType: null,
    attemptedKeyCount: 0,
    attempts: [],
  };
  for (const key of provider.keys) {
    result.attemptedKeyCount += 1;
    const apiKey = resolveStoredUpstreamKey(key);
    const types: CompactItemType[] = [configured, alternateType(configured)];
    for (const itemType of types) {
      const attempt = await postExactReplay({
        providerBaseUrl: provider.baseUrl,
        apiKey,
        keyName: key.name,
        itemType,
        sample,
      });
      result.attempts.push(attempt);
      if (attempt.ok) {
        result.classification = itemType === configured ? "PASS" : "PASS_ALTERNATE_TYPE";
        result.workingKeyName = key.name;
        result.workingCompactItemType = itemType;
        return result;
      }
    }
  }
  return result;
}

async function postExactReplay(input: {
  providerBaseUrl: string;
  apiKey: string;
  keyName: string;
  itemType: CompactItemType;
  sample: Awaited<ReturnType<typeof loadSample>>;
}): Promise<Attempt> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = cloneJson(input.sample.body);
    body.model = input.sample.model;
    body.stream = true;
    body.store = false;
    const bodyInput = body.input as unknown[];
    bodyInput[input.sample.compactIndex] = normalizeCompactItem(
      bodyInput[input.sample.compactIndex],
      input.itemType,
    );
    const response = await fetch(
      buildUpstreamUrl(input.providerBaseUrl, "/v1/responses"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const text = await readLimited(response, controller.signal);
      return {
        keyName: input.keyName,
        itemType: input.itemType,
        ok: false,
        status: response.status,
        latencyMs: Math.round(performance.now() - startedAt),
        error: extractError(text),
      };
    }
    await waitForResponseCompletion(response, controller.signal);
    return {
      keyName: input.keyName,
      itemType: input.itemType,
      ok: true,
      status: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      error: null,
    };
  } catch (error) {
    return {
      keyName: input.keyName,
      itemType: input.itemType,
      ok: false,
      status: null,
      latencyMs: Math.round(performance.now() - startedAt),
      error: sanitizeText(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForResponseCompletion(
  response: Response,
  signal: AbortSignal,
) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) return;
      text += decoder.decode(next.value, { stream: true });
      if (text.includes("response.completed") || text.includes("[DONE]")) {
        return;
      }
      if (text.length > 128_000) {
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function readLimited(response: Response, signal: AbortSignal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!signal.aborted && text.length < 8_000) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

function normalizeCompactItem(value: unknown, type: CompactItemType) {
  if (!isRecord(value) || typeof value.encrypted_content !== "string") {
    return value;
  }
  if (type === "compaction") {
    const { id: _id, object: _object, ...rest } = value;
    return { ...rest, type: "compaction" };
  }
  return {
    ...value,
    id:
      typeof value.id === "string" && value.id
        ? value.id
        : `compact_exact_${Date.now()}`,
    type: "compaction_summary",
  };
}

function extractError(text: string) {
  try {
    const parsed = JSON.parse(text);
    const values: string[] = [];
    visit(parsed, (record) => {
      if (typeof record.message === "string") values.push(record.message);
      if (typeof record.code === "string") values.push(record.code);
    });
    return sanitizeText([...new Set(values)].join(" | "));
  } catch {
    return sanitizeText(text);
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isCompactType(value: unknown) {
  return (
    value === "compaction" ||
    value === "compaction_summary" ||
    value === "response.compaction_summary"
  );
}

function normalizeType(value: string): CompactItemType {
  return value === "compaction" ? "compaction" : "compaction_summary";
}

function alternateType(value: CompactItemType): CompactItemType {
  return value === "compaction" ? "compaction_summary" : "compaction";
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
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isLogTruncationMarker(value: unknown) {
  return (
    isRecord(value) &&
    value.reason === "log_array_truncated" &&
    typeof value.omittedItems === "number"
  );
}

function containsLogRedaction(value: unknown): boolean {
  if (typeof value === "string") {
    return (
      /^\[(?:REDACTED|TRUNCATED)_/u.test(value) ||
      /\.\.\.\[truncated \d+ chars\]$/u.test(value)
    );
  }
  if (Array.isArray(value)) {
    return value.some(containsLogRedaction);
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    isLogTruncationMarker(value) ||
    Object.values(value).some(containsLogRedaction)
  );
}

function sanitizeText(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .slice(0, 1000);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
