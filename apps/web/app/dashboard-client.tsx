"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  apiAuthFailureEvent,
  apiFetch,
  clearToken,
  getToken,
  isAuthError,
  setToken,
  type ApiAuthFailureDetail,
} from "../lib/api";
import type {
  FrontAvailableModel,
  FrontModelMapping,
  FrontSelectableAccessTier,
  FrontUsageSummary,
  FrontUser,
  FrontWallet,
} from "../lib/types/front";
import { CallTester } from "./front/_components/call-tester";
import {
  FrontAppShell,
  frontPageMeta,
  frontTabs,
  type FrontTab,
} from "./front/_components/front-app-shell";
import { FrontLogin } from "./front/_components/front-login";
import { FrontOverview } from "./front/_components/front-overview";
import { FrontRequestList } from "./front/_components/front-request-list";
import { Keys, type ApiKey } from "./front/_components/frontend-keys";
import {
  BillingDetails,
  WalletManagement,
} from "./front/_components/frontend-wallet";
import { ModelMappingsPanel } from "./front/_components/model-mappings-panel";
import { ReferralPanel } from "./front/_components/referral-panel";
import {
  FrontAlert,
  FrontButton,
  FrontLogo,
  FrontProviders,
  useFrontToast,
} from "./front/_components/ui/front-ui";

type LoadingState = {
  keys: boolean;
  mappings: boolean;
  wallet: boolean;
  summary: boolean;
  models: boolean;
  tiers: boolean;
};

const initialLoading: LoadingState = {
  keys: false,
  mappings: false,
  wallet: false,
  summary: false,
  models: false,
  tiers: false,
};

export default function DashboardClient({ referralCode }: { referralCode?: string }) {
  return (
    <FrontProviders>
      <DashboardController referralCode={referralCode} />
    </FrontProviders>
  );
}

function DashboardController({ referralCode }: { referralCode?: string }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<FrontUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FrontTab>(referralCode ? "referral" : "overview");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [modelMappings, setModelMappings] = useState<FrontModelMapping[]>([]);
  const [wallet, setWallet] = useState<FrontWallet | null>(null);
  const [summary, setSummary] = useState<FrontUsageSummary | null>(null);
  const [availableModels, setAvailableModels] = useState<FrontAvailableModel[]>([]);
  const [accessTiers, setAccessTiers] = useState<FrontSelectableAccessTier[]>([]);
  const [loading, setLoading] = useState<LoadingState>(initialLoading);
  const [switchingTierId, setSwitchingTierId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [refreshSignals, setRefreshSignals] = useState({
    wallet: 0,
    referral: 0,
    billing: 0,
    requests: 0,
  });
  const toast = useFrontToast();

  const resetUserData = useCallback(() => {
    setApiKeys([]);
    setModelMappings([]);
    setWallet(null);
    setSummary(null);
    setAvailableModels([]);
    setAccessTiers([]);
    setLoading(initialLoading);
    setSwitchingTierId(null);
    setPageError(null);
  }, []);

  const handleAuthFailure = useCallback((error: unknown, expectedToken?: string | null) => {
    if (!isAuthError(error)) return false;
    if (expectedToken && getToken() !== expectedToken) return true;
    clearToken();
    resetUserData();
    setTokenState(null);
    setUser(null);
    setAuthChecked(true);
    setAuthError(null);
    return true;
  }, [resetUserData]);

  useEffect(() => {
    const onAuthFailure = (event: Event) => {
      const detail = (event as CustomEvent<ApiAuthFailureDetail>).detail;
      if (!detail?.token || detail.token !== getToken()) return;
      handleAuthFailure(detail.error, detail.token);
    };
    window.addEventListener(apiAuthFailureEvent, onAuthFailure);
    return () => window.removeEventListener(apiAuthFailureEvent, onAuthFailure);
  }, [handleAuthFailure]);

  const loadKeys = useCallback(async (authToken?: string | null) => {
    setLoading((current) => ({ ...current, keys: true }));
    try {
      const result = await apiFetch<{ apiKeys: ApiKey[] }>("/api-keys", {
        token: authToken,
      });
      if (!authToken || getToken() === authToken) setApiKeys(result.apiKeys);
    } finally {
      if (!authToken || getToken() === authToken) {
        setLoading((current) => ({ ...current, keys: false }));
      }
    }
  }, []);

  const loadMappings = useCallback(async (authToken?: string | null) => {
    setLoading((current) => ({ ...current, mappings: true }));
    try {
      const result = await apiFetch<{ mappings: FrontModelMapping[] }>(
        "/model-mappings",
        { token: authToken },
      );
      if (!authToken || getToken() === authToken) setModelMappings(result.mappings);
    } finally {
      if (!authToken || getToken() === authToken) {
        setLoading((current) => ({ ...current, mappings: false }));
      }
    }
  }, []);

  const loadWallet = useCallback(async (authToken?: string | null) => {
    setLoading((current) => ({ ...current, wallet: true }));
    try {
      const result = await apiFetch<{ wallet: FrontWallet | null }>("/wallet", {
        token: authToken,
      });
      if (!authToken || getToken() === authToken) setWallet(result.wallet);
    } finally {
      if (!authToken || getToken() === authToken) {
        setLoading((current) => ({ ...current, wallet: false }));
      }
    }
  }, []);

  const loadSummary = useCallback(async (authToken?: string | null) => {
    setLoading((current) => ({ ...current, summary: true }));
    try {
      const result = await apiFetch<FrontUsageSummary>("/usage/summary", {
        token: authToken,
      });
      if (!authToken || getToken() === authToken) setSummary(result);
    } finally {
      if (!authToken || getToken() === authToken) {
        setLoading((current) => ({ ...current, summary: false }));
      }
    }
  }, []);

  const loadModels = useCallback(async (authToken?: string | null) => {
    setLoading((current) => ({ ...current, models: true }));
    try {
      const result = await apiFetch<{ models: FrontAvailableModel[] }>("/models", {
        token: authToken,
      });
      if (!authToken || getToken() === authToken) setAvailableModels(result.models);
    } finally {
      if (!authToken || getToken() === authToken) {
        setLoading((current) => ({ ...current, models: false }));
      }
    }
  }, []);

  const loadTiers = useCallback(async (authToken?: string | null) => {
    setLoading((current) => ({ ...current, tiers: true }));
    try {
      const result = await apiFetch<{ tiers: FrontSelectableAccessTier[] }>(
        "/me/access-tiers",
        { token: authToken },
      );
      if (!authToken || getToken() === authToken) setAccessTiers(result.tiers);
    } finally {
      if (!authToken || getToken() === authToken) {
        setLoading((current) => ({ ...current, tiers: false }));
      }
    }
  }, []);

  const loadMe = useCallback(async (authToken: string) => {
    const result = await apiFetch<{ user: FrontUser }>("/auth/me", {
      token: authToken,
    });
    if (getToken() === authToken) setUser(result.user);
    return result.user;
  }, []);

  const loadInitialData = useCallback(
    async (authToken: string) => {
      const loaders = [
        ["API Key", loadKeys],
        ["模型映射", loadMappings],
        ["钱包", loadWallet],
        ["用量", loadSummary],
        ["模型", loadModels],
        ["访问等级", loadTiers],
      ] as const;
      const results = await Promise.allSettled(
        loaders.map(async ([label, loader]) => {
          try {
            await loader(authToken);
          } catch (error) {
            if (handleAuthFailure(error, authToken)) return;
            throw new Error(`${label}加载失败：${errorToText(error)}`);
          }
        }),
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failed && getToken() === authToken) setPageError(errorToText(failed.reason));
    },
    [handleAuthFailure, loadKeys, loadMappings, loadModels, loadSummary, loadTiers, loadWallet],
  );

  const restoreSession = useCallback(async () => {
    const saved = getToken();
    if (!saved) {
      resetUserData();
      setTokenState(null);
      setUser(null);
      setAuthChecked(true);
      setAuthError(null);
      return;
    }
    setTokenState(saved);
    setAuthChecked(false);
    setAuthError(null);
    try {
      await loadMe(saved);
      setAuthChecked(true);
      await loadInitialData(saved);
    } catch (error) {
      if (handleAuthFailure(error, saved)) return;
      setAuthError(errorToText(error));
      setAuthChecked(true);
    }
  }, [handleAuthFailure, loadInitialData, loadMe, resetUserData]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const applyLocation = () => {
      const url = new URL(window.location.href);
      const requestedTab = url.searchParams.get("tab");
      const tab = parseTab(requestedTab);
      const nextTab = referralCode ? "referral" : tab;
      setActiveTab(nextTab);
      if (
        !referralCode &&
        requestedTab !== null &&
        !frontTabs.includes(requestedTab as FrontTab)
      ) {
        window.history.replaceState({}, "", "/?tab=overview");
      }
    };
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, [referralCode]);

  useEffect(() => {
    if (!authChecked) {
      document.title = "正在进入控制台 | APIshare";
      return;
    }
    if (!user) {
      document.title = referralCode
        ? "邀请登录 | APIshare"
        : "用户登录 | APIshare";
      return;
    }
    document.title = `${frontPageMeta[activeTab].title} | APIshare`;
  }, [activeTab, authChecked, referralCode, user]);

  function navigate(tab: FrontTab, replace = false) {
    setPageError(null);
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = `/?tab=${tab}`;
      if (replace) window.history.replaceState({}, "", url);
      else window.history.pushState({}, "", url);
    }
  }

  function logout() {
    clearToken();
    resetUserData();
    setTokenState(null);
    setUser(null);
    setAuthError(null);
    setAuthChecked(true);
    navigate("overview", true);
  }

  async function switchAccessTier(tier: FrontSelectableAccessTier) {
    if (!token || switchingTierId || user?.tierId === tier.id) return;
    setSwitchingTierId(tier.id);
    setPageError(null);
    try {
      const result = await apiFetch<{
        tier: FrontSelectableAccessTier;
        user: { tierId: string; tier: { id: string; code: string; name: string } };
      }>("/me/access-tier", {
        method: "PATCH",
        token,
        body: JSON.stringify({ tierId: tier.id }),
      });
      setUser((current) =>
        current
          ? { ...current, tierId: result.user.tierId, tier: result.user.tier }
          : current,
      );
      toast(`已切换为 ${result.tier.name}`);
      try {
        await loadModels(token);
      } catch (refreshError) {
        if (!handleAuthFailure(refreshError, token)) {
          setPageError(`等级已切换，但模型列表刷新失败：${errorToText(refreshError)}`);
        }
      }
    } catch (error) {
      if (!handleAuthFailure(error, token)) {
        setPageError(`等级切换失败：${errorToText(error)}`);
      }
    } finally {
      setSwitchingTierId(null);
    }
  }

  if (!authChecked) {
    return <AuthBoot />;
  }

  if (authError && token && !user) {
    return (
      <main className="front-public-page front-auth-boot">
        <section className="front-auth-boot-card">
          <FrontLogo />
          <FrontAlert tone="error" title="暂时无法恢复登录状态">
            {authError}
          </FrontAlert>
          <div className="front-auth-error-actions">
            <FrontButton onClick={() => void restoreSession()}>
              <RefreshCw aria-hidden="true" size={17} /> 重试
            </FrontButton>
            <FrontButton variant="secondary" onClick={logout}>重新登录</FrontButton>
          </div>
        </section>
      </main>
    );
  }

  if (!token || !user) {
    return (
      <FrontLogin
        referralCode={referralCode}
        onLogin={(nextToken, nextUser, referralApplied) => {
          resetUserData();
          setToken(nextToken);
          setTokenState(nextToken);
          setUser(nextUser);
          setAuthChecked(true);
          const nextTab = referralApplied ? "referral" : referralCode ? "overview" : activeTab;
          navigate(nextTab, true);
          if (referralApplied) toast("欢迎加入，已进入邀请奖励页面");
          void loadInitialData(nextToken);
        }}
      />
    );
  }

  return (
    <FrontAppShell
      user={user}
      wallet={wallet}
      activeTab={activeTab}
      onTabChange={navigate}
      onLogout={logout}
    >
      {pageError ? (
        <FrontAlert tone="error" className="front-page-error">
          {pageError}
        </FrontAlert>
      ) : null}

      {activeTab === "overview" ? (
        <FrontOverview
          wallet={wallet}
          summary={summary}
          apiKeys={apiKeys}
          availableModels={availableModels}
          loading={loading}
          onNavigate={navigate}
        />
      ) : null}
      {activeTab === "keys" ? (
        <Keys apiKeys={apiKeys} loading={loading.keys} onChanged={() => loadKeys(token)} />
      ) : null}
      {activeTab === "model-mappings" ? (
        <ModelMappingsPanel
          mappings={modelMappings}
          availableModels={availableModels}
          onChanged={setModelMappings}
        />
      ) : null}
      {activeTab === "wallet" ? (
        <WalletManagement
          user={user}
          wallet={wallet}
          accessTiers={accessTiers}
          accessTierLoading={loading.tiers}
          switchingTierId={switchingTierId}
          loading={loading.wallet}
          refreshSignal={refreshSignals.wallet}
          onSelectTier={switchAccessTier}
          onChanged={async () => {
            await Promise.all([
              loadWallet(token),
              loadMe(token),
              loadModels(token),
              loadTiers(token),
            ]);
          }}
        />
      ) : null}
      {activeTab === "billing" ? (
        <BillingDetails refreshSignal={refreshSignals.billing} />
      ) : null}
      {activeTab === "requests" ? (
        <FrontRequestList mode="paged" refreshSignal={refreshSignals.requests} />
      ) : null}
      {activeTab === "referral" ? (
        <ReferralPanel refreshSignal={refreshSignals.referral} />
      ) : null}
      {activeTab === "test" ? (
        <CallTester
          availableModels={availableModels}
          onChanged={async () => {
            await Promise.all([loadSummary(token), loadKeys(token)]);
            setRefreshSignals((current) => ({ ...current, requests: current.requests + 1 }));
          }}
        />
      ) : null}

    </FrontAppShell>
  );
}

function AuthBoot() {
  return (
    <main className="front-public-page front-auth-boot">
      <section className="front-auth-boot-card" aria-label="正在进入 APIshare 控制台">
        <FrontLogo />
        <div className="front-auth-boot-copy">
          <strong>正在进入控制台</strong>
          <p>正在安全恢复登录状态并准备工作台数据。</p>
        </div>
        <div className="front-auth-progress" aria-hidden="true" />
      </section>
    </main>
  );
}

function parseTab(value: string | null): FrontTab {
  return frontTabs.includes(value as FrontTab) ? (value as FrontTab) : "overview";
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
