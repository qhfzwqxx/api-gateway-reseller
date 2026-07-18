import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "@gateway/db";

export type WhitelistFilterSettings = {
  enabled: boolean;
  secret: string;
  secretVersion: string;
  noticeText: string;
  applyToAdmins: boolean;
};

export const defaultWhitelistFilterSettings: WhitelistFilterSettings = {
  enabled: false,
  secret: "",
  secretVersion: "",
  noticeText: "当前账号需要完成白名单验证后才能继续使用网关。",
  applyToAdmins: false,
};

const settingKey = "whitelist_filter_settings";
const unlockKeyPrefix = "whitelist-filter:unlock:";
const cacheTtlMs = 5_000;
let cachedSettings = defaultWhitelistFilterSettings;
let cachedAtMs = 0;

export async function readWhitelistFilterSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeWhitelistFilterSettings(parseSettings(setting?.value));
  cachedAtMs = nowMs;
  return cachedSettings;
}

export async function saveWhitelistFilterSettings(
  input: Partial<Omit<WhitelistFilterSettings, "secretVersion">>,
) {
  const current = await readWhitelistFilterSettings();
  const next = normalizeWhitelistFilterSettings({ ...current, ...input });

  if (next.enabled && !next.secret) {
    next.secret = createWhitelistSecret();
  }
  if (next.secret && !next.secretVersion) {
    next.secretVersion = createSecretVersion();
  }

  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(next) },
    create: { key: settingKey, value: JSON.stringify(next) },
  });
  cachedSettings = next;
  cachedAtMs = Date.now();
  return next;
}

export async function rotateWhitelistFilterSecret() {
  const current = await readWhitelistFilterSettings();
  const next = normalizeWhitelistFilterSettings({
    ...current,
    secret: createWhitelistSecret(),
    secretVersion: createSecretVersion(),
  });

  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(next) },
    create: { key: settingKey, value: JSON.stringify(next) },
  });
  cachedSettings = next;
  cachedAtMs = Date.now();
  return next;
}

export async function isWhitelistFilterUnlocked(
  app: FastifyInstance,
  userId: string,
  settings = cachedSettings,
) {
  if (!settings.secretVersion) {
    return false;
  }

  const unlockedVersion = await app.redis.get(unlockKey(userId));
  return unlockedVersion === settings.secretVersion;
}

export async function unlockWhitelistFilterUser(
  app: FastifyInstance,
  userId: string,
  secret: string,
) {
  const settings = await readWhitelistFilterSettings();
  if (!settings.enabled) {
    return { ok: false as const, reason: "disabled" as const, settings };
  }

  if (!settings.secret || secret.trim() !== settings.secret) {
    return { ok: false as const, reason: "invalid_secret" as const, settings };
  }

  await app.redis.set(unlockKey(userId), settings.secretVersion);
  return { ok: true as const, settings };
}

function unlockKey(userId: string) {
  return `${unlockKeyPrefix}${userId}`;
}

function createWhitelistSecret() {
  return randomBytes(18).toString("base64url");
}

function createSecretVersion() {
  return randomBytes(12).toString("base64url");
}

function parseSettings(value: string | null | undefined) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as Partial<WhitelistFilterSettings>;
  } catch {
    return {};
  }
}

function normalizeWhitelistFilterSettings(input: Partial<WhitelistFilterSettings>) {
  return {
    enabled: Boolean(input.enabled),
    secret: String(input.secret ?? "").trim().slice(0, 256),
    secretVersion: String(input.secretVersion ?? "").trim().slice(0, 128),
    noticeText:
      String(input.noticeText ?? "").trim().slice(0, 8000) ||
      defaultWhitelistFilterSettings.noticeText,
    applyToAdmins: Boolean(input.applyToAdmins),
  };
}
