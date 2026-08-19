import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { hashSecret } from "../lib/crypto.js";
import { requireUser } from "../services/auth.js";
import {
  grantSubscription,
  summarizeSubscriptionQuota,
} from "../services/subscriptions.js";
import {
  baseToWalletAmount,
  getBalanceCurrencyOrThrow,
  upsertWalletWithActiveCurrency,
  walletToBaseAmount,
} from "../services/balance-currency.js";

export async function redeemCodeRoutes(app: FastifyInstance) {
  app.post(
    "/redeem-codes/redeem",
    { preHandler: requireUser },
    async (request, reply) => {
      const user = request.user as { sub: string };
      const body = z
        .object({
          code: z.string().min(8).max(160),
        })
        .parse(request.body);
      const codeHash = hashSecret(body.code.trim());

      try {
        const result = await prisma.$transaction(
          async (tx) => {
            const redeemCode = await tx.redeemCode.findUnique({
              where: { codeHash },
              include: {
                subscriptionPlan: {
                  include: {
                    tier: {
                      select: {
                        id: true,
                        code: true,
                        name: true,
                        status: true,
                      },
                    },
                  },
                },
              },
            });

            if (!redeemCode) {
              throw new RedeemError("兑换码无效。");
            }

            if (redeemCode.status !== "ACTIVE") {
              throw new RedeemError("兑换码已停用。");
            }

            if (redeemCode.expiresAt && redeemCode.expiresAt < new Date()) {
              throw new RedeemError("兑换码已过期。");
            }

            if (redeemCode.redeemedCount >= redeemCode.maxRedemptions) {
              throw new RedeemError("兑换码已被使用完。");
            }

            const currentUser = await tx.user.findUnique({
              where: { id: user.sub },
              select: { id: true, tierId: true },
            });

            if (!currentUser) {
              throw new RedeemError("用户不存在，请重新登录。");
            }

            if (
              redeemCode.validUserTierId &&
              redeemCode.validUserTierId !== currentUser.tierId
            ) {
              throw new RedeemError("当前账号等级不能使用这个兑换码。");
            }

            const redeemedByUser = await tx.redeemCodeRedemption.count({
              where: {
                redeemCodeId: redeemCode.id,
                userId: user.sub,
              },
            });

            if (redeemedByUser >= redeemCode.perUserLimit) {
              throw new RedeemError("你已经达到这个兑换码的使用次数限制。");
            }

            if (redeemCode.rewardType === "SUBSCRIPTION") {
              if (
                !redeemCode.subscriptionPlanId ||
                !redeemCode.subscriptionPlan
              ) {
                throw new RedeemError("兑换码订阅套餐不存在，请联系管理员。");
              }

              const updatedCode = await tx.redeemCode.updateMany({
                where: {
                  id: redeemCode.id,
                  redeemedCount: { lt: redeemCode.maxRedemptions },
                },
                data: {
                  redeemedCount: { increment: 1 },
                },
              });

              if (updatedCode.count === 0) {
                throw new RedeemError("兑换码已被使用完。");
              }

              const subscription = await grantSubscription(tx, {
                userId: user.sub,
                planId: redeemCode.subscriptionPlanId,
                source: "REDEEM",
                redeemCodeId: redeemCode.id,
                remark: `Redeem code ${redeemCode.codePrefix}`,
              });

              await tx.redeemCodeRedemption.create({
                data: {
                  redeemCodeId: redeemCode.id,
                  userId: user.sub,
                  amount: "0",
                },
              });

              return {
                subscription: summarizeSubscriptionQuota(subscription),
                redeemed: {
                  type: "SUBSCRIPTION",
                  codePrefix: redeemCode.codePrefix,
                  subscriptionPlan: redeemCode.subscriptionPlan,
                },
              };
            }

            const amount = new Decimal(redeemCode.amount.toString());
            if (!amount.isFinite() || amount.lte(0)) {
              throw new RedeemError("兑换码金额异常，请联系管理员。");
            }

            const codeCurrency = await getBalanceCurrencyOrThrow(
              tx,
              redeemCode.currency,
            );
            const wallet = await upsertWalletWithActiveCurrency(tx, user.sub);
            const balanceBefore = new Decimal(wallet.balance.toString());
            const walletAmount = baseToWalletAmount(
              walletToBaseAmount(amount, codeCurrency),
              await getBalanceCurrencyOrThrow(tx, wallet.currency),
            );
            const balanceAfter = balanceBefore.plus(walletAmount);

            const updatedWallet = await tx.wallet.update({
              where: { userId: user.sub },
              data: {
                balance: balanceAfter.toFixed(8),
              },
            });

            const updatedCode = await tx.redeemCode.updateMany({
              where: {
                id: redeemCode.id,
                redeemedCount: { lt: redeemCode.maxRedemptions },
              },
              data: {
                redeemedCount: { increment: 1 },
              },
            });

            if (updatedCode.count === 0) {
              throw new RedeemError("兑换码已被使用完。");
            }

            await tx.redeemCodeRedemption.create({
              data: {
                redeemCodeId: redeemCode.id,
                userId: user.sub,
                amount: amount.toFixed(8),
              },
            });

            const transaction = await tx.walletTransaction.create({
              data: {
                userId: user.sub,
                type: "RECHARGE",
                source: "REDEEM",
                amount: walletAmount.toFixed(8),
                balanceBefore: balanceBefore.toFixed(8),
                balanceAfter: balanceAfter.toFixed(8),
                currency: wallet.currency,
                remark: `Redeem code ${redeemCode.codePrefix}`,
                metadata: {
                  redeemCodeId: redeemCode.id,
                  codePrefix: redeemCode.codePrefix,
                  codeAmount: amount.toFixed(8),
                  codeCurrency: redeemCode.currency,
                  walletAmount: walletAmount.toFixed(8),
                  walletCurrency: wallet.currency,
                },
              },
            });

            return {
              wallet: updatedWallet,
              transaction,
              redeemed: {
                type: "BALANCE",
                amount: walletAmount.toFixed(8),
                currency: wallet.currency,
                codePrefix: redeemCode.codePrefix,
              },
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        return result;
      } catch (error) {
        if (error instanceof RedeemError) {
          return reply.status(400).send({ message: error.message });
        }

        if (isUniqueConstraintError(error)) {
          return reply
            .status(400)
            .send({ message: "你已经兑换过这个兑换码。" });
        }

        throw error;
      }
    },
  );
}

class RedeemError extends Error {}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
