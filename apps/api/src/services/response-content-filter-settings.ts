import { prisma } from "@gateway/db";

export type ResponseContentFilterSettings = {
  enabled: boolean;
  blockedTerms: string[];
  replacement: string;
  caseSensitive: boolean;
  includeUpstreamBaseUrls: boolean;
};

export const maxResponseContentFilterTerms = 200;
export const maxResponseContentFilterTermLength = 2048;
export const maxResponseContentFilterReplacementLength = 200;

export const defaultResponseContentFilterSettings: ResponseContentFilterSettings = {
  enabled: false,
  blockedTerms: [],
  replacement: "[内容已屏蔽]",
  caseSensitive: false,
  includeUpstreamBaseUrls: false,
};

const settingKey = "response_content_filter_settings";
const cacheTtlMs = 5_000;
const unsafeReplacementPattern = /["\\\u0000-\u001f\u007f]/;
const unsafeReplacementCharactersPattern = /["\\\u0000-\u001f\u007f]/g;

let cachedSettings = defaultResponseContentFilterSettings;
let cachedAtMs = 0;
let cachedSettingsLoaded = false;
let cachedUpstreamBaseUrlTerms: string[] = [];
let cachedUpstreamBaseUrlsAtMs = 0;
let cachedUpstreamBaseUrlsLoaded = false;

export async function readResponseContentFilterSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: settingKey },
    });
    cachedSettings = normalizeResponseContentFilterSettings(
      parseStoredSettings(setting?.value),
    );
    cachedAtMs = nowMs;
    cachedSettingsLoaded = true;
    return cachedSettings;
  } catch (error) {
    if (!cachedSettingsLoaded) {
      throw error;
    }
    cachedAtMs = nowMs;
    return cachedSettings;
  }
}

export async function saveResponseContentFilterSettings(
  input: Partial<ResponseContentFilterSettings>,
) {
  const settings = normalizeResponseContentFilterSettings({
    ...(await readResponseContentFilterSettings()),
    ...input,
  });

  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(settings) },
    create: { key: settingKey, value: JSON.stringify(settings) },
  });

  cachedSettings = settings;
  cachedAtMs = Date.now();
  cachedSettingsLoaded = true;
  return settings;
}

export async function readEffectiveResponseContentFilterSettings() {
  const settings = await readResponseContentFilterSettings();
  if (!settings.includeUpstreamBaseUrls) {
    return settings;
  }

  try {
    const upstreamBaseUrlTerms = await readUpstreamBaseUrlBlockedTerms();
    return {
      ...settings,
      blockedTerms: mergeBlockedTerms(
        settings.blockedTerms,
        upstreamBaseUrlTerms,
        settings.caseSensitive,
      ),
    };
  } catch {
    return settings;
  }
}

export async function readUpstreamBaseUrlBlockedTerms() {
  const nowMs = Date.now();
  if (nowMs - cachedUpstreamBaseUrlsAtMs < cacheTtlMs) {
    return cachedUpstreamBaseUrlTerms;
  }

  try {
    const providers = await prisma.upstreamProvider.findMany({
      select: { baseUrl: true },
      orderBy: { createdAt: "asc" },
    });
    cachedUpstreamBaseUrlTerms = Array.from(
      new Set(
        providers
          .flatMap((provider) =>
            toUpstreamBaseUrlBlockedTerms(provider.baseUrl),
          )
          .filter((value): value is string => Boolean(value)),
      ),
    );
    cachedUpstreamBaseUrlsAtMs = nowMs;
    cachedUpstreamBaseUrlsLoaded = true;
    return cachedUpstreamBaseUrlTerms;
  } catch (error) {
    if (!cachedUpstreamBaseUrlsLoaded) {
      throw error;
    }
    cachedUpstreamBaseUrlsAtMs = nowMs;
    return cachedUpstreamBaseUrlTerms;
  }
}

export function invalidateResponseContentFilterUpstreamCache() {
  cachedUpstreamBaseUrlsAtMs = 0;
}

export function toUpstreamBaseUrlBlockedTerm(value: string) {
  return toUpstreamBaseUrlBlockedTerms(value)[0] ?? "";
}

export function toUpstreamBaseUrlBlockedTerms(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed.replace(/^\/\//, "")}`,
    );
    return uniqueBlockedTerms([
      `${url.host}${url.pathname}`.replace(/\/+$/, ""),
      url.host,
      url.hostname,
      getParentHostname(url.hostname),
    ]);
  } catch {
    const withoutScheme = trimmed
      .replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
      .replace(/^\/\//, "")
      .replace(/\/+$/, "");
    const authority = withoutScheme.split("/", 1)[0] ?? "";
    const hostname = authority.replace(/:\d+$/, "");
    return uniqueBlockedTerms([
      withoutScheme,
      authority,
      hostname,
      getParentHostname(hostname),
    ]);
  }
}

const commonCountryCodeSecondLevelDomains = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "mil",
  "net",
  "org",
]);

function getParentHostname(value: string) {
  const hostname = value.trim().toLowerCase();
  if (!hostname || hostname.includes(":")) {
    return "";
  }
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 3) {
    return "";
  }
  const topLevelDomain = labels.at(-1) ?? "";
  const secondLevelDomain = labels.at(-2) ?? "";
  if (
    labels.length === 3 &&
    topLevelDomain.length === 2 &&
    commonCountryCodeSecondLevelDomains.has(secondLevelDomain)
  ) {
    return "";
  }
  return labels.slice(1).join(".");
}

function uniqueBlockedTerms(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeResponseContentFilterSettings(
  value: unknown,
): ResponseContentFilterSettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<Record<keyof ResponseContentFilterSettings, unknown>>)
      : {};
  const caseSensitive =
    typeof input.caseSensitive === "boolean"
      ? input.caseSensitive
      : defaultResponseContentFilterSettings.caseSensitive;

  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : defaultResponseContentFilterSettings.enabled,
    blockedTerms: normalizeBlockedTerms(input.blockedTerms, caseSensitive),
    replacement: normalizeReplacement(input.replacement),
    caseSensitive,
    includeUpstreamBaseUrls:
      typeof input.includeUpstreamBaseUrls === "boolean"
        ? input.includeUpstreamBaseUrls
        : defaultResponseContentFilterSettings.includeUpstreamBaseUrls,
  };
}

export function isSafeResponseContentFilterReplacement(value: string) {
  return (
    value.length <= maxResponseContentFilterReplacementLength &&
    !unsafeReplacementPattern.test(value)
  );
}

function normalizeBlockedTerms(value: unknown, caseSensitive: boolean) {
  if (!Array.isArray(value)) {
    return defaultResponseContentFilterSettings.blockedTerms;
  }

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const term = item.trim().slice(0, maxResponseContentFilterTermLength);
    if (!term) {
      continue;
    }
    const key = caseSensitive ? term : term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(term);
    if (terms.length >= maxResponseContentFilterTerms) {
      break;
    }
  }
  return terms;
}

function normalizeReplacement(value: unknown) {
  if (typeof value !== "string") {
    return defaultResponseContentFilterSettings.replacement;
  }
  return value
    .slice(0, maxResponseContentFilterReplacementLength)
    .replace(unsafeReplacementCharactersPattern, "");
}

function mergeBlockedTerms(
  manualTerms: string[],
  upstreamBaseUrlTerms: string[],
  caseSensitive: boolean,
) {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const term of [...manualTerms, ...upstreamBaseUrlTerms]) {
    const key = caseSensitive ? term : term.toLowerCase();
    if (!term || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(term);
  }
  return merged;
}

function parseStoredSettings(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
