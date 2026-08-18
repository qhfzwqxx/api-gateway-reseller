import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";

const remoteRoot = "https://moxinggang.com/skills/security-research/current";
const outputRoot = resolve("vendor/security-research/current");
const seeds = [
  "RULES.md",
  "README_AI.md",
  "SKILL.md",
  "LICENSE",
  "NOTICE.md",
  "CHANGELOG.md",
  "ctf-orchestrator/LICENSE",
  "agents/openai.yaml",
  "references/source-provenance.md",
  "references/routing.md",
  "references/evidence-workflow.md",
  "references/scope-and-evidence.md",
  "references/reporting.md",
  "references/experience-index.md",
  "scripts/env_probe.py",
  "scripts/reusable/artifact_inventory.py",
  "scripts/reusable/route_task.py",
  "scripts/validate_result.py",
  "schemas/research-result.schema.json",
  "assets/templates/ctf-writeup.md",
  "assets/templates/research-result.json",
];
const allowedRoots = new Set([
  "references",
  "skills",
  "scripts",
  "assets",
  "schemas",
  "ctf-orchestrator",
]);
const referencePattern = /(?:REMOTE_ROOT\/)?((?:references|skills|scripts|assets|schemas|ctf-orchestrator)\/[A-Za-z0-9_./-]+\.(?:md|py|ps1|json|ya?ml|txt|ts|js|mjs|cjs))/gu;
const relativePattern = /`((?:\.\.\/)+(?:references|skills|scripts|assets|schemas|ctf-orchestrator)\/[A-Za-z0-9_./-]+\.(?:md|py|ps1|json|ya?ml|txt|ts|js|mjs|cjs))`/gu;
const localPathPattern = /`((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:md|py|ps1|json|ya?ml|txt|ts|js|mjs|cjs))`/gu;
const competitionSkillPattern = /\$(competition-[a-z0-9-]+)/gu;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const queue = [...seeds];
const queued = new Set(queue);
const downloaded = [];
const missing = [];

while (queue.length > 0) {
  const path = queue.shift();
  const response = await fetch(`${remoteRoot}/${path}`);
  if (!response.ok) {
    missing.push({ path, status: response.status });
    continue;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const destination = join(outputRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  downloaded.push({
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });

  if (!isTextPath(path)) continue;
  const text = bytes.toString("utf8");
  for (const candidate of extractReferences(path, text)) {
    if (queued.has(candidate)) continue;
    queued.add(candidate);
    queue.push(candidate);
  }
}

downloaded.sort((left, right) => left.path.localeCompare(right.path));
missing.sort((left, right) => left.path.localeCompare(right.path));
const downloadedPaths = new Set(downloaded.map((entry) => entry.path));
const aliases = missing.filter((entry) => hasDownloadedAlias(entry.path, downloadedPaths));
const unresolved = missing.filter((entry) => !hasDownloadedAlias(entry.path, downloadedPaths));
const manifest = {
  sourceRoot: remoteRoot,
  syncedAt: new Date().toISOString(),
  fileCount: downloaded.length,
  totalBytes: downloaded.reduce((sum, item) => sum + item.bytes, 0),
  files: downloaded,
  aliases,
  missing: unresolved,
};
await writeFile(
  join(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

const license = await readFile(join(outputRoot, "LICENSE"), "utf8").catch(() => "");
if (!license.trim()) throw new Error("Remote skill mirror is missing LICENSE");

console.log(
  `Mirrored ${manifest.fileCount} files (${manifest.totalBytes} bytes) from ${remoteRoot}`,
);
if (unresolved.length > 0) {
  console.log(`Skipped ${unresolved.length} unresolved references; see manifest.json`);
}

function extractReferences(currentPath, text) {
  const candidates = new Set();
  for (const match of text.matchAll(referencePattern)) {
    addCandidate(candidates, match[1]);
    if (currentPath.includes("/")) {
      addCandidate(candidates, join(dirname(currentPath), match[1]));
    }
  }
  for (const match of text.matchAll(relativePattern)) {
    const relative = normalize(join(dirname(currentPath), match[1])).replaceAll("\\", "/");
    addCandidate(candidates, relative);
    addCandidate(candidates, match[1].replace(/^(?:\.\.\/)+/u, ""));
  }
  for (const match of text.matchAll(localPathPattern)) {
    addCandidate(candidates, join(dirname(currentPath), match[1]));
  }
  for (const match of text.matchAll(competitionSkillPattern)) {
    addCandidate(candidates, `ctf-orchestrator/${match[1]}/INSTRUCTIONS.md`);
  }
  return candidates;
}

function addCandidate(candidates, value) {
  const path = normalize(value).replaceAll("\\", "/").replace(/^\.\//u, "");
  if (path.includes("..") || !allowedRoots.has(path.split("/", 1)[0])) return;
  candidates.add(path);
}

function isTextPath(path) {
  return /\.(?:md|py|ps1|json|ya?ml|txt|ts|js|mjs|cjs)$/iu.test(path) || path === "LICENSE";
}

function hasDownloadedAlias(path, downloadedPaths) {
  const suffix = path.replace(/^references\//u, "/references/");
  const basename = path.split("/").at(-1);
  return [...downloadedPaths].some((candidate) =>
    candidate.endsWith(suffix) || candidate.endsWith(`/${basename}`),
  );
}
