import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { prisma } from "@gateway/db";
import { Decimal } from "decimal.js";
import {
  inspectDirectCompactionOutput,
  inspectRemoteCompactionOutput,
  shouldBypassPolicyRecoveryForCompact,
} from "../apps/api/src/services/compact-request-utils.ts";
import { readPolicyRecoverySettings } from "../apps/api/src/services/policy-recovery-settings.ts";
import {
  getForwardableUpstreamResponseHeaders,
  safeReadUpstreamBody,
} from "../apps/api/src/services/proxy-request-utils.ts";

const requestedApiKeyId = process.env.AUDIT_API_KEY_ID?.trim() || null;
const model = process.env.AUDIT_MODEL?.trim() || "gpt-5.6-sol";
const gatewayBaseUrl = normalizeBaseUrl(
  process.env.AUDIT_GATEWAY_URL?.trim() ||
    `http://127.0.0.1:${process.env.API_PORT?.trim() || "4100"}`,
);
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
  const settings = await readPolicyRecoverySettings();
  assert.equal(
    settings.masterEnabled,
    true,
    "policy recovery master switch must be enabled for this live audit",
  );

  const selected = await selectAuditApiKey();
  const requestBody = {
    model,
    instructions: `Preserve the audit marker ${marker} while compacting.`,
    input: Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Conversation turn ${index + 1}: preserve ${marker} and all prior context.`,
    })),
  };
  assert.equal(
    shouldBypassPolicyRecoveryForCompact({
      endpoint: "/v1/responses/compact",
      requestBody,
    }),
    true,
  );

  const startedAtDate = new Date();
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${gatewayBaseUrl}/v1/responses/compact`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${selected.apiKey.keySecret}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate, br",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      },
    );
    const rawBody = await safeReadUpstreamBody(response, {
      maxBytes: 16 * 1024 * 1024,
    });
    if ("error" in rawBody) {
      throw new Error(rawBody.error.message);
    }
    const responseBody = parseJsonBody(response, rawBody.text);
    const inspection = inspectRemoteCompactionOutput(responseBody);
    const directInspection = inspectDirectCompactionOutput(responseBody);
    const forwardableHeaders = Object.fromEntries(
      getForwardableUpstreamResponseHeaders(response.headers),
    );

    assert.equal(
      response.ok,
      true,
      `gateway compact failed with ${response.status}: ${rawBody.text.slice(0, 1000)}`,
    );
    assert.equal(
      inspection.outputItemCount,
      1,
      `gateway compact expected one output item, got ${inspection.outputItemCount}`,
    );
    assert.equal(
      inspection.compactionOutputItemCount,
      1,
      `gateway compact expected exactly one compaction output item, got ${inspection.compactionOutputItemCount} from ${inspection.outputItemCount} output items`,
    );
    assert.deepEqual(inspection.outputItemTypes, ["compaction"]);
    assert.deepEqual(directInspection, inspection);
    assert.equal(forwardableHeaders["content-encoding"], undefined);
    assert.equal(forwardableHeaders["content-length"], undefined);
    assertLoopbackResponseLength(response, rawBody.text);

    const apiRequest = await findAuditApiRequest({
      apiKeyId: selected.apiKey.id,
      startedAt: startedAtDate,
    });
    assert.equal(apiRequest.status, "SUCCESS");
    assert.equal(apiRequest.httpStatus, 200);
    assert.equal(apiRequest.accessTierId, selected.modelPool.tierId);
    assert.equal(apiRequest.policyRecoveryAudit, null);
    assert.ok(
      selected.modelPool.channels.some(
        (channel) => channel.upstreamProvider === apiRequest.upstreamProvider,
      ),
      `request routed to unexpected provider ${apiRequest.upstreamProvider}`,
    );
    const responseUsage = asRecord(apiRequest.responseUsage);
    assert.equal(responseUsage.gatewayCompactKind, "normal");
    assert.equal(responseUsage.reason, "compact_request_completed");

    const replayResult = await replayCompactionItem({
      apiKeySecret: selected.apiKey.keySecret,
      apiKeyId: selected.apiKey.id,
      compactionItem: inspection.compactionOutputItems[0],
      expectedTierId: selected.modelPool.tierId,
      expectedProviders: selected.modelPool.channels.map(
        (channel) => channel.upstreamProvider,
      ),
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          gatewayBaseUrl,
          model,
          accessTier: selected.modelPool.tier,
          modelPoolId: selected.modelPool.id,
          policyRecoveryMasterEnabled: settings.masterEnabled,
          policyRecoveryPoolEnabled: selected.modelPool.policyRecoveryEnabled,
          policyRecoveryBypassed: apiRequest.policyRecoveryAudit === null,
          provider: apiRequest.upstreamProvider,
          status: response.status,
          latencyMs: Math.round(performance.now() - startedAt),
          contentType: response.headers.get("content-type"),
          downstreamContentEncoding:
            response.headers.get("content-encoding") ?? "identity",
          downstreamContentLength:
            response.headers.get("content-length") ?? "chunked",
          outputItemCount: inspection.outputItemCount,
          compactionOutputItemCount: inspection.compactionOutputItemCount,
          outputItemTypes: inspection.outputItemTypes,
          topLevelOutputItemTypes: directInspection.outputItemTypes,
          topLevelResponseKeys:
            responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)
              ? Object.keys(responseBody as Record<string, unknown>).sort()
              : [],
          encryptedContentLengths: inspection.compactionOutputItems.map((item) =>
            typeof item.encrypted_content === "string"
              ? item.encrypted_content.length
              : 0,
          ),
          apiRequestId: apiRequest.id,
          traceCode: apiRequest.traceCode,
          responseUsageReason: responseUsage.reason,
          responseUsageKind: responseUsage.gatewayCompactKind,
          replayApiRequestId: replayResult.apiRequest.id,
          replayTraceCode: replayResult.apiRequest.traceCode,
          replayStatus: replayResult.response.status,
          replayInputItemTypes: replayResult.inputItemTypes,
          replayPolicyRecoveryEnabled:
            replayResult.policyRecoveryAudit.enabled,
          replayPolicyFinalOutcome:
            replayResult.policyRecoveryAudit.finalOutcome,
          replayPolicyAttempts: Array.isArray(
            replayResult.policyRecoveryAudit.attempts,
          )
            ? replayResult.policyRecoveryAudit.attempts.length
            : 0,
        },
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function replayCompactionItem(params: {
  apiKeySecret: string;
  apiKeyId: string;
  compactionItem: Record<string, unknown> | undefined;
  expectedTierId: string;
  expectedProviders: string[];
}) {
  assert.ok(params.compactionItem, "compact response did not expose a replayable item");
  const replayMarker = `${marker}-replay`;
  const replayBody = {
    model,
    input: [
      structuredClone(params.compactionItem),
      {
        role: "user",
        content: `Confirm continuity for ${replayMarker} in one short sentence.`,
      },
    ],
    reasoning: { effort: "low" },
    store: false,
    stream: false,
  };
  const startedAt = new Date();
  const response = await fetch(`${gatewayBaseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKeySecret}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Accept-Encoding": "gzip, deflate, br",
    },
    body: JSON.stringify(replayBody),
  });
  const rawBody = await safeReadUpstreamBody(response, {
    maxBytes: 16 * 1024 * 1024,
  });
  if ("error" in rawBody) {
    throw new Error(rawBody.error.message);
  }
  assert.equal(
    response.ok,
    true,
    `post-compact replay failed with ${response.status}: ${rawBody.text.slice(0, 1000)}`,
  );
  const apiRequest = await findAuditApiRequest({
    apiKeyId: params.apiKeyId,
    endpoint: "/v1/responses",
    requestMarker: replayMarker,
    startedAt,
  });
  assert.equal(apiRequest.status, "SUCCESS");
  assert.equal(apiRequest.httpStatus, 200);
  assert.equal(apiRequest.accessTierId, params.expectedTierId);
  assert.ok(
    params.expectedProviders.includes(apiRequest.upstreamProvider),
    `post-compact replay routed to unexpected provider ${apiRequest.upstreamProvider}`,
  );
  const policyRecoveryAudit = asRecord(apiRequest.policyRecoveryAudit);
  assert.equal(policyRecoveryAudit.enabled, true);
  assert.ok(
    policyRecoveryAudit.finalOutcome === "not_triggered" ||
      policyRecoveryAudit.finalOutcome === "recovered",
    `unexpected post-compact recovery outcome ${String(policyRecoveryAudit.finalOutcome)}`,
  );
  const inputItemTypes = readInputItemTypes(apiRequest.requestBody);
  assert.equal(inputItemTypes[0], "compaction");
  assert.equal(inputItemTypes.includes("compaction_trigger"), false);
  return { response, apiRequest, policyRecoveryAudit, inputItemTypes };
}

async function selectAuditApiKey() {
  const apiKeys = await prisma.apiKey.findMany({
    where: {
      status: "ACTIVE",
      keySecret: { not: null },
      ipWhitelist: { isEmpty: true },
      ...(requestedApiKeyId ? { id: requestedApiKeyId } : {}),
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        {
          OR: [
            { allowedModels: { isEmpty: true } },
            { allowedModels: { has: model } },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      keySecret: true,
      tierId: true,
      user: {
        select: {
          tierId: true,
          status: true,
          allowedModels: true,
          wallet: {
            select: {
              balance: true,
              reservedBalance: true,
            },
          },
        },
      },
    },
    orderBy: [{ lastUsedAt: "desc" }, { createdAt: "asc" }],
    take: requestedApiKeyId ? 1 : 100,
  });

  for (const apiKey of apiKeys) {
    if (
      !apiKey.keySecret ||
      apiKey.user.status !== "ACTIVE" ||
      (apiKey.user.allowedModels.length > 0 &&
        !apiKey.user.allowedModels.includes(model))
    ) {
      continue;
    }
    const tierId = apiKey.tierId ?? apiKey.user.tierId;
    if (!tierId) {
      continue;
    }
    const modelPool = await prisma.modelPool.findFirst({
      where: {
        model,
        tierId,
        status: "ACTIVE",
        policyRecoveryEnabled: true,
        channels: {
          some: {
            status: { in: ["ACTIVE", "FORCED_ACTIVE"] },
          },
        },
      },
      select: {
        id: true,
        tierId: true,
        policyRecoveryEnabled: true,
        tier: {
          select: {
            id: true,
            code: true,
            name: true,
            walletRequired: true,
            minimumWalletBalanceUsd: true,
          },
        },
        channels: {
          where: {
            status: { in: ["ACTIVE", "FORCED_ACTIVE"] },
          },
          select: {
            upstreamProvider: true,
            status: true,
          },
        },
      },
    });
    if (
      modelPool?.tier &&
      hasSufficientWallet(
        apiKey.user.wallet,
        modelPool.tier.walletRequired,
        modelPool.tier.minimumWalletBalanceUsd,
      )
    ) {
      return { apiKey, modelPool };
    }
  }

  throw new Error(
    requestedApiKeyId
      ? `AUDIT_API_KEY_ID ${requestedApiKeyId} is not usable for an enabled policy-recovery model pool`
      : `No active readable API key routes ${model} through an enabled policy-recovery model pool`,
  );
}

async function findAuditApiRequest(params: {
  apiKeyId: string;
  endpoint?: string;
  requestMarker?: string;
  startedAt: Date;
}) {
  const candidates = await prisma.apiRequest.findMany({
    where: {
      apiKeyId: params.apiKeyId,
      endpoint: params.endpoint ?? "/v1/responses/compact",
      model,
      createdAt: { gte: new Date(params.startedAt.getTime() - 1000) },
    },
    select: {
      id: true,
      traceCode: true,
      status: true,
      httpStatus: true,
      accessTierId: true,
      upstreamProvider: true,
      requestBody: true,
      responseUsage: true,
      policyRecoveryAudit: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const match = candidates.find((candidate) =>
    JSON.stringify(candidate.requestBody).includes(
      params.requestMarker ?? marker,
    ),
  );
  assert.ok(match, "gateway compact request record was not persisted");
  return match;
}

function readInputItemTypes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const input = (value as Record<string, unknown>).input;
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return typeof item;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.type === "string") {
      return record.type;
    }
    if (typeof record.role === "string") {
      return record.role;
    }
    return "object";
  });
}

function parseJsonBody(response: Response, text: string) {
  const contentType = response.headers.get("content-type") ?? "";
  assert.match(contentType, /application\/json/iu);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `gateway compact returned invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
    );
  }
}

function assertLoopbackResponseLength(response: Response, text: string) {
  const hostname = new URL(gatewayBaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
    return;
  }
  assert.equal(response.headers.get("content-encoding"), null);
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    assert.equal(Number(contentLength), Buffer.byteLength(text, "utf8"));
  }
}

function asRecord(value: unknown) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function hasSufficientWallet(
  wallet: { balance: Decimal; reservedBalance: Decimal } | null,
  walletRequired: boolean,
  minimumWalletBalanceUsd: Decimal | null,
) {
  if (!walletRequired) {
    return true;
  }
  if (!wallet) {
    return false;
  }
  const available = new Decimal(wallet.balance).minus(wallet.reservedBalance);
  return available.greaterThanOrEqualTo(minimumWalletBalanceUsd ?? 0);
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/u, "");
}

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
