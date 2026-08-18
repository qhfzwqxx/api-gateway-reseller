import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@gateway/db";
import { buildUpstreamUrl } from "../apps/api/src/services/upstream.js";
import { resolveStoredUpstreamKey } from "../apps/api/src/services/upstream-key-encryption.js";

type CompactItemType = "compaction" | "compaction_summary";

type ReplayAttempt = {
  keyName: string;
  itemType: CompactItemType;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
};

type ReplayResult = {
  provider: string;
  providerStatus: string;
  baseUrl: string;
  model: string;
  configuredCompactItemType: CompactItemType;
  classification:
    | "PASS"
    | "PASS_ALTERNATE_TYPE"
    | "NO_ACTIVE_KEY"
    | "REPLAY_FAILED";
  workingKeyName: string | null;
  workingCompactItemType: CompactItemType | null;
  attemptedKeyCount: number;
  attempts: ReplayAttempt[];
};

const sampleRequestId =
  process.env.COMPACT_REPLAY_SAMPLE_REQUEST_ID ?? "cmrsq2gkw004f7zc914k6074o";
const timeoutMs = 45_000;
const concurrency = 4;
const sourceOnly = process.env.COMPACT_REPLAY_SOURCE_ONLY === "1";

async function main() {
  const sample = await loadReplaySample();
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
  const results: ReplayResult[] = new Array(jobs.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      const provider = jobs[index];
      if (!provider) {
        return;
      }
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
      compactItemType: sample.compactItem.type,
      encryptedContentLength: sample.compactItem.encrypted_content.length,
    },
    scope: {
      providers: jobs.length,
      activeKeyPolicy:
        "try active keys until configured or alternate compact type succeeds; all keys are tried when the provider fails",
      timeoutMs,
      concurrency,
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
  const outputDir = resolve("tmp");
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "upstream-compact-replay-audit-final.json");
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`REPORT_PATH=${outputPath}`);
  console.log(`SUMMARY=${JSON.stringify(report.summary)}`);
}

async function loadReplaySample() {
  const request = await prisma.apiRequest.findUnique({
    where: { id: sampleRequestId },
    select: {
      model: true,
      upstreamProvider: true,
      upstreamProviderKeyId: true,
      requestBody: true,
    },
  });
  if (
    !request ||
    !isRecord(request.requestBody) ||
    !Array.isArray(request.requestBody.input)
  ) {
    throw new Error("compact replay sample request body is unavailable");
  }
  const requestInput = request.requestBody.input as unknown[];
  const compactItem = requestInput.find(
    (item) =>
      isRecord(item) &&
      isCompactType(item.type) &&
      typeof item.encrypted_content === "string" &&
      item.encrypted_content,
  );
  if (
    !isRecord(compactItem) ||
    typeof compactItem.encrypted_content !== "string"
  ) {
    throw new Error("compact replay sample has no encrypted compaction item");
  }
  const prefixMessages = requestInput
    .slice(0, requestInput.indexOf(compactItem))
    .filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) && item.type === "message",
    )
    .map((item, index) => sanitizeMessage(item, index));
  return {
    model: request.model,
    sourceProvider: request.upstreamProvider,
    sourceKeyId: request.upstreamProviderKeyId,
    compactItem: {
      type: String(compactItem.type),
      encrypted_content: compactItem.encrypted_content,
    },
    prefixMessages,
    reasoning: isRecord(request.requestBody.reasoning)
      ? request.requestBody.reasoning
      : { effort: "low" },
  };
}

async function auditProvider(
  provider: Awaited<ReturnType<typeof prisma.upstreamProvider.findMany>>[number] & {
    keys: Array<{
      name: string;
      key: string;
      encryptedKey: string | null;
    }>;
  },
  sample: Awaited<ReturnType<typeof loadReplaySample>>,
): Promise<ReplayResult> {
  const configuredCompactItemType = normalizeCompactItemType(
    provider.compactItemType,
  );
  const result: ReplayResult = {
    provider: provider.name,
    providerStatus: provider.status,
    baseUrl: provider.baseUrl,
    model: sample.model,
    configuredCompactItemType,
    classification: provider.keys.length === 0 ? "NO_ACTIVE_KEY" : "REPLAY_FAILED",
    workingKeyName: null,
    workingCompactItemType: null,
    attemptedKeyCount: 0,
    attempts: [],
  };

  for (const key of provider.keys) {
    result.attemptedKeyCount += 1;
    const apiKey = resolveStoredUpstreamKey(key);
    const configuredAttempt = await replay({
      baseUrl: provider.baseUrl,
      apiKey,
      keyName: key.name,
      itemType: configuredCompactItemType,
      sample,
    });
    result.attempts.push(configuredAttempt);
    if (configuredAttempt.ok) {
      result.classification = "PASS";
      result.workingKeyName = key.name;
      result.workingCompactItemType = configuredCompactItemType;
      return result;
    }

    const alternateType: CompactItemType =
      configuredCompactItemType === "compaction"
        ? "compaction_summary"
        : "compaction";
    const alternateAttempt = await replay({
      baseUrl: provider.baseUrl,
      apiKey,
      keyName: key.name,
      itemType: alternateType,
      sample,
    });
    result.attempts.push(alternateAttempt);
    if (alternateAttempt.ok) {
      result.classification = "PASS_ALTERNATE_TYPE";
      result.workingKeyName = key.name;
      result.workingCompactItemType = alternateType;
      return result;
    }
  }

  return result;
}

async function replay(input: {
  baseUrl: string;
  apiKey: string;
  keyName: string;
  itemType: CompactItemType;
  sample: Awaited<ReturnType<typeof loadReplaySample>>;
}): Promise<ReplayAttempt> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildUpstreamUrl(input.baseUrl, "/v1/responses"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: input.sample.model,
        instructions: "Reply only with OK.",
        input: [
          ...input.sample.prefixMessages,
          normalizeCompactItem(input.sample.compactItem, input.itemType),
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Reply only with OK." }],
          },
        ],
        include: [],
        reasoning: input.sample.reasoning,
        parallel_tool_calls: true,
        store: false,
        stream: true,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      keyName: input.keyName,
      itemType: input.itemType,
      ok: response.ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      error: response.ok ? null : extractError(text),
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

function sanitizeMessage(item: Record<string, unknown>, index: number) {
  return {
    ...item,
    content: [{ type: "input_text", text: `Compact replay audit context ${index + 1}.` }],
  };
}

function normalizeCompactItem(
  item: { type: string; encrypted_content: string },
  itemType: CompactItemType,
) {
  if (itemType === "compaction") {
    return {
      type: "compaction",
      encrypted_content: item.encrypted_content,
    };
  }
  return {
    id: `cmp_replay_audit_${Date.now()}`,
    type: "compaction_summary",
    encrypted_content: item.encrypted_content,
  };
}

function extractError(text: string) {
  try {
    const parsed = JSON.parse(text);
    const messages: string[] = [];
    visit(parsed, (record) => {
      if (typeof record.message === "string") {
        messages.push(record.message);
      }
      if (typeof record.code === "string") {
        messages.push(record.code);
      }
    });
    if (messages.length > 0) {
      return sanitizeText([...new Set(messages)].join(" | "));
    }
  } catch {
    return sanitizeText(text);
  }
  return sanitizeText(text);
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

function isCompactType(value: unknown) {
  return (
    value === "compaction" ||
    value === "compaction_summary" ||
    value === "response.compaction_summary"
  );
}

function normalizeCompactItemType(value: string): CompactItemType {
  return value === "compaction" ? "compaction" : "compaction_summary";
}

function sanitizeText(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .slice(0, 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
