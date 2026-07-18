import { prisma } from "@gateway/db";

export type BannedUserNoticeSettings = {
  noticeText: string;
};

export const defaultBannedUserNoticeSettings: BannedUserNoticeSettings = {
  noticeText: "您已被封禁，如有异议请及时联系管理员QQ：1810499229",
};

const settingKey = "banned_user_notice_settings";
const cacheTtlMs = 5_000;
let cachedSettings = defaultBannedUserNoticeSettings;
let cachedAtMs = 0;

export async function readBannedUserNoticeSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeBannedUserNoticeSettings(parseSettings(setting?.value));
  cachedAtMs = nowMs;
  return cachedSettings;
}

export async function saveBannedUserNoticeSettings(
  input: Partial<BannedUserNoticeSettings>,
) {
  const current = await readBannedUserNoticeSettings();
  const settings = normalizeBannedUserNoticeSettings({ ...current, ...input });
  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(settings) },
    create: { key: settingKey, value: JSON.stringify(settings) },
  });
  cachedSettings = settings;
  cachedAtMs = Date.now();
  return settings;
}

function parseSettings(value: string | null | undefined) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as Partial<BannedUserNoticeSettings>;
  } catch {
    return {};
  }
}

function normalizeBannedUserNoticeSettings(
  input: Partial<BannedUserNoticeSettings>,
) {
  const noticeText = String(input.noticeText ?? "").trim();
  return {
    noticeText: (noticeText || defaultBannedUserNoticeSettings.noticeText).slice(
      0,
      8000,
    ),
  };
}
