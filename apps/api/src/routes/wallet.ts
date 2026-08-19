import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { requireAdmin, requireUser } from "../services/auth.js";
import {
  applyWalletBalanceDelta,
  balanceCurrencySelect,
  getUsableBalanceCurrencyOrThrow,
  normalizeCurrencyCode,
} from "../services/balance-currency.js";

const walletTransactionSelect = {
  id: true,
  type: true,
  source: true,
  amount: true,
  balanceBefore: true,
  balanceAfter: true,
  currency: true,
  remark: true,
  metadata: true,
  createdAt: true,
  balanceCurrency: {
    select: {
      symbol: true,
      icon: true,
      name: true,
    },
  },
  apiRequest: {
    select: {
      chargedAmountUsd: true,
      subscriptionChargedAmountUsd: true,
      walletChargedAmountUsd: true,
    },
  },
} as const;

export async function walletRoutes(app: FastifyInstance) {
  app.get("/wallet", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const wallets = await prisma.wallet.findMany({
      where: { userId: user.sub },
      select: {
        id: true,
        balance: true,
        reservedBalance: true,
        currency: true,
        balanceCurrency: { select: balanceCurrencySelect },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [
        { balanceCurrency: { sortOrder: "asc" } },
        { currency: "asc" },
      ],
    });
    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: walletTransactionSelect,
    });

    return { wallets, transactions };
  });

  app.get("/wallet/transactions", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(18),
        currency: z.string().trim().min(1).max(32).optional(),
      })
      .parse(request.query);
    const where = {
      userId: user.sub,
      ...(query.currency
        ? { currency: normalizeCurrencyCode(query.currency) }
        : {}),
    };
    const [total, transactions] = await Promise.all([
      prisma.walletTransaction.count({ where }),
      prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: walletTransactionSelect,
      }),
    ]);

    return {
      transactions,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  });

  app.post(
    "/wallet/recharge",
    { preHandler: [requireUser, requireAdmin] },
    async (request) => {
      const body = z
        .object({
          userId: z.string(),
          amount: z.string().or(z.number()).transform(String),
          currency: z.string().trim().min(1).max(32).default("POINTS"),
          remark: z.string().optional(),
        })
        .parse(request.body);

      const amount = new Decimal(body.amount);

      if (!amount.isFinite() || amount.lte(0)) {
        return { ok: false, message: "Amount must be positive" };
      }

      const result = await prisma.$transaction(async (tx) => {
        const currency = await getUsableBalanceCurrencyOrThrow(
          tx,
          normalizeCurrencyCode(body.currency),
          "充值",
        );
        const { wallet: updatedWallet, balanceBefore, balanceAfter } =
          await applyWalletBalanceDelta(tx, {
            userId: body.userId,
            currencyCode: currency.code,
            amount,
          });

        const transaction = await tx.walletTransaction.create({
          data: {
            userId: body.userId,
            type: "RECHARGE",
            source: "ADMIN_RECHARGE",
            amount: amount.toFixed(8),
            balanceBefore: balanceBefore.toFixed(8),
            balanceAfter: balanceAfter.toFixed(8),
            currency: currency.code,
            remark: body.remark ?? "Manual recharge",
          },
        });

        return { wallet: updatedWallet, transaction };
      });

      return result;
    },
  );
}
