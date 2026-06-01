"use client";

import { LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/admin": "运营总览",
  "/admin/overview": "运营总览",
  "/admin/users": "用户与钱包",
  "/admin/redeem-codes": "兑换码",
  "/admin/subscriptions": "订阅管理",
  "/admin/upstreams": "上游管理",
  "/admin/model-prices": "模型价格",
  "/admin/model-pools": "模型池",
  "/admin/routing": "调度与访问等级",
  "/admin/requests": "调用记录",
  "/admin/risk-control": "风控与公告",
  "/admin/notices": "公益设置",
  "/admin/settings": "系统设置",
  "/admin/audit-logs": "审计日志",
};

function getAdminTokenKey() {
  return "gateway_admin_token";
}

function getTitle(pathname: string) {
  const matchedPath = Object.keys(pageTitles)
    .sort((a, b) => b.length - a.length)
    .find((path) => pathname === path || pathname.startsWith(`${path}/`));

  return matchedPath ? pageTitles[matchedPath] : "管理后台";
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const title = getTitle(pathname);

  function handleLogout() {
    window.localStorage.removeItem(getAdminTokenKey());
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/80 lg:px-6">
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">管理后台</div>
        <h1 className="truncate text-lg font-semibold text-slate-950">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700">
          <span
            className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
            aria-hidden="true"
          />
          API 正常
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          退出登录
        </button>
      </div>
    </header>
  );
}
