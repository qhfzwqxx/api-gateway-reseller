"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  BarChart3,
  CreditCard,
  Gift,
  GitBranch,
  HelpCircle,
  KeyRound,
  LogOut,
  Menu,
  ReceiptText,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FrontUser, FrontWallet } from "../../../lib/types/front";
import { money } from "../../../lib/format";
import {
  FrontIconButton,
  FrontLogo,
} from "./ui/front-ui";

export const frontTabs = [
  "overview",
  "keys",
  "model-mappings",
  "test",
  "wallet",
  "billing",
  "requests",
  "referral",
] as const;

export type FrontTab = (typeof frontTabs)[number];

export const frontPageMeta: Record<
  FrontTab,
  { title: string; description: string }
> = {
  overview: {
    title: "总览",
    description: "账户、用量与快速接入状态",
  },
  keys: {
    title: "API Key",
    description: "创建和管理网关调用密钥",
  },
  "model-mappings": {
    title: "模型映射",
    description: "配置调用模型到实际模型的映射",
  },
  test: {
    title: "调用测试",
    description: "发送真实请求验证网关链路",
  },
  wallet: {
    title: "钱包与订阅",
    description: "查看基础访问等级、钱包余额与可选订阅权益",
  },
  billing: {
    title: "账单明细",
    description: "查看资金变化与消费记录",
  },
  requests: {
    title: "调用记录",
    description: "查看请求状态、Token 与扣费",
  },
  referral: {
    title: "邀请奖励",
    description: "管理邀请链接与奖励记录",
  },
};

const navGroups = [
  {
    label: "工作台",
    items: [{ id: "overview" as const, label: "总览", icon: BarChart3 }],
  },
  {
    label: "开发配置",
    items: [
      { id: "keys" as const, label: "API Key", icon: KeyRound },
      { id: "model-mappings" as const, label: "模型映射", icon: GitBranch },
      { id: "test" as const, label: "调用测试", icon: Send },
    ],
  },
  {
    label: "费用与记录",
    items: [
      { id: "wallet" as const, label: "钱包与订阅", icon: CreditCard },
      { id: "billing" as const, label: "账单明细", icon: ReceiptText },
      { id: "requests" as const, label: "调用记录", icon: Activity },
    ],
  },
  {
    label: "增长",
    items: [{ id: "referral" as const, label: "邀请奖励", icon: Gift }],
  },
];

export function FrontAppShell({
  user,
  wallet,
  activeTab,
  onTabChange,
  onLogout,
  children,
}: {
  user: FrontUser;
  wallet: FrontWallet | null;
  activeTab: FrontTab;
  onTabChange: (tab: FrontTab) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navTooltip, setNavTooltip] = useState<{
    id: FrontTab;
    label: string;
    top: number;
    left: number;
  } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingAfterCloseRef = useRef(false);
  const currentPage = frontPageMeta[activeTab];

  function selectTab(tab: FrontTab) {
    setNavTooltip(null);
    onTabChange(tab);
    focusHeadingAfterCloseRef.current = drawerOpen;
    setDrawerOpen(false);
  }

  function showNavTooltip(target: HTMLButtonElement, id: FrontTab, label: string) {
    if (!window.matchMedia("(min-width: 768px) and (max-width: 1199px)").matches) {
      return;
    }
    const rect = target.getBoundingClientRect();
    setNavTooltip({
      id,
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 8,
    });
  }

  useEffect(() => {
    const closeTooltip = () => setNavTooltip(null);
    window.addEventListener("resize", closeTooltip);
    return () => window.removeEventListener("resize", closeTooltip);
  }, []);

  const navigation = (
    <nav
      className="front-nav"
      aria-label="用户控制台导航"
      onScroll={() => setNavTooltip(null)}
    >
      {navGroups.map((group) => (
        <div className="front-nav-group" key={group.label}>
          <div className="front-nav-heading">{group.label}</div>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                aria-current={active ? "page" : undefined}
                aria-describedby={navTooltip?.id === item.id ? "front-nav-tooltip" : undefined}
                aria-label={item.label}
                className={`front-nav-item${active ? " front-active" : ""}`}
                key={item.id}
                onBlur={() => setNavTooltip(null)}
                onClick={() => selectTab(item.id)}
                onFocus={(event) => showNavTooltip(event.currentTarget, item.id, item.label)}
                onMouseEnter={(event) => showNavTooltip(event.currentTarget, item.id, item.label)}
                onMouseLeave={() => setNavTooltip(null)}
                title={item.label}
                type="button"
              >
                <Icon aria-hidden="true" size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <main className="front-scope front-app">
      <aside className="front-sidebar">
        <div className="front-sidebar-brand">
          <FrontLogo />
        </div>
        {navigation}
        <div className="front-sidebar-footer">
          <div className="front-account-card">
            <span className="front-account-avatar" aria-hidden="true">
              {user.email.slice(0, 1).toUpperCase()}
            </span>
            <div className="front-account-copy">
              <strong title={user.email}>{user.email}</strong>
              <span>{user.role === "ADMIN" ? "管理员账号" : "用户账号"}</span>
            </div>
            <FrontIconButton label="退出登录" tooltip="退出" onClick={onLogout}>
              <LogOut aria-hidden="true" size={18} />
            </FrontIconButton>
          </div>
        </div>
      </aside>

      <section className="front-main">
        <header className="front-topbar">
          <div className="front-mobile-topbar-brand">
            <FrontLogo compact />
          </div>
          <div className="front-page-heading">
            <h1 ref={headingRef} tabIndex={-1}>
              {currentPage.title}
            </h1>
            <p>{currentPage.description}</p>
          </div>
          <div className="front-topbar-actions">
            {wallet ? (
              <button
                className="front-balance-summary"
                onClick={() => selectTab("wallet")}
                type="button"
              >
                <span>可用余额</span>
                <strong>${money(availableBalance(wallet))}</strong>
              </button>
            ) : null}
            <Link
              aria-label="帮助中心"
              className="front-topbar-help"
              href="/help"
              title="帮助中心"
            >
              <HelpCircle aria-hidden="true" size={18} />
              <span>帮助中心</span>
            </Link>
            <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
              <Dialog.Trigger asChild>
                <FrontIconButton
                  className="front-mobile-menu-button"
                  label="打开导航菜单"
                  wrapperClassName="front-mobile-action-wrapper"
                >
                  <Menu aria-hidden="true" size={20} />
                </FrontIconButton>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="front-drawer-overlay" />
                <Dialog.Content
                  className="front-mobile-drawer"
                  onCloseAutoFocus={(event) => {
                    if (!focusHeadingAfterCloseRef.current) return;
                    event.preventDefault();
                    focusHeadingAfterCloseRef.current = false;
                    window.requestAnimationFrame(() => headingRef.current?.focus());
                  }}
                >
                  <Dialog.Title className="front-sr-only">
                    用户控制台导航
                  </Dialog.Title>
                  <Dialog.Description className="front-sr-only">
                    选择要打开的功能页面
                  </Dialog.Description>
                  <div className="front-mobile-drawer-head">
                    <FrontLogo />
                    <Dialog.Close asChild>
                      <FrontIconButton label="关闭导航菜单">
                        <X aria-hidden="true" size={20} />
                      </FrontIconButton>
                    </Dialog.Close>
                  </div>
                  <div className="front-mobile-drawer-body">{navigation}</div>
                  <div className="front-mobile-drawer-foot">
                    <button
                      className="front-account-mobile"
                      onClick={() => selectTab("wallet")}
                      type="button"
                    >
                      <span className="front-account-avatar" aria-hidden="true">
                        {user.email.slice(0, 1).toUpperCase()}
                      </span>
                      <span>{user.email}</span>
                    </button>
                    <div className="front-mobile-drawer-links">
                      <Link href="/help">
                        <HelpCircle aria-hidden="true" size={18} />
                        帮助中心
                      </Link>
                      <button onClick={onLogout} type="button">
                        <LogOut aria-hidden="true" size={18} />
                        退出登录
                      </button>
                    </div>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </header>
        <div className="front-main-scroll">
          <div className="front-workspace">{children}</div>
        </div>
      </section>
      {navTooltip && typeof document !== "undefined"
        ? createPortal(
            <div
              className="front-nav-tooltip"
              id="front-nav-tooltip"
              role="tooltip"
              style={{ top: navTooltip.top, left: navTooltip.left }}
            >
              {navTooltip.label}
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}

function availableBalance(wallet: FrontWallet) {
  return Math.max(
    0,
    Number(wallet.balance || 0) - Number(wallet.reservedBalance || 0),
  );
}
