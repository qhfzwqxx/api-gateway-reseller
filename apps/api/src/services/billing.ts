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
  getTierCurrencyOptionsOrThrow,
  releaseWalletReservedAmountInTransaction,
  upsertWallet,
  walletToBaseAmount,
} from "./balance-currency.js";
import { applyUnifiedCustomerPricing } from "./unified-pricing.js";
import { consumeSubscriptionQuota, getActiveSubscriptionWithPlan } from "./subscriptions.js";
import type { Usage } from "../types.js";

export const defaultWalletReservationUsd = new Decimal("0.01");
const insufficientBalanceMessage = "你的 APIshare 钱包余额不足，请充值后继续使用。";

export async function ensureWalletCanStart(
  userId: string,
  accessTierId: string | null,
  minimumBalanceUsd: string | null,
) {
  if (!accessTierId) {
    return {
      ok: false as const,
      reason: "当前请求没有可用的访问等级，请联系管理员配置后重试。",
    };
  }
  try {
    const options = await getTierCurrencyOptionsOrThrow(prisma, {
      userId,
      accessTierId,
    });
    const wallets = await prisma.wallet.findMany({
      where: {
        userId,
        currency: { in: options.map((option) => option.currency.code) },
      },
      include: { balanceCurrency: { select: { baseUnitsPerUnit: true } } },
    });
    const walletByCurrency = new Map(
      wallets.map((wallet) => [wallet.currency, wallet]),
    );
    let highestAvailableBalance = new Decimal(0);
    let availableCurrencyCode: string | null = null;

    for (const option of options) {
      const wallet = walletByCurrency.get(option.currency.code);
      if (!wallet) continue;
      const available = Decimal.max(
        0,
        new Decimal(wallet.balance.toString()).minus(wallet.reservedBalance.toString()),
      );
      const availableBase = walletToBaseAmount(available, wallet.balanceCurrency);
      if (availableBase.gt(highestAvailableBalance)) {
        highestAvailableBalance = availableBase;
        availableCurrencyCode = wallet.currency;
      }
    }

    if (
      minimumBalanceUsd !== null &&
      highestAvailableBalance.lt(new Decimal(minimumBalanceUsd))
    ) {
      return { ok: false as const, reason: insufficientBalanceMessage };
    }

    return {
      ok: true as const,
      balance: highestAvailableBalance,
      currencyCode: availableCurrencyCode,
    };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : insufficientBalanceMessage,
    };
  }
}

export async function reserveWalletBalance(params: {
  userId: string;
  accessTierId: string;
  amountUsd?: Decimal;
}) {
  const amount = params.amountUsd ?? defaultWalletReservationUsd;
  if (amount.lte(0)) {
    return { ok: true as const, amount: new Decimal(0), currencyCode: null };
  }

  return prisma.$transaction(async (tx) => {
    const options = await getTierCurrencyOptionsOrThrow(tx, {
      userId: params.userId,
      accessTierId: params.accessTierId,
    });

    for (const option of options) {
      const wallet = await upsertWallet(tx, params.userId, option.currency.code);
      const walletAmount = baseToWalletAmount(amount, option.currency);
      const updatedRows = await tx.$executeRaw(
        Prisma.sql`
          UPDATE "Wallet"
          SET "reservedBalance" = "reservedBalance" + ${walletAmount.toFixed(8)}::numeric
          WHERE "id" = ${wallet.id}
            AND ("balance" - "reservedBalance") >= ${walletAmount.toFixed(8)}::numeric
        `,
      );
      if (updatedRows > 0) {
        return {
          ok: true as const,
          amount,
          currencyCode: option.currency.code,
        };
      }
    }

    return { ok: false as const, reason: insufficientBalanceMessage };
  });
}

export async function releaseWalletReservedAmount(params: {
  userId: string;
  currencyCode: string | null;
  amountUsd: Decimal;
}) {
  await prisma.$transaction((tx) =>
    releaseWalletReservedAmountInTransaction(tx, params),
  );
}

export async function releaseWalletReservation(params: {
  requestId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "ApiRequest" WHERE "id" = ${params.requestId} FOR UPDATE`,
    );
    const request = await tx.apiRequest.findUnique({
      where: { id: params.requestId },
      select: {
        userId: true,
        walletCurrency: true,
        reservedAmountUsd: true,
      },
    });
    if (!request || request.userId !== params.userId) return;

    await releaseWalletReservedAmountInTransaction(tx, {
      userId: request.userId,
      currencyCode: request.walletCurrency,
      amountUsd: request.reservedAmountUsd.toString(),
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
  const chargePrice = await applyUnifiedCustomerPricing(params.price);
  const { upstreamCostUsd, chargedAmountUsd: baseChargedAmountUsd } =
    calculateCharges(chargePrice, params.usage);
  const billingMultiplier = await readAccessTierBillingMultiplier(params.accessTierId);
  const chargedAmountUsd = baseChargedAmountUsd
    .mul(billingMultiplier)
    .toDecimalPlaces(8);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "ApiRequest" WHERE "id" = ${params.requestId} FOR UPDATE`,
    );
    const existingRequest = await tx.apiRequest.findUnique({
      where: { id: params.requestId },
      select: {
        id: true,
        apiKeyId: true,
        accessTierId: true,
        status: true,
        reservedAmountUsd: true,
        walletCurrency: true,
      },
    });
    if (!existingRequest) throw new Error("API request not found");
    if (existingRequest.status !== "PENDING") return existingRequest;

    const accessTierId = params.accessTierId ?? existingRequest.accessTierId;
    if (!accessTierId) {
      throw Object.assign(new Error("请求缺少最终访问等级，无法结算。"), {
        statusCode: 409,
      });
    }
    const currencyOptions = await getTierCurrencyOptionsOrThrow(tx, {
      userId: params.userId,
      accessTierId,
    });
    const defaultCurrencyCode = currencyOptions[0]?.currency.code;
    if (!defaultCurrencyCode) {
      throw Object.assign(
        new Error("该访问等级尚未配置可用货币，请联系管理员配置后重试。"),
        { statusCode: 409 },
      );
    }
    const reservedAmount = new Decimal(existingRequest.reservedAmountUsd.toString());

    const subscriptionState = await getActiveSubscriptionWithPlan(tx, params.userId);
    const subscriptionCharge = subscriptionState
      ? (
          await consumeSubscriptionQuota(tx, {
            userId: params.userId,
            requestId: params.requestId,
            amountUsd: chargedAmountUsd,
          })
        ).subscriptionAmount
      : new Decimal(0);
    const walletChargeUsd = chargedAmountUsd.minus(subscriptionCharge);
    const finalChargedAmountUsd = subscriptionCharge.plus(walletChargeUsd);

    let chargedCurrencyCode: string | null = null;
    let chargedWalletAmount = new Decimal(0);
    let chargedBalanceBefore = new Decimal(0);
    let chargedBalanceAfter = new Decimal(0);

    if (walletChargeUsd.gt(0)) {
      const preferredReservedOption = existingRequest.walletCurrency
        ? currencyOptions.find(
            (option) => option.currency.code === existingRequest.walletCurrency,
          )
        : undefined;
      const orderedOptions = preferredReservedOption
        ? [
            preferredReservedOption,
            ...currencyOptions.filter(
              (option) => option.currency.code !== preferredReservedOption.currency.code,
            ),
          ]
        : currencyOptions;

      for (const option of orderedOptions) {
        const wallet = await upsertWallet(tx, params.userId, option.currency.code);
        const walletAmount = baseToWalletAmount(walletChargeUsd, option.currency);
        const reservedWalletAmount =
          existingRequest.walletCurrency === option.currency.code
            ? baseToWalletAmount(reservedAmount, option.currency)
            : new Decimal(0);
        const updatedRows = await tx.$executeRaw(
          Prisma.sql`
            UPDATE "Wallet"
            SET
              "balance" = "balance" - ${walletAmount.toFixed(8)}::numeric,
              "reservedBalance" = GREATEST(
                0,
                "reservedBalance" - ${reservedWalletAmount.toFixed(8)}::numeric
              )
            WHERE "id" = ${wallet.id}
              AND "balance" - "reservedBalance" + ${reservedWalletAmount.toFixed(8)}::numeric
                >= ${walletAmount.toFixed(8)}::numeric
          `,
        );
        if (updatedRows === 0) continue;

        const updatedWallet = await tx.wallet.findUniqueOrThrow({
          where: { id: wallet.id },
          select: { balance: true },
        });
        chargedCurrencyCode = option.currency.code;
        chargedWalletAmount = walletAmount;
        chargedBalanceAfter = new Decimal(updatedWallet.balance.toString());
        chargedBalanceBefore = chargedBalanceAfter.plus(walletAmount);
        break;
      }

      if (!chargedCurrencyCode) {
        throw Object.assign(new Error(insufficientBalanceMessage), { statusCode: 402 });
      }
    }

    if (
      reservedAmount.gt(0) &&
      existingRequest.walletCurrency &&
      existingRequest.walletCurrency !== chargedCurrencyCode
    ) {
      await releaseWalletReservedAmountInTransaction(tx, {
        userId: params.userId,
        currencyCode: existingRequest.walletCurrency,
        amountUsd: reservedAmount,
      });
    }

    if (chargedCurrencyCode) {
      await tx.walletTransaction.create({
        data: {
          userId: params.userId,
          requestId: params.requestId,
          type: "CHARGE",
          source: "API_CHARGE",
          amount: chargedWalletAmount.negated().toFixed(8),
          balanceBefore: chargedBalanceBefore.toFixed(8),
          balanceAfter: chargedBalanceAfter.toFixed(8),
          currency: chargedCurrencyCode,
          remark: `API usage ${params.price.model}`,
          metadata: billingMetadata({
            usage: params.usage,
            upstreamCostUsd,
            chargedAmountUsd: finalChargedAmountUsd,
            calculatedChargedAmountUsd: chargedAmountUsd,
            subscriptionChargedAmountUsd: subscriptionCharge,
            walletChargedAmountUsd: walletChargeUsd,
            walletAmount: chargedWalletAmount,
            walletCurrency: chargedCurrencyCode,
          }),
        },
      });
    } else if (subscriptionState) {
      await tx.walletTransaction.create({
        data: {
          userId: params.userId,
          requestId: params.requestId,
          type: "CHARGE",
          source: "SUBSCRIPTION_ONLY",
          amount: "0",
          balanceBefore: "0",
          balanceAfter: "0",
          currency: existingRequest.walletCurrency ?? defaultCurrencyCode,
          remark: `API usage ${params.price.model}`,
          metadata: billingMetadata({
            usage: params.usage,
            upstreamCostUsd,
            chargedAmountUsd: finalChargedAmountUsd,
            calculatedChargedAmountUsd: chargedAmountUsd,
            subscriptionChargedAmountUsd: subscriptionCharge,
            walletChargedAmountUsd: new Decimal(0),
            walletAmount: new Decimal(0),
            walletCurrency:
              existingRequest.walletCurrency ?? defaultCurrencyCode,
          }),
        },
      });
    }

    await tx.apiRequest.update({
      where: { id: params.requestId },
      data: {
        status: "SUCCESS",
        resultType: "PROXIED_SUCCESS",
        inputTokens: params.usage.inputTokens,
        cachedInputTokens: params.usage.cachedInputTokens,
        outputTokens: params.usage.outputTokens,
        totalTokens: params.usage.totalTokens,
        latencyMs:
          params.startedAt === undefined
            ? undefined
            : Math.round(performance.now() - params.startedAt),
        upstreamCostUsd: upstreamCostUsd.toFixed(8),
        chargedAmountUsd: finalChargedAmountUsd.toFixed(8),
        subscriptionChargedAmountUsd: subscriptionCharge.toFixed(8),
        walletChargedAmountUsd: walletChargeUsd.toFixed(8),
        reservedAmountUsd: "0",
        walletCurrency:
          chargedCurrencyCode ?? existingRequest.walletCurrency ?? defaultCurrencyCode,
        responseUsage:
          params.usage.raw === undefined
            ? undefined
            : (sanitizeJsonForPostgres(params.usage.raw) as object),
      },
    });

    const apiRequest = await tx.apiRequest.findUniqueOrThrow({
      where: { id: params.requestId },
    });
    await disableApiKeyIfTotalLimitReached(tx, apiRequest);
    return apiRequest;
  });
}

function billingMetadata(input: {
  usage: Usage;
  upstreamCostUsd: Decimal;
  chargedAmountUsd: Decimal;
  calculatedChargedAmountUsd: Decimal;
  subscriptionChargedAmountUsd: Decimal;
  walletChargedAmountUsd: Decimal;
  walletAmount: Decimal;
  walletCurrency: string;
}) {
  return {
    inputTokens: input.usage.inputTokens,
    cachedInputTokens: input.usage.cachedInputTokens,
    totalInputTokens: input.usage.inputTokens + input.usage.cachedInputTokens,
    outputTokens: input.usage.outputTokens,
    totalTokens: input.usage.totalTokens,
    upstreamCostUsd: input.upstreamCostUsd.toFixed(8),
    chargedAmountUsd: input.chargedAmountUsd.toFixed(8),
    calculatedChargedAmountUsd: input.calculatedChargedAmountUsd.toFixed(8),
    subscriptionChargedAmountUsd: input.subscriptionChargedAmountUsd.toFixed(8),
    walletChargedAmountUsd: input.walletChargedAmountUsd.toFixed(8),
    walletAmount: input.walletAmount.toFixed(8),
    walletCurrency: input.walletCurrency,
  };
}

async function disableApiKeyIfTotalLimitReached(
  tx: Prisma.TransactionClient,
  apiRequest: Pick<ApiRequest, "apiKeyId">,
) {
  if (!apiRequest.apiKeyId) return;

  const apiKey = await tx.apiKey.findUnique({
    where: { id: apiRequest.apiKeyId },
    select: { id: true, totalLimitUsd: true, status: true },
  });
  if (apiKey?.status !== "ACTIVE" || !apiKey.totalLimitUsd) return;

  const limit = new Decimal(apiKey.totalLimitUsd.toString());
  if (limit.lte(0)) return;
  const usage = await tx.apiRequest.aggregate({
    where: { apiKeyId: apiKey.id, status: "SUCCESS" },
    _sum: { chargedAmountUsd: true },
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

async function readAccessTierBillingMultiplier(accessTierId?: string | null) {
  if (!accessTierId) return new Decimal(1);
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
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "ApiRequest" WHERE "id" = ${request.id} FOR UPDATE`,
    );
    const existingRequest = await tx.apiRequest.findUnique({
      where: { id: request.id },
      select: {
        userId: true,
        walletCurrency: true,
        reservedAmountUsd: true,
        status: true,
      },
    });
    if (!existingRequest || existingRequest.status !== "PENDING") return false;

    await releaseWalletReservedAmountInTransaction(tx, {
      userId: existingRequest.userId,
      currencyCode: existingRequest.walletCurrency,
      amountUsd: existingRequest.reservedAmountUsd.toString(),
    });
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
