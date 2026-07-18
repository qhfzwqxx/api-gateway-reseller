import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { requireAdmin, requireUser } from "../services/auth.js";
import {
  buildInviteLink,
  ensureReferralProfile,
  readReferralSettings,
  saveReferralSettings,
} from "../services/referrals.js";
import { subscriptionPlanInclude } from "../services/subscriptions.js";

const rewardSchema = z.object({
  type: z.enum(["NONE", "BALANCE", "SUBSCRIPTION"]),
  amountUsd: z.string().or(z.number()).transform(String).optional(),
  subscriptionPlanId: z.string().trim().min(1).nullable().optional(),
});

const referralSettingsSchema = z.object({
  enabled: z.boolean(),
  inviteBaseUrl: z.string().trim().max(300).default(""),
  inviterReward: rewardSchema,
  inviteeReward: rewardSchema,
});

export async function referralRoutes(app: FastifyInstance) {
  app.get("/me/referral", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const [settings, profile] = await Promise.all([
      readReferralSettings(),
      ensureReferralProfile(user.sub),
    ]);

    const recentInvites = await prisma.referralInvite.findMany({
      where: { inviterUserId: user.sub },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        invitee: {
          select: {
            id: true,
            email: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      profile,
      inviteLink: buildInviteLink({
        code: profile.code,
        settings,
        origin: request.headers.origin,
      }),
      settings: {
        enabled: settings.enabled,
        inviterReward: settings.inviterReward,
        inviteeReward: settings.inviteeReward,
      },
      invites: recentInvites,
    };
  });

  app.get(
    "/admin/referral-settings",
    { preHandler: [requireUser, requireAdmin] },
    async () => {
      const settings = await readReferralSettings();
      return { settings };
    },
  );

  app.put(
    "/admin/referral-settings",
    { preHandler: [requireUser, requireAdmin] },
    async (request, reply) => {
      const body = referralSettingsSchema.parse(request.body);

      const validationError = await validateReward(body.inviterReward);
      if (validationError) {
        return reply.status(400).send({ message: `邀请人奖励：${validationError}` });
      }
      const inviteeValidationError = await validateReward(body.inviteeReward);
      if (inviteeValidationError) {
        return reply.status(400).send({ message: `被邀请人奖励：${inviteeValidationError}` });
      }

      const settings = await saveReferralSettings({
        enabled: body.enabled,
        inviteBaseUrl: body.inviteBaseUrl,
        inviterReward: {
          type: body.inviterReward.type,
          amountUsd: body.inviterReward.amountUsd ?? "0",
          subscriptionPlanId: body.inviterReward.subscriptionPlanId ?? null,
        },
        inviteeReward: {
          type: body.inviteeReward.type,
          amountUsd: body.inviteeReward.amountUsd ?? "0",
          subscriptionPlanId: body.inviteeReward.subscriptionPlanId ?? null,
        },
      });

      return { settings };
    },
  );

  app.get(
    "/admin/referrals",
    { preHandler: [requireUser, requireAdmin] },
    async (request) => {
      const query = z
        .object({
          q: z.string().trim().optional(),
          status: z.enum(["REWARDED", "SKIPPED"]).optional(),
        })
        .parse(request.query);
      const q = query.q?.trim();
      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" as const } },
                {
                  inviter: {
                    email: { contains: q, mode: "insensitive" as const },
                  },
                },
                {
                  invitee: {
                    email: { contains: q, mode: "insensitive" as const },
                  },
                },
              ],
            }
          : {}),
      };

      const invites = await prisma.referralInvite.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          inviter: {
            select: {
              id: true,
              email: true,
            },
          },
          invitee: {
            select: {
              id: true,
              email: true,
              createdAt: true,
            },
          },
        },
      });

      return { invites };
    },
  );
}

async function validateReward(input: z.infer<typeof rewardSchema>) {
  if (input.type === "NONE") return null;

  if (input.type === "BALANCE") {
    const amount = new Decimal(input.amountUsd ?? "0");
    return amount.isFinite() && amount.gt(0) ? null : "余额奖励必须大于 0";
  }

  if (!input.subscriptionPlanId) {
    return "请选择订阅套餐";
  }

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: input.subscriptionPlanId },
    include: subscriptionPlanInclude,
  });
  if (!plan) return "订阅套餐不存在";
  if (plan.status !== "ACTIVE" || plan.tier.status !== "ACTIVE") {
    return "订阅套餐或访问等级已停用";
  }

  return null;
}
