"use client";

import { KeyRound, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { navGroups, navItems } from "./sidebar";

const pageTitles: Record<string, string> = {
  "/admin": "运营总览",
  "/admin/overview": "运营总览",
  "/admin/users": "用户与钱包",
  "/admin/balance-currencies": "余额货币",
  "/admin/referrals": "邀请奖励",
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
  "/admin/policy-recovery": "破甲功能",
  "/admin/login-logs": "登录日志",
  "/admin/reports": "运营报表",
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileNavOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function handleLogout() {
    window.localStorage.removeItem(getAdminTokenKey());
    router.replace("/login");
  }

  return (
    <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:px-5 lg:px-7">
        <div className="flex h-16 items-center justify-between gap-3 sm:h-[72px]">
          <div className="flex min-w-0 items-center gap-2">
            <Dialog.Trigger asChild>
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-expanded={mobileNavOpen}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 lg:hidden"
                aria-label="打开后台导航"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </button>
            </Dialog.Trigger>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">
                APIshare / 管理后台
              </div>
              <h1 className="truncate text-lg font-bold tracking-tight text-slate-950 sm:text-xl">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden h-9 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 md:inline-flex">
              <span
                className="h-2 w-2 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              管理员工作区
            </div>

            <button
              type="button"
              onClick={handleLogout}
              aria-label="退出登录"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">退出登录</span>
            </button>
          </div>
        </div>
      </header>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="admin-nav-drawer fixed inset-y-0 left-0 z-50 flex w-[min(88vw,360px)] flex-col bg-white shadow-2xl outline-none lg:hidden"
        >
          <Dialog.Title className="sr-only">后台导航</Dialog.Title>
          <div className="flex h-[72px] items-center justify-between border-b border-slate-200 px-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700">
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-950">
                  APIshare Admin
                </div>
                <div className="truncate text-xs font-medium text-slate-500">
                  网关运营控制台
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              aria-label="关闭后台导航"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <nav
            className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
            aria-label="移动后台主导航"
          >
            <div className="grid gap-5">
              {navGroups.map((group) => (
                <section key={group}>
                  <h2 className="mb-2 px-3 text-xs font-semibold text-slate-500">
                    {group}
                  </h2>
                  <div className="grid gap-1">
                    {navItems
                      .filter((item) => item.group === group)
                      .map((item) => {
                        const Icon = item.icon;
                        const isActive =
                          pathname === item.href ||
                          pathname.startsWith(`${item.href}/`);

                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileNavOpen(false)}
                            aria-current={isActive ? "page" : undefined}
                            className={[
                              "flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                              isActive
                                ? "bg-blue-600 text-white shadow-sm shadow-blue-200"
                                : "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
                            ].join(" ")}
                          >
                            <Icon
                              className="h-[18px] w-[18px] shrink-0"
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
          <div className="m-3 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            管理员工作区
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
