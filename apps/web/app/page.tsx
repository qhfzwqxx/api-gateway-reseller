import DashboardClient from "./dashboard-client";
import CharityVueApp from "./charity-vue-app";
import { AdminConfirmProvider } from "./admin/_components/admin-confirm";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type CharityDashboard = {
  generatedAt: string;
  gateway?: string;
  charityKey?: string | null;
  announcement?: {
    enabled: boolean;
    frequency: "every_visit" | "interval";
    intervalHours: number;
    title: string;
    content: string;
  };
  totals: {
    charityUsers: number;
    requests: number;
    successRequests: number;
    failedRequests: number;
    successRate: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    chargedAmountUsd: string;
    upstreamCostUsd: string;
  };
  trend30d: Array<{
    date: string;
    requests: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
  ranking: Array<{
    name: string;
    requests: number;
    successRate: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
  models: Array<{
    model: string;
    requests: number;
    successRate: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
};

export default async function Home() {
  const host = (await headers()).get("host") ?? "";
  if (host.split(":")[0] === "free.l-kx.cn") {
    const data = await loadCharityDashboard();
    return <CharityHome data={data} />;
  }

  return (
    <AdminConfirmProvider>
      <DashboardClient mode="user" />
    </AdminConfirmProvider>
  );
}

async function loadCharityDashboard(): Promise<CharityDashboard | null> {
  try {
    const response = await fetch(
      `${serverApiBaseUrl()}/public/charity-dashboard`,
      {
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return null;
    }
    return response.json() as Promise<CharityDashboard>;
  } catch {
    return null;
  }
}

function serverApiBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return `http://127.0.0.1:${process.env.API_PORT || "4100"}`;
}

function CharityHome({ data }: { data: CharityDashboard | null }) {
  return <CharityVueApp data={data} />;
}
