import http from "../http";

export interface OverviewData {
  users: number;
  requests: number;
  totalWalletBalance: string;
  walletCurrency: {
    code: string;
    name: string;
    symbol: string;
    icon: string;
  } | null;
  revenue: string;
  upstreamCost: string;
  grossProfit: string;
  totalTokens: number;
}

export interface ServerStatus {
  server: {
    nodeVersion: string;
    uptimeSeconds: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    };
    system: {
      platform: string;
      arch: string;
      cpuCount: number;
      loadAverage: number[];
      totalMemoryBytes: number;
      freeMemoryBytes: number;
      usedMemoryBytes: number;
      memoryUsagePercent: number;
      cpuUsagePercent: number | null;
    };
    cpu: {
      userMicros: number;
      systemMicros: number;
      percent: number | null;
    };
    database: {
      ok: boolean;
      latencyMs?: number;
      error?: string;
    };
    redis: {
      ok: boolean;
      latencyMs?: number;
      error?: string;
    };
    pm2: {
      ok: boolean;
      processes?: Array<{
        name: string;
        status: string;
        cpu?: number;
        memory?: number;
      }>;
      error?: string;
    };
  };
  apiKeys: {
    activeConcurrency: number;
    currentMinuteRequests: number;
    monitoredKeys: number;
    limitedKeys: number;
    sample: Array<{
      id: string;
      name: string;
      keyPrefix: string;
      currentConcurrency: number;
      concurrencyLimit: number;
      currentMinuteRequests: number;
      rateLimitPerMinute: number;
    }>;
  };
  modelPool: {
    totalChannels: number;
    activeChannels: number;
    penalizedChannels: number;
    unavailableChannels: number;
    recoveringChannels: number;
    inflightRequests: number;
    autoCheckEnabledPools: number;
    healthCheckIntervalSeconds: number;
    channels: Array<{
      model: string;
      upstreamProvider: string;
      effectiveStatus: string;
      inflightRequests: number;
      activeKeys: number;
    }>;
    upstreamKeys: {
      total: number;
      active: number;
      inflightRequests: number;
    };
  };
  alerts: Array<{
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
  }>;
  checkedAt: string;
}

export interface SetupWizardStep {
  id: string;
  label: string;
  detail: string;
  completed: boolean;
}

export interface SetupWizardData {
  completed: number;
  total: number;
  percent: number;
  steps: SetupWizardStep[];
}

interface SetupWizardResponse {
  wizard: SetupWizardData;
}

export async function getOverviewStats() {
  const response = await http.get<OverviewData>("/admin/overview");

  return response.data;
}

export async function getServerStatus() {
  const response = await http.get<ServerStatus>("/admin/server-status");

  return response.data;
}

export async function getSetupWizard() {
  const response = await http.get<SetupWizardResponse>("/admin/setup-wizard");

  return response.data.wizard;
}
