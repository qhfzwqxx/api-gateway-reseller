import assert from "node:assert/strict";
import {
  normalizeCodexCompactionOutput,
  normalizeCodexCompactionSseText,
  normalizeCompactItemForTarget,
} from "../apps/api/src/services/compact-request-utils.ts";

const encryptedContent = "opaque-encrypted-content-fixture";
const itemId = "cmp_original_upstream_item_id";
const upstreamItem = {
  id: itemId,
  type: "compaction_summary",
  encrypted_content: encryptedContent,
  summary: [{ type: "summary_text", text: "Compacted conversation" }],
};

const normalized = normalizeCodexCompactionOutput({ output: [upstreamItem] });
assert.equal(normalized.replacements, 1);
assert.deepEqual(normalized.value.output[0], {
  ...upstreamItem,
  type: "compaction",
});

const responsesApiItem = normalizeCompactItemForTarget(
  JSON.parse(JSON.stringify(normalized.value.output[0])),
  "compaction_summary",
);
assert.deepEqual(responsesApiItem, upstreamItem);

const alternateItem = normalizeCompactItemForTarget(
  JSON.parse(JSON.stringify(upstreamItem)),
  "compaction",
);
assert.deepEqual(alternateItem, { ...upstreamItem, type: "compaction" });

const idlessItem = normalizeCompactItemForTarget(
  { type: "compaction", encrypted_content: encryptedContent },
  "compaction_summary",
);
assert.deepEqual(idlessItem, {
  type: "compaction_summary",
  encrypted_content: encryptedContent,
});

const sse = [
  "event: response.output_item.done",
  `data: ${JSON.stringify({ type: "response.output_item.done", item: upstreamItem })}`,
  "",
  "",
].join("\n");
const normalizedSse = normalizeCodexCompactionSseText(sse);
assert.equal(normalizedSse.replacements, 1);
const event = JSON.parse(
  normalizedSse.text.match(/^data: (.+)$/m)?.[1] ?? "null",
) as { item?: Record<string, unknown> };
assert.equal(event.item?.id, itemId);
assert.equal(event.item?.encrypted_content, encryptedContent);

console.log("Compaction item ID/encrypted-content round-trip checks passed.");
