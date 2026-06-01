import type { FastifyInstance } from "fastify";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { requireUser } from "../services/auth.js";
import {
  activateUserSubscription,
  summarizeSubscriptionQuota,
  syncUserSubscriptionState,
  userSubscriptionInclude,
} from "../services/subscriptions.js";

export async function subscriptionRoutes(app: FastifyInstance) {
  app.get("/me/subscriptions", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    await prisma.$transaction((tx) => syncUserSubscriptionState(tx, user.sub));
    const subscriptions = await prisma.userSubscription.findMany({
      where: { userId: user.sub },
      orderBy: [{ active: "desc" }, { status: "asc" }, { updatedAt: "desc" }],
      include: userSubscriptionInclude,
    });
    const subscriptionsWithQuota = subscriptions.map((subscription) =>
      summarizeSubscriptionQuota(subscription),
    );
    return {
      subscriptions: subscriptionsWithQuota,
      activeSubscription:
        subscriptionsWithQuota.find(
          (subscription) =>
            subscription.active && subscription.status === "ACTIVE",
        ) ?? null,
    };
  });

  app.post(
    "/me/subscriptions/:id/activate",
    { preHandler: requireUser },
    async (request) => {
      const user = request.user as { sub: string };
      const params = z.object({ id: z.string() }).parse(request.params);
      const subscription = await prisma.$transaction((tx) =>
        activateUserSubscription(tx, {
          userId: user.sub,
          subscriptionId: params.id,
        }),
      );
      return { subscription: summarizeSubscriptionQuota(subscription) };
    },
  );
}
