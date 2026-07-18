"use client";

import { apiBaseUrl, apiFetch, getToken } from "../../../lib/api";

export type AdminResource =
  | "overview"
  | "serverStatus"
  | "setupWizard"
  | "riskCenter"
  | "reports"
  | "users"
  | "upstreams"
  | "modelPrices"
  | "modelPools"
  | "dispatchSettings"
  | "ipAccessTiers"
  | "accessTiers"
  | "redeemCodes"
  | "referralSettings"
  | "referrals"
  | "subscriptionPlans"
  | "authSettings"
  | "gatewayNotices"
  | "charityAnnouncements"
  | "pendingAutoTerminate"
  | "reasoningTransform"
  | "auditLogs"
  | "loginLogs"
  | "requests";

export const adminQueryKeys = {
  all: ["admin"] as const,
  resource: (resource: AdminResource, params?: unknown) =>
    ["admin", resource, params ?? null] as const,
};

export function adminFetch<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
) {
  return apiFetch<T>(path, {
    ...init,
    token: init.token ?? getToken(),
  });
}

export async function adminDownload(
  path: string,
  filename: string,
  token = getToken(),
) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
