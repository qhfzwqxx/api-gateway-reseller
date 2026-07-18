import { randomBytes } from "node:crypto";
import { Decimal } from "decimal.js";
import { Prisma } from "@prisma/client";
import { prisma } from "@gateway/db";
import { normalizeMoney } from "./auth-settings.js";
import { grantSubscription } from "./subscriptions.js";

type Tx = Prisma.TransactionClient;

export type ReferralRewardType = "NONE" | "BALANCE" | "SUBSCRIPTION";

export type ReferralRewardSettings = {
  type: ReferralRewardType;
  amountUsd: string;
  subscriptionPlanId: string | null;
};

export type ReferralSettings = {
  enabled: boolean;
  inviteBaseUrl: string;
  inviterReward: ReferralRewardSettings;
  inviteeReward: ReferralRewardSettings;
};

export type ReferralSettingsInput = Partial<{
  enabled: boolean;
  inviteBaseUrl: string;
  inviterReward: Partial<ReferralRewardSettings>;
  inviteeReward: Partial<ReferralRewardSettings>;
}>;

const referralSettingsKey = "referral_settings";

export const defaultReferralSettings: ReferralSettings = {
  enabled: true,
  inviteBaseUrl: "",
  inviterReward: {
    type: "NONE",
    amountUsd: "0.00000000",
    subscriptionPlanId: null,
  },
  inviteeReward: {
    type: "NONE",
    amountUsd: "0.00000000",
    subscriptionPlanId: null,
  },
};

export async function readReferralSettings(): Promise<ReferralSettings> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: referralSettingsKey },
  });

  if (!setting) {
    return defaultReferralSettings;
  }

  try {
    const parsed = JSON.parse(setting.value) as Partial<ReferralSettings>;
    return normalizeReferralSettings({
      ...defaultReferralSettings,
      ...parsed,
      inviterReward: {
        ...defaultReferralSettings.inviterReward,
        ...parsed.inviterReward,
      },
      inviteeReward: {
        ...defaultReferralSettings.inviteeReward,
        ...parsed.inviteeReward,
      },
    });
  } catch {
    return defaultReferralSettings;
  }
}

export async function saveReferralSettings(input: ReferralSettingsInput) {
  const current = await readReferralSettings();
  const settings = normalizeReferralSettings({
    ...current,
    ...input,
    inviterReward: {
      ...current.inviterReward,
      ...input.inviterReward,
    },
    inviteeReward: {
      ...current.inviteeReward,
      ...input.inviteeReward,
    },
  });

  await prisma.systemSetting.upsert({
    where: { key: referralSettingsKey },
    update: { value: JSON.stringify(settings) },
    create: { key: referralSettingsKey, value: JSON.stringify(settings) },
  });

  return settings;
}

export async function ensureReferralProfile(userId: string) {
  const existing = await prisma.referralProfile.findUnique({
    where: { userId },
  });
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.referralProfile.create({
        data: {
          userId,
          code: createReferralCode(),
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  throw new Error("Failed to create referral code");
}

export function buildInviteLink(input: {
  code: string;
  settings: ReferralSettings;
  origin?: string | null;
}) {
  const base = input.settings.inviteBaseUrl.trim() || input.origin?.trim() || "";
  if (!base) return `/invite/${input.code}`;
  return `${base.replace(/\/+$/, "")}/invite/${input.code}`;
}

export async function applyReferralForNewUser(
  tx: Tx,
  input: {
    inviteeUserId: string;
    referralCode?: string | null;
  },
) {
  const code = input.referralCode?.trim();
  if (!code) return null;

  const settings = await readReferralSettings();
  if (!settings.enabled) return null;

  const profile = await tx.referralProfile.findUnique({
    where: { code },
    include: {
      user: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (!profile || profile.status !== "ACTIVE") return null;
  if (profile.userId === input.inviteeUserId) return null;
  if (!["ACTIVE", "TRIAL"].includes(profile.user.status)) return null;

  const existingInvite = await tx.referralInvite.findUnique({
    where: { inviteeUserId: input.inviteeUserId },
  });
  if (existingInvite) return existingInvite;

  const now = new Date();
  const inviterRewardedAt = await applyReward(tx, {
    userId: profile.userId,
    reward: settings.inviterReward,
    counterpartyUserId: input.inviteeUserId,
    role: "inviter",
  });
  const inviteeRewardedAt = await applyReward(tx, {
    userId: input.inviteeUserId,
    reward: settings.inviteeReward,
    counterpartyUserId: profile.userId,
    role: "invitee",
  });

  const invite = await tx.referralInvite.create({
    data: {
      referralProfileId: profile.id,
      inviterUserId: profile.userId,
      inviteeUserId: input.inviteeUserId,
      code: profile.code,
      status: "REWARDED",
      inviterRewardType: settings.inviterReward.type,
      inviterRewardAmount:
        settings.inviterReward.type === "BALANCE"
          ? settings.inviterReward.amountUsd
          : "0",
      inviterRewardPlanId:
        settings.inviterReward.type === "SUBSCRIPTION"
          ? settings.inviterReward.subscriptionPlanId
          : null,
      inviteeRewardType: settings.inviteeReward.type,
      inviteeRewardAmount:
        settings.inviteeReward.type === "BALANCE"
          ? settings.inviteeReward.amountUsd
          : "0",
      inviteeRewardPlanId:
        settings.inviteeReward.type === "SUBSCRIPTION"
          ? settings.inviteeReward.subscriptionPlanId
          : null,
      inviterRewardedAt,
      inviteeRewardedAt,
      rewardSnapshot: settings,
      createdAt: now,
    },
  });

  await tx.referralProfile.update({
    where: { id: profile.id },
    data: {
      successfulInvites: { increment: 1 },
      rewardedInvites:
        inviterRewardedAt || inviteeRewardedAt ? { increment: 1 } : undefined,
    },
  });

  return invite;
}

async function applyReward(
  tx: Tx,
  input: {
    userId: string;
    reward: ReferralRewardSettings;
    counterpartyUserId: string;
    role: "inviter" | "invitee";
  },
) {
  if (input.reward.type === "NONE") return null;

  if (input.reward.type === "SUBSCRIPTION") {
    if (!input.reward.subscriptionPlanId) return null;
    const plan = await tx.subscriptionPlan.findUnique({
      where: { id: input.reward.subscriptionPlanId },
      include: {
        tier: {
          select: {
            status: true,
          },
        },
      },
    });
    if (!plan || plan.status !== "ACTIVE" || plan.tier.status !== "ACTIVE") {
      return null;
    }
    await grantSubscription(tx, {
      userId: input.userId,
      planId: input.reward.subscriptionPlanId,
      source: "REFERRAL",
      remark:
        input.role === "inviter"
          ? "Referral inviter reward"
          : "Referral invitee reward",
    });
    return new Date();
  }

  const amount = new Decimal(input.reward.amountUsd);
  if (!amount.isFinite() || amount.lte(0)) return null;

  const wallet = await tx.wallet.upsert({
    where: { userId: input.userId },
    update: {},
    create: {
      userId: input.userId,
      balance: "0",
    },
  });
  const balanceBefore = new Decimal(wallet.balance.toString());
  const balanceAfter = balanceBefore.plus(amount);

  await tx.wallet.update({
    where: { userId: input.userId },
    data: { balance: balanceAfter.toFixed(8) },
  });

  await tx.walletTransaction.create({
    data: {
      userId: input.userId,
      type: "RECHARGE",
      source: "REFERRAL",
      amount: amount.toFixed(8),
      balanceBefore: balanceBefore.toFixed(8),
      balanceAfter: balanceAfter.toFixed(8),
      remark:
        input.role === "inviter"
          ? "Referral inviter reward"
          : "Referral invitee reward",
      metadata: {
        role: input.role,
        counterpartyUserId: input.counterpartyUserId,
      },
    },
  });

  return new Date();
}

function normalizeReferralSettings(settings: ReferralSettings): ReferralSettings {
  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : true,
    inviteBaseUrl: String(settings.inviteBaseUrl ?? "").trim(),
    inviterReward: normalizeRewardSettings(settings.inviterReward),
    inviteeReward: normalizeRewardSettings(settings.inviteeReward),
  };
}

function normalizeRewardSettings(
  settings: ReferralRewardSettings,
): ReferralRewardSettings {
  const type = ["NONE", "BALANCE", "SUBSCRIPTION"].includes(settings.type)
    ? settings.type
    : "NONE";
  return {
    type,
    amountUsd: type === "BALANCE" ? normalizeMoney(settings.amountUsd) : "0.00000000",
    subscriptionPlanId:
      type === "SUBSCRIPTION" && settings.subscriptionPlanId
        ? String(settings.subscriptionPlanId)
        : null,
  };
}

function createReferralCode() {
  return randomBytes(8).toString("base64url");
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
