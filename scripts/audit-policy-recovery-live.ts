import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma } from "@gateway/db";
import {
  buildUnifiedPolicyRecoveryDocument,
  normalizePolicyRecoverySettings,
} from "../apps/api/src/services/policy-recovery-settings.ts";

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "policy_recovery_settings" },
  });
  assert.ok(setting, "policy recovery settings are not persisted");

  const stored = parseStoredSettings(setting.value);
  const normalized = normalizePolicyRecoverySettings(stored);
  const canonicalDocument = buildUnifiedPolicyRecoveryDocument(
    normalized.layers,
  );
  const storedDocument = typeof stored.unifiedDocument === "string"
    ? stored.unifiedDocument
    : "";

  assert.equal(
    storedDocument,
    canonicalDocument,
    "persisted V2 document differs from the canonical V1 source rebuild",
  );
  assert.equal(normalized.unifiedDocument, canonicalDocument);

  let previousBlockEnd = -1;
  const layers = normalized.layers.map((layer) => {
    const sourceText = layer.content.trim();
    const exactBlock = [
      `[POLICY_RECOVERY_LAYER:${layer.id}]`,
      sourceText,
      `[/POLICY_RECOVERY_LAYER:${layer.id}]`,
    ].join("\n");
    const blockStart = storedDocument.indexOf(exactBlock);
    assert.ok(blockStart >= 0, `persisted V2 omitted ${layer.id}`);
    assert.ok(
      blockStart > previousBlockEnd,
      `persisted V2 changed source order at ${layer.id}`,
    );
    assert.equal(
      countOccurrences(storedDocument, exactBlock),
      1,
      `persisted V2 duplicated or rewrote ${layer.id}`,
    );
    const extractedSource = extractUnifiedLayer(storedDocument, layer.id);
    assert.equal(
      extractedSource,
      sourceText,
      `persisted V2 altered source text for ${layer.id}`,
    );
    assert.equal(
      Buffer.byteLength(extractedSource, "utf8"),
      Buffer.byteLength(sourceText, "utf8"),
    );
    assert.equal(sha256(extractedSource), sha256(sourceText));
    previousBlockEnd = blockStart + exactBlock.length;
    return {
      id: layer.id,
      enabledInV1: layer.enabled,
      bytes: Buffer.byteLength(sourceText, "utf8"),
      sha256: sha256(sourceText),
    };
  });

  console.log(JSON.stringify({
    ok: true,
    masterEnabled: normalized.masterEnabled,
    activeProfile: normalized.activeProfile,
    version: normalized.version,
    layerCount: layers.length,
    unifiedBytes: Buffer.byteLength(storedDocument, "utf8"),
    unifiedSha256: sha256(storedDocument),
    canonicalMatch: true,
    layers,
  }, null, 2));
}

function parseStoredSettings(value: string) {
  const parsed: unknown = JSON.parse(value);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  return parsed as Record<string, unknown>;
}

function extractUnifiedLayer(document: string, layerId: string) {
  const begin = `[POLICY_RECOVERY_LAYER:${layerId}]\n`;
  const end = `\n[/POLICY_RECOVERY_LAYER:${layerId}]`;
  const beginIndex = document.indexOf(begin);
  assert.ok(beginIndex >= 0, `missing start marker for ${layerId}`);
  const contentStart = beginIndex + begin.length;
  const endIndex = document.indexOf(end, contentStart);
  assert.ok(endIndex >= 0, `missing end marker for ${layerId}`);
  assert.equal(document.indexOf(begin, contentStart), -1);
  assert.equal(document.indexOf(end, endIndex + end.length), -1);
  return document.slice(contentStart, endIndex);
}

function countOccurrences(value: string, needle: string) {
  return needle ? value.split(needle).length - 1 : 0;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
