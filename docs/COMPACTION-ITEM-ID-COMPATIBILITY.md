# Compaction Item ID Compatibility

Encrypted compaction content is opaque and must stay paired with its original item ID. The gateway now preserves the upstream ID when it normalizes `compaction_summary` to `compaction`, and preserves it when adapting an item to the configured upstream compact item type. It no longer derives a replacement `cmp_...` ID from the encrypted-content hash.

Items that arrive without an ID remain without one; the gateway does not invent an ID that may not match the encrypted payload. `encrypted_content` is passed through unchanged.

Run `npm run audit:compact-item-id` to verify response, SSE, and target-format round trips without a database or upstream credentials.

This source change is not live until deployed through the protected release flow. Commit the changes before running `bash deploy.sh --update --backup`.
