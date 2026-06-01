import { prisma } from "@gateway/db";

export const standardAccessTierCode = "standard";

export type AccessRoutePolicy = {
  tierId: string | null;
  tierCode: string;
  walletRequired: boolean;
};

type RoutePrincipal = {
  userId: string;
  apiKeyId: string;
  userTierId?: string | null;
  apiKeyTierId?: string | null;
  clientIp?: string | null;
};

let cachedStandardTier:
  | {
      id: string;
      code: string;
      walletRequired: boolean;
    }
  | undefined;

export async function ensureStandardAccessTier() {
  if (cachedStandardTier !== undefined) {
    return cachedStandardTier;
  }

  const tier = await prisma.accessTier.upsert({
    where: { code: standardAccessTierCode },
    update: {},
    create: {
      id: "tier_standard",
      code: standardAccessTierCode,
      name: "Standard",
      description: "Default access tier",
      sortOrder: 100,
    },
    select: {
      id: true,
      code: true,
      walletRequired: true,
    },
  });
  cachedStandardTier = tier;
  return tier;
}

export function clearStandardAccessTierCache() {
  cachedStandardTier = undefined;
}

export async function resolveAccessRoutePolicy(
  principal: RoutePrincipal,
): Promise<AccessRoutePolicy> {
  const [standardTier, ipTier] = await Promise.all([
    ensureStandardAccessTier(),
    findMatchingIpAccessTier(principal.clientIp),
  ]);
  const selectedTierId =
    ipTier?.tierId ??
    principal.apiKeyTierId ??
    principal.userTierId ??
    standardTier.id;
  const tier =
    ipTier?.tier ??
    (await prisma.accessTier.findFirst({
      where: {
        id: selectedTierId,
        status: "ACTIVE",
      },
      select: { id: true, code: true, walletRequired: true },
    })) ??
    standardTier;

  return {
    tierId: tier.id,
    tierCode: tier.code,
    walletRequired: tier.walletRequired,
  };
}

async function findMatchingIpAccessTier(clientIp?: string | null) {
  if (!clientIp) {
    return null;
  }

  const rules = await prisma.ipAccessTierRule.findMany({
    where: {
      status: "ACTIVE",
      tier: { status: "ACTIVE" },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      cidrOrIp: true,
      tierId: true,
      tier: { select: { id: true, code: true, walletRequired: true } },
    },
  });

  return rules.find((rule) => ipMatchesPattern(clientIp, rule.cidrOrIp)) ?? null;
}

export function ipMatchesPattern(ip: string, pattern: string) {
  const normalizedIp = ip.trim();
  const normalizedPattern = pattern.trim();
  if (!normalizedIp || !normalizedPattern) {
    return false;
  }

  if (!normalizedPattern.includes("/")) {
    return normalizedIp === normalizedPattern;
  }

  const [rangeAddress, prefixText] = normalizedPattern.split("/");
  const prefix = Number(prefixText);
  const ipBytes = parseIpv4(normalizedIp);
  const rangeBytes = parseIpv4(rangeAddress ?? "");

  if (
    !ipBytes ||
    !rangeBytes ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    return false;
  }

  const ipNumber = ipv4ToNumber(ipBytes);
  const rangeNumber = ipv4ToNumber(rangeBytes);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (rangeNumber & mask);
}

function parseIpv4(value: string) {
  const parts = value.trim().split(".");
  if (parts.length !== 4) {
    return null;
  }

  const bytes = parts.map((part) => Number(part));
  if (
    bytes.some(
      (byte, index) =>
        !Number.isInteger(byte) ||
        byte < 0 ||
        byte > 255 ||
        String(byte) !== parts[index],
    )
  ) {
    return null;
  }

  return bytes;
}

function ipv4ToNumber(bytes: number[]) {
  return (
    (((bytes[0] ?? 0) << 24) |
      ((bytes[1] ?? 0) << 16) |
      ((bytes[2] ?? 0) << 8) |
      (bytes[3] ?? 0)) >>>
    0
  );
}
