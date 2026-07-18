import { prisma } from "@gateway/db";

export const reasoningEffortValues = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffortValue = (typeof reasoningEffortValues)[number];

export type ReasoningEffortTransformRule = {
  enabled: boolean;
  from: ReasoningEffortValue;
  to: ReasoningEffortValue;
};

export type ReasoningEffortTransformSettings = {
  rules: ReasoningEffortTransformRule[];
  gpt56Force: {
    enabled: boolean;
    effort: ReasoningEffortValue;
  };
};

export const defaultReasoningEffortTransformSettings: ReasoningEffortTransformSettings = {
  rules: [],
  gpt56Force: {
    enabled: false,
    effort: "medium",
  },
};

const reasoningEffortTransformSettingsKey = "reasoning_effort_transform_settings";
const settingsCacheTtlMs = 5_000;
let cachedSettings = defaultReasoningEffortTransformSettings;
let cachedSettingsLoadedAtMs = 0;

export async function readReasoningEffortTransformSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedSettingsLoadedAtMs < settingsCacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: reasoningEffortTransformSettingsKey },
  });

  cachedSettings = normalizeReasoningEffortTransformSettings(parseStoredSettings(setting?.value));
  cachedSettingsLoadedAtMs = nowMs;

  return cachedSettings;
}

export async function saveReasoningEffortTransformSettings(input: Partial<ReasoningEffortTransformSettings>) {
  const current = await readReasoningEffortTransformSettings();
  const settings = normalizeReasoningEffortTransformSettings({
    ...current,
    ...input,
  });

  await prisma.systemSetting.upsert({
    where: { key: reasoningEffortTransformSettingsKey },
    update: { value: JSON.stringify(settings) },
    create: { key: reasoningEffortTransformSettingsKey, value: JSON.stringify(settings) },
  });

  cachedSettings = settings;
  cachedSettingsLoadedAtMs = Date.now();

  return settings;
}

export async function applyReasoningEffortTransform<T extends Record<string, unknown>>(
  body: T,
  context?: { endpoint?: string },
): Promise<T> {
  const settings = await readReasoningEffortTransformSettings();
  const transformedBody = settings.rules.length > 0
    ? transformReasoningEffort(body, settings.rules)
    : body;

  if (
    settings.gpt56Force.enabled &&
    context?.endpoint === "/v1/responses" &&
    isGpt56Model(transformedBody.model)
  ) {
    return forceResponsesReasoningEffort(
      transformedBody,
      settings.gpt56Force.effort,
    );
  }

  return transformedBody;
}

export function getReasoningEffortFromBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const visited = new Set<object>();
  const visit = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || visited.has(value)) {
      return null;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const effort = visit(item);
        if (effort) return effort;
      }
      return null;
    }

    const record = value as Record<string, unknown>;
    for (const key of ["reasoning_effort", "model_reasoning_effort"]) {
      const effort = normalizeReasoningEffortText(record[key]);
      if (effort) return effort;
    }

    const directEffort = normalizeReasoningEffortText(record.effort);
    if (directEffort) return directEffort;

    for (const [key, child] of Object.entries(record)) {
      if (key === "reasoning" || key === "input" || key === "items") {
        const effort = visit(child);
        if (effort) return effort;
      }
    }

    return null;
  };

  return visit(body);
}

export function normalizeReasoningEffortTransformSettings(input: {
  rules?: Array<Partial<ReasoningEffortTransformRule>>;
  gpt56Force?: {
    enabled?: boolean;
    effort?: ReasoningEffortValue;
  };
}) {
  const rules = Array.isArray(input.rules) ? input.rules : [];
  return {
    rules: normalizeRules(rules),
    gpt56Force: {
      enabled: input.gpt56Force?.enabled === true,
      effort:
        normalizeReasoningEffortValue(input.gpt56Force?.effort) ??
        defaultReasoningEffortTransformSettings.gpt56Force.effort,
    },
  };
}

export function normalizeReasoningEffortTransformRule(input: Partial<ReasoningEffortTransformRule>) {
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    from: normalizeReasoningEffortValue(input.from) ?? "high",
    to: normalizeReasoningEffortValue(input.to) ?? "medium",
  };
}

export function validateReasoningEffortTransformRules(rules: ReasoningEffortTransformRule[]) {
  const activeRules = rules.filter((rule) => rule.enabled);
  const duplicateSources = new Map<ReasoningEffortValue, ReasoningEffortTransformRule[]>();
  const selfTransforms: ReasoningEffortTransformRule[] = [];

  for (const rule of activeRules) {
    if (rule.from === rule.to) {
      selfTransforms.push(rule);
    }

    const bucket = duplicateSources.get(rule.from) ?? [];
    bucket.push(rule);
    duplicateSources.set(rule.from, bucket);
  }

  const conflicts = [...duplicateSources.entries()]
    .filter(([, value]) => value.length > 1)
    .map(([from, value]) => ({ from, count: value.length, rules: value }));

  return {
    ok: conflicts.length === 0 && selfTransforms.length === 0,
    conflicts,
    selfTransforms,
  };
}

function transformReasoningEffort<T extends Record<string, unknown>>(
  body: T,
  rules: ReasoningEffortTransformRule[],
) {
  let changed = false;
  const next: Record<string, unknown> = { ...body };

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    if (matchesReasoningEffort(next.reasoning_effort, rule.from)) {
      next.reasoning_effort = rule.to;
      changed = true;
    }

    if (matchesReasoningEffort(next.model_reasoning_effort, rule.from)) {
      next.model_reasoning_effort = rule.to;
      changed = true;
    }

    if (next.reasoning && typeof next.reasoning === "object" && !Array.isArray(next.reasoning)) {
      const reasoning = next.reasoning as Record<string, unknown>;
      if (matchesReasoningEffort(reasoning.effort, rule.from)) {
        next.reasoning = {
          ...reasoning,
          effort: rule.to,
        };
        changed = true;
      }
    }
  }

  return changed ? (next as T) : body;
}

function forceResponsesReasoningEffort<T extends Record<string, unknown>>(
  body: T,
  effort: ReasoningEffortValue,
) {
  const reasoning =
    body.reasoning && typeof body.reasoning === "object" && !Array.isArray(body.reasoning)
      ? (body.reasoning as Record<string, unknown>)
      : {};

  return {
    ...body,
    reasoning: {
      ...reasoning,
      effort,
    },
  } as T;
}

function isGpt56Model(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }

  return /(^|\/)gpt-5\.6(?:$|[-.])/.test(value.trim().toLowerCase());
}

function matchesReasoningEffort(value: unknown, expected: ReasoningEffortValue) {
  return typeof value === "string" && normalizeReasoningEffortValue(value) === expected;
}

function normalizeReasoningEffortText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function parseStoredSettings(value: string | undefined) {
  if (!value) {
    return defaultReasoningEffortTransformSettings;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ReasoningEffortTransformSettings> | Partial<ReasoningEffortTransformRule>;
    if (Array.isArray((parsed as Partial<ReasoningEffortTransformSettings>).rules)) {
      return parsed as Partial<ReasoningEffortTransformSettings>;
    }

    if ("enabled" in parsed || "from" in parsed || "to" in parsed) {
      const legacy = parsed as Partial<ReasoningEffortTransformRule>;
      return {
        rules: [legacy],
      };
    }

    return defaultReasoningEffortTransformSettings;
  } catch {
    return defaultReasoningEffortTransformSettings;
  }
}

function normalizeRules(input: unknown[]): ReasoningEffortTransformRule[] {
  return input.map((rule) => normalizeReasoningEffortTransformRule(rule as Partial<ReasoningEffortTransformRule>));
}

function normalizeReasoningEffortValue(value: unknown): ReasoningEffortValue | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return reasoningEffortValues.includes(normalized as ReasoningEffortValue)
    ? (normalized as ReasoningEffortValue)
    : null;
}
