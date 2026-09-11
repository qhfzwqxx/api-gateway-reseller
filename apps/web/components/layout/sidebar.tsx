"use client";

import {
  Activity,
  Banknote,
  Coins,
  Crown,
  FileClock,
  Gift,
  Gauge,
  Megaphone,
  KeyRound,
  Layers3,
  Network,
  Route,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

export interface NavItem {
  title: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  group: "运营" | "资源" | "安全";
}

export const navItems: NavItem[] = [
  { title: "运营总览", href: "/admin/overview", icon: Gauge, group: "运营" },
  { title: "用户与钱包", href: "/admin/users", icon: Users, group: "运营" },
  { title: "余额货币", href: "/admin/balance-currencies", icon: Zap, group: "运营" },
  { title: "邀请奖励", href: "/admin/referrals", icon: Gift, group: "运营" },
  { title: "兑换码", href: "/admin/redeem-codes", icon: Coins, group: "运营" },
  { title: "订阅管理", href: "/admin/subscriptions", icon: Crown, group: "运营" },
  { title: "上游管理", href: "/admin/upstreams", icon: Network, group: "资源" },
  { title: "模型价格", href: "/admin/model-prices", icon: Banknote, group: "资源" },
  { title: "模型池", href: "/admin/model-pools", icon: Layers3, group: "资源" },
  { title: "调度与访问等级", href: "/admin/routing", icon: Route, group: "资源" },
  { title: "调用记录", href: "/admin/requests", icon: Activity, group: "资源" },
  { title: "破甲功能", href: "/admin/policy-recovery", icon: ShieldCheck, group: "安全" },
  { title: "风控与公告", href: "/admin/risk-control", icon: ShieldAlert, group: "安全" },
  { title: "公益设置", href: "/admin/notices", icon: Megaphone, group: "安全" },
  { title: "系统设置", href: "/admin/settings", icon: Settings, group: "安全" },
  { title: "审计日志", href: "/admin/audit-logs", icon: FileClock, group: "安全" },
];

export const navGroups = ["运营", "资源", "安全"] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-200 bg-white lg:flex lg:flex-col">
      <div className="flex h-[72px] items-center gap-3 border-b border-slate-200 px-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700 shadow-sm">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold tracking-tight text-slate-950">
            APIshare Admin
          </div>
          <div className="mt-0.5 truncate text-xs font-medium text-slate-500">
            网关运营控制台
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="后台主导航">
        <div className="grid gap-5">
          {navGroups.map((group) => (
            <section key={group} aria-label={`${group}菜单`}>
              <div className="mb-2 px-3 text-[11px] font-bold tracking-[0.08em] text-slate-400">
                {group}
              </div>
              <div className="space-y-1">
                {navItems.filter((item) => item.group === group).map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={[
                        "group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-all duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                        isActive
                          ? "bg-blue-600 text-white shadow-sm shadow-blue-200"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                      ].join(" ")}
                    >
                      <Icon
                        className={[
                          "h-[18px] w-[18px] shrink-0",
                          isActive
                            ? "text-white"
                            : "text-slate-400 group-hover:text-slate-700",
                        ].join(" ")}
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.title}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </nav>

      <div className="m-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          管理员工作区
        </div>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">运营配置会即时同步到服务端。</p>
      </div>
    </aside>
  );
}
