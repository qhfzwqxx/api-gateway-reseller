"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Cpu,
  Database,
  HardDrive,
  Layers3,
  Radio,
  Server,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  getOverviewStats,
  getServerStatus,
  getSetupWizard,
  type OverviewData,
  type ServerStatus,
  type SetupWizardData,
} from "../../../lib/api/overview";
import { AdminScrollLock } from "../components/admin-scroll-lock";

export default function AdminOverviewPage() {
  const [activeTab, setActiveTab] = useState<"server" | "wizard">("server");
  const overviewQuery = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: getOverviewStats,
    staleTime: 60_000,
  });

  const serverQuery = useQuery({
    queryKey: ["admin", "server-status"],
    queryFn: getServerStatus,
    refetchInterval: 15_000,
  });

  const wizardQuery = useQuery({
    queryKey: ["admin", "setup-wizard"],
    queryFn: getSetupWizard,
    staleTime: 60_000,
  });

  const hasError = overviewQuery.isError || serverQuery.isError || wizardQuery.isError;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <AdminScrollLock />
      <section className="shrink-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Operation Overview</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">运营总览</h2>
            <p className="mt-2 text-sm text-slate-500">核心经营指标、实时系统状态与上线配置进度。</p>
          </div>
          <Badge tone="green">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            实时监控中
          </Badge>
        </div>
      </section>

      {hasError ? (
        <div className="shrink-0 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          数据加载失败，请稍后刷新页面或检查当前管理员登录状态。
        </div>
      ) : null}

      <KpiSection data={overviewQuery.data} isLoading={overviewQuery.isLoading} />
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="shrink-0 border-b border-slate-200 p-2">
          <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
            <TabButton active={activeTab === "server"} onClick={() => setActiveTab("server")}>
              服务器状态
            </TabButton>
            <TabButton active={activeTab === "wizard"} onClick={() => setActiveTab("wizard")}>
              初始化向导
            </TabButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 p-3">
          {activeTab === "server" ? <ServerStatusSection data={serverQuery.data} isLoading={serverQuery.isLoading} /> : null}
          {activeTab === "wizard" ? <SetupWizardSection data={wizardQuery.data} isLoading={wizardQuery.isLoading} /> : null}
        </div>
      </section>
    </div>
  );
}

function KpiSection({ data, isLoading }: { data?: OverviewData; isLoading: boolean }) {
  const items = [
    { label: "用户数", value: formatInteger(data?.users), icon: Users, caption: "注册用户总量" },
    { label: "总请求数", value: formatInteger(data?.requests), icon: Zap, caption: "累计 API 调用" },
    {
      label: "钱包余额",
      value: formatBalance(data?.totalWalletBalance, data?.walletCurrency),
      icon: Wallet,
      caption: data?.walletCurrency
        ? `用户余额总额 · ${data.walletCurrency.name}`
        : "用户余额总额",
    },
    { label: "总 Token", value: formatInteger(data?.totalTokens), icon: Layers3, caption: "累计消耗 Token" },
    { label: "收入", value: formatMoney(data?.revenue), icon: CircleDollarSign, caption: "客户累计扣费" },
    { label: "上游成本", value: formatMoney(data?.upstreamCost), icon: Server, caption: "供应商侧成本" },
    { label: "毛利", value: formatMoney(data?.grossProfit), icon: CheckCircle2, caption: "收入减上游成本" },
  ];

  return (
    <section className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          {isLoading ? (
            <SkeletonCard />
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-500">{item.label}</p>
                <p className="mt-1 truncate text-xl font-semibold tabular-nums text-slate-950">{item.value}</p>
                <p className="mt-1 text-xs text-slate-400">{item.caption}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                <item.icon className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>
          )}
        </Card>
      ))}
    </section>
  );
}

function ServerStatusSection({ data, isLoading }: { data?: ServerStatus; isLoading: boolean }) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 flex flex-col gap-2 border-b border-slate-200 p-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
            <h3 className="text-base font-semibold text-slate-950">服务器状态监控</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">每 5 秒自动刷新一次运行状态与网关负载。</p>
        </div>
        <Badge tone="slate">更新于 {data ? formatDateTime(data.checkedAt) : "-"}</Badge>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-2">
        {isLoading ? (
          <>
            <PanelSkeleton />
            <PanelSkeleton />
          </>
        ) : (
          <>
            <div className="space-y-2">
              <InfoRow icon={<Server />} label="Node 版本" value={data?.server.nodeVersion ?? "-"} />
              <InfoRow
                icon={<Database />}
                label="数据库"
                value={data?.server.database.ok ? `${data.server.database.latencyMs ?? 0} ms` : data?.server.database.error ?? "-"}
                status={data?.server.database.ok}
              />
              <InfoRow
                icon={<Radio />}
                label="Redis"
                value={data?.server.redis.ok ? `${data.server.redis.latencyMs ?? 0} ms` : data?.server.redis.error ?? "-"}
                status={data?.server.redis.ok}
              />
              <InfoRow
                icon={<Cpu />}
                label="PM2"
                value={formatPm2(data)}
                status={data?.server.pm2.ok}
              />
              <InfoRow
                icon={<HardDrive />}
                label="系统内存"
                value={`${formatPercent(data?.server.system.memoryUsagePercent)} · ${formatBytes(data?.server.system.usedMemoryBytes)} / ${formatBytes(data?.server.system.totalMemoryBytes)}`}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <MiniMetric label="模型池渠道数" value={formatInteger(data?.modelPool.totalChannels)} caption={`活跃 ${data?.modelPool.activeChannels ?? 0} · 不可用 ${data?.modelPool.unavailableChannels ?? 0}`} />
              <MiniMetric label="当前并发" value={formatInteger(data?.apiKeys.activeConcurrency)} caption={`模型池进行中 ${data?.modelPool.inflightRequests ?? 0}`} />
              <MiniMetric label="API Key 数量" value={formatInteger(data?.apiKeys.monitoredKeys)} caption={`受限 ${data?.apiKeys.limitedKeys ?? 0}`} />
              <MiniMetric label="当前分钟请求" value={formatInteger(data?.apiKeys.currentMinuteRequests)} caption={`上游 Key ${data?.modelPool.upstreamKeys.active ?? 0}/${data?.modelPool.upstreamKeys.total ?? 0}`} />
              <MiniMetric label="CPU 使用率" value={formatPercent(data?.server.system.cpuUsagePercent)} caption={`进程 ${formatPercent(data?.server.cpu.percent)}`} />
              <MiniMetric label="运行时间" value={formatDuration(data?.server.uptimeSeconds ?? 0)} caption={`${data?.server.system.platform ?? "-"} ${data?.server.system.arch ?? ""}`} />
            </div>
          </>
        )}
      </div>

      {!isLoading ? (
        <div className="shrink-0 border-t border-slate-200 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
            实时告警
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {(data?.alerts.length ?? 0) > 0 ? (
              data?.alerts.map((alert) => (
                <div key={`${alert.severity}:${alert.title}`} className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
                  <p className="text-sm font-semibold text-amber-900">{alert.title}</p>
                  <p className="mt-1 text-sm text-amber-700">{alert.message}</p>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                暂无风险预警，关键服务运行正常。
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SetupWizardSection({ data, isLoading }: { data?: SetupWizardData; isLoading: boolean }) {
  const percent = Math.min(Math.max(data?.percent ?? 0, 0), 100);

  return (
    <section className="h-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">初始化向导</h3>
          <p className="mt-1 text-sm text-slate-500">按上线顺序检查系统关键配置完成情况。</p>
        </div>
        <Badge tone={data && data.completed === data.total ? "green" : "blue"}>
          {data?.completed ?? 0}/{data?.total ?? 0} 已完成
        </Badge>
      </div>

      {isLoading ? (
        <div className="mt-5 h-24 animate-pulse rounded-md bg-slate-100" />
      ) : (
        <>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">配置进度</span>
              <span className="font-semibold tabular-nums text-slate-950">{percent}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(data?.steps ?? []).map((step) => (
              <div key={step.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <span className={step.completed ? "text-emerald-600" : "text-slate-400"}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold text-slate-900">{step.label}</p>
                </div>
                <p className="mt-2 text-sm leading-5 text-slate-500">{step.detail}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-9 rounded text-sm font-semibold transition-colors",
        active ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-950",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">{children}</div>;
}

function Badge({ children, tone }: { children: ReactNode; tone: "blue" | "green" | "slate" }) {
  const styles = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
  };

  return <span className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-medium ${styles[tone]}`}>{children}</span>;
}

function InfoRow({ icon, label, value, status }: { icon: ReactNode; label: string; value: string; status?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-slate-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <span className="text-sm font-medium text-slate-600">{label}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {typeof status === "boolean" ? <span className={status ? "h-2 w-2 rounded-full bg-emerald-500" : "h-2 w-2 rounded-full bg-red-500"} /> : null}
        <span className="truncate text-right text-sm font-semibold text-slate-950">{value}</span>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{caption}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-20 rounded bg-slate-100" />
      <div className="h-8 w-32 rounded bg-slate-100" />
      <div className="h-3 w-24 rounded bg-slate-100" />
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
      ))}
    </div>
  );
}

function formatInteger(value?: number) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatMoney(value?: string | number) {
  const numeric = Number(value ?? 0);
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(Number.isFinite(numeric) ? numeric : 0)}`;
}

function formatBalance(
  value?: string | number,
  currency?: OverviewData["walletCurrency"],
) {
  const formatted = formatMoney(value).replace(/^\$/, "");
  if (!currency || currency.symbol === "$") {
    return `$${formatted}`;
  }
  return `${formatted} ${currency.symbol || currency.name}`;
}

function formatPercent(value?: number | null) {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${value.toFixed(1)}%`;
}

function formatBytes(value?: number) {
  const bytes = value ?? 0;
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatPm2(data?: ServerStatus) {
  if (!data?.server.pm2.ok) {
    return data?.server.pm2.error ?? "-";
  }

  const processes = data.server.pm2.processes ?? [];
  return processes.length > 0 ? processes.map((process) => `${process.name}:${process.status}`).join(" · ") : "未检测到进程";
}
