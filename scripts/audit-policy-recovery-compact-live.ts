import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { prisma } from "@gateway/db";
import { extractEncryptedItems } from "../apps/api/src/services/compact-cache.ts";
import { isCompactionTriggerRequestBody } from "../apps/api/src/services/compact-request-utils.ts";
import {
  buildPolicyRecoveryBody,
  createPolicyRecoveryContext,
  detectPolicyBlock,
  sanitizePolicyResponseBody,
} from "../apps/api/src/services/policy-recovery.ts";
import { readPolicyRecoverySettings } from "../apps/api/src/services/policy-recovery-settings.ts";
import {
  getForwardableUpstreamResponseHeaders,
  safeReadUpstreamBody,
} from "../apps/api/src/services/proxy-request-utils.ts";
import {
  parseSseJsonPayloads,
  sseBufferHasCompletedResponse,
} from "../apps/api/src/services/proxy-usage.ts";
import { buildUpstreamUrl } from "../apps/api/src/services/upstream.ts";
import { resolveStoredUpstreamKey } from "../apps/api/src/services/upstream-key-encryption.ts";

const providerName = requiredEnv("AUDIT_PROVIDER_NAME");
const keyId = requiredEnv("AUDIT_KEY_ID");
const model = process.env.AUDIT_MODEL?.trim() || "gpt-5.6-sol";
const timeoutMs = readPositiveInteger("AUDIT_TIMEOUT_MS", 6 * 60 * 1000);
const marker = `policy-compact-live-${Date.now()}`;

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  const provider = await prisma.upstreamProvider.findFirstOrThrow({
    where: { name: providerName },
    select: {
      id: true,
      name: true,
      baseUrl: true,
      timeoutMs: true,
    },
  });
  const key = await prisma.upstreamProviderKey.findFirstOrThrow({
    where: {
      id: keyId,
      upstreamProviderId: provider.id,
      status: "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      key: true,
      encryptedKey: true,
    },
  });
  const settings = await readPolicyRecoverySettings();
  const enabledSettings = {
    ...settings,
    masterEnabled: true,
  };
  const originalBody = {
    model,
    instructions: `Preserve the audit marker ${marker}.`,
    input: [
      ...Array.from({ length: 24 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Conversation turn ${index + 1}: preserve ${marker} and all prior context.`,
      })),
      { type: "compaction_trigger" },
    ],
    reasoning: { effort: "low" },
    store: false,
    stream: true,
  };
  const context = createPolicyRecoveryContext(originalBody, enabledSettings);
  const requestBody = buildPolicyRecoveryBody({
    context,
    endpoint: "/v1/responses",
    recoveryAttempt: 1,
    signal: {
      source: "sse",
      code: "audit_policy_recovery",
      summary: "Synthetic structured policy retry for compact verification",
    },
    provider: provider.name,
    model,
  });
  assert.equal(isCompactionTriggerRequestBody(requestBody), true);
  assert.equal(countCompactionTriggers(requestBody), 1);

  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      buildUpstreamUrl(provider.baseUrl, "/v1/responses"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resolveStoredUpstreamKey(key)}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Accept-Encoding": "identity",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      },
    );
    const rawBody = await safeReadUpstreamBody(response, {
      maxBytes: enabledSettings.maxInspectableResponseBytes,
    });
    if ("error" in rawBody) {
      throw new Error(rawBody.error.message);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const parsedBody = contentType.includes("text/event-stream")
      ? parseSseJsonPayloads(rawBody.text)
      : rawBody.json;
    const signal = detectPolicyBlock({
      statusCode: response.status,
      headers: response.headers,
      body: contentType.includes("text/event-stream")
        ? rawBody.text
        : parsedBody,
      source: contentType.includes("text/event-stream") ? "sse" : "json",
    });
    const encryptedItems = extractEncryptedItems(parsedBody);
    const sanitizedEncryptedItems = extractEncryptedItems(
      sanitizePolicyResponseBody(parsedBody),
    );
    const forwardableHeaders = Object.fromEntries(
      getForwardableUpstreamResponseHeaders(response.headers),
    );
    const completed = contentType.includes("text/event-stream")
      ? sseBufferHasCompletedResponse(rawBody.text)
      : true;

    assert.equal(response.ok, true, summarizeFailure(response, rawBody.text));
    assert.equal(signal, null, signal?.summary);
    assert.equal(completed, true, "compact trigger stream did not complete");
    assert.ok(
      encryptedItems.length > 0,
      "compact trigger response missing encrypted_content",
    );
    assert.equal(sanitizedEncryptedItems.length, encryptedItems.length);
    assert.equal(forwardableHeaders["content-encoding"], undefined);
    assert.equal(forwardableHeaders["content-length"], undefined);

    console.log(
      JSON.stringify(
        {
          ok: true,
          provider: provider.name,
          keyName: key.name,
          model,
          status: response.status,
          contentType,
          upstreamContentEncoding:
            response.headers.get("content-encoding") ?? "identity",
          latencyMs: Math.round(performance.now() - startedAt),
          providerTimeoutMs: provider.timeoutMs,
          auditTimeoutMs: timeoutMs,
          policyProfile: enabledSettings.activeProfile,
          policyInstructionsBytes: Buffer.byteLength(
            enabledSettings.baseInstructions,
            "utf8",
          ),
          compactionTriggerCount: countCompactionTriggers(requestBody),
          encryptedItemCount: encryptedItems.length,
          completed,
          removedHeaders: ["content-encoding", "content-length"],
        },
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(timeout);
  }
}

function countCompactionTriggers(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }
  const input = (value as Record<string, unknown>).input;
  if (!Array.isArray(input)) {
    return 0;
  }
  return input.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type === "compaction_trigger",
  ).length;
}

function summarizeFailure(response: Response, text: string) {
  return `upstream compact trigger failed with ${response.status}: ${text.slice(0, 1000)}`;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
