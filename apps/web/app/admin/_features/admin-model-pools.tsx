"use client";

import {
  Copy,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { confirmAdminAction } from "../_components/admin-confirm";
import { dateTime, formatNumber, money, seconds } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";
import {
  AdminDataTable,
  ConsoleNavButton,
  InfoLine,
  Metric,
  ModalShell,
  MobileField,
  MobileRecord,
  StatusPill,
  StatusTile,
  WorkbenchLayout,
} from "../_components/admin-ui";

type AccessTierRef = { id: string; code: string; name: string };

type AccessTier = AccessTierRef & {
  status: "ACTIVE" | "DISABLED" | string;
  sortOrder: number;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { users: number; apiKeys: number; modelPools: number };
};

type UpstreamProviderKey = {
  id: string;
  upstreamProviderId: string;
  name: string;
  key: string;
  encryptedKey?: string | null;
  encryptionKeyVersion?: string | null;
  keyPrefix: string;
  status: "ACTIVE" | "DISABLED" | string;
  priority: number;
  lastUsedAt?: string | null;
  lastCheckStatus?: string | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  dailyLimitUsd?: string | null;
  monthlyLimitUsd?: string | null;
  providerRateLimit?: number | null;
  disabledReason?: string | null;
  lastErrorCategory?: string | null;
  createdAt: string;
  updatedAt: string;
};

type UpstreamProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  status: "ACTIVE" | "DISABLED";
  priority: number;
  timeoutMs: number;
  compactItemType: "compaction" | "compaction_summary";
  keys?: UpstreamProviderKey[];
  createdAt: string;
  updatedAt: string;
};

type ModelPoolHealthCheckEndpoint = "responses" | "chat.completions";

type ModelPoolChannelStatus = "ACTIVE" | "FORCED_ACTIVE" | "DISABLED" | "UNAVAILABLE" | "PENALIZED";

type ModelPoolChannel = {
  id: string;
  modelPoolId: string;
  upstreamProvider: string;
  status: ModelPoolChannelStatus | string;
  priority: number;
  consecutiveFailures: number;
  recoverySuccesses: number;
  penalizedUntil?: string | null;
  penaltyReason?: string | null;
  lastCheckStatus?: string | null;
  lastCheckedAt?: string | null;
  lastSuccessfulCallAt?: string | null;
  lastLatencyMs?: number | null;
  lastFirstTokenLatencyMs?: number | null;
  lastError?: string | null;
  checkIntervalSeconds?: number;
  nextCheckAt?: string | null;
  nextCheckRemainingSeconds?: number | null;
  penaltyRemainingSeconds?: number | null;
  successGraceRemainingSeconds?: number | null;
  healthCheckVersion?: string | null;
  hasPrice: boolean;
  priceEnabled: boolean;
  providerStatus: string;
  providerPriority?: number | null;
  activeKeyCount: number;
  unavailableReasons?: string[];
  isChecking?: boolean;
  checkingStartedAt?: string | null;
  effectiveStatus: "READY" | "FORCED_READY" | "UNAVAILABLE" | string;
};

type ModelPool = {
  id: string;
  model: string;
  tierId?: string | null;
  tier?: AccessTierRef | null;
  status: "ACTIVE" | "DISABLED" | string;
  autoHealthCheckEnabled: boolean;
  healthCheckEndpoint: ModelPoolHealthCheckEndpoint | string;
  readyChannelCount: number;
  pricedChannelCount: number;
  channels: ModelPoolChannel[];
  createdAt: string;
  updatedAt: string;
};

type AvailablePoolChannel = {
  id: string;
  model: string;
  upstreamProvider: string;
  priceEnabled: boolean;
  providerStatus: string;
  activeKeyCount: number;
};

type ModelPoolHealthCheck = {
  intervalSeconds: number;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
  penaltySeconds: number;
  minPenaltySeconds?: number;
  maxPenaltySeconds?: number;
  successGraceSeconds: number;
  minSuccessGraceSeconds?: number;
  maxSuccessGraceSeconds?: number;
  serverNow: string;
  receivedAtMs: number;
};

type ModelPoolResponse = {
  modelPools: ModelPool[];
  availableChannels: AvailablePoolChannel[];
  accessTiers?: AccessTier[];
  healthCheck: Omit<ModelPoolHealthCheck, "receivedAtMs">;
  dispatchSettings?: { forceAvailableButtonEnabled: boolean };
};

type UpstreamProvidersResponse = {
  providers: UpstreamProvider[];
};

function errorToText(error: unknown) { return error instanceof Error ? error.message : "未知错误"; }
function displayUpstreamProviderKeyName(name: string) { return name === "默认 Key" ? "key-1" : name; }
function MobileEmpty({ children }: { children: ReactNode }) { return <div className="mobile-empty">{children}</div>; }

export function AdminModelPoolsPage({
  onError,
}: {
  onError: (error: string | null) => void;
}) {
  const modelPools = useAdminResource<ModelPoolResponse>(
    "modelPools",
    "/admin/model-pools",
  );
  const upstreams = useAdminResource<UpstreamProvidersResponse>(
    "upstreams",
    "/admin/upstream-providers",
  );
  const [healthReceivedAtMs, setHealthReceivedAtMs] = useState(Date.now());

  useEffect(() => {
    if (modelPools.data?.healthCheck) {
      setHealthReceivedAtMs(Date.now());
    }
  }, [modelPools.data?.healthCheck]);

  useEffect(() => {
    const firstError = modelPools.error ?? upstreams.error;
    onError(firstError ? errorToText(firstError) : null);
  }, [modelPools.error, onError, upstreams.error]);

  return (
    <AdminModelPools
      modelPools={modelPools.data?.modelPools ?? []}
      availableChannels={modelPools.data?.availableChannels ?? []}
      accessTiers={modelPools.data?.accessTiers ?? []}
      upstreamProviders={upstreams.data?.providers ?? []}
      healthCheck={
        modelPools.data?.healthCheck
          ? { ...modelPools.data.healthCheck, receivedAtMs: healthReceivedAtMs }
          : null
      }
      forceAvailableButtonEnabled={
        modelPools.data?.dispatchSettings?.forceAvailableButtonEnabled ?? true
      }
      onRefreshModelPools={() => void modelPools.refetch()}
      onChanged={() => void modelPools.refetch()}
      onError={onError}
    />
  );
}

function AdminModelPools({
  modelPools,
  availableChannels,
  accessTiers,
  upstreamProviders,
  healthCheck,
  forceAvailableButtonEnabled,
  onRefreshModelPools,
  onChanged,
  onError,
}: {
  modelPools: ModelPool[];
  availableChannels: AvailablePoolChannel[];
  accessTiers: AccessTier[];
  upstreamProviders: UpstreamProvider[];
  healthCheck: ModelPoolHealthCheck | null;
  forceAvailableButtonEnabled: boolean;
  onRefreshModelPools: () => void;
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [createModel, setCreateModel] = useState("");
  const [createTierId, setCreateTierId] = useState("");
  const [copyTargetTierId, setCopyTargetTierId] = useState("");
  const [copyOverwriteExisting, setCopyOverwriteExisting] = useState(false);
  const [bulkProviderName, setBulkProviderName] = useState("");
  const [bulkProviderTierId, setBulkProviderTierId] = useState("");
  const [healthIntervalSeconds, setHealthIntervalSeconds] = useState("30");
  const [successGraceSeconds, setSuccessGraceSeconds] = useState("0");
  const [penaltySeconds, setPenaltySeconds] = useState("60");
  const [channelSelections, setChannelSelections] = useState<
    Record<string, string>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modelPoolModal, setModelPoolModal] = useState<
    "health" | "create" | "copy" | "bulk-toggle" | "bulk-add" | null
  >(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedPoolId, setSelectedPoolId] = useState("");
  const refreshTriggeredForKeyRef = useRef("");
  const lastDueRefreshAtRef = useRef(0);
  const activeTiers = accessTiers.filter((tier) => tier.status === "ACTIVE");
  const standardTier =
    accessTiers.find((tier) => tier.code === "standard") ?? null;
  const copyTargetTiers = accessTiers.filter(
    (tier) => tier.id !== standardTier?.id,
  );
  const selectedCreateTierId =
    createTierId || activeTiers[0]?.id || accessTiers[0]?.id || "";
  const selectedCopyTargetTierId =
    copyTargetTierId || copyTargetTiers[0]?.id || "";
  const bulkProviderOptions = upstreamProviders
    .filter((provider) => provider.name.trim().toLowerCase() !== "default")
    .map((provider) => provider.name);
  const bulkProviderOptionsKey = bulkProviderOptions.join("|");
  const selectedBulkProviderName =
    bulkProviderName || bulkProviderOptions[0] || "";
  const selectedBulkProviderTierId =
    bulkProviderTierId || activeTiers[0]?.id || accessTiers[0]?.id || "";
  const existingModelTierKeys = new Set(
    modelPools.map((pool) => `${pool.model}:${pool.tierId ?? ""}`),
  );
  const pricedModels = Array.from(
    new Set(availableChannels.map((channel) => channel.model)),
  ).sort();
  const creatableModels = pricedModels.filter(
    (model) => !existingModelTierKeys.has(`${model}:${selectedCreateTierId}`),
  );
  const creatableModelKey = creatableModels.join("|");
  const selectedCreateModel = createModel || creatableModels[0] || "";
  const groupedModelPools = groupModelPools(modelPools);
  const selectedModelGroup =
    groupedModelPools.find((group) => group.model === selectedModel) ??
    groupedModelPools[0] ??
    null;
  const selectedPool =
    selectedModelGroup?.pools.find((pool) => pool.id === selectedPoolId) ??
    selectedModelGroup?.pools[0] ??
    null;
  const selectableChannels = selectedPool ? channelsForPool(selectedPool) : [];
  const selectedChannel =
    selectedPool
      ? channelSelections[selectedPool.id] ||
        selectableChannels[0]?.upstreamProvider ||
        ""
      : "";
  const callableChannels =
    selectedPool?.channels.filter(isCallableModelPoolChannel) ?? [];
  const unavailableChannels =
    selectedPool?.channels.filter((channel) => !isCallableModelPoolChannel(channel)) ??
    [];

  useEffect(() => {
    if (!selectedModelGroup) {
      setSelectedModel("");
      setSelectedPoolId("");
      return;
    }
    if (selectedModel !== selectedModelGroup.model) {
      setSelectedModel(selectedModelGroup.model);
    }
    if (
      selectedModelGroup.pools.length > 0 &&
      !selectedModelGroup.pools.some((pool) => pool.id === selectedPoolId)
    ) {
      setSelectedPoolId(selectedModelGroup.pools[0]?.id ?? "");
    }
  }, [selectedModel, selectedModelGroup, selectedPoolId]);

  useEffect(() => {
    if (healthCheck) {
      setHealthIntervalSeconds(String(healthCheck.intervalSeconds));
      setSuccessGraceSeconds(String(healthCheck.successGraceSeconds));
      setPenaltySeconds(String(healthCheck.penaltySeconds));
    }
  }, [
    healthCheck?.intervalSeconds,
    healthCheck?.penaltySeconds,
    healthCheck?.successGraceSeconds,
  ]);

  useEffect(() => {
    if (
      creatableModels.length > 0 &&
      (!createModel || !creatableModels.includes(createModel))
    ) {
      setCreateModel(creatableModels[0] ?? "");
    }
  }, [creatableModelKey, createModel]);

  useEffect(() => {
    if (!createTierId && activeTiers[0]?.id) {
      setCreateTierId(activeTiers[0].id);
    }
  }, [createTierId, activeTiers]);

  useEffect(() => {
    if (!copyTargetTierId && copyTargetTiers[0]?.id) {
      setCopyTargetTierId(copyTargetTiers[0].id);
    }
  }, [copyTargetTierId, copyTargetTiers]);

  useEffect(() => {
    if (!bulkProviderName && bulkProviderOptions[0]) {
      setBulkProviderName(bulkProviderOptions[0]);
    }
  }, [bulkProviderName, bulkProviderOptionsKey]);

  useEffect(() => {
    if (!bulkProviderTierId && activeTiers[0]?.id) {
      setBulkProviderTierId(activeTiers[0].id);
    }
  }, [bulkProviderTierId, activeTiers]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const dueChannelIds = modelPools
      .flatMap((pool) =>
        pool.channels.map((channel) => ({
          channel,
          autoHealthCheckEnabled: pool.autoHealthCheckEnabled,
        })),
      )
      .filter(
        ({ channel, autoHealthCheckEnabled }) =>
          nextCheckState(channel, healthCheck, nowMs, autoHealthCheckEnabled)
            .isWaitingForResult,
      )
      .map(
        ({ channel }) =>
          `${channel.id}:${channel.nextCheckAt ?? ""}:${channel.isChecking ? "checking" : "due"}`,
      )
      .sort();
    const dueKey = dueChannelIds.join("|");
    const canRetryDueRefresh = nowMs - lastDueRefreshAtRef.current > 5000;

    if (
      !dueKey ||
      (refreshTriggeredForKeyRef.current === dueKey && !canRetryDueRefresh)
    ) {
      return;
    }

    refreshTriggeredForKeyRef.current = dueKey;
    lastDueRefreshAtRef.current = nowMs;
    void onRefreshModelPools();
  }, [modelPools, healthCheck, nowMs, onRefreshModelPools]);

  function channelsForPool(pool: ModelPool) {
    const existingChannels = new Set(
      pool.channels.map((channel) => channel.upstreamProvider),
    );
    return availableChannels.filter(
      (channel) =>
        channel.model === pool.model &&
        channel.upstreamProvider.trim().toLowerCase() !== "default" &&
        !existingChannels.has(channel.upstreamProvider),
    );
  }

  async function createPool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (!selectedCreateModel) {
      onError("请先在上游管理里给模型配置价格。");
      return;
    }

    try {
      await apiFetch("/admin/model-pools", {
        method: "POST",
        body: JSON.stringify({
          model: selectedCreateModel,
          tierId: selectedCreateTierId,
          status: "ACTIVE",
        }),
      });
      setCreateModel("");
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function copyStandardPools(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (!selectedCopyTargetTierId) {
      onError("请先创建一个非 standard 的访问等级。");
      return;
    }

    const targetTier = accessTiers.find(
      (tier) => tier.id === selectedCopyTargetTierId,
    );
    const confirmed = await confirmAdminAction({
      title: "复制 standard 模型池",
      description: `确定将 standard 模型池复制到「${targetTier?.name ?? "目标等级"}」吗？${copyOverwriteExisting ? "已存在的模型池会被覆盖基础配置和渠道状态。" : "已存在的模型池会跳过。"}`,
      confirmText: "开始复制",
      danger: copyOverwriteExisting,
    });

    if (!confirmed) {
      return;
    }

    setBusyId("copy-standard-pools");
    try {
      const response = await apiFetch<{
        result: {
          sourcePools: number;
          createdPools: number;
          updatedPools: number;
          createdChannels: number;
          updatedChannels: number;
          skippedModels: string[];
        };
      }>("/admin/model-pools/copy-standard", {
        method: "POST",
        body: JSON.stringify({
          targetTierId: selectedCopyTargetTierId,
          overwriteExisting: copyOverwriteExisting,
        }),
      });
      const result = response.result;
      onError(
        `复制完成：来源 ${result.sourcePools} 个，新增 ${result.createdPools} 个，更新 ${result.updatedPools} 个，新增渠道 ${result.createdChannels} 个，更新渠道 ${result.updatedChannels} 个，跳过 ${result.skippedModels.length} 个。`,
      );
      onChanged();
    } catch (copyError) {
      onError(errorToText(copyError));
    } finally {
      setBusyId(null);
    }
  }

  async function bulkSetProviderChannels(status: ModelPoolChannelStatus) {
    onError(null);

    if (!selectedBulkProviderName) {
      onError("请先配置上游 Provider。");
      return;
    }

    const confirmed = await confirmAdminAction({
      title: "批量设置渠道状态",
      description: `确定将所有「${selectedBulkProviderName}」模型池渠道设置为 ${status} 吗？`,
      confirmText: "批量设置",
      danger: status === "DISABLED",
    });

    if (!confirmed) {
      return;
    }

    setBusyId(`bulk-provider:${selectedBulkProviderName}`);
    try {
      const response = await apiFetch<{
        result: {
          upstreamProvider: string;
          status: string;
          updatedChannels: number;
        };
      }>("/admin/model-pool-channels/by-provider", {
        method: "PATCH",
        body: JSON.stringify({
          upstreamProvider: selectedBulkProviderName,
          status,
        }),
      });
      onError(
        `已将 ${response.result.upstreamProvider} 的 ${response.result.updatedChannels} 个渠道设置为 ${response.result.status}。`,
      );
      onChanged();
    } catch (bulkError) {
      onError(errorToText(bulkError));
    } finally {
      setBusyId(null);
    }
  }

  async function bulkAddProviderToTier() {
    onError(null);

    if (!selectedBulkProviderName || !selectedBulkProviderTierId) {
      onError("请先选择 Provider 和目标等级。");
      return;
    }

    const targetTier = accessTiers.find(
      (tier) => tier.id === selectedBulkProviderTierId,
    );
    const confirmed = await confirmAdminAction({
      title: "批量添加上游渠道",
      description: `确定把「${selectedBulkProviderName}」已定价的模型批量加入「${targetTier?.name ?? "目标等级"}」模型池吗？`,
      confirmText: "批量添加",
    });

    if (!confirmed) {
      return;
    }

    setBusyId(`bulk-add-provider:${selectedBulkProviderName}`);
    try {
      const response = await apiFetch<{
        result: {
          upstreamProvider: string;
          pricedModels: number;
          createdPools: number;
          existingPools: number;
          createdChannels: number;
          updatedChannels: number;
        };
      }>("/admin/model-pools/add-provider", {
        method: "POST",
        body: JSON.stringify({
          upstreamProvider: selectedBulkProviderName,
          tierId: selectedBulkProviderTierId,
          channelStatus: "ACTIVE",
          onlyEnabledPrices: true,
        }),
      });
      const result = response.result;
      onError(
        `已处理 ${result.upstreamProvider} 的 ${result.pricedModels} 个已启用定价模型：新增模型池 ${result.createdPools} 个，已有模型池 ${result.existingPools} 个，新增渠道 ${result.createdChannels} 个，更新渠道 ${result.updatedChannels} 个。`,
      );
      onChanged();
    } catch (bulkError) {
      onError(errorToText(bulkError));
    } finally {
      setBusyId(null);
    }
  }

  async function setPoolStatus(pool: ModelPool, status: "ACTIVE" | "DISABLED") {
    onError(null);
    setBusyId(pool.id);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function setPoolAutoHealthCheck(
    pool: ModelPool,
    autoHealthCheckEnabled: boolean,
  ) {
    onError(null);
    setBusyId(`${pool.id}:auto-health`);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}`, {
        method: "PATCH",
        body: JSON.stringify({ autoHealthCheckEnabled }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function setPoolHealthCheckEndpoint(
    pool: ModelPool,
    healthCheckEndpoint: ModelPoolHealthCheckEndpoint,
  ) {
    onError(null);
    setBusyId(`${pool.id}:health-endpoint`);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}`, {
        method: "PATCH",
        body: JSON.stringify({ healthCheckEndpoint }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function deletePool(pool: ModelPool) {
    const confirmed = await confirmAdminAction({
      title: "删除模型池",
      description: `确定删除模型池「${pool.model}」吗？池内上游渠道会一起移除，但上游定价不会被删除。`,
      confirmText: "删除模型池",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyId(pool.id);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  async function addChannel(pool: ModelPool) {
    const selectableChannels = channelsForPool(pool);
    const upstreamProvider =
      channelSelections[pool.id] ||
      selectableChannels[0]?.upstreamProvider ||
      "";

    if (!upstreamProvider) {
      onError("这个模型暂时没有可添加的上游渠道。");
      return;
    }

    onError(null);
    setBusyId(pool.id);
    try {
      await apiFetch(`/admin/model-pools/${pool.id}/channels`, {
        method: "POST",
        body: JSON.stringify({ upstreamProvider, status: "ACTIVE" }),
      });
      setChannelSelections((current) => ({ ...current, [pool.id]: "" }));
      onChanged();
    } catch (addError) {
      onError(errorToText(addError));
    } finally {
      setBusyId(null);
    }
  }

  async function setChannelStatus(
    channel: ModelPoolChannel,
    status: ModelPoolChannelStatus,
  ) {
    onError(null);
    setBusyId(channel.id);
    try {
      await apiFetch(`/admin/model-pool-channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function checkChannel(channel: ModelPoolChannel) {
    onError(null);
    setBusyId(channel.id);
    try {
      await apiFetch(`/admin/model-pool-channels/${channel.id}/check`, {
        method: "POST",
      });
      onChanged();
    } catch (checkError) {
      onError(errorToText(checkError));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteChannel(channel: ModelPoolChannel) {
    const confirmed = await confirmAdminAction({
      title: "移除模型池渠道",
      description: `确定从模型池移除「${channel.upstreamProvider}」吗？`,
      confirmText: "移除",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyId(channel.id);
    try {
      await apiFetch(`/admin/model-pool-channels/${channel.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  async function updateHealthInterval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    const intervalSeconds = Number(healthIntervalSeconds);
    const nextSuccessGraceSeconds = Number(successGraceSeconds);
    const nextPenaltySeconds = Number(penaltySeconds);
    const minIntervalSeconds = healthCheck?.minIntervalSeconds ?? 5;
    const maxIntervalSeconds = healthCheck?.maxIntervalSeconds ?? 3600;
    const minSuccessGraceSeconds = healthCheck?.minSuccessGraceSeconds ?? 0;
    const maxSuccessGraceSeconds = healthCheck?.maxSuccessGraceSeconds ?? 86400;
    const minPenaltySeconds = healthCheck?.minPenaltySeconds ?? 1;
    const maxPenaltySeconds = healthCheck?.maxPenaltySeconds ?? 86400;

    if (
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds < minIntervalSeconds ||
      intervalSeconds > maxIntervalSeconds
    ) {
      onError(
        `自动检测间隔必须是 ${minIntervalSeconds}-${maxIntervalSeconds} 秒之间的整数。`,
      );
      return;
    }

    if (
      !Number.isInteger(nextSuccessGraceSeconds) ||
      nextSuccessGraceSeconds < minSuccessGraceSeconds ||
      nextSuccessGraceSeconds > maxSuccessGraceSeconds
    ) {
      onError(
        `成功免检必须是 ${minSuccessGraceSeconds}-${maxSuccessGraceSeconds} 秒之间的整数。`,
      );
      return;
    }

    if (
      !Number.isInteger(nextPenaltySeconds) ||
      nextPenaltySeconds < minPenaltySeconds ||
      nextPenaltySeconds > maxPenaltySeconds
    ) {
      onError(
        `惩罚期必须是 ${minPenaltySeconds}-${maxPenaltySeconds} 秒之间的整数。`,
      );
      return;
    }

    setBusyId("health-check");
    try {
      await apiFetch("/admin/model-pools/health-check", {
        method: "PATCH",
        body: JSON.stringify({
          intervalSeconds,
          successGraceSeconds: nextSuccessGraceSeconds,
          penaltySeconds: nextPenaltySeconds,
        }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page admin-model-pool-page">
      {modelPoolModal === "health" ? (
        <ModalShell
          title="模型池检测参数"
          description="调整自动健康检测、成功免检和惩罚期。"
          onClose={() => setModelPoolModal(null)}
        >
          <form className="form" onSubmit={updateHealthInterval}>
            <div className="modal-body">
              <div className="grid cols-3">
                <label className="field">
                  <span>自动检测间隔（秒）</span>
                  <input
                    className="input"
                    max={healthCheck?.maxIntervalSeconds ?? 3600}
                    min={healthCheck?.minIntervalSeconds ?? 5}
                    step={1}
                    type="number"
                    value={healthIntervalSeconds}
                    onChange={(event) =>
                      setHealthIntervalSeconds(event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>成功免检（秒）</span>
                  <input
                    className="input"
                    max={healthCheck?.maxSuccessGraceSeconds ?? 86400}
                    min={healthCheck?.minSuccessGraceSeconds ?? 0}
                    step={1}
                    type="number"
                    value={successGraceSeconds}
                    onChange={(event) =>
                      setSuccessGraceSeconds(event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>惩罚期（秒）</span>
                  <input
                    className="input"
                    max={healthCheck?.maxPenaltySeconds ?? 86400}
                    min={healthCheck?.minPenaltySeconds ?? 1}
                    step={1}
                    type="number"
                    value={penaltySeconds}
                    onChange={(event) => setPenaltySeconds(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setModelPoolModal(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={busyId === "health-check"}
                type="submit"
              >
                <Save size={16} />
                保存检测
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {modelPoolModal === "create" ? (
        <ModalShell
          title="添加模型池"
          description="为指定访问等级添加一个已定价模型。"
          onClose={() => setModelPoolModal(null)}
        >
          <form className="form" onSubmit={createPool}>
            <div className="modal-body">
              <div className="grid cols-2">
                <label className="field">
                  <span>访问等级</span>
                  <select
                    className="input"
                    disabled={accessTiers.length === 0}
                    value={selectedCreateTierId}
                    onChange={(event) => setCreateTierId(event.target.value)}
                  >
                    {accessTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name} ({tier.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>模型</span>
                  <select
                    className="input"
                    disabled={creatableModels.length === 0}
                    value={selectedCreateModel}
                    onChange={(event) => setCreateModel(event.target.value)}
                  >
                    {creatableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                    {creatableModels.length === 0 ? (
                      <option value="">暂无可添加模型</option>
                    ) : null}
                  </select>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setModelPoolModal(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={creatableModels.length === 0 || !selectedCreateTierId}
                type="submit"
              >
                <Plus size={17} />
                添加模型池
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {modelPoolModal === "copy" ? (
        <ModalShell
          title="复制 standard 模型池"
          description="把 standard 等级的模型池配置复制到目标等级。"
          onClose={() => setModelPoolModal(null)}
        >
          <form className="form" onSubmit={copyStandardPools}>
            <div className="modal-body">
              <label className="field">
                <span>目标等级</span>
                <select
                  className="input"
                  disabled={copyTargetTiers.length === 0}
                  value={selectedCopyTargetTierId}
                  onChange={(event) => setCopyTargetTierId(event.target.value)}
                >
                  {copyTargetTiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name} ({tier.code})
                    </option>
                  ))}
                  {copyTargetTiers.length === 0 ? (
                    <option value="">暂无目标等级</option>
                  ) : null}
                </select>
              </label>
              <label className="check-row">
                <input
                  checked={copyOverwriteExisting}
                  onChange={(event) =>
                    setCopyOverwriteExisting(event.target.checked)
                  }
                  type="checkbox"
                />
                覆盖已有模型池
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setModelPoolModal(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={
                  busyId === "copy-standard-pools" ||
                  copyTargetTiers.length === 0
                }
                type="submit"
              >
                <Copy size={16} />
                复制
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {modelPoolModal === "bulk-toggle" ? (
        <ModalShell
          title="批量启停渠道"
          description="按上游 Provider 批量启用或禁用已加入的模型池渠道。"
          onClose={() => setModelPoolModal(null)}
        >
          <div className="modal-body">
            <label className="field">
              <span>Provider</span>
              <select
                className="input"
                disabled={bulkProviderOptions.length === 0}
                value={selectedBulkProviderName}
                onChange={(event) => setBulkProviderName(event.target.value)}
              >
                {bulkProviderOptions.map((providerName) => (
                  <option key={providerName} value={providerName}>
                    {providerName}
                  </option>
                ))}
                {bulkProviderOptions.length === 0 ? (
                  <option value="">暂无 Provider</option>
                ) : null}
              </select>
            </label>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setModelPoolModal(null)}
              type="button"
            >
              取消
            </button>
            <button
              className="button secondary"
              disabled={
                !selectedBulkProviderName ||
                busyId === `bulk-provider:${selectedBulkProviderName}`
              }
              onClick={() => bulkSetProviderChannels("ACTIVE")}
              type="button"
            >
              启用渠道
            </button>
            <button
              className="button danger"
              disabled={
                !selectedBulkProviderName ||
                busyId === `bulk-provider:${selectedBulkProviderName}`
              }
              onClick={() => bulkSetProviderChannels("DISABLED")}
              type="button"
            >
              禁用渠道
            </button>
          </div>
        </ModalShell>
      ) : null}

      {modelPoolModal === "bulk-add" ? (
        <ModalShell
          title="批量添加渠道"
          description="把指定 Provider 批量加入某个访问等级的模型池。"
          onClose={() => setModelPoolModal(null)}
        >
          <div className="modal-body">
            <div className="grid cols-2">
              <label className="field">
                <span>Provider</span>
                <select
                  className="input"
                  disabled={bulkProviderOptions.length === 0}
                  value={selectedBulkProviderName}
                  onChange={(event) => setBulkProviderName(event.target.value)}
                >
                  {bulkProviderOptions.map((providerName) => (
                    <option key={providerName} value={providerName}>
                      {providerName}
                    </option>
                  ))}
                  {bulkProviderOptions.length === 0 ? (
                    <option value="">暂无 Provider</option>
                  ) : null}
                </select>
              </label>
              <label className="field">
                <span>访问等级</span>
                <select
                  className="input"
                  disabled={accessTiers.length === 0}
                  value={selectedBulkProviderTierId}
                  onChange={(event) =>
                    setBulkProviderTierId(event.target.value)
                  }
                >
                  {accessTiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name} ({tier.code})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setModelPoolModal(null)}
              type="button"
            >
              取消
            </button>
            <button
              className="button"
              disabled={
                !selectedBulkProviderName ||
                !selectedBulkProviderTierId ||
                busyId === `bulk-add-provider:${selectedBulkProviderName}`
              }
              onClick={bulkAddProviderToTier}
              type="button"
            >
              <Plus size={16} />
              批量添加
            </button>
          </div>
        </ModalShell>
      ) : null}

      <WorkbenchLayout
        className="model-pool-workbench"
        sidebar={
          <>
            <div className="console-side-head">
              <div>
                <h2 className="section-title">模型</h2>
                <p className="section-subtitle">
                  {modelPools.filter((pool) => pool.readyChannelCount > 0).length}/{modelPools.length} 池可调用 · 检测 {healthCheck ? `${healthCheck.intervalSeconds}s` : "加载中"}
                </p>
              </div>
            </div>
            <div className="console-nav-list">
              {groupedModelPools.map((modelGroup) => (
                <ConsoleNavButton
                  key={modelGroup.model}
                  active={selectedModelGroup?.model === modelGroup.model}
                  title={modelGroup.model}
                  description={`${modelGroup.pools.length} 个等级 · READY ${sumReadyChannels(modelGroup.pools)} · 渠道 ${sumChannels(modelGroup.pools)}`}
                  meta={<StatusPill status={modelGroup.pools.some((pool) => pool.readyChannelCount > 0) ? "READY" : "UNAVAILABLE"} />}
                  onClick={() => {
                    setSelectedModel(modelGroup.model);
                    setSelectedPoolId(modelGroup.pools[0]?.id ?? "");
                  }}
                />
              ))}
              {groupedModelPools.length === 0 ? (
                <div className="empty-state compact">暂无模型池</div>
              ) : null}
            </div>
          </>
        }
        toolbar={
          <>
            <div>
              <h2 className="section-title">模型池调度工作台</h2>
              <p className="section-subtitle">左侧选模型，中间选等级池，右侧维护渠道。</p>
            </div>
            <div className="button-row admin-toolbar-actions">
              <button className="button secondary" onClick={onRefreshModelPools} type="button">
                <RefreshCw size={17} />
                刷新
              </button>
              <button className="button" disabled={creatableModels.length === 0 || !selectedCreateTierId} onClick={() => setModelPoolModal("create")} type="button">
                <Plus size={17} />
                添加模型池
              </button>
              <button className="button secondary" onClick={() => setModelPoolModal("health")} type="button">
                <Settings size={17} />
                检测参数
              </button>
              <button className="button secondary" disabled={copyTargetTiers.length === 0} onClick={() => setModelPoolModal("copy")} type="button">
                <Copy size={17} />
                复制 standard
              </button>
              <button className="button secondary" disabled={bulkProviderOptions.length === 0} onClick={() => setModelPoolModal("bulk-toggle")} type="button">
                <SlidersHorizontal size={17} />
                批量启停
              </button>
              <button className="button secondary" disabled={bulkProviderOptions.length === 0} onClick={() => setModelPoolModal("bulk-add")} type="button">
                <Plus size={17} />
                批量加渠道
              </button>
            </div>
          </>
        }
      >
      <section className="card model-pool-list-card legacy-model-pool-list">
        <div className="section-head">
          <div>
            <h2 className="section-title">模型池列表</h2>
            <p className="section-subtitle">
              只有 ACTIVE 模型池且至少一个渠道 READY 时，用户侧才可调用。
            </p>
          </div>
          <StatusPill
            status={
              modelPools.some((pool) => pool.readyChannelCount > 0)
                ? "READY"
                : "UNAVAILABLE"
            }
          />
        </div>
        <div className="provider-stack model-pool-scroll">
          {groupedModelPools.map((modelGroup, modelIndex) => (
            <details
              className="provider-panel model-dispatch-model-group model-pool-foldout"
              key={modelGroup.model}
              open={modelIndex === 0}
            >
              <summary className="model-pool-foldout-summary">
                <div>
                  <h3 className="section-title">{modelGroup.model}</h3>
                  <p className="section-subtitle">
                    {modelGroup.pools.length} 个等级 · 可调用{" "}
                    {sumReadyChannels(modelGroup.pools)} 个 · 已加入{" "}
                    {sumChannels(modelGroup.pools)} 个渠道
                  </p>
                </div>
                <div className="model-pool-foldout-meta">
                  <StatusPill status={modelGroup.pools.some((pool) => pool.readyChannelCount > 0) ? "READY" : "UNAVAILABLE"} />
                  <span className="foldout-caret">展开</span>
                </div>
              </summary>
              <div className="provider-stack">
                {modelGroup.pools.map((pool, poolIndex) => {
                  const selectableChannels = channelsForPool(pool);
                  const selectedChannel =
                    channelSelections[pool.id] ||
                    selectableChannels[0]?.upstreamProvider ||
                    "";
                  const callableChannels = pool.channels.filter(
                    isCallableModelPoolChannel,
                  );
                  const unavailableChannels = pool.channels.filter(
                    (channel) => !isCallableModelPoolChannel(channel),
                  );

                  return (
                    <details
                      className="subpanel model-tier-foldout"
                      key={pool.id}
                      open={modelIndex === 0 && poolIndex === 0}
                    >
                <summary className="provider-head model-tier-foldout-summary">
                  <div>
                    <div className="provider-title">
                      <strong>{pool.tier?.name ?? "Free"}</strong>
                      <span className="muted">
                        {pool.tier?.code ?? "standard"}
                      </span>
                      <StatusPill status={pool.status} />
                      <StatusPill
                        status={
                          pool.readyChannelCount > 0 ? "READY" : "UNAVAILABLE"
                        }
                      />
                      <StatusPill
                        status={
                          pool.autoHealthCheckEnabled
                            ? "AUTO_CHECK_ON"
                            : "AUTO_CHECK_OFF"
                        }
                      />
                    </div>
                    <p>
                      模型 {pool.model} · 可调用 {pool.readyChannelCount} 个 · 已定价{" "}
                      {pool.pricedChannelCount} 个 · 已加入{" "}
                      {pool.channels.length} 个 · 检测接口{" "}
                      {modelPoolHealthCheckEndpointLabel(
                        pool.healthCheckEndpoint,
                      )}
                      · 等级 {pool.tier?.name ?? "Free"}· 惩罚期{" "}
                      {healthCheck?.penaltySeconds ?? 60} 秒 · 自动检测
                      {pool.autoHealthCheckEnabled ? "已开启" : "已关闭"}
                    </p>
                  </div>
                  <div className="button-row">
                    <label className="inline-field">
                      <span>检测接口</span>
                      <select
                        className="input compact-select"
                        disabled={busyId === `${pool.id}:health-endpoint`}
                        value={normalizeModelPoolHealthCheckEndpoint(
                          pool.healthCheckEndpoint,
                        )}
                        onChange={(event) =>
                          setPoolHealthCheckEndpoint(
                            pool,
                            event.target.value as ModelPoolHealthCheckEndpoint,
                          )
                        }
                      >
                        <option value="responses">Responses</option>
                        <option value="chat.completions">
                          Chat Completions
                        </option>
                      </select>
                    </label>
                    <button
                      className="button secondary"
                      disabled={busyId === `${pool.id}:auto-health`}
                      onClick={() =>
                        setPoolAutoHealthCheck(
                          pool,
                          !pool.autoHealthCheckEnabled,
                        )
                      }
                      type="button"
                    >
                      {pool.autoHealthCheckEnabled
                        ? "关闭自动检测"
                        : "开启自动检测"}
                    </button>
                    {pool.status === "ACTIVE" ? (
                      <button
                        className="button secondary"
                        disabled={busyId === pool.id}
                        onClick={() => setPoolStatus(pool, "DISABLED")}
                        type="button"
                      >
                        停用模型池
                      </button>
                    ) : (
                      <button
                        className="button"
                        disabled={busyId === pool.id}
                        onClick={() => setPoolStatus(pool, "ACTIVE")}
                        type="button"
                      >
                        启用模型池
                      </button>
                    )}
                    <button
                      className="button danger"
                      disabled={busyId === pool.id}
                      onClick={() => deletePool(pool)}
                      type="button"
                    >
                      <Trash2 size={15} />
                      删除模型池
                    </button>
                  </div>
                </summary>

                <div className="section-head compact-head">
                  <div>
                    <h3 className="section-title">上游渠道</h3>
                    <p className="section-subtitle">
                      {pool.autoHealthCheckEnabled
                        ? `自动检测只使用 ${modelPoolHealthCheckEndpointLabel(pool.healthCheckEndpoint)}，每个渠道会检测该 Provider 下所有 ACTIVE Key；连续两次检测成功后恢复。`
                        : "这个模型池已关闭自动检测；手动检测和用户调用不受影响。"}
                    </p>
                  </div>
                  <div className="button-row">
                    <select
                      className="input compact-select"
                      disabled={selectableChannels.length === 0}
                      value={selectedChannel}
                      onChange={(event) =>
                        setChannelSelections((current) => ({
                          ...current,
                          [pool.id]: event.target.value,
                        }))
                      }
                    >
                      {selectableChannels.map((channel) => (
                        <option
                          key={channel.id}
                          value={channel.upstreamProvider}
                        >
                          {channel.upstreamProvider} ·{" "}
                          {channel.priceEnabled ? "价格启用" : "价格停用"} ·{" "}
                          {channel.providerStatus}· Key {channel.activeKeyCount}
                        </option>
                      ))}
                      {selectableChannels.length === 0 ? (
                        <option value="">暂无可添加渠道</option>
                      ) : null}
                    </select>
                    <button
                      className="button secondary"
                      disabled={busyId === pool.id || !selectedChannel}
                      onClick={() => addChannel(pool)}
                      type="button"
                    >
                      <Plus size={17} />
                      添加渠道
                    </button>
                  </div>
                </div>

                <div className="pool-channel-groups">
                  <section className="pool-channel-section callable">
                    <div className="pool-channel-section-head">
                      <span>可调用池</span>
                      <strong>{callableChannels.length}</strong>
                    </div>
                    <div className="pool-channel-list">
                      {callableChannels.map((channel, index) => (
                        <ModelPoolChannelCard
                          key={channel.id}
                          channel={channel}
                          pool={pool}
                          rank={index + 1}
                          healthCheck={healthCheck}
                          nowMs={nowMs}
                          busyId={busyId}
                          onCheck={checkChannel}
                          onDelete={deleteChannel}
                          onSetStatus={setChannelStatus}
                          forceAvailableButtonEnabled={forceAvailableButtonEnabled}
                        />
                      ))}
                      {callableChannels.length === 0 ? (
                        <div className="pool-channel-empty">暂无可调用渠道</div>
                      ) : null}
                    </div>
                  </section>
                  <section className="pool-channel-section unavailable">
                    <div className="pool-channel-section-head">
                      <span>不可调用池</span>
                      <strong>{unavailableChannels.length}</strong>
                    </div>
                    <div className="pool-channel-list">
                      {unavailableChannels.map((channel) => (
                        <ModelPoolChannelCard
                          key={channel.id}
                          channel={channel}
                          pool={pool}
                          healthCheck={healthCheck}
                          nowMs={nowMs}
                          busyId={busyId}
                          onCheck={checkChannel}
                          onDelete={deleteChannel}
                          onSetStatus={setChannelStatus}
                          forceAvailableButtonEnabled={forceAvailableButtonEnabled}
                        />
                      ))}
                      {unavailableChannels.length === 0 ? (
                        <div className="pool-channel-empty">
                          暂无不可调用渠道
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
                <div className="mobile-record-list model-pool-channel-records">
                  {pool.channels.map((channel) => (
                    <MobileRecord
                      key={channel.id}
                      title={channel.upstreamProvider}
                      meta={
                        channel.lastCheckedAt
                          ? `上次检测 ${dateTime(channel.lastCheckedAt)}`
                          : "尚未检测"
                      }
                      badges={
                        <StatusPill status={channel.effectiveStatus} strong />
                      }
                      actions={
                        <>
                          <button
                            className="button secondary"
                            disabled={busyId === channel.id}
                            onClick={() => checkChannel(channel)}
                            type="button"
                          >
                            检测
                          </button>
                          {forceAvailableButtonEnabled && channel.status !== "FORCED_ACTIVE" ? (
                            <button
                              className="button"
                              disabled={busyId === channel.id}
                              onClick={() =>
                                setChannelStatus(channel, "FORCED_ACTIVE")
                              }
                              type="button"
                            >
                              人工可用
                            </button>
                          ) : null}
                          {channel.status === "ACTIVE" ||
                          channel.status === "FORCED_ACTIVE" ? (
                            <button
                              className="button secondary"
                              disabled={busyId === channel.id}
                              onClick={() =>
                                setChannelStatus(channel, "DISABLED")
                              }
                              type="button"
                            >
                              停用
                            </button>
                          ) : (
                            <button
                              className="button secondary"
                              disabled={busyId === channel.id}
                              onClick={() =>
                                setChannelStatus(channel, "ACTIVE")
                              }
                              type="button"
                            >
                              自动可用
                            </button>
                          )}
                          <button
                            className="button danger"
                            disabled={busyId === channel.id}
                            onClick={() => deleteChannel(channel)}
                            type="button"
                          >
                            删除
                          </button>
                        </>
                      }
                    >
                      <MobileField label="池状态">
                        <StatusPill status={channel.status} />
                      </MobileField>
                      <MobileField label="价格">
                        <StatusPill
                          status={
                            channel.hasPrice && channel.priceEnabled
                              ? "ACTIVE"
                              : "DISABLED"
                          }
                        />
                      </MobileField>
                      <MobileField label="上游状态">
                        <StatusPill status={channel.providerStatus} />
                      </MobileField>
                      <MobileField label="自动检测">
                        <StatusPill
                          status={
                            pool.autoHealthCheckEnabled
                              ? "AUTO_CHECK_ON"
                              : "AUTO_CHECK_OFF"
                          }
                        />
                      </MobileField>
                      <MobileField label="检测接口">
                        {modelPoolHealthCheckEndpointLabel(
                          pool.healthCheckEndpoint,
                        )}
                      </MobileField>
                      <MobileField label="ACTIVE Key">
                        {channel.activeKeyCount}
                      </MobileField>
                      <MobileField label="惩罚">
                        {penaltyCountdown(channel, healthCheck, nowMs)}
                      </MobileField>
                      <MobileField label="恢复">
                        {channel.recoverySuccesses}/2
                      </MobileField>
                      <MobileField label="优先级">
                        {channel.priority}
                      </MobileField>
                      <MobileField label="连续失败">
                        {channel.consecutiveFailures}
                      </MobileField>
                      <MobileField label="下次检测">
                        {nextCheckCountdown(
                          channel,
                          healthCheck,
                          nowMs,
                          pool.autoHealthCheckEnabled,
                        )}
                      </MobileField>
                      <MobileField label="平均首字">
                        {seconds(channel.lastFirstTokenLatencyMs)}
                      </MobileField>
                      <MobileField label="平均总耗时">
                        {seconds(channel.lastLatencyMs)}
                      </MobileField>
                      <MobileField label="错误" wide>
                        {channel.lastError ?? "-"}
                      </MobileField>
                    </MobileRecord>
                  ))}
                  {pool.channels.length === 0 ? (
                    <MobileEmpty>暂无上游渠道</MobileEmpty>
                  ) : null}
                </div>
                    </details>
                  );
                })}
              </div>
            </details>
          ))}
          {modelPools.length === 0 ? (
            <div className="empty-cell">暂无模型池</div>
          ) : null}
        </div>
      </section>
      <div className="model-pool-triple">
        <section className="card model-pool-tier-list">
          <div className="section-head">
            <div>
              <h2 className="section-title">等级池</h2>
              <p className="section-subtitle">{selectedModelGroup?.model ?? "未选择模型"}</p>
            </div>
          </div>
          <div className="console-nav-list">
            {selectedModelGroup?.pools.map((pool) => (
              <ConsoleNavButton
                key={pool.id}
                active={selectedPool?.id === pool.id}
                title={pool.tier?.name ?? "Free"}
                description={`${pool.tier?.code ?? "standard"} · READY ${pool.readyChannelCount}/${pool.channels.length} · ${modelPoolHealthCheckEndpointLabel(pool.healthCheckEndpoint)}`}
                meta={<StatusPill status={pool.readyChannelCount > 0 ? "READY" : "UNAVAILABLE"} />}
                onClick={() => setSelectedPoolId(pool.id)}
              />
            ))}
            {!selectedModelGroup ? <div className="empty-state compact">暂无等级池</div> : null}
          </div>
        </section>

        <section className="card model-pool-detail">
          {selectedPool ? (
            <>
              <div className="section-head">
                <div>
                  <h2 className="section-title">
                    {selectedPool.tier?.name ?? "Free"} · {selectedPool.model}
                  </h2>
                  <p className="section-subtitle">
                    READY {selectedPool.readyChannelCount} · 已定价 {selectedPool.pricedChannelCount} · 渠道 {selectedPool.channels.length}
                  </p>
                </div>
                <div className="button-row">
                  <select
                    className="input compact-select"
                    disabled={busyId === `${selectedPool.id}:health-endpoint`}
                    value={normalizeModelPoolHealthCheckEndpoint(selectedPool.healthCheckEndpoint)}
                    onChange={(event) =>
                      setPoolHealthCheckEndpoint(
                        selectedPool,
                        event.target.value as ModelPoolHealthCheckEndpoint,
                      )
                    }
                  >
                    <option value="responses">Responses</option>
                    <option value="chat.completions">Chat Completions</option>
                  </select>
                  <button
                    className="button secondary"
                    disabled={busyId === `${selectedPool.id}:auto-health`}
                    onClick={() => setPoolAutoHealthCheck(selectedPool, !selectedPool.autoHealthCheckEnabled)}
                    type="button"
                  >
                    {selectedPool.autoHealthCheckEnabled ? "关闭自动检测" : "开启自动检测"}
                  </button>
                  {selectedPool.status === "ACTIVE" ? (
                    <button className="button secondary" disabled={busyId === selectedPool.id} onClick={() => setPoolStatus(selectedPool, "DISABLED")} type="button">
                      停用模型池
                    </button>
                  ) : (
                    <button className="button" disabled={busyId === selectedPool.id} onClick={() => setPoolStatus(selectedPool, "ACTIVE")} type="button">
                      启用模型池
                    </button>
                  )}
                  <button className="button danger" disabled={busyId === selectedPool.id} onClick={() => deletePool(selectedPool)} type="button">
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              </div>
              <div className="section-head compact-head">
                <div>
                  <h3 className="section-title">上游渠道</h3>
                  <p className="section-subtitle">
                    {selectedPool.autoHealthCheckEnabled
                      ? `自动检测使用 ${modelPoolHealthCheckEndpointLabel(selectedPool.healthCheckEndpoint)}。`
                      : "已关闭自动检测；手动检测和用户调用不受影响。"}
                  </p>
                </div>
                <div className="button-row">
                  <select
                    className="input compact-select"
                    disabled={selectableChannels.length === 0}
                    value={selectedChannel}
                    onChange={(event) =>
                      setChannelSelections((current) => ({
                        ...current,
                        [selectedPool.id]: event.target.value,
                      }))
                    }
                  >
                    {selectableChannels.map((channel) => (
                      <option key={channel.id} value={channel.upstreamProvider}>
                        {channel.upstreamProvider} · {channel.priceEnabled ? "价格启用" : "价格停用"} · {channel.providerStatus} · Key {channel.activeKeyCount}
                      </option>
                    ))}
                    {selectableChannels.length === 0 ? <option value="">暂无可添加渠道</option> : null}
                  </select>
                  <button className="button secondary" disabled={busyId === selectedPool.id || !selectedChannel} onClick={() => addChannel(selectedPool)} type="button">
                    <Plus size={17} />
                    添加渠道
                  </button>
                </div>
              </div>
              <div className="pool-channel-groups compact">
                <section className="pool-channel-section callable">
                  <div className="pool-channel-section-head">
                    <span>可调用池</span>
                    <strong>{callableChannels.length}</strong>
                  </div>
                  <div className="pool-channel-list">
                    {callableChannels.map((channel, index) => (
                      <ModelPoolChannelCard
                        key={channel.id}
                        channel={channel}
                        pool={selectedPool}
                        rank={index + 1}
                        healthCheck={healthCheck}
                        nowMs={nowMs}
                        busyId={busyId}
                        onCheck={checkChannel}
                        onDelete={deleteChannel}
                        onSetStatus={setChannelStatus}
                        forceAvailableButtonEnabled={forceAvailableButtonEnabled}
                      />
                    ))}
                    {callableChannels.length === 0 ? <div className="pool-channel-empty">暂无可调用渠道</div> : null}
                  </div>
                </section>
                <section className="pool-channel-section unavailable">
                  <div className="pool-channel-section-head">
                    <span>不可调用池</span>
                    <strong>{unavailableChannels.length}</strong>
                  </div>
                  <div className="pool-channel-list">
                    {unavailableChannels.map((channel) => (
                      <ModelPoolChannelCard
                        key={channel.id}
                        channel={channel}
                        pool={selectedPool}
                        healthCheck={healthCheck}
                        nowMs={nowMs}
                        busyId={busyId}
                        onCheck={checkChannel}
                        onDelete={deleteChannel}
                        onSetStatus={setChannelStatus}
                        forceAvailableButtonEnabled={forceAvailableButtonEnabled}
                      />
                    ))}
                    {unavailableChannels.length === 0 ? <div className="pool-channel-empty">暂无不可调用渠道</div> : null}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <div className="empty-cell">请选择模型池</div>
          )}
        </section>
      </div>
      </WorkbenchLayout>
    </div>
  );
}

function ChannelFact({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "channel-fact wide" : "channel-fact"}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

type ChannelStatusTone = "ok" | "warn" | "neutral";

function compactStatusTone(status: string): ChannelStatusTone {
  if (
    status === "ACTIVE" ||
    status === "READY" ||
    status === "FORCED_ACTIVE" ||
    status === "FORCED_READY" ||
    status === "HEALTHY" ||
    status === "SUCCESS" ||
    status === "AUTO_CHECK_ON"
  ) {
    return "ok";
  }
  if (
    status === "DISABLED" ||
    status === "UNAVAILABLE" ||
    status === "PENALIZED" ||
    status === "FAILED" ||
    status === "UNHEALTHY" ||
    status === "MISSING" ||
    status === "REVOKED" ||
    status === "AUTO_CHECK_OFF"
  ) {
    return "warn";
  }
  return "neutral";
}

function compactStatusLabel(status: string) {
  const labelMap: Record<string, string> = {
    ACTIVE: "启用",
    AUTO_CHECK_OFF: "自检关",
    AUTO_CHECK_ON: "自检开",
    DISABLED: "停用",
    FAILED: "失败",
    FORCED_ACTIVE: "人工",
    FORCED_READY: "人工",
    HEALTHY: "正常",
    MISSING: "缺失",
    PENALIZED: "惩罚",
    READY: "可调",
    REVOKED: "失效",
    SUCCESS: "成功",
    UNAVAILABLE: "不可用",
    UNHEALTHY: "异常",
    WAITING: "等待",
  };
  return labelMap[status] ?? status;
}

function channelScheduleLabel(status: string) {
  if (status === "ACTIVE") {
    return "自动";
  }
  return compactStatusLabel(status);
}

function ModelPoolChannelCard({
  channel,
  pool,
  rank,
  healthCheck,
  nowMs,
  busyId,
  onCheck,
  onDelete,
  onSetStatus,
  forceAvailableButtonEnabled,
}: {
  channel: ModelPoolChannel;
  pool: ModelPool;
  rank?: number;
  healthCheck: ModelPoolHealthCheck | null;
  nowMs: number;
  busyId: string | null;
  onCheck: (channel: ModelPoolChannel) => void;
  onDelete: (channel: ModelPoolChannel) => void;
  onSetStatus: (
    channel: ModelPoolChannel,
    status: ModelPoolChannelStatus,
  ) => void;
  forceAvailableButtonEnabled: boolean;
}) {
  const priceStatus =
    channel.hasPrice && channel.priceEnabled
      ? "ACTIVE"
      : channel.hasPrice
        ? "DISABLED"
        : "MISSING";
  const errorText = formatChannelError(channel.lastError);
  const healthCountdown = nextCheckCountdown(
    channel,
    healthCheck,
    nowMs,
    pool.autoHealthCheckEnabled,
  );
  const successGraceCountdown = successGraceCountdownText(
    channel,
    healthCheck,
    nowMs,
  );
  const statusItems = [
    {
      label: "通道",
      value: compactStatusLabel(channel.effectiveStatus),
      tone: compactStatusTone(channel.effectiveStatus),
    },
    {
      label: "调度",
      value: channelScheduleLabel(channel.status),
      tone: compactStatusTone(channel.status),
    },
    {
      label: "定价",
      value:
        priceStatus === "ACTIVE"
          ? "已开"
          : priceStatus === "DISABLED"
            ? "停用"
            : "缺失",
      tone: compactStatusTone(priceStatus),
    },
    {
      label: "上游",
      value: compactStatusLabel(channel.providerStatus),
      tone: compactStatusTone(channel.providerStatus),
    },
  ];

  return (
    <article
      className={`${rank ? "pool-channel-row callable" : "pool-channel-row unavailable"}${errorText ? " has-error" : ""}`}
    >
      <div className="pool-channel-main">
        <div className="pool-channel-top">
          <div className="pool-channel-title">
            {rank ? <span className="rank-pill">#{rank}</span> : null}
            <strong>{channel.upstreamProvider}</strong>
          </div>
          <span
            className={`channel-state-dot ${compactStatusTone(channel.effectiveStatus)}`}
            aria-hidden="true"
          />
        </div>
        <div className="pool-channel-status-strip" aria-label="渠道状态">
          {statusItems.map((item) => (
            <span className={`compact-status ${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </span>
          ))}
        </div>
      </div>
      <div className="pool-channel-facts" aria-label="渠道详情">
        <div className="channel-fact-group timing">
          <ChannelFact label="免检">{successGraceCountdown}</ChannelFact>
          <ChannelFact label="下次检测">{healthCountdown}</ChannelFact>
          <ChannelFact label="惩罚">
            {penaltyCountdown(channel, healthCheck, nowMs)}
          </ChannelFact>
        </div>
        <div className="channel-fact-group routing">
          <ChannelFact label="ACTIVE Key">{channel.activeKeyCount}</ChannelFact>
          <ChannelFact label="优先级">{channel.priority}</ChannelFact>
          <ChannelFact label="连续失败">
            {channel.consecutiveFailures}
          </ChannelFact>
          <ChannelFact label="恢复">{channel.recoverySuccesses}/2</ChannelFact>
        </div>
        <div className="channel-fact-group latency">
          <ChannelFact label="平均首字">
            {seconds(channel.lastFirstTokenLatencyMs)}
          </ChannelFact>
          <ChannelFact label="平均总耗">
            {seconds(channel.lastLatencyMs)}
          </ChannelFact>
        </div>
      </div>
      {errorText ? (
        <div className="pool-channel-error">
          <span>错误</span>
          <strong>{errorText}</strong>
        </div>
      ) : null}
      {channel.unavailableReasons?.length ? (
        <div className="pool-channel-error">
          <span>不可用原因</span>
          <strong>{channel.unavailableReasons.join("；")}</strong>
        </div>
      ) : null}
      <div className="pool-channel-actions">
        <button
          className="button secondary"
          disabled={busyId === channel.id}
          onClick={() => onCheck(channel)}
          type="button"
        >
          检测
        </button>
        {forceAvailableButtonEnabled && channel.status !== "FORCED_ACTIVE" ? (
          <button
            className="button"
            disabled={busyId === channel.id}
            onClick={() => onSetStatus(channel, "FORCED_ACTIVE")}
            type="button"
          >
            人工可用
          </button>
        ) : null}
        {channel.status === "ACTIVE" || channel.status === "FORCED_ACTIVE" ? (
          <button
            className="button secondary"
            disabled={busyId === channel.id}
            onClick={() => onSetStatus(channel, "DISABLED")}
            type="button"
          >
            停用
          </button>
        ) : (
          <button
            className="button secondary"
            disabled={busyId === channel.id}
            onClick={() => onSetStatus(channel, "ACTIVE")}
            type="button"
          >
            自动可用
          </button>
        )}
        <button
          className="button danger"
          disabled={busyId === channel.id}
          onClick={() => onDelete(channel)}
          type="button"
        >
          <Trash2 size={15} />
          删除
        </button>
      </div>
    </article>
  );
}

function formatChannelError(value?: string | null) {
  const text = value?.trim();
  if (!text) {
    return "";
  }

  const normalized = text.toLowerCase();
  if (
    (normalized.includes("operation") && normalized.includes("abort")) ||
    normalized.includes("aborterror") ||
    normalized.includes("aborted")
  ) {
    return "健康检测超时：上游没有及时返回，网关已主动中止这次检测。";
  }

  return text;
}

function isCallableModelPoolChannel(channel: ModelPoolChannel) {
  return (
    channel.effectiveStatus === "READY" ||
    channel.effectiveStatus === "FORCED_READY"
  );
}

function formatConcurrencyLimit(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "不限";
  }

  return `${numeric}`;
}

function formatRateLimit(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "不限";
  }

  return `${numeric}/min`;
}

function nextCheckState(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
  autoHealthCheckEnabled = true,
) {
  if (channel.status === "PENALIZED") {
    const remaining = penaltyRemainingSeconds(channel, healthCheck, nowMs);
    return {
      secondsUntilNext: remaining === 0 ? 0 : null,
      isWaitingForResult: remaining === 0,
    };
  }

  if (channel.isChecking) {
    return { secondsUntilNext: 0, isWaitingForResult: true };
  }

  if (!autoHealthCheckEnabled || !healthCheck) {
    return { secondsUntilNext: null, isWaitingForResult: false };
  }

  const secondsUntilNext = channel.nextCheckRemainingSeconds;

  if (secondsUntilNext === null || secondsUntilNext === undefined) {
    return { secondsUntilNext: null, isWaitingForResult: false };
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((nowMs - healthCheck.receivedAtMs) / 1000),
  );
  const displayedSecondsUntilNext = Math.max(
    0,
    secondsUntilNext - elapsedSeconds,
  );

  return {
    secondsUntilNext: displayedSecondsUntilNext,
    isWaitingForResult: displayedSecondsUntilNext === 0,
  };
}

function nextCheckCountdown(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
  autoHealthCheckEnabled = true,
) {
  if (channel.status === "PENALIZED") {
    const remaining = penaltyRemainingSeconds(channel, healthCheck, nowMs);
    return remaining === 0
      ? "恢复检测"
      : remaining === null
        ? "-"
        : `${remaining}s 后恢复`;
  }

  if (!autoHealthCheckEnabled && !channel.isChecking) {
    return "未参与";
  }

  const successGraceRemaining = successGraceRemainingSeconds(
    channel,
    healthCheck,
    nowMs,
  );
  if (successGraceRemaining !== null && successGraceRemaining > 0) {
    return `免检中 ${successGraceRemaining}s`;
  }

  const state = nextCheckState(
    channel,
    healthCheck,
    nowMs,
    autoHealthCheckEnabled,
  );

  if (state.secondsUntilNext === null) {
    return "-";
  }

  return state.isWaitingForResult ? "等待检测" : `${state.secondsUntilNext}s`;
}

function successGraceCountdownText(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
) {
  const remaining = successGraceRemainingSeconds(channel, healthCheck, nowMs);
  if (remaining === null) {
    return "-";
  }

  return remaining > 0 ? `${remaining}s` : "结束";
}

function successGraceRemainingSeconds(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
) {
  const fromServer = channel.successGraceRemainingSeconds;
  if (fromServer !== null && fromServer !== undefined) {
    const elapsedSeconds = healthCheck
      ? Math.max(0, Math.floor((nowMs - healthCheck.receivedAtMs) / 1000))
      : 0;
    return Math.max(0, fromServer - elapsedSeconds);
  }

  if (!channel.lastSuccessfulCallAt || !healthCheck) {
    return null;
  }

  return Math.max(
    0,
    Math.ceil(
      (new Date(channel.lastSuccessfulCallAt).getTime() +
        healthCheck.successGraceSeconds * 1000 -
        nowMs) /
        1000,
    ),
  );
}

function penaltyRemainingSeconds(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
) {
  const fromServer = channel.penaltyRemainingSeconds;
  if (fromServer !== null && fromServer !== undefined) {
    const elapsedSeconds = healthCheck
      ? Math.max(0, Math.floor((nowMs - healthCheck.receivedAtMs) / 1000))
      : 0;
    return Math.max(0, fromServer - elapsedSeconds);
  }

  if (!channel.penalizedUntil) {
    return null;
  }

  return Math.max(
    0,
    Math.ceil((new Date(channel.penalizedUntil).getTime() - nowMs) / 1000),
  );
}

function penaltyCountdown(
  channel: ModelPoolChannel,
  healthCheck: ModelPoolHealthCheck | null,
  nowMs: number,
) {
  if (channel.status !== "PENALIZED") {
    return "-";
  }

  const remaining = penaltyRemainingSeconds(channel, healthCheck, nowMs);
  return remaining === null ? "-" : remaining === 0 ? "到期" : `${remaining}s`;
}

function groupModelPools(modelPools: ModelPool[]) {
  const groups = new Map<string, ModelPool[]>();
  for (const pool of modelPools) {
    groups.set(pool.model, [...(groups.get(pool.model) ?? []), pool]);
  }

  return Array.from(groups.entries())
    .map(([model, pools]) => ({
      model,
      pools: pools.sort((left, right) =>
        (left.tier?.code ?? "standard").localeCompare(
          right.tier?.code ?? "standard",
        ),
      ),
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
}

function sumReadyChannels(pools: ModelPool[]) {
  return pools.reduce((total, pool) => total + pool.readyChannelCount, 0);
}

function sumChannels(pools: ModelPool[]) {
  return pools.reduce((total, pool) => total + pool.channels.length, 0);
}

function normalizeModelPoolHealthCheckEndpoint(
  value: string | null | undefined,
): ModelPoolHealthCheckEndpoint {
  return value === "chat.completions" ? "chat.completions" : "responses";
}

function modelPoolHealthCheckEndpointLabel(value: string | null | undefined) {
  return normalizeModelPoolHealthCheckEndpoint(value) === "chat.completions"
    ? "Chat Completions"
    : "Responses";
}
