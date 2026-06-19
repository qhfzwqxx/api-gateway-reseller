"use client";

import {
  Copy,
  FileSearch,
  KeyRound,
  Pencil,
  Plus,
  Save,
  Send,
  Server,
  SlidersHorizontal,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { adminDownload } from "../_components/admin-api";
import { confirmAdminAction } from "../_components/admin-confirm";
import {
  dateTime,
  money,
  parseModelList,
  seconds,
  splitList,
} from "../_components/admin-format";
import {
  AdminDataTable,
  AdminFoldout,
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
import { useAdminResource } from "../_components/admin-hooks";

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

type ModelPrice = {
  id: string;
  model: string;
  upstreamProvider: string;
  upstreamEndpoint: "responses" | "chat_completions" | "images_generations";
  pricingMode: "token" | "request";
  currency: string;
  upstreamInputPer1MTok: string;
  upstreamCachedInputPer1MTok: string;
  upstreamOutputPer1MTok: string;
  upstreamPriceMultiplier: string;
  upstreamPerRequestUsd: string;
  customerInputPer1MTok: string;
  customerCachedInputPer1MTok: string;
  customerOutputPer1MTok: string;
  customerPriceMultiplier: string;
  minimumChargeUsd: string;
  perRequestUsd: string;
  enabled: boolean;
  priceVersion: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  createdByUserId?: string | null;
};

type ModelPriceMarginRisk = {
  level: "loss" | "low" | "ok" | "unknown";
  label: string;
  detail: string;
  worstMarginPercent: number | null;
};

type UnifiedPriceDraft = {
  customerInputPer1MTok: string;
  customerCachedInputPer1MTok: string;
  customerOutputPer1MTok: string;
  customerPriceMultiplier: string;
};

type UnifiedPriceSetting = UnifiedPriceDraft & {
  model: string;
  enabled: boolean;
};

type UnifiedPriceGroup = {
  model: string;
  prices: ModelPrice[];
  providerNames: string[];
  setting?: UnifiedPriceSetting;
  hasDifferentOriginalCustomerPricing: boolean;
};

type ModelPriceImportPreviewRow = {
  action: "create" | "update";
  data: {
    model: string;
    upstreamProvider: string;
    pricingMode: "token" | "request";
    currency: string;
    upstreamInputPer1MTok: string;
    upstreamCachedInputPer1MTok: string;
    upstreamOutputPer1MTok: string;
    upstreamPriceMultiplier: string;
    upstreamPerRequestUsd: string;
    customerInputPer1MTok: string;
    customerCachedInputPer1MTok: string;
    customerOutputPer1MTok: string;
    customerPriceMultiplier: string;
    minimumChargeUsd: string;
    perRequestUsd: string;
    enabled: boolean;
    priceVersion: string;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  };
};

type ModelPriceImportPreview = {
  dryRun: boolean;
  summary: { rows: number; creates: number; updates: number };
  rows: ModelPriceImportPreviewRow[];
};

type UpstreamProvidersResponse = {
  providers: UpstreamProvider[];
};

type ModelPricesResponse = {
  modelPrices: ModelPrice[];
  unifiedPriceSettings?: UnifiedPriceSetting[];
};

const modelPriceImportExampleCsv = [
  "model,upstreamProvider,upstreamEndpoint,pricingMode,currency,upstreamInputPer1MTok,upstreamCachedInputPer1MTok,upstreamOutputPer1MTok,upstreamPriceMultiplier,upstreamPerRequestUsd,customerInputPer1MTok,customerCachedInputPer1MTok,customerOutputPer1MTok,customerPriceMultiplier,minimumChargeUsd,perRequestUsd,enabled,priceVersion,effectiveFrom,effectiveTo",
  "gpt-4o-mini,openai,responses,token,USD,5,0.5,30,1,0,6,0.6,36,1,0,0,true,v1,,",
].join("\n");

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
function displayUpstreamProviderKeyName(name: string) {
  return name === "默认 Key" ? "key-1" : name;
}
function displayCompactItemType(type?: UpstreamProvider["compactItemType"]) {
  return type === "compaction" ? "compaction" : "compaction_summary";
}
function normalizeOptionalNumberText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
function parseBatchProviderKeys(value: string) {
  return value
    .split(/\r?\n/)
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return null;
      }

      const [name, key] = trimmed.split(/\s+/, 2);
      if (!name || !key) {
        throw new Error(`第 ${index + 1} 行格式不正确，请使用：名称 空格 key`);
      }

      return { name, key };
    })
    .filter((item): item is { name: string; key: string } => Boolean(item));
}
function MobileEmpty({ children }: { children: React.ReactNode }) {
  return <div className="mobile-empty">{children}</div>;
}
function formatPriceValidity(
  price: Pick<ModelPrice, "effectiveFrom" | "effectiveTo">,
) {
  const starts = price.effectiveFrom ? dateTime(price.effectiveFrom) : "立即";
  const expires = price.effectiveTo ? dateTime(price.effectiveTo) : "长期";
  return `${starts} - ${expires}`;
}

export function AdminUpstreamsPage({
  onError,
}: {
  onError: (error: string | null) => void;
}) {
  const upstreams = useAdminResource<UpstreamProvidersResponse>(
    "upstreams",
    "/admin/upstream-providers",
  );
  const prices = useAdminResource<ModelPricesResponse>(
    "modelPrices",
    "/admin/model-prices",
  );

  useEffect(() => {
    const firstError = upstreams.error ?? prices.error;
    onError(firstError ? errorToText(firstError) : null);
  }, [onError, prices.error, upstreams.error]);

  const refetchAll = () => {
    void upstreams.refetch();
    void prices.refetch();
  };

  return (
    <UpstreamProviders
      providers={upstreams.data?.providers ?? []}
      modelPrices={prices.data?.modelPrices ?? []}
      unifiedPriceSettings={prices.data?.unifiedPriceSettings ?? []}
      onChanged={refetchAll}
      onError={onError}
    />
  );
}

export function UpstreamProviders({
  providers,
  modelPrices,
  unifiedPriceSettings,
  onChanged,
  onError,
}: {
  providers: UpstreamProvider[];
  modelPrices: ModelPrice[];
  unifiedPriceSettings: UnifiedPriceSetting[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("upstream-1");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);
  const [timeoutSeconds, setTimeoutSeconds] = useState(180);
  const [compactItemType, setCompactItemType] =
    useState<UpstreamProvider["compactItemType"]>("compaction_summary");
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [providerDetailTab, setProviderDetailTab] = useState<
    "overview" | "keys" | "prices" | "tools"
  >("overview");
  const [providerSearch, setProviderSearch] = useState("");
  const [hiddenProviderIds, setHiddenProviderIds] = useState<string[]>([]);
  const [hiddenProvidersOpen, setHiddenProvidersOpen] = useState(false);
  const [priceSearch, setPriceSearch] = useState("");
  const [keyModalProvider, setKeyModalProvider] =
    useState<UpstreamProvider | null>(null);
  const [keyName, setKeyName] = useState("key-1");
  const [keySecret, setKeySecret] = useState("");
  const [keyPriority, setKeyPriority] = useState(100);
  const [keyDailyLimitUsd, setKeyDailyLimitUsd] = useState("");
  const [keyMonthlyLimitUsd, setKeyMonthlyLimitUsd] = useState("");
  const [keyProviderRateLimit, setKeyProviderRateLimit] = useState("");
  const [batchKeyModalProvider, setBatchKeyModalProvider] =
    useState<UpstreamProvider | null>(null);
  const [batchKeyContent, setBatchKeyContent] = useState("");
  const [batchKeyPriority, setBatchKeyPriority] = useState(100);
  const [batchKeyBusy, setBatchKeyBusy] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [selectedProviderKeyIds, setSelectedProviderKeyIds] = useState<
    string[]
  >([]);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceProvider, setPriceProvider] = useState("");
  const [upstreamEndpoint, setUpstreamEndpoint] = useState<
    "responses" | "chat_completions" | "images_generations"
  >("responses");
  const [model, setModel] = useState("gpt-4o-mini");
  const [upstreamInput, setUpstreamInput] = useState("5");
  const [upstreamCachedInput, setUpstreamCachedInput] = useState("0.5");
  const [upstreamOutput, setUpstreamOutput] = useState("30");
  const [upstreamMultiplier, setUpstreamMultiplier] = useState("0.06");
  const [customerInput, setCustomerInput] = useState("5");
  const [customerCachedInput, setCustomerCachedInput] = useState("0.5");
  const [customerOutput, setCustomerOutput] = useState("30");
  const [customerMultiplier, setCustomerMultiplier] = useState("0.12");
  const [perRequestUsd, setPerRequestUsd] = useState("0");
  const [enabled, setEnabled] = useState(true);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [busyPriceId, setBusyPriceId] = useState<string | null>(null);
  const [unifiedPriceModalOpen, setUnifiedPriceModalOpen] = useState(false);
  const [priceImportModalOpen, setPriceImportModalOpen] = useState(false);
  const [priceImportFormat, setPriceImportFormat] = useState<"csv" | "json">(
    "csv",
  );
  const [priceImportContent, setPriceImportContent] = useState("");
  const [priceImportPreview, setPriceImportPreview] =
    useState<ModelPriceImportPreview | null>(null);
  const [priceImportBusy, setPriceImportBusy] = useState(false);
  const [unifiedPriceDrafts, setUnifiedPriceDrafts] = useState<
    Record<string, UnifiedPriceDraft>
  >({});
  const [unifiedPriceSelections, setUnifiedPriceSelections] = useState<
    Record<string, boolean>
  >({});
  const [unifiedPriceSaving, setUnifiedPriceSaving] = useState(false);
  const unifiedPriceGroups = buildUnifiedPriceGroups(
    modelPrices,
    providers,
    unifiedPriceSettings,
  );
  const visibleProviders = useMemo(
    () =>
      providers.filter((provider) => !hiddenProviderIds.includes(provider.id)),
    [hiddenProviderIds, providers],
  );
  const hiddenProviders = useMemo(
    () =>
      providers.filter((provider) => hiddenProviderIds.includes(provider.id)),
    [hiddenProviderIds, providers],
  );
  const selectedProvider =
    visibleProviders.find((provider) => provider.id === selectedProviderId) ??
    visibleProviders[0] ??
    null;
  const selectedProviderKeys = selectedProvider?.keys ?? [];
  const selectedProviderKeysForDeletion = selectedProviderKeys.filter((key) =>
    selectedProviderKeyIds.includes(key.id),
  );
  const allProviderKeysSelected =
    selectedProviderKeys.length > 0 &&
    selectedProviderKeysForDeletion.length === selectedProviderKeys.length;
  const selectedUnifiedPriceCount = unifiedPriceGroups.filter(
    (group) => unifiedPriceSelections[group.model],
  ).length;
  const upstreamEffective = {
    input: multiplied(upstreamInput, upstreamMultiplier),
    cached: multiplied(upstreamCachedInput, upstreamMultiplier),
    output: multiplied(upstreamOutput, upstreamMultiplier),
  };
  const customerEffective = {
    input: multiplied(customerInput, customerMultiplier),
    cached: multiplied(customerCachedInput, customerMultiplier),
    output: multiplied(customerOutput, customerMultiplier),
  };

  useEffect(() => {
    if (visibleProviders.length === 0) {
      setSelectedProviderId(null);
      return;
    }

    if (
      !selectedProviderId ||
      !visibleProviders.some((item) => item.id === selectedProviderId)
    ) {
      setSelectedProviderId(visibleProviders[0]?.id ?? null);
    }
  }, [selectedProviderId, visibleProviders]);

  useEffect(() => {
    setSelectedProviderKeyIds([]);
  }, [selectedProvider?.id]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(
        "admin:hidden-upstream-providers",
      );
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setHiddenProviderIds(
          parsed.filter((item): item is string => typeof item === "string"),
        );
      }
    } catch {
      // Local view preference only.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "admin:hidden-upstream-providers",
        JSON.stringify(hiddenProviderIds),
      );
    } catch {
      // Local view preference only.
    }
  }, [hiddenProviderIds]);

  async function saveModelPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (!priceProvider) {
      onError("请选择上游渠道。");
      return;
    }

    try {
      await apiFetch(
        editingPriceId
          ? `/admin/model-prices/${editingPriceId}`
          : "/admin/model-prices",
        {
          method: editingPriceId ? "PUT" : "POST",
          body: JSON.stringify({
            model,
            upstreamProvider: priceProvider,
            upstreamEndpoint,
            pricingMode: "token",
            upstreamInputPer1MTok: upstreamInput,
            upstreamCachedInputPer1MTok: upstreamCachedInput,
            upstreamOutputPer1MTok: upstreamOutput,
            upstreamPriceMultiplier: upstreamMultiplier,
            upstreamPerRequestUsd: "0",
            customerInputPer1MTok: customerInput,
            customerCachedInputPer1MTok: customerCachedInput,
            customerOutputPer1MTok: customerOutput,
            customerPriceMultiplier: customerMultiplier,
            minimumChargeUsd: "0",
            perRequestUsd,
            enabled,
          }),
        },
      );
      setEditingPriceId(null);
      setPriceModalOpen(false);
      onChanged();
    } catch (saveError) {
      onError(errorToText(saveError));
    }
  }

  function editPrice(price: ModelPrice) {
    setEditingPriceId(price.id);
    setPriceProvider(price.upstreamProvider);
    setUpstreamEndpoint(price.upstreamEndpoint ?? "responses");
    setModel(price.model);
    setUpstreamInput(price.upstreamInputPer1MTok);
    setUpstreamCachedInput(price.upstreamCachedInputPer1MTok);
    setUpstreamOutput(price.upstreamOutputPer1MTok);
    setUpstreamMultiplier(price.upstreamPriceMultiplier);
    setCustomerInput(price.customerInputPer1MTok);
    setCustomerCachedInput(price.customerCachedInputPer1MTok);
    setCustomerOutput(price.customerOutputPer1MTok);
    setCustomerMultiplier(price.customerPriceMultiplier);
    setPerRequestUsd(price.perRequestUsd ?? "0");
    setEnabled(price.enabled);
    setPriceModalOpen(true);
  }

  function openCreatePrice(providerName: string) {
    setEditingPriceId(null);
    setPriceProvider(providerName);
    setUpstreamEndpoint("responses");
    setModel("gpt-4o-mini");
    setUpstreamInput("5");
    setUpstreamCachedInput("0.5");
    setUpstreamOutput("30");
    setUpstreamMultiplier("0.06");
    setCustomerInput("5");
    setCustomerCachedInput("0.5");
    setCustomerOutput("30");
    setCustomerMultiplier("0.12");
    setPerRequestUsd("0");
    setEnabled(true);
    setPriceModalOpen(true);
  }

  async function togglePrice(price: ModelPrice) {
    onError(null);
    setBusyPriceId(price.id);
    try {
      await apiFetch(`/admin/model-prices/${price.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !price.enabled }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyPriceId(null);
    }
  }

  async function deletePrice(price: ModelPrice) {
    const confirmed = await confirmAdminAction({
      title: "删除模型价格",
      description: `确定删除模型价格「${price.upstreamProvider} / ${price.model}」吗？`,
      confirmText: "删除价格",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyPriceId(price.id);

    try {
      await apiFetch(`/admin/model-prices/${price.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyPriceId(null);
    }
  }

  async function exportModelPrices(format: "json" | "csv") {
    onError(null);
    try {
      await adminDownload(
        `/admin/model-prices/export?format=${format}`,
        `model-prices-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
    } catch (exportError) {
      onError(errorToText(exportError));
    }
  }

  async function previewModelPriceImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    setPriceImportBusy(true);
    try {
      const result = await apiFetch<ModelPriceImportPreview>(
        "/admin/model-prices/import",
        {
          method: "POST",
          body: JSON.stringify({
            format: priceImportFormat,
            content: priceImportContent,
            dryRun: true,
          }),
        },
      );
      setPriceImportPreview(result);
    } catch (importError) {
      onError(errorToText(importError));
    } finally {
      setPriceImportBusy(false);
    }
  }

  async function applyModelPriceImport() {
    onError(null);
    setPriceImportBusy(true);
    try {
      await apiFetch("/admin/model-prices/import", {
        method: "POST",
        body: JSON.stringify({
          format: priceImportFormat,
          content: priceImportContent,
          dryRun: false,
        }),
      });
      setPriceImportModalOpen(false);
      setPriceImportPreview(null);
      setPriceImportContent("");
      onChanged();
    } catch (importError) {
      onError(errorToText(importError));
    } finally {
      setPriceImportBusy(false);
    }
  }

  function openPriceImportModal() {
    setPriceImportContent(modelPriceImportExampleCsv);
    setPriceImportFormat("csv");
    setPriceImportPreview(null);
    setPriceImportModalOpen(true);
  }

  function openUnifiedPriceModal() {
    const nextDrafts = Object.fromEntries(
      unifiedPriceGroups.map((group) => [
        group.model,
        group.setting
          ? unifiedPriceDraftFromSetting(group.setting)
          : unifiedPriceDraftFromPrice(group.prices[0]),
      ]),
    );
    const nextSelections = Object.fromEntries(
      unifiedPriceGroups.map((group) => [
        group.model,
        group.setting?.enabled ?? false,
      ]),
    );
    setUnifiedPriceDrafts(nextDrafts);
    setUnifiedPriceSelections(nextSelections);
    setUnifiedPriceModalOpen(true);
  }

  function setUnifiedPriceSelected(modelId: string, selected: boolean) {
    setUnifiedPriceSelections((current) => ({
      ...current,
      [modelId]: selected,
    }));
  }

  function updateUnifiedPriceDraft(
    modelId: string,
    field: keyof UnifiedPriceDraft,
    value: string,
  ) {
    setUnifiedPriceDrafts((current) => {
      const group = unifiedPriceGroups.find((item) => item.model === modelId);
      const currentDraft =
        current[modelId] ??
        (group ? unifiedPriceDraftFromPrice(group.prices[0]) : undefined);

      if (!currentDraft) {
        return current;
      }

      return {
        ...current,
        [modelId]: {
          ...currentDraft,
          [field]: value,
        },
      };
    });
  }

  async function saveUnifiedPrices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    const updates = unifiedPriceGroups.map((group) => ({
      model: group.model,
      enabled: unifiedPriceSelections[group.model] ?? false,
      ...(unifiedPriceDrafts[group.model] ??
        (group.setting
          ? unifiedPriceDraftFromSetting(group.setting)
          : unifiedPriceDraftFromPrice(group.prices[0]))),
    }));

    if (updates.length === 0) {
      onError("暂无可配置统一售价模式的模型。");
      return;
    }

    const invalidUpdate = updates.find(
      (update) =>
        update.enabled &&
        [
          update.customerInputPer1MTok,
          update.customerCachedInputPer1MTok,
          update.customerOutputPer1MTok,
          update.customerPriceMultiplier,
        ].some((value) => !isNonNegativeNumberText(value)),
    );

    if (invalidUpdate) {
      onError(
        `模型「${invalidUpdate.model}」的站点定价必须是大于等于 0 的数字。`,
      );
      return;
    }

    setUnifiedPriceSaving(true);
    try {
      await apiFetch("/admin/model-prices/unified", {
        method: "PUT",
        body: JSON.stringify({ updates }),
      });
      setUnifiedPriceModalOpen(false);
      onChanged();
    } catch (saveError) {
      onError(errorToText(saveError));
    } finally {
      setUnifiedPriceSaving(false);
    }
  }

  async function saveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (!editingId && !apiKey.trim()) {
      onError("添加上游时必须填写上游 API Key。");
      return;
    }

    const body = {
      name,
      baseUrl,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      priority: Number(priority),
      timeoutMs: Math.round(Number(timeoutSeconds) * 1000),
      compactItemType,
      status: "ACTIVE",
    };

    try {
      await apiFetch(
        editingId
          ? `/admin/upstream-providers/${editingId}`
          : "/admin/upstream-providers",
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
      clearForm();
      setProviderModalOpen(false);
      onChanged();
    } catch (saveError) {
      onError(errorToText(saveError));
    }
  }

  function editProvider(provider: UpstreamProvider) {
    setEditingId(provider.id);
    setName(provider.name);
    setBaseUrl(provider.baseUrl);
    setApiKey("");
    setPriority(provider.priority);
    setTimeoutSeconds(provider.timeoutMs / 1000);
    setCompactItemType(provider.compactItemType ?? "compaction_summary");
    setProviderModalOpen(true);
  }

  function clearForm() {
    setEditingId(null);
    setName("upstream-1");
    setBaseUrl("https://api.openai.com");
    setApiKey("");
    setPriority(100);
    setTimeoutSeconds(180);
    setCompactItemType("compaction_summary");
  }

  function openCreateProvider() {
    clearForm();
    setProviderModalOpen(true);
  }

  async function setProviderStatus(
    provider: UpstreamProvider,
    status: UpstreamProvider["status"],
  ) {
    onError(null);
    setBusyProviderId(provider.id);

    try {
      await apiFetch(`/admin/upstream-providers/${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyProviderId(null);
    }
  }

  async function deleteProvider(provider: UpstreamProvider) {
    const confirmed = await confirmAdminAction({
      title: "删除上游",
      description: `确定删除上游「${provider.name}」吗？`,
      confirmText: "删除上游",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyProviderId(provider.id);

    try {
      await apiFetch(`/admin/upstream-providers/${provider.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyProviderId(null);
    }
  }

  function openCreateProviderKey(provider: UpstreamProvider) {
    setKeyModalProvider(provider);
    setKeyName(`key-${(provider.keys?.length ?? 0) + 1}`);
    setKeySecret("");
    setKeyPriority(100);
    setKeyDailyLimitUsd("");
    setKeyMonthlyLimitUsd("");
    setKeyProviderRateLimit("");
  }

  function openBatchCreateProviderKeys(provider: UpstreamProvider) {
    setBatchKeyModalProvider(provider);
    setBatchKeyContent("");
    setBatchKeyPriority(100);
  }

  async function createProviderKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!keyModalProvider) {
      return;
    }

    onError(null);
    try {
      await apiFetch(`/admin/upstream-providers/${keyModalProvider.id}/keys`, {
        method: "POST",
        body: JSON.stringify({
          name: keyName,
          key: keySecret,
          priority: Number(keyPriority),
          status: "ACTIVE",
          dailyLimitUsd: normalizeOptionalNumberText(keyDailyLimitUsd),
          monthlyLimitUsd: normalizeOptionalNumberText(keyMonthlyLimitUsd),
          providerRateLimit: keyProviderRateLimit
            ? Number(keyProviderRateLimit)
            : null,
        }),
      });
      setKeyModalProvider(null);
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function createProviderKeysBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batchKeyModalProvider || batchKeyBusy) {
      return;
    }

    onError(null);
    setBatchKeyBusy(true);
    try {
      const rows = parseBatchProviderKeys(batchKeyContent);
      if (rows.length === 0) {
        throw new Error("请至少输入一行 Key。");
      }

      for (const row of rows) {
        await apiFetch(
          `/admin/upstream-providers/${batchKeyModalProvider.id}/keys`,
          {
            method: "POST",
            body: JSON.stringify({
              name: row.name,
              key: row.key,
              priority: Number(batchKeyPriority),
              status: "ACTIVE",
              dailyLimitUsd: null,
              monthlyLimitUsd: null,
              providerRateLimit: null,
            }),
          },
        );
      }

      setBatchKeyModalProvider(null);
      setBatchKeyContent("");
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    } finally {
      setBatchKeyBusy(false);
    }
  }

  async function setProviderKeyStatus(
    key: UpstreamProviderKey,
    status: "ACTIVE" | "DISABLED",
  ) {
    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/admin/upstream-provider-keys/${key.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyKeyId(null);
    }
  }

  async function deleteProviderKey(key: UpstreamProviderKey) {
    const confirmed = await confirmAdminAction({
      title: "删除上游 Key",
      description: `确定删除上游 Key「${displayUpstreamProviderKeyName(key.name)}」吗？`,
      confirmText: "删除 Key",
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/admin/upstream-provider-keys/${key.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyKeyId(null);
    }
  }

  async function deleteSelectedProviderKeys() {
    if (selectedProviderKeysForDeletion.length === 0) {
      return;
    }

    const confirmed = await confirmAdminAction({
      title: "批量删除上游 Key",
      description: `确定删除选中的 ${selectedProviderKeysForDeletion.length} 个上游 Key 吗？删除后这些 Key 不再参与调度。`,
      confirmText: "删除 Key",
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyKeyId("__batch_delete__");
    try {
      await apiFetch("/admin/upstream-provider-keys", {
        method: "DELETE",
        body: JSON.stringify({
          ids: selectedProviderKeysForDeletion.map((key) => key.id),
        }),
      });
      setSelectedProviderKeyIds([]);
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyKeyId(null);
    }
  }

  function pricesForProvider(providerName: string) {
    return modelPrices.filter(
      (price) => price.upstreamProvider === providerName,
    );
  }

  function unifiedSettingForModel(modelId: string) {
    return unifiedPriceSettings.find((setting) => setting.model === modelId);
  }

  function effectiveCustomerDraft(price: ModelPrice) {
    const setting = unifiedSettingForModel(price.model);
    return setting?.enabled
      ? unifiedPriceDraftFromSetting(setting)
      : unifiedPriceDraftFromPrice(price);
  }

  function renderCustomerPrice(price: ModelPrice) {
    const setting = unifiedSettingForModel(price.model);
    const draft = effectiveCustomerDraft(price);

    return (
      <div className="price-cell-stack">
        {setting?.enabled ? <span className="pill ok">统一模式</span> : null}
        <span>
          x{draft.customerPriceMultiplier}:{" "}
          {priceTriplet(
            multiplied(
              draft.customerInputPer1MTok,
              draft.customerPriceMultiplier,
            ),
            multiplied(
              draft.customerCachedInputPer1MTok,
              draft.customerPriceMultiplier,
            ),
            multiplied(
              draft.customerOutputPer1MTok,
              draft.customerPriceMultiplier,
            ),
          )}
        </span>
        {setting?.enabled ? (
          <span className="muted-cell">
            普通价 x{price.customerPriceMultiplier}:{" "}
            {priceTriplet(
              multiplied(
                price.customerInputPer1MTok,
                price.customerPriceMultiplier,
              ),
              multiplied(
                price.customerCachedInputPer1MTok,
                price.customerPriceMultiplier,
              ),
              multiplied(
                price.customerOutputPer1MTok,
                price.customerPriceMultiplier,
              ),
            )}
          </span>
        ) : null}
      </div>
    );
  }

  function marginRiskForPrice(price: ModelPrice): ModelPriceMarginRisk {
    const draft = effectiveCustomerDraft(price);
    return calculateModelPriceMarginRisk(price, draft);
  }

  function renderMarginRisk(price: ModelPrice) {
    const risk = marginRiskForPrice(price);
    const className =
      risk.level === "loss"
        ? "pill danger"
        : risk.level === "low"
          ? "pill warn"
          : risk.level === "ok"
            ? "pill ok"
            : "pill";

    return (
      <div className="price-cell-stack">
        <span className={className}>{risk.label}</span>
        <span className="muted-cell">{risk.detail}</span>
      </div>
    );
  }

  function hideProvider(provider: UpstreamProvider) {
    setHiddenProviderIds((current) =>
      current.includes(provider.id) ? current : [...current, provider.id],
    );
  }

  function showProvider(provider: UpstreamProvider) {
    setHiddenProviderIds((current) =>
      current.filter((providerId) => providerId !== provider.id),
    );
    setSelectedProviderId(provider.id);
  }

  const selectedProviderPrices = selectedProvider
    ? pricesForProvider(selectedProvider.name)
    : [];
  const filteredProviders = visibleProviders.filter((provider) => {
    const keyword = providerSearch.trim().toLowerCase();
    if (!keyword) {
      return true;
    }
    return (
      provider.name.toLowerCase().includes(keyword) ||
      provider.baseUrl.toLowerCase().includes(keyword) ||
      provider.status.toLowerCase().includes(keyword)
    );
  });
  const filteredHiddenProviders = hiddenProviders.filter((provider) => {
    const keyword = providerSearch.trim().toLowerCase();
    if (!keyword) {
      return true;
    }
    return (
      provider.name.toLowerCase().includes(keyword) ||
      provider.baseUrl.toLowerCase().includes(keyword) ||
      provider.status.toLowerCase().includes(keyword)
    );
  });
  const filteredSelectedProviderPrices = selectedProviderPrices.filter(
    (price) => {
      const keyword = priceSearch.trim().toLowerCase();
      if (!keyword) {
        return true;
      }
      return (
        price.model.toLowerCase().includes(keyword) ||
        price.priceVersion.toLowerCase().includes(keyword) ||
        price.upstreamProvider.toLowerCase().includes(keyword)
      );
    },
  );
  const selectedProviderKeyRows = (selectedProvider?.keys ?? []).map((key) => ({
    id: key.id,
    select: (
      <input
        aria-label={`选择 ${displayUpstreamProviderKeyName(key.name)}`}
        checked={selectedProviderKeyIds.includes(key.id)}
        disabled={busyKeyId === "__batch_delete__"}
        onChange={() =>
          setSelectedProviderKeyIds((current) =>
            current.includes(key.id)
              ? current.filter((id) => id !== key.id)
              : [...current, key.id],
          )
        }
        type="checkbox"
      />
    ),
    name: displayUpstreamProviderKeyName(key.name),
    prefix: <code>{key.keyPrefix || key.key}</code>,
    status: <StatusPill status={key.status} />,
    priority: key.priority,
    quota: (
      <>
        <strong>
          日 ${money(key.dailyLimitUsd)} / 月 {money(key.monthlyLimitUsd)}
        </strong>
        <span className="muted">
          {key.providerRateLimit ? `${key.providerRateLimit}/min` : "不限速"}
        </span>
      </>
    ),
    checkedAt: key.lastCheckedAt
      ? `${dateTime(key.lastCheckedAt)} · ${key.lastCheckStatus ?? "-"}`
      : "-",
    usedAt: key.lastUsedAt ? dateTime(key.lastUsedAt) : "-",
    error: key.lastError ?? "-",
    actions: (
      <div className="button-row compact">
        {key.status === "ACTIVE" ? (
          <button
            className="button secondary"
            disabled={busyKeyId === key.id}
            onClick={() => setProviderKeyStatus(key, "DISABLED")}
            type="button"
          >
            停用
          </button>
        ) : (
          <button
            className="button"
            disabled={busyKeyId === key.id}
            onClick={() => setProviderKeyStatus(key, "ACTIVE")}
            type="button"
          >
            启用
          </button>
        )}
        <button
          className="button danger"
          disabled={busyKeyId === key.id}
          onClick={() => deleteProviderKey(key)}
          type="button"
        >
          <Trash2 size={15} />
          删除
        </button>
      </div>
    ),
  }));
  const selectedProviderPriceRows = filteredSelectedProviderPrices.map(
    (price) => ({
      id: price.id,
      model: price.model,
      status: <StatusPill status={price.enabled ? "ACTIVE" : "DISABLED"} />,
      upstreamRaw: priceTriplet(
        price.upstreamInputPer1MTok,
        price.upstreamCachedInputPer1MTok,
        price.upstreamOutputPer1MTok,
      ),
      upstreamEffective: (
        <>
          x{price.upstreamPriceMultiplier}:{" "}
          {priceTriplet(
            multiplied(
              price.upstreamInputPer1MTok,
              price.upstreamPriceMultiplier,
            ),
            multiplied(
              price.upstreamCachedInputPer1MTok,
              price.upstreamPriceMultiplier,
            ),
            multiplied(
              price.upstreamOutputPer1MTok,
              price.upstreamPriceMultiplier,
            ),
          )}
        </>
      ),
      customerPrice: renderCustomerPrice(price),
      marginRisk: renderMarginRisk(price),
      version: (
        <>
          {price.priceVersion || "v1"}
          <br />
          <span className="muted-cell">
            {endpointLabel(price.upstreamEndpoint)}
          </span>
          <br />
          <span className="muted-cell">{formatPriceValidity(price)}</span>
        </>
      ),
      actions: (
        <div className="button-row compact">
          <button
            className="button secondary"
            onClick={() => editPrice(price)}
            type="button"
          >
            编辑
          </button>
          <button
            className="button secondary"
            onClick={() => togglePrice(price)}
            type="button"
          >
            {price.enabled ? "停用" : "启用"}
          </button>
          <button
            className="button danger"
            disabled={busyPriceId === price.id}
            onClick={() => deletePrice(price)}
            type="button"
          >
            <Trash2 size={15} />
            删除
          </button>
        </div>
      ),
    }),
  );
  const priceImportPreviewRows =
    priceImportPreview?.rows.slice(0, 20).map((row) => ({
      id: `${row.data.upstreamProvider}:${row.data.model}`,
      action: row.action === "create" ? "新增" : "更新",
      upstreamProvider: row.data.upstreamProvider,
      model: row.data.model,
      customerPrice: `$${money(row.data.customerInputPer1MTok)} / $${money(
        row.data.customerOutputPer1MTok,
      )}`,
      priceVersion: row.data.priceVersion,
    })) ?? [];
  const activeProviderCount = providers.filter(
    (provider) => provider.status === "ACTIVE",
  ).length;
  const totalProviderKeyCount = providers.reduce(
    (total, provider) => total + (provider.keys?.length ?? 0),
    0,
  );
  const enabledPriceCount = modelPrices.filter((price) => price.enabled).length;

  return (
    <>
      <div className="admin-page admin-gateway-page">
        <WorkbenchLayout
          className="upstream-console-workbench"
          sidebar={
            <>
              <div className="console-side-head">
                <div>
                  <h2 className="section-title">上游渠道</h2>
                  <p className="section-subtitle">
                    {activeProviderCount}/{providers.length} 启用 ·{" "}
                    {totalProviderKeyCount} Key · {enabledPriceCount} 价格
                  </p>
                </div>
                <input
                  className="input search-input"
                  placeholder="搜索渠道 / URL"
                  value={providerSearch}
                  onChange={(event) => setProviderSearch(event.target.value)}
                />
              </div>
              <div className="console-nav-list">
                {filteredProviders.map((provider) => {
                  const activeKeys =
                    provider.keys?.filter((key) => key.status === "ACTIVE")
                      .length ?? 0;
                  const providerPrices = pricesForProvider(provider.name);
                  return (
                    <ConsoleNavButton
                      key={provider.id}
                      active={selectedProvider?.id === provider.id}
                      title={provider.name}
                      description={`${provider.baseUrl} · Key ${activeKeys}/${provider.keys?.length ?? 0} · 价格 ${providerPrices.filter((price) => price.enabled).length}/${providerPrices.length}`}
                      meta={<StatusPill status={provider.status} />}
                      onClick={() => setSelectedProviderId(provider.id)}
                    />
                  );
                })}
                {filteredProviders.length === 0 ? (
                  <div className="empty-state compact">暂无匹配渠道</div>
                ) : null}
              </div>
            </>
          }
          toolbar={
            <>
              <div>
                <h2 className="section-title">上游渠道工作台</h2>
                <p className="section-subtitle">
                  选中渠道后，在右侧处理概览、Key、模型价格和导入导出。
                  {hiddenProviders.length > 0
                    ? ` 已隐藏 ${hiddenProviders.length} 个上游。`
                    : ""}
                </p>
              </div>
              <div className="button-row admin-toolbar-actions">
                <button
                  className="button secondary"
                  onClick={() => setHiddenProvidersOpen(true)}
                  type="button"
                >
                  <Eye size={17} />
                  隐藏区
                  {hiddenProviders.length > 0
                    ? ` (${hiddenProviders.length})`
                    : ""}
                </button>
                <button
                  className="button"
                  onClick={openCreateProvider}
                  type="button"
                >
                  <Plus size={17} />
                  添加上游
                </button>
                <button
                  className="button secondary"
                  onClick={openPriceImportModal}
                  type="button"
                >
                  <FileSearch size={17} />
                  导入价格
                </button>
                <button
                  className="button secondary"
                  disabled={unifiedPriceGroups.length === 0}
                  onClick={openUnifiedPriceModal}
                  type="button"
                >
                  <SlidersHorizontal size={17} />
                  统一定价
                </button>
              </div>
            </>
          }
        >
          {selectedProvider ? (
            <div className="provider-stack stack-top">
              {(selectedProvider ? [selectedProvider] : []).map((provider) => {
                const providerPrices = pricesForProvider(provider.name);

                return (
                  <section
                    className="provider-panel provider-detail-panel"
                    key={provider.id}
                  >
                    <div className="provider-head">
                      <div>
                        <div className="provider-title">
                          <strong>{provider.name}</strong>
                          <StatusPill status={provider.status} />
                          <span className="pill">
                            Key{" "}
                            {provider.keys?.filter(
                              (key) => key.status === "ACTIVE",
                            ).length ?? 0}
                            /{provider.keys?.length ?? 0}
                          </span>
                        </div>
                        <p>
                          优先级 {provider.priority} · 超时{" "}
                          {seconds(provider.timeoutMs)} · Compact{" "}
                          {displayCompactItemType(provider.compactItemType)} ·{" "}
                          {provider.baseUrl}
                        </p>
                      </div>
                      <div className="button-row">
                        <button
                          className="button secondary"
                          onClick={() => hideProvider(provider)}
                          type="button"
                        >
                          <EyeOff size={15} />
                          隐藏
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => editProvider(provider)}
                          type="button"
                        >
                          编辑渠道
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => openBatchCreateProviderKeys(provider)}
                          type="button"
                        >
                          <Plus size={15} />
                          批量添加
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => openCreateProviderKey(provider)}
                          type="button"
                        >
                          <Plus size={15} />
                          新增 Key
                        </button>
                        {provider.status === "ACTIVE" ? (
                          <button
                            className="button secondary"
                            disabled={busyProviderId === provider.id}
                            onClick={() =>
                              setProviderStatus(provider, "DISABLED")
                            }
                            type="button"
                          >
                            停用
                          </button>
                        ) : (
                          <button
                            className="button"
                            disabled={busyProviderId === provider.id}
                            onClick={() =>
                              setProviderStatus(provider, "ACTIVE")
                            }
                            type="button"
                          >
                            启用
                          </button>
                        )}
                        <button
                          className="button danger"
                          disabled={busyProviderId === provider.id}
                          onClick={() => deleteProvider(provider)}
                          type="button"
                        >
                          <Trash2 size={15} />
                          删除
                        </button>
                      </div>
                    </div>

                    <div className="segmented-tabs">
                      {[
                        ["overview", "概览"],
                        ["keys", "Key"],
                        ["prices", "模型价格"],
                        ["tools", "导入/导出"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          className={providerDetailTab === id ? "active" : ""}
                          onClick={() =>
                            setProviderDetailTab(id as typeof providerDetailTab)
                          }
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {providerDetailTab === "overview" ? (
                      <div className="grid cols-3 metric-row">
                        <Metric
                          label="Key"
                          value={`${provider.keys?.filter((key) => key.status === "ACTIVE").length ?? 0}/${provider.keys?.length ?? 0}`}
                        />
                        <Metric
                          label="模型价格"
                          value={`${providerPrices.filter((price) => price.enabled).length}/${providerPrices.length}`}
                        />
                        <Metric
                          label="超时"
                          value={seconds(provider.timeoutMs)}
                        />
                      </div>
                    ) : null}

                    {providerDetailTab === "keys" ? (
                      <>
                        <div className="section-head compact-head">
                          <div>
                            <h3 className="section-title">Key 池</h3>
                            <p className="section-subtitle">
                              调度会在 ACTIVE Key 中按进行中请求数均摊。
                            </p>
                          </div>
                          <div className="button-row compact">
                            <label className="checkbox-line">
                              <input
                                checked={allProviderKeysSelected}
                                disabled={
                                  selectedProviderKeys.length === 0 ||
                                  busyKeyId === "__batch_delete__"
                                }
                                onChange={(event) =>
                                  setSelectedProviderKeyIds(
                                    event.target.checked
                                      ? selectedProviderKeys.map(
                                          (key) => key.id,
                                        )
                                      : [],
                                  )
                                }
                                type="checkbox"
                              />
                              已选 {selectedProviderKeysForDeletion.length}/
                              {selectedProviderKeys.length}
                            </label>
                            <button
                              className="button danger"
                              disabled={
                                selectedProviderKeysForDeletion.length === 0 ||
                                busyKeyId === "__batch_delete__"
                              }
                              onClick={deleteSelectedProviderKeys}
                              type="button"
                            >
                              <Trash2 size={15} />
                              批量删除
                            </button>
                          </div>
                        </div>
                        <AdminDataTable
                          columns={[
                            { accessorKey: "select", header: "" },
                            { accessorKey: "name", header: "名称" },
                            { accessorKey: "prefix", header: "前缀" },
                            { accessorKey: "status", header: "状态" },
                            { accessorKey: "priority", header: "优先级" },
                            { accessorKey: "quota", header: "额度/限流" },
                            { accessorKey: "checkedAt", header: "最近检测" },
                            { accessorKey: "usedAt", header: "最近使用" },
                            { accessorKey: "error", header: "错误" },
                            { accessorKey: "actions", header: "操作" },
                          ]}
                          data={selectedProviderKeyRows}
                          empty="暂无 Key"
                        />
                      </>
                    ) : null}
                    <div className="mobile-record-list">
                      {(provider.keys ?? []).map((key) => (
                        <MobileRecord
                          key={key.id}
                          title={displayUpstreamProviderKeyName(key.name)}
                          meta={key.keyPrefix || key.key}
                          badges={<StatusPill status={key.status} />}
                          actions={
                            <>
                              {key.status === "ACTIVE" ? (
                                <button
                                  className="button secondary"
                                  disabled={busyKeyId === key.id}
                                  onClick={() =>
                                    setProviderKeyStatus(key, "DISABLED")
                                  }
                                  type="button"
                                >
                                  停用
                                </button>
                              ) : (
                                <button
                                  className="button"
                                  disabled={busyKeyId === key.id}
                                  onClick={() =>
                                    setProviderKeyStatus(key, "ACTIVE")
                                  }
                                  type="button"
                                >
                                  启用
                                </button>
                              )}
                              <button
                                className="button danger"
                                disabled={busyKeyId === key.id}
                                onClick={() => deleteProviderKey(key)}
                                type="button"
                              >
                                删除
                              </button>
                            </>
                          }
                        >
                          <MobileField label="优先级">
                            {key.priority}
                          </MobileField>
                          <MobileField label="额度/限流" wide>
                            日 ${money(key.dailyLimitUsd)} / 月 $
                            {money(key.monthlyLimitUsd)} ·{" "}
                            {key.providerRateLimit
                              ? `${key.providerRateLimit}/min`
                              : "不限速"}
                          </MobileField>
                          <MobileField label="错误分类">
                            {key.lastErrorCategory ?? "-"}
                          </MobileField>
                          <MobileField label="最近检测" wide>
                            {key.lastCheckedAt
                              ? `${dateTime(key.lastCheckedAt)} · ${key.lastCheckStatus ?? "-"}`
                              : "-"}
                          </MobileField>
                          <MobileField label="最近使用">
                            {key.lastUsedAt ? dateTime(key.lastUsedAt) : "-"}
                          </MobileField>
                          <MobileField label="错误" wide>
                            {key.lastError ?? "-"}
                          </MobileField>
                        </MobileRecord>
                      ))}
                      {(provider.keys ?? []).length === 0 ? (
                        <MobileEmpty>暂无 Key</MobileEmpty>
                      ) : null}
                    </div>

                    {providerDetailTab === "prices" ? (
                      <>
                        <div className="section-head compact-head">
                          <div>
                            <h3 className="section-title">模型价格</h3>
                            <p className="section-subtitle">
                              输入 / 缓存输入 / 输出分别计价，再乘以倍率。
                            </p>
                          </div>
                          <input
                            className="input search-input"
                            placeholder="搜索模型 / 版本"
                            value={priceSearch}
                            onChange={(event) =>
                              setPriceSearch(event.target.value)
                            }
                          />
                          <button
                            className="button secondary"
                            onClick={() => openCreatePrice(provider.name)}
                            type="button"
                          >
                            <Plus size={17} />
                            新增价格
                          </button>
                        </div>

                        <AdminDataTable
                          columns={[
                            { accessorKey: "model", header: "模型" },
                            { accessorKey: "status", header: "状态" },
                            {
                              accessorKey: "upstreamRaw",
                              header: "上游原价 输入/缓存/输出",
                            },
                            {
                              accessorKey: "upstreamEffective",
                              header: "上游实价",
                            },
                            {
                              accessorKey: "customerPrice",
                              header: "站点售价",
                            },
                            { accessorKey: "marginRisk", header: "毛利风险" },
                            { accessorKey: "version", header: "版本/有效期" },
                            { accessorKey: "actions", header: "操作" },
                          ]}
                          data={selectedProviderPriceRows}
                          empty="暂无模型价格"
                        />
                      </>
                    ) : null}
                    <div className="mobile-record-list">
                      {providerPrices.map((price) => (
                        <MobileRecord
                          key={price.id}
                          title={price.model}
                          meta={`上游渠道：${price.upstreamProvider}`}
                          badges={
                            <StatusPill
                              status={price.enabled ? "ACTIVE" : "DISABLED"}
                            />
                          }
                          actions={
                            <>
                              <button
                                className="button secondary"
                                onClick={() => editPrice(price)}
                                type="button"
                              >
                                编辑
                              </button>
                              <button
                                className="button secondary"
                                onClick={() => togglePrice(price)}
                                type="button"
                              >
                                {price.enabled ? "停用" : "启用"}
                              </button>
                              <button
                                className="button danger"
                                disabled={busyPriceId === price.id}
                                onClick={() => deletePrice(price)}
                                type="button"
                              >
                                删除
                              </button>
                            </>
                          }
                        >
                          <MobileField label="上游原价" wide>
                            {priceTriplet(
                              price.upstreamInputPer1MTok,
                              price.upstreamCachedInputPer1MTok,
                              price.upstreamOutputPer1MTok,
                            )}
                          </MobileField>
                          <MobileField label="上游实价" wide>
                            x{price.upstreamPriceMultiplier}:{" "}
                            {priceTriplet(
                              multiplied(
                                price.upstreamInputPer1MTok,
                                price.upstreamPriceMultiplier,
                              ),
                              multiplied(
                                price.upstreamCachedInputPer1MTok,
                                price.upstreamPriceMultiplier,
                              ),
                              multiplied(
                                price.upstreamOutputPer1MTok,
                                price.upstreamPriceMultiplier,
                              ),
                            )}
                          </MobileField>
                          <MobileField label="站点售价" wide>
                            {renderCustomerPrice(price)}
                          </MobileField>
                          <MobileField label="毛利风险" wide>
                            {renderMarginRisk(price)}
                          </MobileField>
                          <MobileField label="版本/有效期" wide>
                            {price.priceVersion || "v1"} ·{" "}
                            {endpointLabel(price.upstreamEndpoint)} ·{" "}
                            {formatPriceValidity(price)}
                          </MobileField>
                        </MobileRecord>
                      ))}
                      {providerPrices.length === 0 ? (
                        <MobileEmpty>暂无模型价格</MobileEmpty>
                      ) : null}
                    </div>

                    {providerDetailTab === "tools" ? (
                      <div className="admin-settings-stack">
                        <section className="admin-action-card">
                          <div>
                            <strong>导入价格</strong>
                            <small>批量创建或更新模型价格。</small>
                          </div>
                          <button
                            className="button secondary"
                            onClick={openPriceImportModal}
                            type="button"
                          >
                            <FileSearch size={16} />
                            导入
                          </button>
                        </section>
                        <section className="admin-action-card">
                          <div>
                            <strong>导出价格</strong>
                            <small>导出当前全站模型价格配置。</small>
                          </div>
                          <div className="button-row">
                            <button
                              className="button secondary"
                              onClick={() => exportModelPrices("json")}
                              type="button"
                            >
                              JSON
                            </button>
                            <button
                              className="button secondary"
                              onClick={() => exportModelPrices("csv")}
                              type="button"
                            >
                              CSV
                            </button>
                          </div>
                        </section>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="empty-cell">暂无上游渠道</div>
          )}
        </WorkbenchLayout>
      </div>

      {hiddenProvidersOpen ? (
        <ModalShell
          title="隐藏区"
          description="这里只影响当前浏览器里的上游管理视图，不会修改上游状态、Key、价格或路由。"
          onClose={() => setHiddenProvidersOpen(false)}
          wide
        >
          <div className="hidden-provider-list">
            {filteredHiddenProviders.map((provider) => {
              const activeKeys =
                provider.keys?.filter((key) => key.status === "ACTIVE")
                  .length ?? 0;
              const providerPrices = pricesForProvider(provider.name);
              return (
                <div className="hidden-provider-item" key={provider.id}>
                  <ConsoleNavButton
                    active={false}
                    title={provider.name}
                    description={`${provider.baseUrl} · Key ${activeKeys}/${provider.keys?.length ?? 0} · 价格 ${providerPrices.filter((price) => price.enabled).length}/${providerPrices.length}`}
                    meta={<StatusPill status={provider.status} />}
                    onClick={() => showProvider(provider)}
                  />
                  <div className="button-row">
                    <button
                      className="button secondary"
                      onClick={() => showProvider(provider)}
                      type="button"
                    >
                      <Eye size={15} />
                      取消隐藏
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredHiddenProviders.length === 0 ? (
              <div className="empty-state compact">隐藏区暂无上游</div>
            ) : null}
          </div>
        </ModalShell>
      ) : null}

      {providerModalOpen ? (
        <ModalShell
          title={editingId ? "编辑上游" : "添加上游"}
          description={
            editingId ? "编辑上游渠道配置。" : "添加新的上游供应商和首个 Key。"
          }
          onClose={() => {
            clearForm();
            setProviderModalOpen(false);
          }}
        >
          <form className="form" onSubmit={saveProvider}>
            <div className="modal-body">
              <label className="field">
                <span>名称</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Base URL</span>
                <input
                  className="input"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </label>
              {!editingId ? (
                <label className="field">
                  <span>首个 Key</span>
                  <input
                    className="input"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-..."
                    type="password"
                  />
                </label>
              ) : null}
              <div className="grid cols-2">
                <label className="field">
                  <span>优先级</span>
                  <input
                    className="input"
                    value={priority}
                    onChange={(event) =>
                      setPriority(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>超时（秒）</span>
                  <input
                    className="input"
                    max={600}
                    min={5}
                    onChange={(event) =>
                      setTimeoutSeconds(Number(event.target.value))
                    }
                    type="number"
                    value={timeoutSeconds}
                  />
                </label>
              </div>
              <label className="field">
                <span>Compact 返回类型</span>
                <select
                  className="input"
                  onChange={(event) =>
                    setCompactItemType(
                      event.target.value as UpstreamProvider["compactItemType"],
                    )
                  }
                  value={compactItemType}
                >
                  <option value="compaction">compaction</option>
                  <option value="compaction_summary">compaction_summary</option>
                </select>
                <span className="field-hint">
                  用于二次 compact 替换时写回请求的 item 类型。New API
                  中转站一般选 compaction；subAPI 类中转站一般选
                  compaction_summary。 这个选项不会让上游自动支持
                  compact，真正可用必须看 /v1/responses/compact 是否返回
                  encrypted_content。
                </span>
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => {
                  clearForm();
                  setProviderModalOpen(false);
                }}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <Server size={17} />
                {editingId ? "保存上游" : "添加上游"}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {keyModalProvider ? (
        <ModalShell
          title="新增上游 Key"
          description={keyModalProvider.name}
          onClose={() => setKeyModalProvider(null)}
        >
          <form className="form" onSubmit={createProviderKey}>
            <div className="modal-body">
              <label className="field">
                <span>名称</span>
                <input
                  className="input"
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>上游 API Key</span>
                <input
                  className="input"
                  value={keySecret}
                  onChange={(event) => setKeySecret(event.target.value)}
                  placeholder="sk-..."
                  type="password"
                />
              </label>
              <label className="field">
                <span>优先级</span>
                <input
                  className="input"
                  min={1}
                  max={10000}
                  value={keyPriority}
                  onChange={(event) =>
                    setKeyPriority(Number(event.target.value))
                  }
                  type="number"
                />
              </label>
              <div className="grid cols-3">
                <label className="field">
                  <span>日额度 USD</span>
                  <input
                    className="input"
                    min={0}
                    onChange={(event) =>
                      setKeyDailyLimitUsd(event.target.value)
                    }
                    placeholder="留空不限"
                    step="0.00000001"
                    type="number"
                    value={keyDailyLimitUsd}
                  />
                </label>
                <label className="field">
                  <span>月额度 USD</span>
                  <input
                    className="input"
                    min={0}
                    onChange={(event) =>
                      setKeyMonthlyLimitUsd(event.target.value)
                    }
                    placeholder="留空不限"
                    step="0.00000001"
                    type="number"
                    value={keyMonthlyLimitUsd}
                  />
                </label>
                <label className="field">
                  <span>Provider 限流</span>
                  <input
                    className="input"
                    min={0}
                    onChange={(event) =>
                      setKeyProviderRateLimit(event.target.value)
                    }
                    placeholder="留空不限"
                    type="number"
                    value={keyProviderRateLimit}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setKeyModalProvider(null)}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <KeyRound size={17} />
                添加 Key
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {batchKeyModalProvider ? (
        <ModalShell
          title="批量添加上游 Key"
          description={batchKeyModalProvider.name}
          onClose={() => {
            if (!batchKeyBusy) {
              setBatchKeyModalProvider(null);
            }
          }}
          wide
        >
          <form className="form" onSubmit={createProviderKeysBatch}>
            <div className="modal-body">
              <label className="field">
                <span>批量 Key</span>
                <textarea
                  className="input textarea"
                  value={batchKeyContent}
                  onChange={(event) => setBatchKeyContent(event.target.value)}
                  placeholder={
                    "apishare11-gwhUAx    sk-example-upstream-key-001\napishare11    sk-example-upstream-key-002"
                  }
                  rows={8}
                />
                <span className="field-hint">
                  每行一个 Key，格式为：名称 空格 上游 API Key。
                </span>
              </label>
              <label className="field">
                <span>优先级</span>
                <input
                  className="input"
                  min={1}
                  max={10000}
                  value={batchKeyPriority}
                  onChange={(event) =>
                    setBatchKeyPriority(Number(event.target.value))
                  }
                  type="number"
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                disabled={batchKeyBusy}
                onClick={() => setBatchKeyModalProvider(null)}
                type="button"
              >
                取消
              </button>
              <button className="button" disabled={batchKeyBusy} type="submit">
                <KeyRound size={17} />
                {batchKeyBusy ? "添加中..." : "批量添加"}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {priceImportModalOpen ? (
        <ModalShell
          title="导入模型价格"
          description="支持从导出的 CSV/JSON 回填；按 upstreamProvider + model 创建或更新。"
          onClose={() => setPriceImportModalOpen(false)}
          wide
        >
          <form className="form" onSubmit={previewModelPriceImport}>
            <div className="modal-body">
              <div className="segmented">
                <button
                  className={priceImportFormat === "csv" ? "active" : ""}
                  onClick={() => {
                    setPriceImportFormat("csv");
                    setPriceImportPreview(null);
                  }}
                  type="button"
                >
                  CSV
                </button>
                <button
                  className={priceImportFormat === "json" ? "active" : ""}
                  onClick={() => {
                    setPriceImportFormat("json");
                    setPriceImportPreview(null);
                  }}
                  type="button"
                >
                  JSON
                </button>
              </div>
              <label className="field">
                <span>导入内容</span>
                <textarea
                  className="input textarea compact-textarea"
                  onChange={(event) => {
                    setPriceImportContent(event.target.value);
                    setPriceImportPreview(null);
                  }}
                  value={priceImportContent}
                />
              </label>
              {priceImportPreview ? (
                <div className="notice">
                  将处理 {priceImportPreview.summary.rows} 行：新增{" "}
                  {priceImportPreview.summary.creates}，更新{" "}
                  {priceImportPreview.summary.updates}。
                </div>
              ) : null}
              {priceImportPreview?.rows.length ? (
                <AdminDataTable
                  columns={[
                    { accessorKey: "action", header: "动作" },
                    { accessorKey: "upstreamProvider", header: "上游" },
                    { accessorKey: "model", header: "模型" },
                    { accessorKey: "customerPrice", header: "售价输入/输出" },
                    { accessorKey: "priceVersion", header: "版本" },
                  ]}
                  data={priceImportPreviewRows}
                  empty="暂无导入预览"
                />
              ) : null}
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setPriceImportModalOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button secondary"
                disabled={priceImportBusy || !priceImportContent.trim()}
                type="submit"
              >
                预览
              </button>
              <button
                className="button"
                disabled={
                  priceImportBusy ||
                  !priceImportPreview ||
                  priceImportPreview.summary.rows === 0
                }
                onClick={() => void applyModelPriceImport()}
                type="button"
              >
                <Save size={17} />
                确认导入
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {unifiedPriceModalOpen ? (
        <ModalShell
          title="统一售价模式"
          description="按模型 ID 开关统一站点售价；原有每条上游站点售价会保留，关闭后立即回到普通模式。"
          onClose={() => setUnifiedPriceModalOpen(false)}
          wide
        >
          <form className="form" onSubmit={saveUnifiedPrices}>
            <div className="modal-body">
              <div className="notice">
                这里只保存模型级统一售价模式，不会覆盖各上游价格行里的原始站点售价，也不会修改任何上游成本价格。
              </div>
              <div className="unified-price-list">
                {unifiedPriceGroups.map((group) => {
                  const draft =
                    unifiedPriceDrafts[group.model] ??
                    unifiedPriceDraftFromPrice(group.prices[0]);
                  const selected = unifiedPriceSelections[group.model] ?? false;
                  const effectiveInput = multiplied(
                    draft.customerInputPer1MTok,
                    draft.customerPriceMultiplier,
                  );
                  const effectiveCachedInput = multiplied(
                    draft.customerCachedInputPer1MTok,
                    draft.customerPriceMultiplier,
                  );
                  const effectiveOutput = multiplied(
                    draft.customerOutputPer1MTok,
                    draft.customerPriceMultiplier,
                  );

                  return (
                    <section className="unified-price-row" key={group.model}>
                      <div className="unified-price-row-head">
                        <div>
                          <strong>{group.model}</strong>
                          <p>
                            {group.providerNames.length} 个上游 ·{" "}
                            {group.prices.length} 条价格 ·{" "}
                            {group.providerNames.join(" / ")}
                          </p>
                        </div>
                        <div className="unified-price-row-actions">
                          <label className="check-row unified-price-switch">
                            <input
                              checked={selected}
                              onChange={(event) =>
                                setUnifiedPriceSelected(
                                  group.model,
                                  event.target.checked,
                                )
                              }
                              type="checkbox"
                            />
                            统一模式
                          </label>
                          <span className={selected ? "pill ok" : "pill"}>
                            {selected ? "已开启" : "普通模式"}
                          </span>
                          <span
                            className={
                              group.hasDifferentOriginalCustomerPricing
                                ? "pill warn"
                                : "pill ok"
                            }
                          >
                            {group.hasDifferentOriginalCustomerPricing
                              ? "原价有差异"
                              : "原价一致"}
                          </span>
                        </div>
                      </div>
                      <div className="grid cols-2 unified-price-fields">
                        <label className="field">
                          <span>站点输入 / 1M</span>
                          <input
                            className="input"
                            disabled={!selected}
                            inputMode="decimal"
                            value={draft.customerInputPer1MTok}
                            onChange={(event) =>
                              updateUnifiedPriceDraft(
                                group.model,
                                "customerInputPer1MTok",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>站点缓存 / 1M</span>
                          <input
                            className="input"
                            disabled={!selected}
                            inputMode="decimal"
                            value={draft.customerCachedInputPer1MTok}
                            onChange={(event) =>
                              updateUnifiedPriceDraft(
                                group.model,
                                "customerCachedInputPer1MTok",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>站点输出 / 1M</span>
                          <input
                            className="input"
                            disabled={!selected}
                            inputMode="decimal"
                            value={draft.customerOutputPer1MTok}
                            onChange={(event) =>
                              updateUnifiedPriceDraft(
                                group.model,
                                "customerOutputPer1MTok",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>站点倍率</span>
                          <input
                            className="input"
                            disabled={!selected}
                            inputMode="decimal"
                            value={draft.customerPriceMultiplier}
                            onChange={(event) =>
                              updateUnifiedPriceDraft(
                                group.model,
                                "customerPriceMultiplier",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      </div>
                      <div className="unified-price-preview">
                        <InfoLine
                          label="统一模式输入"
                          value={`$${money(effectiveInput)}`}
                        />
                        <InfoLine
                          label="统一模式缓存"
                          value={`$${money(effectiveCachedInput)}`}
                        />
                        <InfoLine
                          label="统一模式输出"
                          value={`$${money(effectiveOutput)}`}
                        />
                      </div>
                    </section>
                  );
                })}
                {unifiedPriceGroups.length === 0 ? (
                  <MobileEmpty>暂无已有模型价格</MobileEmpty>
                ) : null}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setUnifiedPriceModalOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={unifiedPriceSaving || unifiedPriceGroups.length === 0}
                type="submit"
              >
                <Save size={17} />
                保存模式（开启 {selectedUnifiedPriceCount} 个）
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {priceModalOpen ? (
        <ModalShell
          title="模型定价"
          description={`上游渠道：${priceProvider || "未选择"}。缓存输入会单独使用缓存价格计算。`}
          onClose={() => {
            setEditingPriceId(null);
            setPriceModalOpen(false);
          }}
          wide
        >
          <form className="form" onSubmit={saveModelPrice}>
            <div className="modal-body">
              {unifiedSettingForModel(model)?.enabled ? (
                <div className="notice">
                  当前模型已开启统一模式；这里编辑的是普通模式下该上游自己的站点售价，关闭统一模式后会继续使用。
                </div>
              ) : null}
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => {
                    setCustomerInput(upstreamInput);
                    setCustomerCachedInput(upstreamCachedInput);
                    setCustomerOutput(upstreamOutput);
                    setCustomerMultiplier("0.12");
                  }}
                  type="button"
                >
                  套用 0.12 售价
                </button>
              </div>
              <div className="pricing-layout">
                <div className="pricing-form">
                  <div className="grid cols-2">
                    <label className="field">
                      <span>上游渠道</span>
                      <select
                        className="input"
                        value={priceProvider}
                        onChange={(event) =>
                          setPriceProvider(event.target.value)
                        }
                      >
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.name}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>模型</span>
                      <input
                        className="input"
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>上游接口</span>
                      <select
                        className="input"
                        value={upstreamEndpoint}
                        onChange={(event) =>
                          setUpstreamEndpoint(
                            event.target.value as
                              | "responses"
                              | "chat_completions"
                              | "images_generations",
                          )
                        }
                      >
                        <option value="responses">Responses API</option>
                        <option value="chat_completions">
                          Chat Completions API
                        </option>
                        <option value="images_generations">
                          Image Generations API
                        </option>
                      </select>
                    </label>
                  </div>
                  <section className="subpanel">
                    <h3>上游价格</h3>
                    <div className="grid cols-2">
                      <label className="field">
                        <span>输入原价 / 1M</span>
                        <input
                          className="input"
                          value={upstreamInput}
                          onChange={(event) =>
                            setUpstreamInput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>缓存原价 / 1M</span>
                        <input
                          className="input"
                          value={upstreamCachedInput}
                          onChange={(event) =>
                            setUpstreamCachedInput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>输出原价 / 1M</span>
                        <input
                          className="input"
                          value={upstreamOutput}
                          onChange={(event) =>
                            setUpstreamOutput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>上游倍率</span>
                        <input
                          className="input"
                          value={upstreamMultiplier}
                          onChange={(event) =>
                            setUpstreamMultiplier(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  </section>
                  <section className="subpanel">
                    <h3>站点售价</h3>
                    <div className="grid cols-2">
                      <label className="field">
                        <span>输入原价 / 1M</span>
                        <input
                          className="input"
                          value={customerInput}
                          onChange={(event) =>
                            setCustomerInput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>缓存原价 / 1M</span>
                        <input
                          className="input"
                          value={customerCachedInput}
                          onChange={(event) =>
                            setCustomerCachedInput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>输出原价 / 1M</span>
                        <input
                          className="input"
                          value={customerOutput}
                          onChange={(event) =>
                            setCustomerOutput(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>站点倍率</span>
                        <input
                          className="input"
                          value={customerMultiplier}
                          onChange={(event) =>
                            setCustomerMultiplier(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>按次费用 USD</span>
                        <input
                          className="input"
                          value={perRequestUsd}
                          onChange={(event) =>
                            setPerRequestUsd(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  </section>
                </div>
                <aside className="pricing-preview">
                  <h3>实时预览 / 1M token</h3>
                  <InfoLine
                    label="上游输入"
                    value={`$${money(upstreamEffective.input)}`}
                  />
                  <InfoLine
                    label="上游缓存"
                    value={`$${money(upstreamEffective.cached)}`}
                  />
                  <InfoLine
                    label="上游输出"
                    value={`$${money(upstreamEffective.output)}`}
                  />
                  <InfoLine
                    label="站点输入"
                    value={`$${money(customerEffective.input)}`}
                  />
                  <InfoLine
                    label="站点缓存"
                    value={`$${money(customerEffective.cached)}`}
                  />
                  <InfoLine
                    label="站点输出"
                    value={`$${money(customerEffective.output)}`}
                  />
                  <InfoLine
                    label="每次请求"
                    value={`$${money(perRequestUsd)}`}
                  />
                </aside>
              </div>
              <label className="check-row">
                <input
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  type="checkbox"
                />
                启用模型
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => {
                  setEditingPriceId(null);
                  setPriceModalOpen(false);
                }}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <Save size={17} />
                保存价格
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}

function buildUnifiedPriceGroups(
  modelPrices: ModelPrice[],
  providers: UpstreamProvider[],
  settings: UnifiedPriceSetting[],
): UnifiedPriceGroup[] {
  const providerNames = new Set(providers.map((provider) => provider.name));
  const settingsByModel = new Map(
    settings.map((setting) => [setting.model, setting]),
  );
  const groups = new Map<string, ModelPrice[]>();

  for (const price of modelPrices) {
    if (!providerNames.has(price.upstreamProvider)) {
      continue;
    }

    groups.set(price.model, [...(groups.get(price.model) ?? []), price]);
  }

  return Array.from(groups.entries())
    .map(([model, prices]) => ({
      model,
      prices,
      providerNames: Array.from(
        new Set(prices.map((price) => price.upstreamProvider)),
      ).sort((left, right) => left.localeCompare(right)),
      setting: settingsByModel.get(model),
      hasDifferentOriginalCustomerPricing: prices.some(
        (price) => !sameUnifiedPriceDraft(price, prices[0]),
      ),
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
}

function unifiedPriceDraftFromSetting(
  setting: UnifiedPriceSetting,
): UnifiedPriceDraft {
  return {
    customerInputPer1MTok: setting.customerInputPer1MTok,
    customerCachedInputPer1MTok: setting.customerCachedInputPer1MTok,
    customerOutputPer1MTok: setting.customerOutputPer1MTok,
    customerPriceMultiplier: setting.customerPriceMultiplier,
  };
}

function unifiedPriceDraftFromPrice(
  price: ModelPrice | undefined,
): UnifiedPriceDraft {
  return {
    customerInputPer1MTok: price?.customerInputPer1MTok ?? "0",
    customerCachedInputPer1MTok: price?.customerCachedInputPer1MTok ?? "0",
    customerOutputPer1MTok: price?.customerOutputPer1MTok ?? "0",
    customerPriceMultiplier: price?.customerPriceMultiplier ?? "1",
  };
}

function sameUnifiedPriceDraft(
  left: ModelPrice,
  right: ModelPrice | undefined,
) {
  if (!right) {
    return true;
  }

  return (
    Number(left.customerInputPer1MTok) ===
      Number(right.customerInputPer1MTok) &&
    Number(left.customerCachedInputPer1MTok) ===
      Number(right.customerCachedInputPer1MTok) &&
    Number(left.customerOutputPer1MTok) ===
      Number(right.customerOutputPer1MTok) &&
    Number(left.customerPriceMultiplier) ===
      Number(right.customerPriceMultiplier)
  );
}

function isNonNegativeNumberText(value: string) {
  if (!value.trim()) {
    return false;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
}

function multiplied(value: string | number, multiplier: string | number) {
  return Number(value) * Number(multiplier);
}

function endpointLabel(value: ModelPrice["upstreamEndpoint"]) {
  if (value === "chat_completions") {
    return "Chat Completions";
  }
  if (value === "images_generations") {
    return "Image Generations";
  }
  return "Responses";
}

function priceTriplet(
  input: string | number,
  cached: string | number,
  output: string | number,
) {
  return `$${money(input)} / $${money(cached)} / $${money(output)}`;
}

function calculateModelPriceMarginRisk(
  price: ModelPrice,
  customer: UnifiedPriceDraft,
): ModelPriceMarginRisk {
  const upstreamValues = [
    multiplied(price.upstreamInputPer1MTok, price.upstreamPriceMultiplier),
    multiplied(
      price.upstreamCachedInputPer1MTok,
      price.upstreamPriceMultiplier,
    ),
    multiplied(price.upstreamOutputPer1MTok, price.upstreamPriceMultiplier),
  ];
  const customerValues = [
    multiplied(
      customer.customerInputPer1MTok,
      customer.customerPriceMultiplier,
    ),
    multiplied(
      customer.customerCachedInputPer1MTok,
      customer.customerPriceMultiplier,
    ),
    multiplied(
      customer.customerOutputPer1MTok,
      customer.customerPriceMultiplier,
    ),
  ];

  const margins = upstreamValues
    .map((upstream, index) => {
      const sale = customerValues[index] ?? 0;
      if (!Number.isFinite(upstream) || !Number.isFinite(sale) || sale <= 0) {
        return null;
      }

      return ((sale - upstream) / sale) * 100;
    })
    .filter((value): value is number => value !== null);

  if (margins.length === 0) {
    return {
      level: "unknown",
      label: "未计算",
      detail: "售价为 0 或价格无效",
      worstMarginPercent: null,
    };
  }

  const worstMarginPercent = Math.min(...margins);
  const detail = `最低毛利率 ${worstMarginPercent.toFixed(1)}%`;

  if (worstMarginPercent < 0) {
    return {
      level: "loss",
      label: "亏损",
      detail,
      worstMarginPercent,
    };
  }

  if (worstMarginPercent < 15) {
    return {
      level: "low",
      label: "低毛利",
      detail,
      worstMarginPercent,
    };
  }

  return {
    level: "ok",
    label: "正常",
    detail,
    worstMarginPercent,
  };
}
