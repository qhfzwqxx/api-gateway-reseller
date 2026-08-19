import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";

export type AuthSettings = {
  emailCodeLoginEnabled: boolean;
  emailCodeAutoRegisterEnabled: boolean;
  newUserBonusUsd: string;
  newUserBonusCurrency: string;
  emailCodeTtlSeconds: number;
  emailCodeCooldownSeconds: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
};

export type PublicAuthSettings = Pick<
  AuthSettings,
  | "emailCodeLoginEnabled"
  | "emailCodeAutoRegisterEnabled"
  | "newUserBonusUsd"
  | "newUserBonusCurrency"
> & {
  smtpConfigured: boolean;
};

export type AdminAuthSettings = Omit<AuthSettings, "smtpPassword"> & {
  smtpConfigured: boolean;
};

export type AuthSettingsInput = Partial<AuthSettings>;

const authSettingsKey = "auth_settings";

export const defaultAuthSettings: AuthSettings = {
  emailCodeLoginEnabled: true,
  emailCodeAutoRegisterEnabled: true,
  newUserBonusUsd: "0.00000000",
  newUserBonusCurrency: "POINTS",
  emailCodeTtlSeconds: 600,
  emailCodeCooldownSeconds: 60,
  smtpHost: "",
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: "",
  smtpPassword: "",
  smtpFrom: "",
};

export async function readAuthSettings(): Promise<AuthSettings> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: authSettingsKey },
  });

  if (!setting) {
    return defaultAuthSettings;
  }

  try {
    const parsed = JSON.parse(setting.value) as Partial<AuthSettings>;
    return normalizeAuthSettings({
      ...defaultAuthSettings,
      ...parsed,
    });
  } catch {
    return defaultAuthSettings;
  }
}

export async function saveAuthSettings(input: AuthSettingsInput) {
  const current = await readAuthSettings();
  const settings = normalizeAuthSettings({
    ...current,
    ...input,
    smtpPassword:
      input.smtpPassword !== undefined
        ? input.smtpPassword
        : current.smtpPassword,
  });

  await prisma.systemSetting.upsert({
    where: { key: authSettingsKey },
    update: { value: JSON.stringify(settings) },
    create: { key: authSettingsKey, value: JSON.stringify(settings) },
  });

  return settings;
}

export function toPublicAuthSettings(settings: AuthSettings): PublicAuthSettings {
  return {
    emailCodeLoginEnabled: settings.emailCodeLoginEnabled,
    emailCodeAutoRegisterEnabled: settings.emailCodeAutoRegisterEnabled,
    newUserBonusUsd: settings.newUserBonusUsd,
    newUserBonusCurrency: settings.newUserBonusCurrency,
    smtpConfigured: isSmtpConfigured(settings),
  };
}

export function toAdminAuthSettings(settings: AuthSettings): AdminAuthSettings {
  const { smtpPassword: _smtpPassword, ...rest } = settings;
  return {
    ...rest,
    smtpConfigured: isSmtpConfigured(settings),
  };
}

export function isSmtpConfigured(settings: AuthSettings) {
  return Boolean(settings.smtpHost && settings.smtpPort && settings.smtpFrom);
}

export function normalizeMoney(value: string | number | null | undefined) {
  const amount = new Decimal(value ?? 0);
  if (!amount.isFinite() || amount.lt(0)) {
    throw new Error("Amount must be a non-negative number");
  }

  return amount.toFixed(8);
}

function normalizeAuthSettings(settings: AuthSettings): AuthSettings {
  return {
    emailCodeLoginEnabled: normalizeBoolean(
      settings.emailCodeLoginEnabled,
      defaultAuthSettings.emailCodeLoginEnabled,
    ),
    emailCodeAutoRegisterEnabled: normalizeBoolean(
      settings.emailCodeAutoRegisterEnabled,
      defaultAuthSettings.emailCodeAutoRegisterEnabled,
    ),
    newUserBonusUsd: normalizeMoney(settings.newUserBonusUsd),
    newUserBonusCurrency:
      String(settings.newUserBonusCurrency ?? "POINTS").trim().toUpperCase() ||
      "POINTS",
    emailCodeTtlSeconds: clampInteger(settings.emailCodeTtlSeconds, 60, 3600, defaultAuthSettings.emailCodeTtlSeconds),
    emailCodeCooldownSeconds: clampInteger(settings.emailCodeCooldownSeconds, 10, 600, defaultAuthSettings.emailCodeCooldownSeconds),
    smtpHost: String(settings.smtpHost ?? "").trim(),
    smtpPort: clampInteger(settings.smtpPort, 1, 65535, defaultAuthSettings.smtpPort),
    smtpSecure: Boolean(settings.smtpSecure),
    smtpUser: String(settings.smtpUser ?? "").trim(),
    smtpPassword: String(settings.smtpPassword ?? ""),
    smtpFrom: String(settings.smtpFrom ?? "").trim(),
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}
