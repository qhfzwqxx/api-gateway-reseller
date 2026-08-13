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
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

export interface NavItem {
  title: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

export const navItems: NavItem[] = [
  { title: "运营总览", href: "/admin/overview", icon: Gauge },
  { title: "用户与钱包", href: "/admin/users", icon: Users },
  { title: "邀请奖励", href: "/admin/referrals", icon: Gift },
  { title: "兑换码", href: "/admin/redeem-codes", icon: Coins },
  { title: "订阅管理", href: "/admin/subscriptions", icon: Crown },
  { title: "上游管理", href: "/admin/upstreams", icon: Network },
  { title: "模型价格", href: "/admin/model-prices", icon: Banknote },
  { title: "模型池", href: "/admin/model-pools", icon: Layers3 },
  { title: "破甲功能", href: "/admin/policy-recovery", icon: ShieldCheck },
  { title: "调度与访问等级", href: "/admin/routing", icon: Route },
  { title: "调用记录", href: "/admin/requests", icon: Activity },
  { title: "风控与公告", href: "/admin/risk-control", icon: ShieldAlert },
  { title: "公益设置", href: "/admin/notices", icon: Megaphone },
  { title: "系统设置", href: "/admin/settings", icon: Settings },
  { title: "审计日志", href: "/admin/audit-logs", icon: FileClock },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-200 bg-white lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">
            APIshare Admin
          </div>
          <div className="truncate text-xs font-medium text-slate-500">
            Gateway Console
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="后台主导航">
        <div className="mb-2 px-3 text-xs font-semibold uppercase text-slate-400">
          Navigation
        </div>
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                ].join(" ")}
              >
                <Icon
                  className={[
                    "h-4 w-4 shrink-0",
                    isActive
                      ? "text-blue-700"
                      : "text-slate-400 group-hover:text-slate-700",
                  ].join(" ")}
                  aria-hidden="true"
                />
                <span className="truncate">{item.title}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
