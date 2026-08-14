import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildUnifiedPolicyRecoveryDocument,
  createPolicyRecoverySnapshot,
  defaultPolicyRecoverySettings,
  normalizePolicyRecoverySettings,
  type PolicyRecoveryLayer,
} from "../apps/api/src/services/policy-recovery-settings.ts";
import {
  buildPolicyRecoveryBody,
  createPolicyRecoveryContext,
} from "../apps/api/src/services/policy-recovery.ts";

const sourceLayers = defaultPolicyRecoverySettings.layers.map((layer) => ({
  ...layer,
  content: `${layer.content}\n[PROFILE_FIXTURE:${layer.id}]`,
}));
const disabledLayer = sourceLayers[1];
assert.ok(disabledLayer, "expected at least two built-in layers");
const customizedLayers: PolicyRecoveryLayer[] = sourceLayers.map((layer, index) => ({
  ...layer,
  enabled: index !== 1,
}));

const unified = buildUnifiedPolicyRecoveryDocument(customizedLayers);
for (const layer of customizedLayers) {
  const exactBlock = `[POLICY_RECOVERY_LAYER:${layer.id}]\n${layer.content.trim()}\n[/POLICY_RECOVERY_LAYER:${layer.id}]`;
  assert.ok(unified.includes(`[PROFILE_FIXTURE:${layer.id}]`), `V2 omitted ${layer.id}`);
  assert.equal(countOccurrences(unified, exactBlock), 1, `V2 exact source block mismatch for ${layer.id}`);
  assert.ok(unified.includes(`v1_enabled_snapshot: ${String(layer.enabled)}`), `V2 manifest missing ${layer.id} V1 state`);
  assert.ok(unified.includes("v2_included: true"), `V2 manifest missing inclusion state for ${layer.id}`);
  assert.ok(unified.includes(`bytes: ${Buffer.byteLength(layer.content.trim(), "utf8")}`), `V2 manifest byte count mismatch for ${layer.id}`);
  assert.ok(unified.includes(`sha256: ${sha256(layer.content.trim())}`), `V2 manifest hash mismatch for ${layer.id}`);
}
assert.equal(countOccurrences(unified, "v2_included: true"), customizedLayers.length);
assert.equal(countOccurrences(unified, "[UNIFIED_POLICY_RECOVERY_DOCUMENT_V2]"), 1);
assert.equal(countOccurrences(unified, "[/UNIFIED_POLICY_RECOVERY_DOCUMENT_V2]"), 1);

const v1 = createPolicyRecoverySnapshot({
  ...defaultPolicyRecoverySettings,
  activeProfile: "layered-v1",
  layers: customizedLayers,
  unifiedDocument: unified,
});
const v2 = createPolicyRecoverySnapshot({
  ...defaultPolicyRecoverySettings,
  activeProfile: "unified-v2",
  layers: customizedLayers,
  unifiedDocument: unified,
});
assert.equal(v1.activeProfileName, "V1 多文件分层版");
assert.equal(v2.activeProfileName, "V2 统一完整文档版");
assert.ok(!v1.baseInstructions.includes(`[PROFILE_FIXTURE:${disabledLayer.id}]`), "V1 injected disabled layer");
assert.ok(v2.baseInstructions.includes(`[PROFILE_FIXTURE:${disabledLayer.id}]`), "V2 omitted disabled source layer");
assert.equal(v2.baseInstructions, unified);

const legacy = normalizePolicyRecoverySettings({
  masterEnabled: true,
  layers: customizedLayers,
  retryInstructionsTemplate: defaultPolicyRecoverySettings.retryInstructionsTemplate,
  maxRecoveries: 3,
  sseProbeBytes: 262144,
  maxInspectableResponseBytes: 67108864,
  version: 9,
});
assert.equal(legacy.activeProfile, "layered-v1", "legacy settings must remain V1");
assert.ok(legacy.unifiedDocument.includes(`[PROFILE_FIXTURE:${disabledLayer.id}]`), "legacy migration lost V2 source");

const v1Context = createPolicyRecoveryContext({ model: "fixture", input: "hello" }, v1);
const v2Context = createPolicyRecoveryContext({ model: "fixture", input: "hello" }, v2);
assert.equal(v1Context.audit.profileId, "layered-v1");
assert.equal(v2Context.audit.profileId, "unified-v2");
assert.equal(v1Context.audit.profileName, v1.activeProfileName);
assert.equal(v2Context.audit.profileName, v2.activeProfileName);
assert.equal(v1Context.audit.mergedSha256, v1.mergedSha256);
assert.equal(v2Context.audit.mergedSha256, v2.mergedSha256);

for (const profile of [v1, v2]) {
  const context = createPolicyRecoveryContext({
    model: "fixture",
    input: "hello",
    instructions: "CALLER_ORIGINAL_INSTRUCTIONS",
  }, profile);
  const responsesBody = buildPolicyRecoveryBody({
    context,
    endpoint: "/v1/responses",
    recoveryAttempt: 0,
    provider: "fixture",
    model: "fixture",
  });
  assert.equal(
    responsesBody.instructions,
    `${profile.baseInstructions}\n\n[调用方原始 instructions]\nCALLER_ORIGINAL_INSTRUCTIONS`,
  );
  assert.equal(countOccurrences(String(responsesBody.instructions), profile.baseInstructions), 1);

  const compactContext = createPolicyRecoveryContext({
    model: "fixture",
    input: "hello",
    instructions: ["CALLER_ARRAY_INSTRUCTIONS"],
  }, profile);
  const compactBody = buildPolicyRecoveryBody({
    context: compactContext,
    endpoint: "/v1/responses/compact",
    recoveryAttempt: 0,
    provider: "fixture",
    model: "fixture",
  });
  assert.deepEqual(compactBody.instructions, [profile.baseInstructions, "CALLER_ARRAY_INSTRUCTIONS"]);

  const chatContext = createPolicyRecoveryContext({
    model: "fixture",
    messages: [{ role: "user", content: "hello" }],
  }, profile);
  const chatBody = buildPolicyRecoveryBody({
    context: chatContext,
    endpoint: "/v1/chat/completions",
    recoveryAttempt: 0,
    provider: "fixture",
    model: "fixture",
  });
  assert.equal(chatBody.messages?.[0]?.role, "developer");
  assert.equal(chatBody.messages?.[0]?.content, profile.baseInstructions);
  assert.deepEqual(chatBody.messages?.slice(1), [{ role: "user", content: "hello" }]);

  const retryOne = buildPolicyRecoveryBody({
    context,
    endpoint: "/v1/responses",
    recoveryAttempt: 1,
    signal: { source: "json", code: "fixture", summary: "FIRST_SIGNAL" },
    provider: "fixture-provider",
    model: "fixture-model",
  });
  const retryTwo = buildPolicyRecoveryBody({
    context,
    endpoint: "/v1/responses",
    recoveryAttempt: 2,
    signal: { source: "json", code: "fixture", summary: "SECOND_SIGNAL" },
    provider: "fixture-provider",
    model: "fixture-model",
  });
  assert.equal(countOccurrences(String(retryOne.instructions), profile.baseInstructions), 1);
  assert.equal(countOccurrences(String(retryTwo.instructions), profile.baseInstructions), 1);
  assert.ok(String(retryOne.instructions).startsWith("[GPT56_POLICY_RETRY_V2]"));
  assert.ok(String(retryTwo.instructions).startsWith("[GPT56_POLICY_RETRY_V2]"));
  assert.ok(String(retryOne.instructions).includes("[重试前 instructions 原文]"));
  assert.ok(String(retryTwo.instructions).includes("[重试前 instructions 原文]"));
  assert.ok(String(retryOne.instructions).includes("第 1 次自动恢复"));
  assert.ok(String(retryTwo.instructions).includes("第 2 次自动恢复"));
  assert.ok(!String(retryTwo.instructions).includes("第 1 次自动恢复"));
  assert.ok(!String(retryTwo.instructions).includes("上游：fixture-provider"));
  assert.ok(!String(retryTwo.instructions).includes("SECOND_SIGNAL"));
  assert.equal(countOccurrences(String(retryTwo.instructions), "CALLER_ORIGINAL_INSTRUCTIONS"), 1);

  const compactRetry = buildPolicyRecoveryBody({
    context: compactContext,
    endpoint: "/v1/responses/compact",
    recoveryAttempt: 1,
    signal: { source: "sse", code: "fixture", summary: "COMPACT_SIGNAL" },
    provider: "fixture-provider",
    model: "fixture-model",
  });
  assert.ok(Array.isArray(compactRetry.instructions));
  assert.ok(String(compactRetry.instructions[0]).startsWith("[GPT56_POLICY_RETRY_V2]"));
  assert.equal(compactRetry.instructions[1], profile.baseInstructions);
  assert.equal(compactRetry.instructions[2], "CALLER_ARRAY_INSTRUCTIONS");

  const chatRetry = buildPolicyRecoveryBody({
    context: chatContext,
    endpoint: "/v1/chat/completions",
    recoveryAttempt: 1,
    signal: { source: "sse", code: "fixture", summary: "CHAT_SIGNAL" },
    provider: "fixture-provider",
    model: "fixture-model",
  });
  assert.equal(chatRetry.messages?.[0]?.role, "developer");
  assert.ok(String(chatRetry.messages?.[0]?.content).startsWith("[GPT56_POLICY_RETRY_V2]"));
  assert.equal(chatRetry.messages?.[1]?.role, "developer");
  assert.equal(chatRetry.messages?.[1]?.content, profile.baseInstructions);
  assert.deepEqual(chatRetry.messages?.slice(2), [{ role: "user", content: "hello" }]);
}

const v1Body = buildPolicyRecoveryBody({ context: v1Context, endpoint: "/v1/responses", recoveryAttempt: 0, provider: "fixture", model: "fixture" });
const v2Body = buildPolicyRecoveryBody({ context: v2Context, endpoint: "/v1/responses", recoveryAttempt: 0, provider: "fixture", model: "fixture" });
assert.equal(v1Body.instructions, v1.baseInstructions);
assert.equal(v2Body.instructions, v2.baseInstructions);
assert.notEqual(v1Body.instructions, v2Body.instructions);
assert.ok(!String(v1Body.instructions).includes("[UNIFIED_POLICY_RECOVERY_DOCUMENT_V2]"));
assert.ok(String(v2Body.instructions).includes("[UNIFIED_POLICY_RECOVERY_DOCUMENT_V2]"));

console.log(JSON.stringify({
  ok: true,
  layerCount: customizedLayers.length,
  v1Bytes: v1.mergedBytes,
  v2Bytes: v2.mergedBytes,
  v1Sha256: v1.mergedSha256,
  v2Sha256: v2.mergedSha256,
  legacyProfile: legacy.activeProfile,
  disabledLayerIncludedInV2: v2.baseInstructions.includes(`[PROFILE_FIXTURE:${disabledLayer.id}]`),
}, null, 2));

function countOccurrences(value: string, needle: string) {
  if (!needle) return 0;
  return value.split(needle).length - 1;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
