import { prisma, type ModelPrice } from "@gateway/db";
import type { ChargePrice } from "../lib/money.js";

export type UnifiedPriceSetting = {
  model: string;
  enabled: boolean;
  pricingMode: string;
  customerInputPer1MTok: string;
  customerCachedInputPer1MTok: string;
  customerOutputPer1MTok: string;
  customerPriceMultiplier: string;
  perRequestUsd: string;
};

export type UnifiedPriceSettingUpdate = UnifiedPriceSetting;

const unifiedPriceSettingsKey = "model_price_unified_customer_settings";

type StoredUnifiedPriceSetting = Omit<UnifiedPriceSetting, "model">;
type StoredUnifiedPriceSettings = Record<string, StoredUnifiedPriceSetting>;

export async function listUnifiedPriceSettings(models?: string[]) {
  const settings = await readUnifiedPriceSettings();
  const modelSet = models ? new Set(models) : null;

  return Object.entries(settings)
    .filter(([model]) => !modelSet || modelSet.has(model))
    .map(([model, setting]) => ({
      model,
      ...setting,
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
}

export async function saveUnifiedPriceSettings(updates: UnifiedPriceSettingUpdate[]) {
  const current = await readUnifiedPriceSettings();

  for (const update of updates) {
    const existing = current[update.model];
    current[update.model] = {
      enabled: update.enabled,
      pricingMode: normalizePricingMode(update.pricingMode, existing?.pricingMode ?? "token"),
      customerInputPer1MTok: normalizePriceText(update.customerInputPer1MTok, existing?.customerInputPer1MTok ?? "0"),
      customerCachedInputPer1MTok: normalizePriceText(
        update.customerCachedInputPer1MTok,
        existing?.customerCachedInputPer1MTok ?? "0",
      ),
      customerOutputPer1MTok: normalizePriceText(update.customerOutputPer1MTok, existing?.customerOutputPer1MTok ?? "0"),
      customerPriceMultiplier: normalizePriceText(update.customerPriceMultiplier, existing?.customerPriceMultiplier ?? "1"),
      perRequestUsd: normalizePriceText(update.perRequestUsd, existing?.perRequestUsd ?? "0"),
    };
  }

  await prisma.systemSetting.upsert({
    where: { key: unifiedPriceSettingsKey },
    update: { value: JSON.stringify(current) },
    create: {
      key: unifiedPriceSettingsKey,
      value: JSON.stringify(current),
    },
  });

  return listUnifiedPriceSettings(updates.map((update) => update.model));
}

export async function applyUnifiedCustomerPricing(price: ModelPrice): Promise<ChargePrice> {
  const setting = await getUnifiedPriceSetting(price.model);

  if (!setting?.enabled) {
    return price;
  }

  return {
    ...price,
    pricingMode: setting.pricingMode,
    customerInputPer1MTok: setting.customerInputPer1MTok,
    customerCachedInputPer1MTok: setting.customerCachedInputPer1MTok,
    customerOutputPer1MTok: setting.customerOutputPer1MTok,
    customerPriceMultiplier: setting.customerPriceMultiplier,
    perRequestUsd: setting.perRequestUsd,
  };
}

async function getUnifiedPriceSetting(model: string) {
  const settings = await readUnifiedPriceSettings();
  const setting = settings[model];

  return setting
    ? {
        model,
        ...setting,
      }
    : null;
}

export async function readUnifiedPriceSettings(): Promise<StoredUnifiedPriceSettings> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: unifiedPriceSettingsKey },
  });

  if (!setting?.value) {
    return {};
  }

  try {
    return normalizeStoredSettings(JSON.parse(setting.value));
  } catch {
    return {};
  }
}

function normalizeStoredSettings(value: unknown): StoredUnifiedPriceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const settings: StoredUnifiedPriceSettings = {};

  for (const [model, setting] of Object.entries(value)) {
    if (!model.trim() || !setting || typeof setting !== "object" || Array.isArray(setting)) {
      continue;
    }

    const entry = setting as Record<string, unknown>;
    settings[model] = {
      enabled: entry.enabled === true,
      pricingMode: normalizePricingMode(entry.pricingMode, "token"),
      customerInputPer1MTok: normalizePriceText(entry.customerInputPer1MTok, "0"),
      customerCachedInputPer1MTok: normalizePriceText(entry.customerCachedInputPer1MTok, "0"),
      customerOutputPer1MTok: normalizePriceText(entry.customerOutputPer1MTok, "0"),
      customerPriceMultiplier: normalizePriceText(entry.customerPriceMultiplier, "1"),
      perRequestUsd: normalizePriceText(entry.perRequestUsd, "0"),
    };
  }

  return settings;
}

function normalizePricingMode(value: unknown, fallback: string) {
  return value === "request" || value === "token" ? value : fallback;
}

function normalizePriceText(value: unknown, fallback: string) {
  const text = String(value ?? fallback).trim();
  const numeric = Number(text);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }

  return text || fallback;
}
