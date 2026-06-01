import { prisma } from "@gateway/db";

export type UpstreamOutputFilterSettings = {
  enabled: boolean;
  phrases: string[];
};

export const defaultUpstreamOutputFilterSettings: UpstreamOutputFilterSettings =
  {
    enabled: false,
    phrases: [],
  };

const settingKey = "upstream_output_filter_settings";
const cacheTtlMs = 5_000;
let cachedSettings = defaultUpstreamOutputFilterSettings;
let cachedAtMs = 0;

export async function readUpstreamOutputFilterSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeUpstreamOutputFilterSettings(
    parseSettings(setting?.value),
  );
  cachedAtMs = nowMs;
  return cachedSettings;
}

export async function saveUpstreamOutputFilterSettings(
  input: Partial<UpstreamOutputFilterSettings>,
) {
  const current = await readUpstreamOutputFilterSettings();
  const settings = normalizeUpstreamOutputFilterSettings({
    ...current,
    ...input,
  });

  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(settings) },
    create: { key: settingKey, value: JSON.stringify(settings) },
  });
  cachedSettings = settings;
  cachedAtMs = Date.now();
  return settings;
}

export function createUpstreamOutputStreamFilter(
  settings: UpstreamOutputFilterSettings,
) {
  const phrases = getActivePhrases(settings);
  const filterPairs = buildFilterPairs(phrases);
  const singleCharPhrases = new Set(
    phrases.filter((phrase) => Array.from(phrase).length === 1),
  );
  let pendingChar = "";

  return {
    push(text: string) {
      if (phrases.length === 0 || !text) {
        return text;
      }

      let output = "";

      for (const char of Array.from(text)) {
        if (!pendingChar) {
          if (!singleCharPhrases.has(char)) {
            pendingChar = char;
          }
          continue;
        }

        if (!filterPairs.has(`${pendingChar}\u0000${char}`)) {
          output += pendingChar;
        }
        pendingChar = singleCharPhrases.has(char) ? "" : char;
      }

      return output;
    },
    flush() {
      const output = pendingChar;
      pendingChar = "";
      return output;
    },
  };
}

export function filterUpstreamOutputText(
  text: string,
  settings: UpstreamOutputFilterSettings,
) {
  return getActivePhrases(settings).reduce(
    (current, phrase) => current.split(phrase).join(""),
    text,
  );
}

export function filterUpstreamOutputBody(
  body: unknown,
  settings: UpstreamOutputFilterSettings,
): unknown {
  if (!settings.enabled || settings.phrases.length === 0) {
    return body;
  }

  if (typeof body === "string") {
    return filterUpstreamOutputText(body, settings);
  }

  if (Array.isArray(body)) {
    return body.map((item) => filterUpstreamOutputBody(item, settings));
  }

  if (body && typeof body === "object") {
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [
        key,
        filterUpstreamOutputBody(value, settings),
      ]),
    );
  }

  return body;
}

function parseSettings(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Partial<UpstreamOutputFilterSettings>;
  } catch {
    return {};
  }
}

function normalizeUpstreamOutputFilterSettings(
  input: Partial<UpstreamOutputFilterSettings>,
): UpstreamOutputFilterSettings {
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : false,
    phrases: normalizePhrases(input.phrases),
  };
}

function getActivePhrases(settings: UpstreamOutputFilterSettings) {
  return settings.enabled ? settings.phrases : [];
}

function buildFilterPairs(phrases: string[]) {
  const pairs = new Set<string>();

  for (const phrase of phrases) {
    const chars = Array.from(phrase);
    for (let index = 0; index < chars.length - 1; index += 1) {
      pairs.add(`${chars[index]}\u0000${chars[index + 1]}`);
    }
  }

  return pairs;
}

function normalizePhrases(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .sort((left, right) => right.length - left.length),
    ),
  ).slice(0, 50);
}
