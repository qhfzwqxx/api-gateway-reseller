import { createHash, randomUUID } from "node:crypto";
import { redis } from "../lib/redis.js";

export type CompactCacheEntry = {
  id: string;
  requestBody: unknown;
  userId: string;
  apiKeyId: string;
  model?: string;
  sourceFingerprint: string;
  encryptedContentHashes: string[];
  createdAt: string;
};

export type CompactRouteFingerprintInput = {
  channelId?: string;
  upstreamProviderKeyId?: string | null;
  providerId: string;
  providerName: string;
  providerApiKey?: string;
};

const compactCacheTtlSeconds = 24 * 60 * 60;
const maxCompactRequestBodyBytes = 5 * 1024 * 1024;
const maxCompactExpansionDepth = 16;
const encryptedIndexPrefix = "gateway:compact:encrypted:";
const cachePrefix = "gateway:compact:cache:";
const targetPrefix = "gateway:compact:target:";

type EncryptedContentIndexEntry = {
  compactCacheId: string;
  fingerprint?: string;
};

export function createCompactRouteFingerprint(
  input: CompactRouteFingerprintInput,
) {
  const keyFingerprint = input.upstreamProviderKeyId
    ? `key:${input.upstreamProviderKeyId}`
    : `provider:${input.providerId}:${input.providerName}:env:${shortHash(input.providerApiKey ?? "")}`;

  return input.channelId
    ? `channel:${input.channelId}:${keyFingerprint}`
    : keyFingerprint;
}

export function createCompactChannelFingerprint(
  input: CompactRouteFingerprintInput,
) {
  return input.channelId
    ? `channel:${input.channelId}`
    : `provider:${input.providerId}:${input.providerName}`;
}

export function hashEncryptedContent(encryptedContent: string) {
  return sha256(encryptedContent);
}

export function collectEncryptedContents(value: unknown) {
  const contents: string[] = [];
  visitJson(value, (record) => {
    const encryptedContent = record.encrypted_content;
    if (typeof encryptedContent === "string" && encryptedContent) {
      contents.push(encryptedContent);
    }
  });
  return [...new Set(contents)];
}

export function isCompactionTriggerRequestBody(value: unknown) {
  return (
    isPlainRecord(value) &&
    Array.isArray(value.input) &&
    value.input.some(
      (item) => isPlainRecord(item) && item.type === "compaction_trigger",
    )
  );
}

export function extractCompactionItems(value: unknown) {
  const items: Array<{ encryptedContent: string; item: unknown }> = [];
  const seenHashes = new Set<string>();

  visitJson(value, (record) => {
    const encryptedContent = record.encrypted_content;
    if (
      !isCompactionItem(record) ||
      typeof encryptedContent !== "string" ||
      !encryptedContent
    ) {
      return;
    }

    const hash = hashEncryptedContent(encryptedContent);
    if (seenHashes.has(hash)) {
      return;
    }
    seenHashes.add(hash);
    items.push({
      encryptedContent,
      item: cloneJson(record),
    });
  });

  return items;
}

export function extractCompactionSummaryItem(value: unknown) {
  let fallback: string | null = null;
  let fallbackItem: unknown = null;
  let summaryEncryptedContent: string | null = null;
  let summaryItem: unknown = null;

  visitJson(value, (record) => {
    const encryptedContent = record.encrypted_content;
    if (typeof encryptedContent !== "string" || !encryptedContent) {
      return;
    }

    if (fallback === null) {
      fallback = encryptedContent;
      fallbackItem = record;
    }
    if (
      summaryEncryptedContent === null &&
      (record.type === "compaction_summary" ||
        record.type === "response.compaction_summary" ||
        record.type === "compaction" ||
        record.object === "compaction_summary")
    ) {
      summaryEncryptedContent = encryptedContent;
      summaryItem = record;
    }
  });

  const encryptedContent = summaryEncryptedContent ?? fallback;
  if (!encryptedContent) {
    return null;
  }

  return {
    encryptedContent,
    item: cloneJson(summaryItem ?? fallbackItem),
  };
}

export function extractEncryptedItems(value: unknown) {
  const items: Array<{ encryptedContent: string; item: unknown }> = [];

  visitJson(value, (record) => {
    const encryptedContent = record.encrypted_content;
    if (typeof encryptedContent === "string" && encryptedContent) {
      items.push({
        encryptedContent,
        item: cloneJson(record),
      });
    }
  });

  return items;
}

export function removeMalformedEncryptedInputItems<T>(value: T) {
  if (!isPlainRecord(value) || !Array.isArray(value.input)) {
    return { value, removed: 0 };
  }

  let removed = 0;
  const input = value.input.filter((item) => {
    if (!isPlainRecord(item) || !requiresEncryptedContent(item)) {
      return true;
    }

    if (
      typeof item.encrypted_content === "string" &&
      item.encrypted_content.length > 0
    ) {
      return true;
    }

    removed += 1;
    return false;
  });

  if (removed === 0) {
    return { value, removed };
  }

  return {
    value: { ...value, input } as T,
    removed,
  };
}

export function removeReasoningInputItems<T>(value: T) {
  if (!isPlainRecord(value) || !Array.isArray(value.input)) {
    return { value, removed: 0 };
  }

  let removed = 0;
  const input = value.input.filter((item) => {
    if (!isPlainRecord(item) || item.type !== "reasoning") {
      return true;
    }

    removed += 1;
    return false;
  });

  if (removed === 0) {
    return { value, removed };
  }

  return {
    value: { ...value, input } as T,
    removed,
  };
}

export function normalizeCrossChannelResponsesInput<T>(value: T) {
  if (!isPlainRecord(value) || !Array.isArray(value.input)) {
    return { value, removed: 0, normalizedReasoningItems: 0 };
  }

  let removed = 0;
  let normalizedReasoningItems = 0;
  const input: unknown[] = [];

  for (const item of value.input) {
    if (!isPlainRecord(item)) {
      input.push(item);
      continue;
    }

    if (requiresEncryptedContent(item)) {
      const encryptedContent = item.encrypted_content;
      if (typeof encryptedContent !== "string" || !encryptedContent) {
        removed += 1;
        continue;
      }
    }

    if (item.type !== "reasoning") {
      input.push(item);
      continue;
    }

    const normalized = { ...item };
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(normalized, "id")) {
      delete normalized.id;
      changed = true;
    }
    if (!Array.isArray(normalized.summary)) {
      normalized.summary = [];
      changed = true;
    }
    if (normalized.content === null) {
      delete normalized.content;
      changed = true;
    }
    if (changed) {
      normalizedReasoningItems += 1;
    }
    input.push(normalized);
  }

  if (removed === 0 && normalizedReasoningItems === 0) {
    return { value, removed, normalizedReasoningItems };
  }

  return {
    value: { ...value, input } as T,
    removed,
    normalizedReasoningItems,
  };
}

export async function saveCompactCache(params: {
  requestBody: unknown;
  responseBody: unknown;
  userId: string;
  apiKeyId: string;
  model?: string;
  sourceFingerprint: string;
}) {
  const expandedRequestBody = await expandCachedCompactionItemsForBody({
    value: params.requestBody,
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    model: params.model,
  });
  const requestBodyJson = JSON.stringify(expandedRequestBody.value);
  if (Buffer.byteLength(requestBodyJson, "utf8") > maxCompactRequestBodyBytes) {
    return { saved: false as const, reason: "request_body_too_large" };
  }

  const compactItems = extractCompactionItems(params.responseBody);
  if (compactItems.length === 0) {
    return { saved: false as const, reason: "no_encrypted_content" };
  }

  const encryptedContents = compactItems.map((item) => item.encryptedContent);
  const encryptedContentHashes = encryptedContents.map(hashEncryptedContent);
  const compactCacheId = randomUUID();
  const entry: CompactCacheEntry = {
    id: compactCacheId,
    requestBody: expandedRequestBody.value,
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    model: params.model,
    sourceFingerprint: params.sourceFingerprint,
    encryptedContentHashes,
    createdAt: new Date().toISOString(),
  };

  const operations = redis.multi();
  operations.set(
    cacheKey(compactCacheId),
    JSON.stringify(entry),
    "EX",
    compactCacheTtlSeconds,
  );
  for (const hash of encryptedContentHashes) {
    operations.set(
      encryptedIndexKey(hash),
      serializeEncryptedContentIndex({
        compactCacheId,
        fingerprint: params.sourceFingerprint,
      }),
      "EX",
      compactCacheTtlSeconds,
    );
  }
  await operations.exec();

  return {
    saved: true as const,
    compactCacheId,
    encryptedContentHashes,
    expandedCompactions: expandedRequestBody.replacements,
    unresolvedCompactions: expandedRequestBody.unresolved,
  };
}

export async function expandCachedCompactionItemsForBody<T>(params: {
  value: T;
  userId: string;
  apiKeyId: string;
  model?: string;
}) {
  return expandCachedCompactionItemsForBodyInternal(
    params.value,
    {
      userId: params.userId,
      apiKeyId: params.apiKeyId,
      model: params.model,
    },
    new Set<string>(),
    0,
  );
}

async function expandCachedCompactionItemsForBodyInternal<T>(
  value: T,
  ownership: { userId: string; apiKeyId: string; model?: string },
  visitedCacheIds: Set<string>,
  depth: number,
): Promise<{ value: T; replacements: number; unresolved: number }> {
  if (
    depth > maxCompactExpansionDepth ||
    !isPlainRecord(value) ||
    !Array.isArray(value.input)
  ) {
    return {
      value,
      replacements: 0,
      unresolved: depth > maxCompactExpansionDepth ? 1 : 0,
    };
  }

  const compactItems = value.input.filter(
    (item) =>
      isPlainRecord(item) &&
      isCompactionItem(item) &&
      typeof item.encrypted_content === "string" &&
      item.encrypted_content,
  );
  if (compactItems.length === 0) {
    return { value, replacements: 0, unresolved: 0 };
  }

  const matches = await findCachedCompactsForBody({ input: compactItems });
  const matchesByHash = new Map<string, (typeof matches)[number]>();
  for (const match of matches) {
    for (const hash of match.matchedEncryptedContentHashes) {
      matchesByHash.set(hash, match);
    }
  }

  let replacements = 0;
  let unresolved = 0;
  const input: unknown[] = [];

  for (const item of value.input) {
    if (
      !isPlainRecord(item) ||
      !isCompactionItem(item) ||
      typeof item.encrypted_content !== "string" ||
      !item.encrypted_content
    ) {
      input.push(item);
      continue;
    }

    const match = matchesByHash.get(
      hashEncryptedContent(item.encrypted_content),
    );
    if (
      !match ||
      match.cache.userId !== ownership.userId ||
      match.cache.apiKeyId !== ownership.apiKeyId ||
      (ownership.model !== undefined &&
        match.cache.model !== undefined &&
        match.cache.model !== ownership.model) ||
      visitedCacheIds.has(match.compactCacheId)
    ) {
      unresolved += 1;
      input.push(item);
      continue;
    }

    visitedCacheIds.add(match.compactCacheId);
    const expanded = await expandCachedCompactionItemsForBodyInternal(
      match.cache.requestBody,
      ownership,
      visitedCacheIds,
      depth + 1,
    );
    visitedCacheIds.delete(match.compactCacheId);

    if (
      !isPlainRecord(expanded.value) ||
      !Array.isArray(expanded.value.input)
    ) {
      unresolved += 1;
      input.push(item);
      continue;
    }

    input.push(
      ...expanded.value.input.filter(
        (nestedItem) =>
          !isPlainRecord(nestedItem) ||
          nestedItem.type !== "compaction_trigger",
      ),
    );
    replacements += 1 + expanded.replacements;
    unresolved += expanded.unresolved;
  }

  if (replacements === 0) {
    return { value, replacements, unresolved };
  }

  return {
    value: { ...value, input } as T,
    replacements,
    unresolved,
  };
}

export async function findCachedCompactForBody(value: unknown) {
  const matches = await findCachedCompactsForBody(value);
  return matches[0] ?? null;
}

export async function findCachedCompactsForBody(value: unknown) {
  const encryptedContents = extractCompactionItems(value).map(
    (item) => item.encryptedContent,
  );
  if (encryptedContents.length === 0) {
    return [];
  }

  const candidates = encryptedContents.map((encryptedContent) => ({
    encryptedContent,
    hash: hashEncryptedContent(encryptedContent),
  }));
  const encryptedIndexes = await redis.mget(
    ...candidates.map((candidate) => encryptedIndexKey(candidate.hash)),
  );

  const matches: Array<{
    encryptedContent: string;
    encryptedContentHash: string;
    matchedEncryptedContentHashes: string[];
    compactCacheId: string;
    matchedFingerprint: string;
    cache: CompactCacheEntry;
  }> = [];
  const seenCacheIds = new Set<string>();

  for (let index = 0; index < candidates.length; index += 1) {
    const encryptedIndex = parseEncryptedContentIndex(encryptedIndexes[index]);
    const candidate = candidates[index];
    if (!encryptedIndex || !candidate) {
      continue;
    }

    const entry = await readCompactCache(encryptedIndex.compactCacheId);
    if (!entry) {
      continue;
    }

    const existingMatch = matches.find(
      (match) => match.compactCacheId === encryptedIndex.compactCacheId,
    );
    if (existingMatch) {
      existingMatch.matchedEncryptedContentHashes.push(candidate.hash);
      continue;
    }
    seenCacheIds.add(encryptedIndex.compactCacheId);

    matches.push({
      encryptedContent: candidate.encryptedContent,
      encryptedContentHash: candidate.hash,
      matchedEncryptedContentHashes: [candidate.hash],
      compactCacheId: encryptedIndex.compactCacheId,
      matchedFingerprint: encryptedIndex.fingerprint ?? entry.sourceFingerprint,
      cache: entry,
    });
  }

  return matches;
}

export async function readTargetCompactItems(params: {
  compactCacheId: string;
  targetFingerprint: string;
}) {
  const raw = await redis.get(
    targetKey(params.compactCacheId, params.targetFingerprint),
  );
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveTargetCompactItems(params: {
  compactCacheId: string;
  targetFingerprint: string;
  targetItems: Array<{ encryptedContent: string; item: unknown }>;
}) {
  const operations = redis.multi();
  operations.set(
    targetKey(params.compactCacheId, params.targetFingerprint),
    JSON.stringify(params.targetItems),
    "EX",
    compactCacheTtlSeconds,
  );
  for (const targetItem of params.targetItems) {
    operations.set(
      encryptedIndexKey(hashEncryptedContent(targetItem.encryptedContent)),
      serializeEncryptedContentIndex({
        compactCacheId: params.compactCacheId,
        fingerprint: params.targetFingerprint,
      }),
      "EX",
      compactCacheTtlSeconds,
    );
  }
  await operations.exec();
}

export function replaceCompactionItemByEncryptedContentHash<T>(
  value: T,
  encryptedContentHash: string,
  nextCompactionItem: unknown,
) {
  const replace = (
    current: unknown,
  ): { value: unknown; replacements: number } => {
    if (Array.isArray(current)) {
      let replacements = 0;
      const nextItems = current.map((item) => {
        const replaced = replace(item);
        replacements += replaced.replacements;
        return replaced.value;
      });
      return { value: replacements > 0 ? nextItems : current, replacements };
    }

    if (!isPlainRecord(current)) {
      return { value: current, replacements: 0 };
    }

    const encryptedContent = current.encrypted_content;
    if (
      typeof encryptedContent === "string" &&
      hashEncryptedContent(encryptedContent) === encryptedContentHash
    ) {
      return { value: cloneJson(nextCompactionItem), replacements: 1 };
    }

    let replacements = 0;
    const nextRecord: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) {
      const replaced = replace(item);
      replacements += replaced.replacements;
      nextRecord[key] = replaced.value;
    }

    return { value: replacements > 0 ? nextRecord : current, replacements };
  };

  const replaced = replace(value);
  return {
    value: replaced.value as T,
    replacements: replaced.replacements,
  };
}

export function replaceCompactionItemsByEncryptedContentHashes<T>(
  value: T,
  replacementsByHash: Map<string, unknown>,
) {
  const replace = (
    current: unknown,
  ): { value: unknown; replacements: number } => {
    if (Array.isArray(current)) {
      let replacements = 0;
      const nextItems = current.map((item) => {
        const replaced = replace(item);
        replacements += replaced.replacements;
        return replaced.value;
      });
      return { value: replacements > 0 ? nextItems : current, replacements };
    }

    if (!isPlainRecord(current)) {
      return { value: current, replacements: 0 };
    }

    const encryptedContent = current.encrypted_content;
    if (typeof encryptedContent === "string") {
      const nextItem = replacementsByHash.get(
        hashEncryptedContent(encryptedContent),
      );
      if (nextItem !== undefined) {
        return { value: cloneJson(nextItem), replacements: 1 };
      }
    }

    let replacements = 0;
    const nextRecord: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) {
      const replaced = replace(item);
      replacements += replaced.replacements;
      nextRecord[key] = replaced.value;
    }

    return { value: replacements > 0 ? nextRecord : current, replacements };
  };

  const replaced = replace(value);
  return {
    value: replaced.value as T,
    replacements: replaced.replacements,
  };
}

async function readCompactCache(compactCacheId: string) {
  const raw = await redis.get(cacheKey(compactCacheId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CompactCacheEntry;
    return parsed &&
      typeof parsed.id === "string" &&
      parsed.id === compactCacheId
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function encryptedIndexKey(hash: string) {
  return `${encryptedIndexPrefix}${hash}`;
}

function serializeEncryptedContentIndex(entry: EncryptedContentIndexEntry) {
  return JSON.stringify(entry);
}

function parseEncryptedContentIndex(
  value: string | null | undefined,
): EncryptedContentIndexEntry | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<EncryptedContentIndexEntry>;
    if (typeof parsed.compactCacheId === "string" && parsed.compactCacheId) {
      return {
        compactCacheId: parsed.compactCacheId,
        fingerprint:
          typeof parsed.fingerprint === "string"
            ? parsed.fingerprint
            : undefined,
      };
    }
  } catch {
    return { compactCacheId: value };
  }

  return null;
}

function cacheKey(compactCacheId: string) {
  return `${cachePrefix}${compactCacheId}`;
}

function targetKey(compactCacheId: string, targetFingerprint: string) {
  return `${targetPrefix}${compactCacheId}:${sha256(targetFingerprint)}`;
}

function visitJson(
  value: unknown,
  visitRecord: (record: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitJson(item, visitRecord);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    return;
  }

  visitRecord(value);
  for (const item of Object.values(value)) {
    visitJson(item, visitRecord);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isCompactionItem(value: Record<string, unknown>) {
  return (
    value.type === "compaction" ||
    value.type === "compaction_summary" ||
    value.type === "response.compaction_summary" ||
    value.object === "compaction_summary"
  );
}

function requiresEncryptedContent(value: Record<string, unknown>) {
  return value.type === "reasoning" || isCompactionItem(value);
}

function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function shortHash(value: string) {
  return sha256(value).slice(0, 16);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
