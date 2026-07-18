import { Decimal } from "decimal.js";
import { performance } from "node:perf_hooks";
import { Prisma } from "@prisma/client";
import {
  prisma,
  type ApiRequest,
  type ApiRequestResultType,
  type ModelPrice,
} from "@gateway/db";
import { sanitizeJsonForPostgres, sanitizePostgresText } from "../lib/db-sanitize.js";
import { calculateCharges } from "../lib/money.js";
import { applyUnifiedCustomerPricing } from "./unified-pricing.js";
import { consumeSubscriptionQuota, getActiveSubscriptionWithPlan } from "./subscriptions.js";
import type { Usage } from "../types.js";

export const defaultWalletReservationUsd = new Decimal("0.01");

export async function ensureWalletCanStart(userId: string) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
  });

  if (!wallet) {
    return {
      ok: false as const,
      reason: "你的 APIshare 钱包余额不足，请充值后继续使用。",
    };
  }

  const balance = new Decimal(wallet.balance.toString());

  if (balance.lte(0)) {
    return {
      ok: false as const,
      reason: "你的 APIshare 钱包余额不足，请充值后继续使用。",
    };
  }

  return { ok: true as const, balance };
}

export async function reserveWalletBalance(params: {
  userId: string;
  amountUsd?: Decimal;
}) {
  const amount = params.amountUsd ?? defaultWalletReservationUsd;
  if (amount.lte(0)) {
    return { ok: true as const, amount: new Decimal(0) };
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId: params.userId },
    });
    if (!wallet) {
      return { ok: false as const, reason: "Wallet not found" };
    }

    const reservedBalance = new Decimal(wallet.reservedBalance.toString());
    const balance = new Decimal(wallet.balance.toString());
    const available = balance.minus(reservedBalance);
    if (available.lt(amount)) {
      return { ok: false as const, reason: "Insufficient available balance" };
    }

    const updatedRows = await tx.$executeRaw(
      Prisma.sql`
        UPDATE "Wallet"
        SET "reservedBalance" = "reservedBalance" + ${amount.toFixed(8)}::numeric
        WHERE "userId" = ${params.userId}
          AND ("balance" - "reservedBalance") >= ${amount.toFixed(8)}::numeric
      `,
    );

    if (updatedRows === 0) {
      return { ok: false as const, reason: "Insufficient available balance" };
    }

    return { ok: true as const, amount };
  });
}

export async function releaseWalletReservedAmount(params: {
  userId: string;
  amountUsd: Decimal;
}) {
  if (params.amountUsd.lte(0)) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId: params.userId },
      select: { reservedBalance: true },
    });
    const currentReserved = new Decimal(
      wallet?.reservedBalance?.toString() ?? "0",
    );

    await tx.wallet.update({
      where: { userId: params.userId },
      data: {
        reservedBalance: Decimal.max(
          0,
          currentReserved.minus(params.amountUsd),
        ).toFixed(8),
      },
    });
  });
}

export async function releaseWalletReservation(params: {
  requestId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.apiRequest.findUnique({
      where: { id: params.requestId },
      select: { reservedAmountUsd: true },
    });
    const reservedAmount = new Decimal(request?.reservedAmountUsd?.toString() ?? "0");
    if (reservedAmount.lte(0)) {
      return;
    }

    const wallet = await tx.wallet.findUnique({
      where: { userId: params.userId },
      select: { reservedBalance: true },
    });
    const currentReserved = new Decimal(wallet?.reservedBalance?.toString() ?? "0");

    await tx.wallet.update({
      where: { userId: params.userId },
      data: {
        reservedBalance: Decimal.max(0, currentReserved.minus(reservedAmount)).toFixed(8),
      },
    });
    await tx.apiRequest.update({
      where: { id: params.requestId },
      data: { reservedAmountUsd: "0" },
    });
  });
}

export async function chargeForRequest(params: {
  requestId: string;
  userId: string;
  price: ModelPrice;
  usage: Usage;
  accessTierId?: string | null;
  startedAt?: number;
}) {
  const {
    requestId,
    userId,
    price,
    usage,
    accessTierId,
    startedAt,
  } = params;
  const chargePrice = await applyUnifiedCustomerPricing(price);
  const { upstreamCostUsd, chargedAmountUsd: baseChargedAmountUsd } =
    calculateCharges(chargePrice, usage);
  const billingMultiplier = await readAccessTierBillingMultiplier(accessTierId);
  const chargedAmountUsd = baseChargedAmountUsd
    .mul(billingMultiplier)
    .toDecimalPlaces(8);

  return prisma.$transaction(async (tx) => {
    const existingRequest = await tx.apiRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        apiKeyId: true,
        status: true,
        reservedAmountUsd: true,
      },
    });

    if (!existingRequest) {
      throw new Error("API request not found");
    }

    if (existingRequest.status !== "PENDING") {
      return existingRequest;
    }

    const updateResult = await tx.apiRequest.updateMany({
      where: {
        id: requestId,
        status: "PENDING",
      },
      data: {
        status: "SUCCESS",
        resultType: "PROXIED_SUCCESS",
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        latencyMs: startedAt === undefined ? undefined : Math.round(performance.now() - startedAt),
        upstreamCostUsd: upstreamCostUsd.toFixed(8),
        chargedAmountUsd: chargedAmountUsd.toFixed(8),
        subscriptionChargedAmountUsd: "0",
        walletChargedAmountUsd: "0",
        reservedAmountUsd: "0",
        responseUsage: usage.raw === undefined ? undefined : (sanitizeJsonForPostgres(usage.raw) as object),
      },
    });

    if (updateResult.count === 0) {
      return existingRequest;
    }
    const reservedAmount = new Decimal(
      existingRequest.reservedAmountUsd?.toString() ?? "0",
    );

    const subscriptionState = await getActiveSubscriptionWithPlan(tx, userId);
    const subscriptionCharge = subscriptionState
      ? (await consumeSubscriptionQuota(tx, {
          userId,
          requestId,
          amountUsd: chargedAmountUsd,
        })).subscriptionAmount
      : new Decimal(0);
    const walletCharge = chargedAmountUsd.minus(subscriptionCharge);
    const finalChargedAmountUsd = subscriptionCharge.plus(walletCharge);

    let balanceBefore = new Decimal(0);
    let balanceAfter = new Decimal(0);
    if (walletCharge.gt(0)) {
      const wallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      balanceBefore = new Decimal(wallet.balance.toString());
      const reservedBalance = new Decimal(wallet.reservedBalance.toString());
      balanceAfter = balanceBefore.minus(walletCharge);

      await tx.wallet.update({
        where: { userId },
        data: {
          balance: balanceAfter.toFixed(8),
          reservedBalance: Decimal.max(0, reservedBalance.minus(reservedAmount)).toFixed(8),
        },
      });

      await tx.walletTransaction.create({
        data: {
          userId,
          requestId,
          type: "CHARGE",
          source: "API_CHARGE",
          amount: walletCharge.negated().toFixed(8),
          balanceBefore: balanceBefore.toFixed(8),
          balanceAfter: balanceAfter.toFixed(8),
          remark: `API usage ${price.model}`,
          metadata: {
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            totalInputTokens: usage.inputTokens + usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            upstreamCostUsd: upstreamCostUsd.toFixed(8),
            chargedAmountUsd: finalChargedAmountUsd.toFixed(8),
            calculatedChargedAmountUsd: chargedAmountUsd.toFixed(8),
            subscriptionChargedAmountUsd: subscriptionCharge.toFixed(8),
            walletChargedAmountUsd: walletCharge.toFixed(8),
          },
        },
      });
    } else if (subscriptionState) {
      await tx.walletTransaction.create({
        data: {
          userId,
          requestId,
          type: "CHARGE",
          source: "SUBSCRIPTION_ONLY",
          amount: "0",
          balanceBefore: "0",
          balanceAfter: "0",
          remark: `API usage ${price.model}`,
          metadata: {
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            totalInputTokens: usage.inputTokens + usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            upstreamCostUsd: upstreamCostUsd.toFixed(8),
            chargedAmountUsd: finalChargedAmountUsd.toFixed(8),
            calculatedChargedAmountUsd: chargedAmountUsd.toFixed(8),
            subscriptionChargedAmountUsd: subscriptionCharge.toFixed(8),
            walletChargedAmountUsd: "0",
          },
        },
      });
    }

    if (reservedAmount.gt(0) && walletCharge.lte(0)) {
      const wallet = await tx.wallet.findUnique({
        where: { userId },
        select: { reservedBalance: true },
      });
      const reservedBalance = new Decimal(
        wallet?.reservedBalance?.toString() ?? "0",
      );
      await tx.wallet.update({
        where: { userId },
        data: {
          reservedBalance: Decimal.max(
            0,
            reservedBalance.minus(reservedAmount),
          ).toFixed(8),
        },
      });
    }

    await tx.apiRequest.update({
      where: { id: requestId },
      data: {
        chargedAmountUsd: finalChargedAmountUsd.toFixed(8),
        subscriptionChargedAmountUsd: subscriptionCharge.toFixed(8),
        walletChargedAmountUsd: walletCharge.toFixed(8),
        reservedAmountUsd: "0",
      },
    });

    const apiRequest = await tx.apiRequest.findUniqueOrThrow({
      where: { id: requestId },
    });

    if (apiRequest.apiKeyId) {
      const apiKey = await tx.apiKey.findUnique({
        where: { id: apiRequest.apiKeyId },
        select: {
          id: true,
          totalLimitUsd: true,
          status: true,
        },
      });

      if (apiKey?.status === "ACTIVE" && apiKey.totalLimitUsd) {
        const limit = new Decimal(apiKey.totalLimitUsd.toString());
        if (limit.gt(0)) {
          const usage = await tx.apiRequest.aggregate({
            where: {
              apiKeyId: apiKey.id,
              status: "SUCCESS",
            },
            _sum: {
              chargedAmountUsd: true,
            },
          });
          const usedUsd = new Decimal(usage._sum.chargedAmountUsd?.toString() ?? "0");
          if (usedUsd.gte(limit)) {
            await tx.apiKey.update({
              where: { id: apiKey.id },
              data: {
                status: "DISABLED",
                disabledReason: "Total quota reached",
                disabledAt: new Date(),
              },
            });
          }
        }
      }
    }

    return apiRequest;
  });
}

async function readAccessTierBillingMultiplier(accessTierId?: string | null) {
  if (!accessTierId) {
    return new Decimal(1);
  }

  const tier = await prisma.accessTier.findUnique({
    where: { id: accessTierId },
    select: { billingMultiplier: true },
  });

  return new Decimal(tier?.billingMultiplier?.toString() ?? "1");
}

export async function markRequestFailed(
  request: Pick<ApiRequest, "id">,
  errorMessage: string,
  httpStatus?: number,
  latencyMs?: number,
  responseUsage?: unknown,
  resultType: ApiRequestResultType = "GATEWAY_ERROR",
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const existingRequest = await tx.apiRequest.findUnique({
      where: { id: request.id },
      select: {
        userId: true,
        reservedAmountUsd: true,
        status: true,
      },
    });

    if (!existingRequest || existingRequest.status !== "PENDING") {
      return false;
    }

    const reservedAmount = new Decimal(
      existingRequest.reservedAmountUsd?.toString() ?? "0",
    );
    if (reservedAmount.gt(0)) {
      const wallet = await tx.wallet.findUnique({
        where: { userId: existingRequest.userId },
        select: { reservedBalance: true },
      });
      const currentReserved = new Decimal(
        wallet?.reservedBalance?.toString() ?? "0",
      );
      await tx.wallet.update({
        where: { userId: existingRequest.userId },
        data: {
          reservedBalance: Decimal.max(
            0,
            currentReserved.minus(reservedAmount),
          ).toFixed(8),
        },
      });
    }

    await tx.apiRequest.update({
      where: { id: request.id },
      data: {
        status: "FAILED",
        resultType,
        errorMessage: sanitizePostgresText(errorMessage),
        httpStatus,
        latencyMs,
        reservedAmountUsd: "0",
        ...(responseUsage === undefined
          ? {}
          : { responseUsage: sanitizeJsonForPostgres(responseUsage) as object }),
      },
    });

    return true;
  });
}
