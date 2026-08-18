import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("vendor/security-research/current");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const remote = process.argv.includes("--remote");
const concurrency = 8;
const failures = [];

await runWithConcurrency(manifest.files, concurrency, async (entry) => {
  const bytes = await readFile(resolve(root, entry.path));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== entry.sha256 || bytes.length !== entry.bytes) {
    failures.push({ path: entry.path, kind: "local", expected: entry, actual: { bytes: bytes.length, sha256: actual } });
    return;
  }
  if (!remote) return;
  const response = await fetch(`${manifest.sourceRoot}/${entry.path}`);
  if (!response.ok) {
    failures.push({ path: entry.path, kind: "remote-status", status: response.status });
    return;
  }
  const remoteBytes = Buffer.from(await response.arrayBuffer());
  const remoteHash = createHash("sha256").update(remoteBytes).digest("hex");
  if (remoteBytes.length !== entry.bytes || remoteHash !== entry.sha256) {
    failures.push({
      path: entry.path,
      kind: "remote-content",
      expected: entry,
      actual: { bytes: remoteBytes.length, sha256: remoteHash },
    });
  }
});

const result = {
  sourceRoot: manifest.sourceRoot,
  remoteChecked: remote,
  fileCount: manifest.files.length,
  aliases: manifest.aliases?.length ?? 0,
  unresolvedReferences: manifest.missing?.length ?? 0,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exitCode = 1;

async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        try {
          await worker(item);
        } catch (error) {
          failures.push({ path: item.path, kind: "exception", message: String(error) });
        }
      }
    }),
  );
}
