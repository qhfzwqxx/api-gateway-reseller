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
import {
  baseToWalletAmount,
  getActiveBalanceCurrency,
  walletToBaseAmount,
} from "./balance-currency.js";
import { applyUnifiedCustomerPricing } from "./unified-pricing.js";
import { consumeSubscriptionQuota, getActiveSubscriptionWithPlan } from "./subscriptions.js";
import type { Usage } from "../types.js";

export const defaultWalletReservationUsd = new Decimal("0.01");

export async function ensureWalletCanStart(userId: string, minimumBalanceUsd: string | null) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    include: { balanceCurrency: { select: { baseUnitsPerUnit: true } } },
  });

  if (!wallet) {
    return {
      ok: false as const,
      reason: "你的 APIshare 钱包余额不足，请充值后继续使用。",
    };
  }

  const balance = walletToBaseAmount(wallet.balance.toString(), wallet.balanceCurrency);

  if (minimumBalanceUsd !== null && balance.lt(new Decimal(minimumBalanceUsd))) {
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
      include: { balanceCurrency: { select: { baseUnitsPerUnit: true } } },
    });
    if (!wallet) {
      return { ok: false as const, reason: "Wallet not found" };
    }

    const reservedBalance = new Decimal(wallet.reservedBalance.toString());
    const balance = new Decimal(wallet.balance.toString());
    const walletAmount = baseToWalletAmount(amount, wallet.balanceCurrency);
    const available = balance.minus(reservedBalance);
    if (available.lt(walletAmount)) {
      return { ok: false as const, reason: "Insufficient available balance" };
    }

    const updatedRows = await tx.$executeRaw(
      Prisma.sql`
        UPDATE "Wallet"
        SET "reservedBalance" = "reservedBalance" + ${walletAmount.toFixed(8)}::numeric
        WHERE "userId" = ${params.userId}
          AND ("balance" - "reservedBalance") >= ${walletAmount.toFixed(8)}::numeric
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
      include: { balanceCurrency: { select: { baseUnitsPerUnit: true } } },
    });
    const currentReserved = new Decimal(
      wallet?.reservedBalance?.toString() ?? "0",
    );
    const walletAmount = wallet
      ? baseToWalletAmount(params.amountUsd, wallet.balanceCurrency)
      : new Decimal(0);

    await tx.wallet.update({
      where: { userId: params.userId },
      data: {
        reservedBalance: Decimal.max(
          0,
          currentReserved.minus(walletAmount),
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
      include: { balanceCurrency: { select: { baseUnitsPerUnit: true } } },
    });
    const currentReserved = new Decimal(wallet?.reservedBalance?.toString() ?? "0");
    const walletAmount = wallet
      ? baseToWalletAmount(reservedAmount, wallet.balanceCurrency)
      : new Decimal(0);

    await tx.wallet.update({
      where: { userId: params.userId },
      data: {
        reservedBalance: Decimal.max(0, currentReserved.minus(walletAmount)).toFixed(8),
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
    const walletChargeUsd = chargedAmountUsd.minus(subscriptionCharge);
    const finalChargedAmountUsd = subscriptionCharge.plus(walletChargeUsd);

    let balanceBefore = new Decimal(0);
    let balanceAfter = new Decimal(0);
    let walletCharge = new Decimal(0);
    if (walletChargeUsd.gt(0)) {
      const wallet = await tx.wallet.findUnique({
        where: { userId },
        include: { balanceCurrency: { select: { baseUnitsPerUnit: true } } },
      });

      if (!wallet) {
        throw new Error("Wallet not found");
      }

      balanceBefore = new Decimal(wallet.balance.toString());
      const reservedBalance = new Decimal(wallet.reservedBalance.toString());
      walletCharge = baseToWalletAmount(walletChargeUsd, wallet.balanceCurrency);
      const reservedWalletAmount = baseToWalletAmount(
        reservedAmount,
        wallet.balanceCurrency,
      );
      balanceAfter = balanceBefore.minus(walletCharge);

      await tx.wallet.update({
        where: { userId },
        data: {
          balance: balanceAfter.toFixed(8),
          reservedBalance: Decimal.max(
            0,
            reservedBalance.minus(reservedWalletAmount),
          ).toFixed(8),
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
          currency: wallet.currency,
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
            walletChargedAmountUsd: walletChargeUsd.toFixed(8),
            walletAmount: walletCharge.toFixed(8),
            walletCurrency: wallet.currency,
          },
        },
      });
    } else if (subscriptionState) {
      const activeCurrency = await getActiveBalanceCurrency(tx);
      await tx.walletTransaction.create({
        data: {
          userId,
          requestId,
          type: "CHARGE",
          source: "SUBSCRIPTION_ONLY",
          amount: "0",
          balanceBefore: "0",
          balanceAfter: "0",
          currency: activeCurrency.code,
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

    if (reservedAmount.gt(0) && walletChargeUsd.lte(0)) {
      const wallet = await tx.wallet.findUnique({
        where: { userId },
        include: { balanceCurrency: { select: { baseUnitsPerUnit: true } } },
      });
      const reservedBalance = new Decimal(
        wallet?.reservedBalance?.toString() ?? "0",
      );
      const walletReservedAmount = wallet
        ? baseToWalletAmount(reservedAmount, wallet.balanceCurrency)
        : new Decimal(0);
      await tx.wallet.update({
        where: { userId },
        data: {
          reservedBalance: Decimal.max(
            0,
            reservedBalance.minus(walletReservedAmount),
          ).toFixed(8),
        },
      });
    }

    await tx.apiRequest.update({
      where: { id: requestId },
      data: {
        chargedAmountUsd: finalChargedAmountUsd.toFixed(8),
        subscriptionChargedAmountUsd: subscriptionCharge.toFixed(8),
        walletChargedAmountUsd: walletChargeUsd.toFixed(8),
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
        include: { balanceCurrency: { select: { baseUnitsPerUnit: true } } },
      });
      const currentReserved = new Decimal(
        wallet?.reservedBalance?.toString() ?? "0",
      );
      const walletAmount = wallet
        ? baseToWalletAmount(reservedAmount, wallet.balanceCurrency)
        : new Decimal(0);
      await tx.wallet.update({
        where: { userId: existingRequest.userId },
        data: {
          reservedBalance: Decimal.max(0, currentReserved.minus(walletAmount)).toFixed(8),
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
