import type { FastifyInstance } from "fastify";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { requireUser } from "../services/auth.js";
import { syncUserSubscriptionState } from "../services/subscriptions.js";

const accessTierSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  sortOrder: true,
  billingMultiplier: true,
  rateLimitPerMinute: true,
  concurrencyLimit: true,
  walletRequired: true,
  userSelectable: true,
  description: true,
} as const;

export async function accessTierRoutes(app: FastifyInstance) {
  app.get("/me/access-tiers", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const [currentUser, selectableTiers] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.sub },
        select: {
          tier: { select: accessTierSelect },
        },
      }),
      prisma.accessTier.findMany({
        where: {
          status: "ACTIVE",
          userSelectable: true,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: accessTierSelect,
      }),
    ]);

    if (!currentUser) {
      throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }

    return {
      currentTier: currentUser.tier,
      tiers: selectableTiers,
    };
  });

  app.patch("/me/access-tier", { preHandler: requireUser }, async (request) => {
    const body = z
      .object({ tierId: z.string().trim().min(1) })
      .parse(request.body);
    const user = request.user as { sub: string };

    return prisma.$transaction(async (tx) => {
      await syncUserSubscriptionState(tx, user.sub);
      const activeSubscription = await tx.userSubscription.findFirst({
        where: {
          userId: user.sub,
          active: true,
          status: "ACTIVE",
        },
        select: {
          endsAt: true,
          plan: { select: { name: true } },
          tier: { select: { name: true } },
        },
      });

      if (activeSubscription) {
        throw Object.assign(
          new Error(
            `当前订阅「${activeSubscription.plan.name}」正在生效，访问等级已锁定为「${activeSubscription.tier.name}」，请在订阅结束后再切换。`,
          ),
          { statusCode: 409 },
        );
      }

      const targetTier = await tx.accessTier.findFirst({
        where: {
          id: body.tierId,
          status: "ACTIVE",
          userSelectable: true,
        },
        select: accessTierSelect,
      });

      if (!targetTier) {
        throw Object.assign(
          new Error("该访问等级未开放前台选择，请联系管理员分配。"),
          { statusCode: 403 },
        );
      }

      const updatedUser = await tx.user.update({
        where: { id: user.sub },
        data: { tierId: targetTier.id },
        select: {
          id: true,
          tierId: true,
          tier: { select: accessTierSelect },
        },
      });

      return {
        tier: targetTier,
        user: updatedUser,
      };
    });
  });
}
