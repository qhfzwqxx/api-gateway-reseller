"use client";

import {
  Activity,
  BarChart3,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  GitBranch,
  KeyRound,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShoppingCart,
  ReceiptText,
  Trash2,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  apiBaseUrl,
  apiFetch,
  clearToken,
  getToken,
  setToken,
} from "../lib/api";
import {
  dateTime,
  formatNumber,
  money,
} from "./admin/_components/admin-format";
import {
  Metric,
  StatusPill,
} from "./admin/_components/admin-ui";
import { Requests, type ApiRequest } from "./admin/_components/request-list";
import {
  CallTester,
  type AvailableModel,
} from "./front/_components/call-tester";
import { Keys, type ApiKey } from "./front/_components/frontend-keys";
import {
  BillingDetails,
  WalletManagement,
  type Transaction,
  type Wallet,
} from "./front/_components/frontend-wallet";
import { z } from "zod";

type User = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED" | string;
  statusReason?: string | null;
  allowedModels: string[];
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  tierId?: string | null;
  tier?: AccessTierRef | null;
  charityEnabled?: boolean;
  charityDisplayName?: string | null;
  charityKey?: string | null;
  charityIpRateLimitEnabled?: boolean;
  charityIpRateLimitPerMinute?: number;
  createdAt?: string;
  wallet?: Wallet | null;
};

type RewardType = "NONE" | "BALANCE" | "SUBSCRIPTION";

type ReferralRewardSettings = {
  type: RewardType;
  amountUsd: string;
  subscriptionPlanId: string | null;
};

type ReferralProfile = {
  id: string;
  userId: string;
  code: string;
  status: "ACTIVE" | "DISABLED";
  successfulInvites: number;
  rewardedInvites: number;
  createdAt: string;
  updatedAt: string;
};

type ReferralInvite = {
  id: string;
  code: string;
  status: string;
  inviterRewardType: RewardType;
  inviterRewardAmount: string;
  inviterRewardPlanId: string | null;
  inviteeRewardType: RewardType;
  inviteeRewardAmount: string;
  inviteeRewardPlanId: string | null;
  inviterRewardedAt: string | null;
  inviteeRewardedAt: string | null;
  createdAt: string;
  invitee: {
    id: string;
    email: string;
    createdAt: string;
  };
};

type ReferralDashboard = {
  profile: ReferralProfile;
  inviteLink: string;
  settings: {
    enabled: boolean;
    inviterReward: ReferralRewardSettings;
    inviteeReward: ReferralRewardSettings;
  };
  invites: ReferralInvite[];
};

type ModelMapping = {
  id?: string;
  fromModel: string;
  toModel: string;
  createdAt?: string;
  updatedAt?: string;
};

type Summary = {
  totals: {
    requests: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    chargedAmountUsd: number;
  };
  requests: ApiRequest[];
};

type AccessTierRef = {
  id: string;
  code: string;
  name: string;
};

type PublicAuthSettings = {
  emailCodeLoginEnabled: boolean;
  emailCodeAutoRegisterEnabled: boolean;
  newUserBonusUsd: string;
  smtpConfigured: boolean;
};

const frontNav = [
  { id: "overview", label: "前台总览", icon: BarChart3 },
  { id: "keys", label: "API Key", icon: KeyRound },
  { id: "model-mappings", label: "模型映射", icon: GitBranch },
  { id: "wallet", label: "钱包管理", icon: CreditCard },
  { id: "referral", label: "邀请奖励", icon: Gift },
  { id: "store", label: "购买充值", icon: ShoppingCart },
  { id: "billing", label: "账单明细", icon: ReceiptText },
  { id: "requests", label: "我的调用", icon: Activity },
  { id: "test", label: "调用测试", icon: Send },
] as const;

const cardStoreUrl =
  process.env.NEXT_PUBLIC_CARD_STORE_URL?.trim() || "https://example.com";

type FrontTab = (typeof frontNav)[number]["id"];
type Tab = FrontTab;
const pageMeta: Record<
  Tab,
  {
    eyebrow: string;
    title: string;
    description: string;
  }
> = {
  overview: {
    eyebrow: "前台",
    title: "前台总览",
    description: "账户余额、API Key 和最近调用集中在这里。",
  },
  keys: {
    eyebrow: "前台",
    title: "API Key",
    description: "创建、查看和停用你的调用密钥。",
  },
  "model-mappings": {
    eyebrow: "前台",
    title: "模型映射",
    description: "配置你调用的模型名实际转发到哪个后端模型。",
  },
  wallet: {
    eyebrow: "前台",
    title: "钱包管理",
    description: "查看余额、订阅状态，并兑换余额或订阅。",
  },
  referral: {
    eyebrow: "前台",
    title: "邀请奖励",
    description: "复制你的专属链接，邀请新用户注册后双方都可获得奖励。",
  },
  store: {
    eyebrow: "前台",
    title: "购买充值",
    description: "在内嵌发卡网购买余额或订阅兑换码。",
  },
  billing: {
    eyebrow: "前台",
    title: "账单明细",
    description: "查看钱包流水、余额变化和账单备注。",
  },
  requests: {
    eyebrow: "前台",
    title: "我的调用",
    description: "查看最近请求、token 用量和扣费。",
  },
  test: {
    eyebrow: "前台",
    title: "调用测试",
    description: "用当前网关快速验证模型调用链路。",
  },
};

export default function DashboardClient({
  referralCode,
}: {
  referralCode?: string;
}) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(
    referralCode ? "referral" : "overview",
  );
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [modelMappings, setModelMappings] = useState<ModelMapping[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingActivePage, setRefreshingActivePage] = useState(false);
  const [storeConfirmOpen, setStoreConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const saved = getToken();
    if (saved) {
      setAuthChecked(false);
      setTokenState(saved);
      void refreshAll(saved).finally(() => {
        if (!cancelled) {
          setAuthChecked(true);
        }
      });
    } else {
      setAuthChecked(true);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  function switchTab(tab: Tab) {
    setActiveTab(tab);
  }

  async function refreshAll(authToken = token) {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const me = await apiFetch<{ user: User }>("/auth/me", {
        token: authToken,
      });
      setUser(me.user);
    } catch (refreshError) {
      setError(errorToText(refreshError));
      clearToken();
      setTokenState(null);
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(false);

    const loadData = async (label: string, task: () => Promise<void>) => {
      try {
        await task();
      } catch (loadError) {
        setError(`${label}加载失败：${errorToText(loadError)}`);
      }
    };

    void Promise.allSettled([
      loadData("可用模型", async () => {
        const result = await apiFetch<{ models: AvailableModel[] }>(
          "/models",
          {
            token: authToken,
          },
        );
        setAvailableModels(result.models);
      }),
      loadData("API Key", async () => {
        const result = await apiFetch<{ apiKeys: ApiKey[] }>("/api-keys", {
          token: authToken,
        });
        setApiKeys(result.apiKeys);
      }),
      loadData("模型映射", async () => {
        const result = await apiFetch<{ mappings: ModelMapping[] }>(
          "/model-mappings",
          { token: authToken },
        );
        setModelMappings(result.mappings);
      }),
      loadData("钱包", async () => {
        const result = await apiFetch<{
          wallet: Wallet | null;
          transactions: Transaction[];
        }>("/wallet", { token: authToken });
        setWallet(result.wallet);
        setTransactions(result.transactions);
      }),
      loadData("用量", async () => {
        const result = await apiFetch<Summary>("/usage/summary", {
          token: authToken,
        });
        setSummary(result);
      }),
    ]);
  }

  function logout() {
    clearToken();
    setTokenState(null);
    setUser(null);
    setAuthChecked(true);
    setActiveTab("overview");
  }

  async function refreshActivePage() {
    if (refreshingActivePage) {
      return;
    }

    setRefreshingActivePage(true);
    setError(null);

    try {
      await refreshAll();
    } catch (refreshError) {
      setError(`刷新失败：${errorToText(refreshError)}`);
    } finally {
      setRefreshingActivePage(false);
    }
  }

  if (!authChecked) {
    return (
      <main className="auth-boot-page">
        <section className="auth-boot-panel" aria-label="正在进入控制台">
          <span className="auth-boot-mark">A</span>
          <div>
            <strong>正在进入控制台</strong>
            <p>正在恢复登录状态...</p>
          </div>
        </section>
      </main>
    );
  }

  if (!token || !user) {
    return (
      <Login
        referralCode={referralCode}
        onLogin={(nextToken, nextUser) => {
          setToken(nextToken);
          setTokenState(nextToken);
          setUser(nextUser);
          setActiveTab(referralCode ? "referral" : "overview");
          void refreshAll(nextToken);
        }}
      />
    );
  }

  const currentPage = pageMeta[activeTab];
  const fixedWorkspace =
    activeTab === "requests" || activeTab === "billing";

  return (
    <main className="shell shell-user">
      <aside className="sidebar user-sidebar">
        <div className="brand">
          <span className="user-brand-title">APIshare</span>
          <div className="mobile-user-nav-actions">
            <span className="mobile-user-email">{user.email}</span>
            <button
              aria-label={refreshingActivePage ? "刷新中" : "刷新"}
              className="mobile-user-icon-button"
              disabled={refreshingActivePage}
              onClick={() => void refreshActivePage()}
              type="button"
            >
              <RefreshCw size={16} />
            </button>
            <button
              aria-label="退出"
              className="mobile-user-icon-button"
              onClick={logout}
              type="button"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-group">
            <div className="nav-heading">前台</div>
            {frontNav.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={activeTab === item.id}
                onClick={() =>
                  item.id === "store"
                    ? setStoreConfirmOpen(true)
                    : switchTab(item.id)
                }
              />
            ))}
          </div>
        </nav>
      </aside>
      <section className={fixedWorkspace ? "main main-fixed-page" : "main"}>
        <div className="topbar user-topbar">
          <div className="page-heading">
            <span className="eyebrow">{currentPage.eyebrow}</span>
            <h1>{currentPage.title}</h1>
            <p>{currentPage.description}</p>
          </div>
          <div className="topbar-side">
            <div className="account-chip">
              <span>{user.email}</span>
              {user.role === "ADMIN" ? <strong>管理员</strong> : null}
            </div>
            <div className="button-row admin-global-actions">
              <button
                className="button secondary"
                disabled={refreshingActivePage}
                onClick={() => void refreshActivePage()}
                type="button"
              >
                <RefreshCw size={17} />
                <span>{refreshingActivePage ? "刷新中..." : "刷新"}</span>
              </button>
              <button
                className="button secondary"
                onClick={logout}
                type="button"
              >
                <LogOut size={17} />
                <span>退出</span>
              </button>
            </div>
          </div>
        </div>

        <div
          className={
            fixedWorkspace ? "workspace workspace-fixed-page" : "workspace"
          }
        >
          {error ? (
            <div aria-live="polite" className="notice" role="alert">
              {error}
            </div>
          ) : null}
          {loading ? <p className="muted">加载中...</p> : null}
          {activeTab === "overview" ? (
            <Overview
              wallet={wallet}
              summary={summary}
              apiKeys={apiKeys}
              availableModels={availableModels}
            />
          ) : null}
          {activeTab === "keys" ? (
            <Keys
              apiKeys={apiKeys}
              onChanged={() => refreshAll()}
              onError={setError}
            />
          ) : null}
          {activeTab === "model-mappings" ? (
            <ModelMappingsPanel
              mappings={modelMappings}
              onChanged={(nextMappings) => setModelMappings(nextMappings)}
              onError={setError}
            />
          ) : null}
          {activeTab === "wallet" ? (
            <WalletManagement
              wallet={wallet}
              transactions={transactions}
              onChanged={() => refreshAll()}
              onError={setError}
            />
          ) : null}
          {activeTab === "referral" ? (
            <ReferralPanel onError={setError} />
          ) : null}
          {activeTab === "billing" ? (
            <BillingDetails transactions={transactions} />
          ) : null}
          {activeTab === "requests" ? (
            <Requests requests={summary?.requests ?? []} paginated />
          ) : null}
          {activeTab === "test" ? (
            <CallTester
              availableModels={availableModels}
              onChanged={() => refreshAll()}
              onError={setError}
            />
          ) : null}
        </div>
      </section>
      {storeConfirmOpen ? (
        <div
          className="store-confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setStoreConfirmOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="store-confirm-title"
            aria-modal="true"
            className="store-confirm-dialog"
            role="dialog"
          >
            <button
              aria-label="关闭"
              className="store-confirm-close"
              type="button"
              onClick={() => setStoreConfirmOpen(false)}
            >
              ×
            </button>
            <div className="store-confirm-orb">
              <ShoppingCart size={24} />
            </div>
            <div className="store-confirm-copy">
              <span>订阅购买</span>
              <h2 id="store-confirm-title">前往发卡网购买套餐</h2>
              <p>购买完成后，回到钱包管理粘贴兑换码即可到账。</p>
            </div>
            <div className="store-confirm-actions">
              <button
                className="button secondary store-confirm-button"
                type="button"
                onClick={() => setStoreConfirmOpen(false)}
              >
                先不去了
              </button>
              <a
                className="button store-confirm-button"
                href={cardStoreUrl}
                rel="noreferrer"
                target="_blank"
                onClick={() => setStoreConfirmOpen(false)}
              >
                <ExternalLink size={16} />
                前往购买
              </a>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function NavButton({
  item,
  active,
  onClick,
  compact = false,
}: {
  item: {
    id: string;
    label: string;
    description?: string;
    icon: typeof BarChart3;
  };
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      aria-label={item.label}
      className={[
        "nav-item",
        active ? "active" : "",
        compact ? "compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      title={compact ? item.label : undefined}
      type="button"
    >
      <Icon size={18} />
      <span>
        <strong>{item.label}</strong>
        {item.description ? <small>{item.description}</small> : null}
      </span>
    </button>
  );
}

function Login({
  referralCode,
  onLogin,
}: {
  referralCode?: string;
  onLogin: (token: string, user: User) => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [publicAuthSettings, setPublicAuthSettings] =
    useState<PublicAuthSettings | null>(null);
  const [loadingAuthSettings, setLoadingAuthSettings] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingAuthSettings(true);

    void apiFetch<{ settings: PublicAuthSettings }>("/auth/settings", {
      token: null,
    })
      .then((result) => {
        if (!cancelled) {
          setPublicAuthSettings(result.settings);
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(errorToText(fetchError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAuthSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function sendCode() {
    setError(null);
    setMessage(null);
    if (publicAuthSettings?.emailCodeLoginEnabled === false) {
      setError("邮箱验证码登录已关闭。");
      return;
    }
    if (!identifier.trim()) {
      setError("请先填写邮箱。");
      return;
    }

    setSendingCode(true);
    try {
      const result = await apiFetch<{ expiresInSeconds: number }>(
        "/auth/email-code/send",
        {
          method: "POST",
          body: JSON.stringify({ email: identifier }),
          token: null,
        },
      );
      setMessage(
        `验证码已发送，${Math.ceil(result.expiresInSeconds / 60)} 分钟内有效。`,
      );
    } catch (sendError) {
      setError(errorToText(sendError));
    } finally {
      setSendingCode(false);
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (publicAuthSettings?.emailCodeLoginEnabled === false) {
        setError("邮箱验证码登录已关闭。");
        return;
      }

      if (!emailCode.trim()) {
        setError("请填写邮箱验证码。");
        return;
      }

      const result = await apiFetch<{ token: string; user: User }>(
        "/auth/email-code/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: identifier,
            code: emailCode,
            ...(referralCode ? { referralCode } : {}),
          }),
          token: null,
        },
      );
      onLogin(result.token, result.user);
    } catch (loginError) {
      setError(errorToText(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page user-login-page">
      <section
        className="login-shell"
        aria-label="APIshare 前台邮箱登录"
      >
        <div className="login-brand-panel">
          <div className="login-brand-copy">
            <h1>APIshare</h1>
          </div>
        </div>

        <div className="login-panel">
          <div className="login-header">
            <h2>登录</h2>
            <p>
              {loadingAuthSettings
                ? "登录配置加载中..."
                : referralCode
                  ? "通过邀请链接登录，新邮箱会自动创建账户"
                : publicAuthSettings?.emailCodeLoginEnabled === false
                  ? "邮箱验证码登录已关闭"
                  : publicAuthSettings?.emailCodeAutoRegisterEnabled === false
                    ? "仅限已存在账户使用邮箱验证码登录"
                    : "新邮箱会自动创建账户"}
            </p>
          </div>

          {message ? (
            <div className="success auth-feedback">{message}</div>
          ) : null}
          {error ? <div className="error auth-feedback">{error}</div> : null}

          <form className="form login-form" onSubmit={submit}>
            <label className="field">
              <span>邮箱</span>
              <input
                autoComplete="email"
                className="input"
                onChange={(event) => setIdentifier(event.target.value)}
                required
                type="email"
                value={identifier}
              />
            </label>
            <label className="field">
              <span>验证码</span>
              <div className="input-with-action auth-code-action">
                <input
                  autoComplete="one-time-code"
                  className="input"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) =>
                    setEmailCode(
                      event.target.value.replace(/\D/g, "").slice(0, 6),
                    )
                  }
                  required
                  type="text"
                  value={emailCode}
                />
                <button
                  className="button secondary"
                  disabled={
                    sendingCode ||
                    loadingAuthSettings ||
                    publicAuthSettings?.emailCodeLoginEnabled === false
                  }
                  onClick={sendCode}
                  type="button"
                >
                  <span>{sendingCode ? "发送中" : "获取验证码"}</span>
                </button>
              </div>
            </label>
            <button
              className="button login-submit"
              disabled={
                loading ||
                loadingAuthSettings ||
                publicAuthSettings?.emailCodeLoginEnabled === false
              }
              type="submit"
            >
              <span>{loading ? "登录中..." : "登录"}</span>
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function ModelMappingsPanel({
  mappings,
  onChanged,
  onError,
}: {
  mappings: ModelMapping[];
  onChanged: (mappings: ModelMapping[]) => void;
  onError: (error: string | null) => void;
}) {
  const [rows, setRows] = useState<ModelMapping[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRows(
      mappings.length > 0
        ? mappings.map((item) => ({ ...item }))
        : [{ fromModel: "", toModel: "" }],
    );
  }, [mappings]);

  function updateRow(index: number, field: "fromModel" | "toModel", value: string) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  }

  function addRow() {
    setRows((current) => [...current, { fromModel: "", toModel: "" }]);
  }

  function removeRow(index: number) {
    setRows((current) =>
      current.length <= 1
        ? [{ fromModel: "", toModel: "" }]
        : current.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  async function saveMappings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    const normalized = normalizeModelMappingRows(rows);
    setSaving(true);

    try {
      const result = await apiFetch<{ mappings: ModelMapping[] }>(
        "/model-mappings",
        {
          method: "PUT",
          body: JSON.stringify({ mappings: normalized }),
        },
      );
      onChanged(result.mappings);
    } catch (saveError) {
      onError(errorToText(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card user-mapping-panel">
      <div className="section-head">
        <div>
          <h2 className="section-title">模型映射</h2>
          <p className="section-subtitle">
            左侧是请求里填写的模型，右侧是网关实际转发和计费的模型。
          </p>
        </div>
        <StatusPill status={mappings.length > 0 ? "ACTIVE" : "EMPTY"} />
      </div>
      <form className="form" onSubmit={saveMappings}>
        <div className="mapping-editor">
          {rows.map((row, index) => (
            <div className="mapping-row" key={row.id ?? index}>
              <label className="field">
                <span>调用模型</span>
                <input
                  className="input"
                  onChange={(event) =>
                    updateRow(index, "fromModel", event.target.value)
                  }
                  placeholder="gpt-4o"
                  value={row.fromModel}
                />
              </label>
              <label className="field">
                <span>实际模型</span>
                <input
                  className="input"
                  onChange={(event) =>
                    updateRow(index, "toModel", event.target.value)
                  }
                  placeholder="gpt-4.1"
                  value={row.toModel}
                />
              </label>
              <button
                className="button secondary icon-button"
                onClick={() => removeRow(index)}
                title="删除映射"
                type="button"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={addRow} type="button">
            <Plus size={16} />
            添加映射
          </button>
          <button className="button" disabled={saving} type="submit">
            <Save size={16} />
            {saving ? "保存中..." : "保存映射"}
          </button>
        </div>
      </form>
    </section>
  );
}

function normalizeModelMappingRows(rows: ModelMapping[]) {
  const byFromModel = new Map<string, ModelMapping>();
  for (const row of rows) {
    const fromModel = row.fromModel.trim();
    const toModel = row.toModel.trim();
    if (!fromModel || !toModel) {
      continue;
    }
    byFromModel.set(fromModel, { fromModel, toModel });
  }
  return [...byFromModel.values()];
}

function Overview({
  wallet,
  summary,
  apiKeys,
  availableModels,
}: {
  wallet: Wallet | null;
  summary: Summary | null;
  apiKeys: ApiKey[];
  availableModels: AvailableModel[];
}) {
  return (
    <div className="user-overview">
      <div className="user-hero-metrics">
        <Metric
          label="当前余额"
          value={`$${money(wallet?.balance ?? "0")}`}
          caption={`可用 $${money(
            String(
              Number(wallet?.balance ?? 0) -
                Number(wallet?.reservedBalance ?? 0),
            ),
          )} / 冻结 $${money(wallet?.reservedBalance ?? "0")} ${
            wallet?.currency ?? "USD"
          }`}
        />
        <Metric
          label="累计请求数"
          value={String(summary?.totals.requests ?? 0)}
        />
        <Metric
          label="活跃 Key"
          value={String(
            apiKeys.filter((key) => key.status === "ACTIVE").length,
          )}
        />
      </div>
      <div className="user-overview-grid">
        <div className="user-overview-main">
          <div className="grid cols-3 user-secondary-metrics">
            <Metric
              label="总 token"
              value={formatNumber(summary?.totals.totalTokens ?? 0)}
            />
            <Metric
              label="我的扣费"
              value={`$${money(summary?.totals.chargedAmountUsd ?? 0)}`}
            />
            <Metric
              label="Base URL"
              value={apiBaseUrl.replace(/^https?:\/\//, "")}
              small
            />
          </div>
          <Requests requests={summary?.requests.slice(0, 8) ?? []} compact />
        </div>
        <aside className="user-overview-rail">
          <BaseUrlPanel />
          <AvailableModelsPanel models={availableModels} />
        </aside>
      </div>
    </div>
  );
}

function AvailableModelsPanel({ models }: { models: AvailableModel[] }) {
  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h2 className="section-title">可用模型</h2>
          <p className="section-subtitle">这里只显示当前可以调用的模型池。</p>
        </div>
        <StatusPill status={models.length > 0 ? "READY" : "UNAVAILABLE"} />
      </div>
      {models.length > 0 ? (
        <div className="chip-row">
          {models.map((item) => (
            <span className="chip info-chip" key={item.model}>
              {item.model}
            </span>
          ))}
        </div>
      ) : (
        <div className="empty-cell">暂无可用模型</div>
      )}
    </section>
  );
}

function ReferralPanel({ onError }: { onError: (error: string | null) => void }) {
  const [data, setData] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const loadReferral = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<ReferralDashboard>("/me/referral");
      setData(result);
    } catch (loadError) {
      onError(errorToText(loadError));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadReferral();
  }, [loadReferral]);

  async function copyInviteLink() {
    if (!data?.inviteLink) return;
    await navigator.clipboard?.writeText(data.inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (loading && !data) {
    return <p className="muted">邀请信息加载中...</p>;
  }

  if (!data) {
    return <div className="empty-cell">暂无邀请信息</div>;
  }

  return (
    <div className="grid">
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">专属邀请链接</h2>
            <p className="section-subtitle">
              新用户通过此链接用邮箱验证码注册后，双方会按后台配置获得奖励。
            </p>
          </div>
          <StatusPill status={data.settings.enabled ? "ACTIVE" : "DISABLED"} />
        </div>
        <div className="copy-field">
          <span>邀请链接</span>
          <code>{data.inviteLink}</code>
          <button
            className="button secondary"
            onClick={copyInviteLink}
            type="button"
          >
            {copied ? <Save size={16} /> : <Copy size={16} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </div>
        <div className="referral-full-link" aria-label="完整邀请链接">
          <code>{data.inviteLink}</code>
        </div>
        <div className="metric-grid">
          <Metric
            label="成功邀请"
            value={String(data.profile.successfulInvites)}
          />
          <Metric
            label="奖励记录"
            value={String(data.profile.rewardedInvites)}
          />
          <Metric
            label="邀请码"
            value={data.profile.code}
            small
          />
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">最近邀请</h2>
            <p className="section-subtitle">只展示通过你的链接注册成功的新用户。</p>
          </div>
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => void loadReferral()}
            type="button"
          >
            <RefreshCw size={16} />
            <span>{loading ? "刷新中..." : "刷新"}</span>
          </button>
        </div>
        {data.invites.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>新用户</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.invitee.email}</td>
                    <td>{dateTime(invite.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-cell">暂无邀请记录</div>
        )}
      </section>
    </div>
  );
}

function BaseUrlPanel() {
  return (
    <section className="card">
      <h2 className="section-title">接入地址</h2>
      <div className="endpoint-grid">
        <CopyField label="Base URL" value={apiBaseUrl} />
        <CopyField label="Responses" value={`${apiBaseUrl}/v1/responses`} />
        <CopyField
          label="Chat Completions"
          value={`${apiBaseUrl}/v1/chat/completions`}
        />
      </div>
    </section>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="copy-field">
      <span>{label}</span>
      <code>{value}</code>
      <button
        className="button secondary icon-button"
        onClick={copy}
        type="button"
      >
        {copied ? <Save size={16} /> : <Pencil size={16} />}
      </button>
    </div>
  );
}

function titleForTab(tab: Tab) {
  const item = frontNav.find((nav) => nav.id === tab);
  return item?.label ?? "总览";
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

async function readStreamAsText(response: Response) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}
