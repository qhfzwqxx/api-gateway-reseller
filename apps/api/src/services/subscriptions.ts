import { Decimal } from "decimal.js";
import { Prisma } from "@prisma/client";

const daySeconds = 24 * 60 * 60;
const shanghaiTimeZone = "Asia/Shanghai";

type Tx = Prisma.TransactionClient;

type UserSubscriptionWithPlan = Prisma.UserSubscriptionGetPayload<{
  include: typeof userSubscriptionInclude;
}>;

export const subscriptionPlanInclude = {
  tier: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
    },
  },
} satisfies Prisma.SubscriptionPlanInclude;

export const userSubscriptionInclude = {
  plan: {
    include: subscriptionPlanInclude,
  },
  tier: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
    },
  },
  baseTier: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
    },
  },
  redeemCode: {
    select: {
      id: true,
      codePrefix: true,
    },
  },
} satisfies Prisma.UserSubscriptionInclude;

export function subscriptionSeconds(durationDays: number) {
  return Math.max(1, durationDays) * daySeconds;
}

export function shanghaiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: shanghaiTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export async function lockSubscriptionRow(tx: Tx, subscriptionId: string) {
  await tx.$queryRaw`SELECT 1 FROM "UserSubscription" WHERE id = ${subscriptionId} FOR UPDATE`;
}

export function decimalMaxZero(value: Decimal) {
  return Decimal.max(0, value);
}

function getRollingPeriodIndex(startedAt: Date, at = new Date()) {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((at.getTime() - startedAt.getTime()) / 1000),
  );

  return Math.floor(elapsedSeconds / daySeconds);
}

function getRollingPeriodKey(startedAt: Date, at = new Date()) {
  return `rolling:${getRollingPeriodIndex(startedAt, at)}`;
}

function getRollingDailyQuotaPeriod(subscription: UserSubscriptionWithPlan, now = new Date()) {
  const startedAt = subscription.startsAt;
  const periodIndex = getRollingPeriodIndex(startedAt, now);
  const periodStart = addSeconds(startedAt, periodIndex * daySeconds);
  const nextPeriodStart = addSeconds(periodStart, daySeconds);

  return {
    key: `rolling:${periodIndex}`,
    nextRefreshAt:
      subscription.active &&
      subscription.status === "ACTIVE" &&
      nextPeriodStart < subscription.endsAt
        ? nextPeriodStart
        : null,
  };
}

function getPausedAt(subscription: Pick<UserSubscriptionWithPlan, "endsAt" | "remainingSeconds">) {
  return addSeconds(subscription.endsAt, -subscription.remainingSeconds);
}

export async function syncUserSubscriptionState(tx: Tx, userId: string) {
  const now = new Date();
  const active = await tx.userSubscription.findFirst({
    where: {
      userId,
      active: true,
      status: "ACTIVE",
    },
    orderBy: { activatedAt: "desc" },
  });

  if (!active) return null;

  if (active.endsAt > now) return active;

  await tx.userSubscription.update({
    where: { id: active.id },
    data: {
      active: false,
      status: "EXPIRED",
      remainingSeconds: 0,
    },
  });
  await tx.user.update({
    where: { id: userId },
    data: {
      tierId: active.baseTierId,
    },
  });

  return null;
}

export async function getActiveSubscriptionWithPlan(tx: Tx, userId: string) {
  await syncUserSubscriptionState(tx, userId);
  return tx.userSubscription.findFirst({
    where: {
      userId,
      active: true,
      status: "ACTIVE",
    },
    orderBy: { activatedAt: "desc" },
    include: {
      ...userSubscriptionInclude,
      plan: {
        include: subscriptionPlanInclude,
      },
    },
  });
}

export async function getSubscriptionQuotaSummary(tx: Tx, userId: string) {
  const subscription = await getActiveSubscriptionWithPlan(tx, userId);
  if (!subscription) return null;

  return buildSubscriptionQuotaSummary(tx, subscription);
}

export async function buildSubscriptionQuotaSummary(
  _tx: Tx,
  subscription: UserSubscriptionWithPlan,
) {
  return summarizeSubscriptionQuota(subscription);
}

export function summarizeSubscriptionQuota(
  subscription: UserSubscriptionWithPlan,
) {
  const now = new Date();
  const quotaMode = subscription.plan.quotaMode;
  const quotaAmount = new Decimal(subscription.plan.quotaAmountUsd.toString());
  const remainingSeconds =
    subscription.active && subscription.status === "ACTIVE"
      ? Math.max(
          0,
          Math.ceil((subscription.endsAt.getTime() - now.getTime()) / 1000),
        )
      : subscription.remainingSeconds;

  if (quotaMode === "UNLIMITED") {
    return {
      ...subscription,
      remainingSeconds,
      quotaMode,
      quotaAmountUsd: quotaAmount.toFixed(8),
      todayUsedUsd: "0",
      todayRemainingUsd: null,
      nextQuotaRefreshAt: null,
      totalUsedUsd: new Decimal(subscription.totalUsedUsd.toString()).toFixed(8),
      totalRemainingUsd: null,
      walletFallbackRequired: false,
    };
  }

  if (quotaMode === "DAILY") {
    const quotaPeriod = getRollingDailyQuotaPeriod(subscription, now);
    const usedToday =
      subscription.dailyUsageDateKey === quotaPeriod.key
        ? new Decimal(subscription.dailyUsedUsd.toString())
        : new Decimal(0);
    const remainingToday = decimalMaxZero(quotaAmount.minus(usedToday));
    return {
      ...subscription,
      remainingSeconds,
      quotaMode,
      quotaAmountUsd: quotaAmount.toFixed(8),
      todayUsedUsd: usedToday.toFixed(8),
      todayRemainingUsd: remainingToday.toFixed(8),
      nextQuotaRefreshAt: quotaPeriod.nextRefreshAt,
      totalUsedUsd: new Decimal(subscription.totalUsedUsd.toString()).toFixed(8),
      totalRemainingUsd: null,
      walletFallbackRequired: remainingToday.lte(0),
    };
  }

  const usedTotal = new Decimal(subscription.totalUsedUsd.toString());
  const totalCap = quotaAmount.times(subscription.quotaGrantCount);
  const totalRemaining = decimalMaxZero(totalCap.minus(usedTotal));
  return {
    ...subscription,
    remainingSeconds,
    quotaMode,
    quotaAmountUsd: quotaAmount.toFixed(8),
    todayUsedUsd: "0",
    todayRemainingUsd: null,
    nextQuotaRefreshAt: null,
    totalUsedUsd: usedTotal.toFixed(8),
    totalRemainingUsd: totalRemaining.toFixed(8),
    walletFallbackRequired: totalRemaining.lte(0),
  };
}

export function hasAvailableSubscriptionQuota(
  subscription: UserSubscriptionWithPlan,
) {
  const summary = summarizeSubscriptionQuota(subscription);
  if (summary.quotaMode === "UNLIMITED") return true;
  if (summary.quotaMode === "DAILY") {
    return new Decimal(summary.todayRemainingUsd ?? "0").gt(0);
  }
  return new Decimal(summary.totalRemainingUsd ?? "0").gt(0);
}

export async function consumeSubscriptionQuota(tx: Tx, input: {
  userId: string;
  requestId: string;
  amountUsd: Decimal;
}) {
  const subscription = await getActiveSubscriptionWithPlan(tx, input.userId);
  if (!subscription) {
    return {
      subscription: null,
      subscriptionAmount: new Decimal(0),
    };
  }

  await lockSubscriptionRow(tx, subscription.id);
  const locked = await tx.userSubscription.findUniqueOrThrow({
    where: { id: subscription.id },
    include: {
      ...userSubscriptionInclude,
      plan: {
        include: subscriptionPlanInclude,
      },
    },
  });
  const summary = summarizeSubscriptionQuota(locked);
  const available =
    locked.plan.quotaMode === "UNLIMITED"
      ? input.amountUsd
      : locked.plan.quotaMode === "DAILY"
        ? new Decimal(summary.todayRemainingUsd ?? "0")
        : new Decimal(summary.totalRemainingUsd ?? "0");
  const subscriptionAmount = Decimal.min(input.amountUsd, available);
  if (subscriptionAmount.lte(0)) {
    return {
      subscription: locked,
      subscriptionAmount: new Decimal(0),
    };
  }

  const todayKey = shanghaiDateKey();
  const quotaPeriod =
    locked.plan.quotaMode === "DAILY"
      ? getRollingDailyQuotaPeriod(locked)
      : null;
  const usageKey = quotaPeriod?.key ?? todayKey;
  const nextDailyUsed = (() => {
    if (locked.plan.quotaMode !== "DAILY") {
      return new Decimal(locked.dailyUsedUsd.toString());
    }
    if (locked.dailyUsageDateKey !== usageKey) {
      return subscriptionAmount;
    }
    return new Decimal(locked.dailyUsedUsd.toString()).plus(subscriptionAmount);
  })();
  const nextTotalUsed = new Decimal(locked.totalUsedUsd.toString()).plus(subscriptionAmount);
  await tx.userSubscription.update({
    where: { id: locked.id },
    data: {
      dailyUsageDateKey: locked.plan.quotaMode === "DAILY" ? usageKey : locked.dailyUsageDateKey,
      dailyUsedUsd: locked.plan.quotaMode === "DAILY" ? nextDailyUsed.toFixed(8) : locked.dailyUsedUsd.toString(),
      totalUsedUsd: nextTotalUsed.toFixed(8),
    },
  });
  await tx.userSubscriptionUsage.create({
    data: {
      userId: input.userId,
      subscriptionId: locked.id,
      requestId: input.requestId,
      usageDateKey: usageKey,
      amountUsd: subscriptionAmount.toFixed(8),
    },
  });

  return {
    subscription: locked,
    subscriptionAmount,
  };
}

export async function activateUserSubscription(
  tx: Tx,
  input: { userId: string; subscriptionId: string },
) {
  await syncUserSubscriptionState(tx, input.userId);
  const now = new Date();
  const [target, user, active] = await Promise.all([
    tx.userSubscription.findFirst({
      where: {
        id: input.subscriptionId,
        userId: input.userId,
      },
    }),
    tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, tierId: true },
    }),
    tx.userSubscription.findFirst({
      where: {
        userId: input.userId,
        active: true,
        status: "ACTIVE",
      },
      orderBy: { activatedAt: "desc" },
    }),
  ]);

  if (!target) {
    throw Object.assign(new Error("Subscription not found"), {
      statusCode: 404,
    });
  }
  if (!user) {
    throw Object.assign(new Error("User not found"), { statusCode: 404 });
  }
  if (target.status === "DISABLED") {
    throw Object.assign(new Error("Subscription is disabled"), {
      statusCode: 400,
    });
  }

  if (active?.id === target.id && target.endsAt > now) {
    return tx.userSubscription.findUniqueOrThrow({
      where: { id: target.id },
      include: userSubscriptionInclude,
    });
  }

  if (active) {
    await pauseActiveSubscription(tx, active.id, now);
  }

  const remainingSeconds =
    target.active && target.endsAt > now
      ? Math.ceil((target.endsAt.getTime() - now.getTime()) / 1000)
      : target.remainingSeconds;
  if (remainingSeconds <= 0) {
    await tx.userSubscription.update({
      where: { id: target.id },
      data: {
        active: false,
        status: "EXPIRED",
        remainingSeconds: 0,
      },
    });
    throw Object.assign(new Error("Subscription is expired"), {
      statusCode: 400,
    });
  }

  const endsAt = addSeconds(now, remainingSeconds);
  const pausedAt = getPausedAt(target);
  const pausedPeriodKey =
    target.activatedAt && !target.active
      ? getRollingPeriodKey(target.startsAt, pausedAt)
      : null;
  const elapsedQuotaSeconds =
    target.activatedAt && !target.active
      ? Math.max(
          0,
          Math.floor(
            (pausedAt.getTime() - target.startsAt.getTime()) / 1000,
          ) % daySeconds,
        )
      : 0;
  const nextStartsAt =
    target.activatedAt && !target.active
      ? addSeconds(now, -elapsedQuotaSeconds)
      : now;
  const updated = await tx.userSubscription.update({
    where: { id: target.id },
    data: {
      active: true,
      status: "ACTIVE",
      startsAt: nextStartsAt,
      endsAt,
      activatedAt: now,
      remainingSeconds,
      baseTierId: user.tierId,
      ...(pausedPeriodKey && target.dailyUsageDateKey === pausedPeriodKey
        ? { dailyUsageDateKey: getRollingPeriodKey(nextStartsAt, now) }
        : {}),
    },
    include: userSubscriptionInclude,
  });

  await tx.user.update({
    where: { id: input.userId },
    data: { tierId: target.tierId },
  });

  return updated;
}

export async function grantSubscription(
  tx: Tx,
  input: {
    userId: string;
    planId: string;
    source: string;
    redeemCodeId?: string | null;
    remark?: string | null;
  },
) {
  await syncUserSubscriptionState(tx, input.userId);
  const plan = await tx.subscriptionPlan.findUnique({
    where: { id: input.planId },
    include: subscriptionPlanInclude,
  });
  if (!plan) {
    throw Object.assign(new Error("Subscription plan not found"), {
      statusCode: 404,
    });
  }
  if (plan.status !== "ACTIVE" || plan.tier.status !== "ACTIVE") {
    throw Object.assign(new Error("Subscription plan is disabled"), {
      statusCode: 400,
    });
  }

  const addedSeconds = subscriptionSeconds(plan.durationDays);
  const now = new Date();
  const existing = await tx.userSubscription.findFirst({
    where: {
      userId: input.userId,
      planId: input.planId,
      status: { in: ["ACTIVE", "QUEUED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  let subscriptionId = existing?.id;
  if (existing) {
    if (existing.active && existing.endsAt > now) {
      const remainingSeconds = Math.ceil(
        (existing.endsAt.getTime() - now.getTime()) / 1000,
      );
      await tx.userSubscription.update({
        where: { id: existing.id },
        data: {
          endsAt: addSeconds(existing.endsAt, addedSeconds),
          remainingSeconds: remainingSeconds + addedSeconds,
          quotaGrantCount: existing.quotaGrantCount + 1,
          source: input.source,
          redeemCodeId: input.redeemCodeId ?? existing.redeemCodeId,
          remark: input.remark ?? existing.remark,
        },
      });
    } else {
      const pausedAt = getPausedAt(existing);
      await tx.userSubscription.update({
        where: { id: existing.id },
        data: {
          status: "QUEUED",
          active: false,
          remainingSeconds: existing.remainingSeconds + addedSeconds,
          endsAt: addSeconds(pausedAt, existing.remainingSeconds + addedSeconds),
          quotaGrantCount: existing.quotaGrantCount + 1,
          source: input.source,
          redeemCodeId: input.redeemCodeId ?? existing.redeemCodeId,
          remark: input.remark ?? existing.remark,
        },
      });
    }
  } else {
    const created = await tx.userSubscription.create({
      data: {
        userId: input.userId,
        planId: plan.id,
        tierId: plan.tierId,
        status: "QUEUED",
        active: false,
        startsAt: now,
        endsAt: addSeconds(now, addedSeconds),
        remainingSeconds: addedSeconds,
        quotaGrantCount: plan.quotaMode === "TOTAL" ? 1 : 1,
        source: input.source,
        redeemCodeId: input.redeemCodeId,
        remark: input.remark,
      },
    });
    subscriptionId = created.id;
  }

  const active = await tx.userSubscription.findFirst({
    where: { userId: input.userId, active: true, status: "ACTIVE" },
    select: { id: true },
  });
  if (!active && subscriptionId) {
    return activateUserSubscription(tx, {
      userId: input.userId,
      subscriptionId,
    });
  }

  return tx.userSubscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    include: userSubscriptionInclude,
  });
}

export async function syncSubscriptionsForPlanUpdate(
  tx: Tx,
  input: {
    planId: string;
    previousDurationDays: number;
    nextDurationDays: number;
    nextTierId: string;
  },
) {
  const oldSeconds = subscriptionSeconds(input.previousDurationDays);
  const nextSeconds = subscriptionSeconds(input.nextDurationDays);
  const now = new Date();
  const subscriptions = await tx.userSubscription.findMany({
    where: {
      planId: input.planId,
      status: { in: ["ACTIVE", "QUEUED"] },
    },
  });

  for (const subscription of subscriptions) {
    const grantCount = Math.max(1, subscription.quotaGrantCount);
    const grantedSeconds = oldSeconds * grantCount;
    const nextGrantedSeconds = nextSeconds * grantCount;
    const currentRemainingSeconds =
      subscription.active && subscription.endsAt > now
        ? Math.max(
            0,
            Math.ceil((subscription.endsAt.getTime() - now.getTime()) / 1000),
          )
        : subscription.remainingSeconds;
    const consumedSeconds = subscription.active
      ? Math.max(0, grantedSeconds - currentRemainingSeconds)
      : subscription.activatedAt
        ? Math.max(0, grantedSeconds - currentRemainingSeconds)
        : 0;
    const nextRemainingSeconds = Math.max(
      0,
      nextGrantedSeconds - consumedSeconds,
    );
    const nextEndsAt = subscription.active
      ? addSeconds(now, nextRemainingSeconds)
      : subscription.activatedAt
        ? addSeconds(getPausedAt(subscription), nextRemainingSeconds)
        : addSeconds(subscription.startsAt, nextRemainingSeconds);

    if (nextRemainingSeconds <= 0) {
      await tx.userSubscription.update({
        where: { id: subscription.id },
        data: {
          active: false,
          status: "EXPIRED",
          remainingSeconds: 0,
          endsAt: now,
          tierId: input.nextTierId,
        },
      });
      if (subscription.active) {
        await tx.user.update({
          where: { id: subscription.userId },
          data: { tierId: subscription.baseTierId },
        });
      }
      continue;
    }

    await tx.userSubscription.update({
      where: { id: subscription.id },
      data: {
        tierId: input.nextTierId,
        remainingSeconds: nextRemainingSeconds,
        endsAt: nextEndsAt,
      },
    });

    if (subscription.active) {
      await tx.user.update({
        where: { id: subscription.userId },
        data: { tierId: input.nextTierId },
      });
    }
  }
}

export async function pauseActiveSubscription(
  tx: Tx,
  subscriptionId: string,
  now = new Date(),
) {
  const active = await tx.userSubscription.findUnique({
    where: { id: subscriptionId },
  });
  if (!active || !active.active) return;

  const remainingSeconds = Math.max(
    0,
    Math.ceil((active.endsAt.getTime() - now.getTime()) / 1000),
  );
  await tx.userSubscription.update({
    where: { id: subscriptionId },
    data: {
      active: false,
      status: remainingSeconds > 0 ? "QUEUED" : "EXPIRED",
      remainingSeconds,
    },
  });
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}
