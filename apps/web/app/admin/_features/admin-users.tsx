"use client";

import {
  Copy,
  CreditCard,
  KeyRound,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useAdminResource } from "../_components/admin-hooks";
import { apiFetch } from "../../../lib/api";
import { confirmAdminAction } from "../_components/admin-confirm";
import { dateTime, formatNumber, money, parseModelList, splitList } from "../_components/admin-format";
import {
  AdminDataTable,
  Metric,
  ModalShell,
  MobileField,
  MobileRecord,
  StatusPill,
} from "../_components/admin-ui";

type AccessTierRef = {
  id: string;
  code: string;
  name: string;
};

type Wallet = {
  id: string;
  balance: string;
  reservedBalance?: string;
  currency: string;
};

type Transaction = {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  remark?: string | null;
  createdAt: string;
};

type ApiKey = {
  id: string;
  userId?: string;
  name: string;
  keyPrefix: string;
  keySecret?: string | null;
  status: "ACTIVE" | "DISABLED" | "REVOKED" | string;
  rateLimitPerMinute: number;
  dailyLimitUsd?: string | null;
  totalLimitUsd?: string | null;
  totalUsedUsd?: string | null;
  totalRemainingUsd?: string | null;
  tierId?: string | null;
  tier?: AccessTierRef | null;
  concurrencyLimit: number;
  allowedModels: string[];
  noticeEnabled?: boolean;
  noticeText?: string | null;
  tags?: string[];
  disabledReason?: string | null;
  disabledAt?: string | null;
  ipWhitelist?: string[];
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
};

type AccessTier = AccessTierRef & {
  status: "ACTIVE" | "DISABLED" | string;
  sortOrder: number;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { users: number; apiKeys: number; modelPools: number };
};

type AdminUser = {
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
  createdAt: string;
  wallet?: Wallet | null;
  walletTransactions?: Transaction[];
  apiKeys?: ApiKey[];
  modelMappings?: ModelMapping[];
  _count: { apiKeys: number; apiRequests: number };
};

type ModelMapping = {
  id?: string;
  fromModel: string;
  toModel: string;
  createdAt?: string;
  updatedAt?: string;
};

type ModelPool = {
  id: string;
  model: string;
  tierId?: string | null;
  tier?: AccessTierRef | null;
  status: "ACTIVE" | "DISABLED" | string;
};

type CharityAnnouncementSettings = {
  serviceEnabled: boolean;
  serviceDisabledMessage: string;
  enabled: boolean;
  frequency: "every_visit" | "interval";
  intervalHours: number;
  minIntervalHours?: number;
  maxIntervalHours?: number;
  title: string;
  content: string;
};

type ModelPoolResponse = {
  modelPools: ModelPool[];
  accessTiers?: AccessTier[];
};

const defaultCharityEmail = "free@qq.com";

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function limitValue(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return String(value);
}

function normalizeOptionalNumberText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalDateInput(value: string) {
  const trimmed = value.trim();
  return trimmed ? new Date(trimmed).toISOString() : null;
}

function dateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatApiKeyLimitSummary(key: ApiKey) {
  const limit = key.totalLimitUsd ?? key.dailyLimitUsd;
  const numericLimit = Number(limit ?? 0);
  if (!Number.isFinite(numericLimit) || numericLimit <= 0) return "不限";
  const used = key.totalUsedUsd ?? "0";
  const remaining = key.totalRemainingUsd ?? String(Math.max(0, numericLimit - Number(used || 0)));
  return `剩余 $${money(remaining)} / 总 $${money(numericLimit)} / 已用 $${money(used)}`;
}

function normalizeApiKeyStatus(status: string): "ACTIVE" | "DISABLED" | "REVOKED" {
  return status === "DISABLED" || status === "REVOKED" ? status : "ACTIVE";
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

function formatConcurrencyLimit(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  return !Number.isFinite(numeric) || numeric <= 0 ? "不限" : `${numeric}`;
}

function formatRateLimit(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  return !Number.isFinite(numeric) || numeric <= 0 ? "不限" : `${numeric}/min`;
}

function getUserGroup(item: AdminUser) {
  if (item.role === "ADMIN") {
    return "管理员组";
  }
  if (item.charityEnabled) {
    return "公益组";
  }
  if (item.status === "RISK_REVIEW") {
    return "风控组";
  }
  if (item.status === "SUSPENDED" || item.status === "DISABLED") {
    return "受限组";
  }
  return "普通组";
}

function MobileEmpty({ children }: { children: React.ReactNode }) {
  return <div className="mobile-empty">{children}</div>;
}

export function AdminUsersPage({
  charityOnly = false,
  onError,
}: {
  charityOnly?: boolean;
  onError: (error: string | null) => void;
}) {
  const users = useAdminResource<{ users: AdminUser[] }>(
    "users",
    charityOnly ? "/admin/users?scope=charity" : "/admin/users",
  );
  const modelPools = useAdminResource<ModelPoolResponse>(
    "modelPools",
    "/admin/model-pools",
  );
  const accessTiers = useAdminResource<{ tiers: AccessTier[] }>(
    "accessTiers",
    "/admin/access-tiers",
  );
  const charitySettings = useAdminResource<{
    settings: CharityAnnouncementSettings;
  }>(
    "charityAnnouncements",
    "/admin/charity-announcement-settings",
    charityOnly,
  );

  useEffect(() => {
    const firstError =
      users.error ??
      modelPools.error ??
      accessTiers.error ??
      charitySettings.error;
    onError(firstError ? errorToText(firstError) : null);
  }, [
    accessTiers.error,
    charitySettings.error,
    modelPools.error,
    onError,
    users.error,
  ]);

  const refetchAll = () => {
    void users.refetch();
    void modelPools.refetch();
    void accessTiers.refetch();
    if (charityOnly) {
      void charitySettings.refetch();
    }
  };

  return (
    <AdminUsers
      users={users.data?.users ?? []}
      modelPools={modelPools.data?.modelPools ?? []}
      accessTiers={accessTiers.data?.tiers ?? modelPools.data?.accessTiers ?? []}
      charityOnly={charityOnly}
      charityAnnouncementSettings={charitySettings.data?.settings ?? null}
      onChanged={refetchAll}
      onError={onError}
    />
  );
}

export function AdminUsers({
  users,
  modelPools,
  accessTiers,
  charityOnly = false,
  charityAnnouncementSettings = null,
  onChanged,
  onError,
}: {
  users: AdminUser[];
  modelPools: ModelPool[];
  accessTiers: AccessTier[];
  charityOnly?: boolean;
  charityAnnouncementSettings?: CharityAnnouncementSettings | null;
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"USER" | "ADMIN">("USER");
  const [initialBalance, setInitialBalance] = useState("0");
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(0);
  const [concurrencyLimit, setConcurrencyLimit] = useState(0);
  const [tierId, setTierId] = useState("");
  const [charityEnabled, setCharityEnabled] = useState(charityOnly);
  const [charityDisplayName, setCharityDisplayName] = useState(
    charityOnly ? "APIshare Free" : "",
  );
  const [charityKey, setCharityKey] = useState("");
  const [charityIpRateLimitEnabled, setCharityIpRateLimitEnabled] =
    useState(charityOnly);
  const [charityIpRateLimitPerMinute, setCharityIpRateLimitPerMinute] =
    useState(3);
  const [userSearch, setUserSearch] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("10");
  const [adjustRemark, setAdjustRemark] = useState("Admin balance adjustment");
  const [allowedModelsText, setAllowedModelsText] = useState("");
  const [userModal, setUserModal] = useState<
    "create" | "balance" | "models" | null
  >(null);
  const [keyModalUserId, setKeyModalUserId] = useState<string | null>(null);
  const [mappingModalUserId, setMappingModalUserId] = useState<string | null>(
    null,
  );
  const [mappingRows, setMappingRows] = useState<ModelMapping[]>([]);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"USER" | "ADMIN">("USER");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "DISABLED">("ACTIVE");
  const [editAllowedModels, setEditAllowedModels] = useState("");
  const [editRateLimitPerMinute, setEditRateLimitPerMinute] = useState(0);
  const [editConcurrencyLimit, setEditConcurrencyLimit] = useState(0);
  const [editTierId, setEditTierId] = useState("");
  const [editCharityEnabled, setEditCharityEnabled] = useState(false);
  const [editCharityDisplayName, setEditCharityDisplayName] = useState("");
  const [editCharityKey, setEditCharityKey] = useState("");
  const [editCharityIpRateLimitEnabled, setEditCharityIpRateLimitEnabled] =
    useState(false);
  const [editCharityIpRateLimitPerMinute, setEditCharityIpRateLimitPerMinute] =
    useState(0);
  const [announcementEnabled, setAnnouncementEnabled] = useState(false);
  const [announcementFrequency, setAnnouncementFrequency] = useState<
    "every_visit" | "interval"
  >("every_visit");
  const [announcementIntervalHours, setAnnouncementIntervalHours] =
    useState("24");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementContent, setAnnouncementContent] = useState("");
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementSaved, setAnnouncementSaved] = useState<string | null>(
    null,
  );
  const [charityServiceEnabled, setCharityServiceEnabled] = useState(true);
  const [charityServiceDisabledMessage, setCharityServiceDisabledMessage] =
    useState("公益 API 当前暂不可用，请稍后再试。");
  const selectedUserId = targetUserId || users[0]?.id || "";
  const selectedUser = users.find((item) => item.id === selectedUserId);
  const keyModalUser = users.find((item) => item.id === keyModalUserId) ?? null;
  const mappingModalUser =
    users.find((item) => item.id === mappingModalUserId) ?? null;
  const modelSuggestions = modelPools.map((pool) => pool.model);
  const activeTiers = accessTiers.filter((tier) => tier.status === "ACTIVE");
  const defaultTierId = activeTiers[0]?.id ?? accessTiers[0]?.id ?? "";
  const filteredUsers = users.filter((item) => {
    const isDefaultCharityUser =
      item.email.toLowerCase() === defaultCharityEmail;
    if (charityOnly && !item.charityEnabled && !isDefaultCharityUser) {
      return false;
    }
    return `${item.email} ${item.role} ${item.status} ${item.charityDisplayName ?? ""}`
      .toLowerCase()
      .includes(userSearch.trim().toLowerCase());
  });
  const activeUserCount = filteredUsers.filter(
    (item) => item.status === "ACTIVE",
  ).length;
  const disabledUserCount = filteredUsers.filter(
    (item) => item.status === "DISABLED",
  ).length;
  const totalWalletBalance = filteredUsers.reduce(
    (total, item) => total + Number(item.wallet?.balance ?? 0),
    0,
  );
  const totalApiKeys = filteredUsers.reduce(
    (total, item) => total + item._count.apiKeys,
    0,
  );
  const totalUserRequests = filteredUsers.reduce(
    (total, item) => total + item._count.apiRequests,
    0,
  );

  useEffect(() => {
    setAllowedModelsText((selectedUser?.allowedModels ?? []).join("\n"));
  }, [selectedUser?.id]);

  useEffect(() => {
    if (!tierId && defaultTierId) {
      setTierId(defaultTierId);
    }
  }, [tierId, defaultTierId]);

  useEffect(() => {
    if (!charityAnnouncementSettings) {
      return;
    }
    setCharityServiceEnabled(charityAnnouncementSettings.serviceEnabled);
    setCharityServiceDisabledMessage(
      charityAnnouncementSettings.serviceDisabledMessage,
    );
    setAnnouncementEnabled(charityAnnouncementSettings.enabled);
    setAnnouncementFrequency(charityAnnouncementSettings.frequency);
    setAnnouncementIntervalHours(
      String(charityAnnouncementSettings.intervalHours),
    );
    setAnnouncementTitle(charityAnnouncementSettings.title);
    setAnnouncementContent(charityAnnouncementSettings.content);
  }, [charityAnnouncementSettings]);

  function beginEditUser(item: AdminUser) {
    setUserModal(null);
    setEditingUser(item);
    setEditEmail(item.email);
    setEditRole(item.role === "ADMIN" ? "ADMIN" : "USER");
    setEditStatus(item.status === "DISABLED" ? "DISABLED" : "ACTIVE");
    setEditAllowedModels((item.allowedModels ?? []).join("\n"));
    setEditRateLimitPerMinute(item.rateLimitPerMinute ?? 0);
    setEditConcurrencyLimit(item.concurrencyLimit ?? 0);
    setEditTierId(item.tierId ?? defaultTierId);
    setEditCharityEnabled(Boolean(item.charityEnabled));
    setEditCharityDisplayName(item.charityDisplayName ?? "");
    setEditCharityKey(item.charityKey ?? "");
    setEditCharityIpRateLimitEnabled(Boolean(item.charityIpRateLimitEnabled));
    setEditCharityIpRateLimitPerMinute(item.charityIpRateLimitPerMinute ?? 0);
  }

  function beginEditMappings(item: AdminUser) {
    setMappingModalUserId(item.id);
    setMappingRows(
      item.modelMappings && item.modelMappings.length > 0
        ? item.modelMappings.map((mapping) => ({ ...mapping }))
        : [{ fromModel: "", toModel: "" }],
    );
  }

  function updateMappingRow(
    index: number,
    field: "fromModel" | "toModel",
    value: string,
  ) {
    setMappingRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  }

  function addMappingRow() {
    setMappingRows((current) => [...current, { fromModel: "", toModel: "" }]);
  }

  function removeMappingRow(index: number) {
    setMappingRows((current) =>
      current.length <= 1
        ? [{ fromModel: "", toModel: "" }]
        : current.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  async function saveUserModelMappings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    if (!mappingModalUser) {
      return;
    }
    setMappingSaving(true);

    try {
      await apiFetch(`/admin/users/${mappingModalUser.id}/model-mappings`, {
        method: "PUT",
        body: JSON.stringify({
          mappings: normalizeModelMappingRows(mappingRows),
        }),
      });
      setMappingModalUserId(null);
      onChanged();
    } catch (saveError) {
      onError(errorToText(saveError));
    } finally {
      setMappingSaving(false);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (!email.trim()) {
      onError("请填写用户邮箱。");
      return;
    }

    try {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          role,
          initialBalance,
          allowedModels: [],
          rateLimitPerMinute: Number(rateLimitPerMinute),
          concurrencyLimit: Number(concurrencyLimit),
          tierId: tierId || defaultTierId || null,
          charityEnabled,
          charityDisplayName:
            charityOnly && !charityDisplayName.trim()
              ? "APIshare Free"
              : charityDisplayName,
          charityKey,
          charityIpRateLimitEnabled: charityOnly && charityIpRateLimitEnabled,
          charityIpRateLimitPerMinute: charityOnly
            ? Number(charityIpRateLimitPerMinute)
            : 0,
        }),
      });
      setEmail("");
      setInitialBalance("0");
      setRateLimitPerMinute(0);
      setConcurrencyLimit(0);
      setTierId(defaultTierId);
      setCharityEnabled(charityOnly);
      setCharityDisplayName(charityOnly ? "APIshare Free" : "");
      setCharityKey("");
      setCharityIpRateLimitEnabled(charityOnly);
      setCharityIpRateLimitPerMinute(3);
      setUserModal(null);
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function adjustBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    if (!selectedUserId) {
      onError("请选择用户。");
      return;
    }

    try {
      await apiFetch(`/admin/users/${selectedUserId}/balance`, {
        method: "POST",
        body: JSON.stringify({ amount: adjustAmount, remark: adjustRemark }),
      });
      setUserModal(null);
      onChanged();
    } catch (adjustError) {
      onError(errorToText(adjustError));
    }
  }

  async function saveAllowedModels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    if (!selectedUserId) {
      onError("请选择用户。");
      return;
    }

    const allowedModels = parseModelList(allowedModelsText);

    try {
      await apiFetch(`/admin/users/${selectedUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ allowedModels }),
      });
      setUserModal(null);
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    }
  }

  async function toggleUserStatus(item: AdminUser) {
    onError(null);
    try {
      await apiFetch(`/admin/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: item.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        }),
      });
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    }
  }

  async function saveEditingUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    if (!editingUser) {
      return;
    }

    try {
      await apiFetch(`/admin/users/${editingUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          email: editEmail,
          role: editRole,
          status: editStatus,
          allowedModels: parseModelList(editAllowedModels),
          rateLimitPerMinute: Number(editRateLimitPerMinute),
          concurrencyLimit: Number(editConcurrencyLimit),
          tierId: editTierId || null,
          charityEnabled: editCharityEnabled,
          charityDisplayName: editCharityDisplayName,
          charityKey: editCharityKey,
          charityIpRateLimitEnabled:
            editCharityEnabled && editCharityIpRateLimitEnabled,
          charityIpRateLimitPerMinute: Number(editCharityIpRateLimitPerMinute),
        }),
      });
      setEditingUser(null);
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    }
  }

  async function saveCharityAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    setAnnouncementSaved(null);
    setAnnouncementSaving(true);

    try {
      const result = await apiFetch<{ settings: CharityAnnouncementSettings }>(
        "/admin/charity-announcement-settings",
        {
          method: "PUT",
          body: JSON.stringify({
            serviceEnabled: charityServiceEnabled,
            serviceDisabledMessage: charityServiceDisabledMessage.trim(),
            enabled: announcementEnabled,
            frequency: announcementFrequency,
            intervalHours: Number(announcementIntervalHours),
            title: announcementTitle,
            content: announcementContent,
          }),
        },
      );
      setCharityServiceEnabled(result.settings.serviceEnabled);
      setCharityServiceDisabledMessage(result.settings.serviceDisabledMessage);
      setAnnouncementEnabled(result.settings.enabled);
      setAnnouncementFrequency(result.settings.frequency);
      setAnnouncementIntervalHours(String(result.settings.intervalHours));
      setAnnouncementTitle(result.settings.title);
      setAnnouncementContent(result.settings.content);
      setAnnouncementSaved("公益设置已保存，状态和接口拦截会立即生效。");
      onChanged();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setAnnouncementSaving(false);
    }
  }

  async function deleteUser(item: AdminUser) {
    const confirmed = await confirmAdminAction({
      title: "删除用户",
      description: `确定删除用户「${item.email}」吗？这个操作会删除该用户的 API Key、钱包流水和调用记录。`,
      confirmText: "删除用户",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    onError(null);
    try {
      await apiFetch(`/admin/users/${item.id}`, {
        method: "DELETE",
      });
      if (editingUser?.id === item.id) {
        setEditingUser(null);
      }
      if (keyModalUserId === item.id) {
        setKeyModalUserId(null);
      }
      if (mappingModalUserId === item.id) {
        setMappingModalUserId(null);
      }
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    }
  }

  const userDirectoryColumns = [
    { accessorKey: "email", header: "邮箱" },
    { accessorKey: "role", header: "角色" },
    { accessorKey: "status", header: "状态" },
    { accessorKey: "group", header: "分组" },
    { accessorKey: "balance", header: "余额" },
    { accessorKey: "tier", header: "等级" },
    { accessorKey: "charity", header: "公益" },
    ...(charityOnly ? [{ accessorKey: "charityKey", header: "公开 Key" }] : []),
    { accessorKey: "allowedModels", header: "模型白名单" },
    { accessorKey: "accountLimits", header: "账号限制" },
    ...(charityOnly ? [{ accessorKey: "ipLimit", header: "IP 限流" }] : []),
    { accessorKey: "keyCount", header: "Key" },
    { accessorKey: "requestCount", header: "请求" },
    { accessorKey: "createdAt", header: "创建时间" },
    { accessorKey: "actions", header: "操作" },
  ];
  const userDirectoryRows = filteredUsers.map((item) => ({
    id: item.id,
    email: item.email,
    role: item.role,
    status: <StatusPill status={item.status} />,
    group: <span className="pill">{getUserGroup(item)}</span>,
    balance: `$${money(item.wallet?.balance ?? "0")}`,
    tier: item.tier ? `${item.tier.name} (${item.tier.code})` : "默认等级",
    charity: item.charityEnabled ? (
      <span className="pill ok">{item.charityDisplayName || "已公开"}</span>
    ) : charityOnly && item.email.toLowerCase() === defaultCharityEmail ? (
      <span className="pill warn">待配置</span>
    ) : (
      <span className="pill">未公开</span>
    ),
    charityKey: (
      <code className="inline-secret">{item.charityKey || "未填写"}</code>
    ),
    allowedModels:
      item.allowedModels.length > 0 ? item.allowedModels.join(", ") : "不限",
    accountLimits: `${formatRateLimit(item.rateLimitPerMinute)} · 并发 ${formatConcurrencyLimit(item.concurrencyLimit)}`,
    ipLimit: item.charityIpRateLimitEnabled ? (
      <span className="pill ok">
        {formatRateLimit(item.charityIpRateLimitPerMinute ?? 0)}
      </span>
    ) : (
      <span className="pill">未启用</span>
    ),
    keyCount: item._count.apiKeys,
    requestCount: item._count.apiRequests,
    createdAt: dateTime(item.createdAt),
    actions: (
      <div className="button-row compact">
        <button
          className="button secondary"
          onClick={() => beginEditUser(item)}
          type="button"
        >
          编辑
        </button>
        {charityOnly ? (
          <button
            className="button secondary"
            onClick={() => beginEditUser(item)}
            type="button"
          >
            设置公开 Key
          </button>
        ) : null}
        <button
          className="button secondary"
          onClick={() => beginEditMappings(item)}
          type="button"
        >
          模型映射
        </button>
        <button
          className="button secondary"
          onClick={() => setKeyModalUserId(item.id)}
          type="button"
        >
          Key 管理
        </button>
        <button
          className="button secondary"
          onClick={() => toggleUserStatus(item)}
          type="button"
        >
          {item.status === "ACTIVE" ? "停用" : "启用"}
        </button>
        <button
          className="button danger"
          onClick={() => deleteUser(item)}
          type="button"
        >
          删除
        </button>
      </div>
    ),
  }));

  return (
    <>
      <div className="grid admin-page admin-users-page">
        <div className="admin-kpi-strip">
          <Metric label="当前列表" value={String(filteredUsers.length)} caption={`全部 ${users.length}`} />
          <Metric label="启用账号" value={String(activeUserCount)} caption={`停用 ${disabledUserCount}`} />
          <Metric label="余额合计" value={`$${money(totalWalletBalance)}`} />
          <Metric label="API Key" value={String(totalApiKeys)} caption={`${formatNumber(totalUserRequests)} 请求`} />
        </div>
        {charityOnly ? (
          <section className="card charity-announcement-settings">
            <div className="section-head">
              <div>
                <h2 className="section-title">公益总开关与公告</h2>
                <p className="section-subtitle">
                  关闭后公益页状态会变为不可用，公益 Key
                  调用会返回自定义公告封禁文案。
                </p>
              </div>
              <span className={charityServiceEnabled ? "pill ok" : "pill warn"}>
                {charityServiceEnabled ? "服务可用" : "服务关闭"}
              </span>
            </div>
            <form className="form" onSubmit={saveCharityAnnouncement}>
              <div className="announcement-layout">
                <div className="announcement-controls">
                  <label className="checkbox-row">
                    <input
                      checked={charityServiceEnabled}
                      onChange={(event) =>
                        setCharityServiceEnabled(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>启用公益服务总开关</span>
                  </label>
                  <label className="field">
                    <span>关闭时返回文案</span>
                    <textarea
                      className="input textarea"
                      maxLength={8000}
                      onChange={(event) =>
                        setCharityServiceDisabledMessage(event.target.value)
                      }
                      placeholder="公益 API 当前暂不可用，请稍后再试。"
                      value={charityServiceDisabledMessage}
                    />
                  </label>
                  <label className="checkbox-row">
                    <input
                      checked={announcementEnabled}
                      onChange={(event) =>
                        setAnnouncementEnabled(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>启用公益页公告弹窗</span>
                  </label>
                  <label className="field">
                    <span>弹出频率</span>
                    <select
                      className="input"
                      value={announcementFrequency}
                      onChange={(event) =>
                        setAnnouncementFrequency(
                          event.target.value === "interval"
                            ? "interval"
                            : "every_visit",
                        )
                      }
                    >
                      <option value="every_visit">每次打开都弹出</option>
                      <option value="interval">按间隔再次弹出</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>间隔小时</span>
                    <input
                      className="input"
                      disabled={announcementFrequency !== "interval"}
                      max={charityAnnouncementSettings?.maxIntervalHours ?? 720}
                      min={charityAnnouncementSettings?.minIntervalHours ?? 1}
                      onChange={(event) =>
                        setAnnouncementIntervalHours(event.target.value)
                      }
                      type="number"
                      value={announcementIntervalHours}
                    />
                  </label>
                  <label className="field">
                    <span>标题</span>
                    <input
                      className="input"
                      maxLength={80}
                      onChange={(event) =>
                        setAnnouncementTitle(event.target.value)
                      }
                      placeholder="例如：公益 API 使用公告"
                      value={announcementTitle}
                    />
                  </label>
                </div>
                <label className="field announcement-content-field">
                  <span>弹窗内容</span>
                  <textarea
                    className="input textarea announcement-textarea"
                    maxLength={2000}
                    onChange={(event) =>
                      setAnnouncementContent(event.target.value)
                    }
                    placeholder="填写要展示给公益页访问者的公告内容。"
                    value={announcementContent}
                  />
                </label>
              </div>
              {announcementSaved ? (
                <div className="success compact-success">
                  {announcementSaved}
                </div>
              ) : null}
              <div className="button-row">
                <button
                  className="button"
                  disabled={announcementSaving}
                  type="submit"
                >
                  <Save size={17} />
                  {announcementSaving ? "保存中..." : "保存公告设置"}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <section className="action-panel admin-toolbar admin-secondary-toolbar">
          <div>
            <h2>批量任务入口</h2>
            <p>
              {charityOnly
                ? "公益账号仍然是普通用户账号；这里单独集中创建、调余额、设模型和管理 Key。"
                : "创建账号、调整余额和设置模型权限都从弹窗完成。用户通过邮箱验证码进入。"}
            </p>
          </div>
          <div className="button-row admin-toolbar-actions">
            <button
              className="button"
              onClick={() => {
                setEditingUser(null);
                setUserModal("create");
              }}
              type="button"
            >
              <Plus size={17} />
              {charityOnly ? "创建公益用户" : "创建用户"}
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setEditingUser(null);
                setUserModal("balance");
              }}
              type="button"
            >
              <CreditCard size={17} />
              余额调整
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setEditingUser(null);
                setUserModal("models");
              }}
              type="button"
            >
              <SlidersHorizontal size={17} />
              模型白名单
            </button>
          </div>
        </section>

        <section className="card admin-user-directory">
          <div className="section-head">
            <div>
              <h2 className="section-title">
                {charityOnly ? "公益用户列表" : "用户列表"}
              </h2>
              <p className="section-subtitle">
                {charityOnly
                  ? "显示公益账号；free@qq.com 会在这里作为公益账号集中编辑，Key 管理沿用普通用户逻辑。"
                  : "搜索用户、查看余额和模型限制。"}
              </p>
            </div>
            <div className="admin-directory-tools">
              <div className="button-row admin-user-list-actions">
                <button
                  className="button"
                  onClick={() => {
                    setEditingUser(null);
                    setUserModal("create");
                  }}
                  type="button"
                >
                  <Plus size={17} />
                  {charityOnly ? "创建公益用户" : "创建用户"}
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setEditingUser(null);
                    setUserModal("balance");
                  }}
                  type="button"
                >
                  <CreditCard size={17} />
                  余额调整
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setEditingUser(null);
                    setUserModal("models");
                  }}
                  type="button"
                >
                  <SlidersHorizontal size={17} />
                  模型白名单
                </button>
              </div>
              <input
                className="input search-input"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder={
                  charityOnly
                    ? "搜索邮箱 / 公益名称 / 状态"
                    : "搜索邮箱 / 状态 / 角色"
                }
              />
              <span className="pill">{filteredUsers.length} 条</span>
            </div>
          </div>
          <AdminDataTable
            columns={userDirectoryColumns}
            data={userDirectoryRows}
            empty={charityOnly ? "暂无公益用户" : "暂无用户"}
          />
          <div className="mobile-record-list">
            {filteredUsers.map((item) => (
              <MobileRecord
                key={item.id}
                title={item.email}
                meta={dateTime(item.createdAt)}
                badges={
                  <>
                    <StatusPill status={item.status} />
                    <span className="pill">{item.role}</span>
                    <span className="pill">{getUserGroup(item)}</span>
                  </>
                }
                actions={
                  <>
                    <button
                      className="button secondary"
                      onClick={() => beginEditUser(item)}
                      type="button"
                    >
                      编辑
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setKeyModalUserId(item.id)}
                      type="button"
                    >
                      Key 管理
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => toggleUserStatus(item)}
                      type="button"
                    >
                      {item.status === "ACTIVE" ? "停用" : "启用"}
                    </button>
                    <button
                      className="button danger"
                      onClick={() => deleteUser(item)}
                      type="button"
                    >
                      删除
                    </button>
                  </>
                }
              >
                <MobileField label="余额">
                  ${money(item.wallet?.balance ?? "0")}
                </MobileField>
                <MobileField label="公益">
                  {item.charityEnabled
                    ? item.charityDisplayName || "已公开"
                    : charityOnly &&
                        item.email.toLowerCase() === defaultCharityEmail
                      ? "待配置"
                    : "未公开"}
                </MobileField>
                <MobileField label="分组">{getUserGroup(item)}</MobileField>
                {charityOnly ? (
                  <MobileField label="公益 Key" wide>
                    <code className="inline-secret">
                      {item.charityKey || "未填写"}
                    </code>
                  </MobileField>
                ) : null}
                <MobileField label="账号限流">
                  {formatRateLimit(item.rateLimitPerMinute)}
                </MobileField>
                <MobileField label="账号并发">
                  {formatConcurrencyLimit(item.concurrencyLimit)}
                </MobileField>
                {charityOnly ? (
                  <MobileField label="IP 限流">
                    {item.charityIpRateLimitEnabled
                      ? formatRateLimit(item.charityIpRateLimitPerMinute ?? 0)
                      : "未启用"}
                  </MobileField>
                ) : null}
                <MobileField label="Key">{item._count.apiKeys}</MobileField>
                <MobileField label="公告 Key">
                  {
                    (item.apiKeys ?? []).filter((key) => key.noticeEnabled)
                      .length
                  }
                </MobileField>
                <MobileField label="请求">
                  {item._count.apiRequests}
                </MobileField>
                <MobileField label="模型白名单" wide>
                  {item.allowedModels.length > 0
                    ? item.allowedModels.join(", ")
                    : "不限"}
                </MobileField>
              </MobileRecord>
            ))}
            {filteredUsers.length === 0 ? (
              <MobileEmpty>暂无用户</MobileEmpty>
            ) : null}
          </div>
        </section>
      </div>

      {userModal === "create" ? (
        <ModalShell
          title={charityOnly ? "创建公益用户" : "创建用户"}
          description={
            charityOnly
              ? "创建后会自动纳入公益公开页统计；Key 仍从 Key 管理里创建。"
              : "给客户开账号和初始余额。"
          }
          onClose={() => setUserModal(null)}
        >
          <form className="form" onSubmit={createUser}>
            <div className="modal-body">
              <label className="field">
                <span>邮箱</span>
                <input
                  className="input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                />
              </label>
              <div className="grid cols-2">
                <label className="field">
                  <span>角色</span>
                  <select
                    className="input"
                    value={role}
                    onChange={(event) =>
                      setRole(event.target.value === "ADMIN" ? "ADMIN" : "USER")
                    }
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </label>
                <label className="field">
                  <span>初始余额</span>
                  <input
                    className="input"
                    value={initialBalance}
                    onChange={(event) => setInitialBalance(event.target.value)}
                  />
                </label>
              </div>
              <div className="grid cols-2">
                <label className="field">
                  <span>访问等级</span>
                  <select
                    className="input"
                    value={tierId || defaultTierId}
                    onChange={(event) => setTierId(event.target.value)}
                  >
                    {accessTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name} ({tier.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>账号每分钟限流</span>
                  <input
                    className="input"
                    value={rateLimitPerMinute}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setRateLimitPerMinute(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>账号并发限制</span>
                  <input
                    className="input"
                    value={concurrencyLimit}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setConcurrencyLimit(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
              </div>
              {charityOnly ? null : (
                <label className="checkbox-row">
                  <input
                    checked={charityEnabled}
                    onChange={(event) =>
                      setCharityEnabled(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>纳入公益公开统计</span>
                </label>
              )}
              <label className="field">
                <span>公益展示名称</span>
                <input
                  className="input"
                  value={charityDisplayName}
                  onChange={(event) =>
                    setCharityDisplayName(event.target.value)
                  }
                  placeholder="例如：公益项目名称"
                />
              </label>
              {charityOnly ? (
                <label className="field">
                  <span>公益 Key</span>
                  <input
                    className="input"
                    value={charityKey}
                    onChange={(event) => setCharityKey(event.target.value)}
                    placeholder="先创建公益用户 Key，再把完整 Key 粘贴到这里"
                  />
                </label>
              ) : null}
              {charityOnly ? (
                <div className="grid cols-2">
                  <label className="checkbox-row">
                    <input
                      checked={charityIpRateLimitEnabled}
                      onChange={(event) =>
                        setCharityIpRateLimitEnabled(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>启用公益单 IP 限流</span>
                  </label>
                  <label className="field">
                    <span>单 IP 每分钟限制</span>
                    <input
                      className="input"
                      disabled={!charityIpRateLimitEnabled}
                      max={10000}
                      min={0}
                      onChange={(event) =>
                        setCharityIpRateLimitPerMinute(
                          Number(event.target.value),
                        )
                      }
                      type="number"
                      value={charityIpRateLimitPerMinute}
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setUserModal(null)}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <Users size={17} />
                {charityOnly ? "创建公益用户" : "创建用户"}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {userModal === "balance" ? (
        <ModalShell
          title="余额调整"
          description="正数加余额，负数扣余额。"
          onClose={() => setUserModal(null)}
        >
          <form className="form" onSubmit={adjustBalance}>
            <div className="modal-body">
              <label className="field">
                <span>用户</span>
                <select
                  className="input"
                  value={selectedUserId}
                  onChange={(event) => setTargetUserId(event.target.value)}
                >
                  {users.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.email}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid cols-2">
                <label className="field">
                  <span>金额</span>
                  <input
                    className="input"
                    value={adjustAmount}
                    onChange={(event) => setAdjustAmount(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>备注</span>
                  <input
                    className="input"
                    value={adjustRemark}
                    onChange={(event) => setAdjustRemark(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setUserModal(null)}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <CreditCard size={17} />
                调整余额
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {userModal === "models" ? (
        <ModalShell
          title="模型白名单"
          description="留空表示该用户不限模型。"
          onClose={() => setUserModal(null)}
        >
          <form className="form" onSubmit={saveAllowedModels}>
            <div className="modal-body">
              <label className="field">
                <span>用户</span>
                <select
                  className="input"
                  value={selectedUserId}
                  onChange={(event) => setTargetUserId(event.target.value)}
                >
                  {users.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>允许模型</span>
                <textarea
                  className="input textarea compact-textarea"
                  value={allowedModelsText}
                  onChange={(event) => setAllowedModelsText(event.target.value)}
                  placeholder="每行一个模型，比如 gpt-5.5"
                />
              </label>
              <div className="chip-row">
                {modelSuggestions.slice(0, 8).map((modelName) => (
                  <button
                    className="chip"
                    key={modelName}
                    onClick={() =>
                      setAllowedModelsText((current) =>
                        Array.from(
                          new Set([...parseModelList(current), modelName]),
                        ).join("\n"),
                      )
                    }
                    type="button"
                  >
                    + {modelName}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setUserModal(null)}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <Save size={17} />
                保存白名单
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {keyModalUser ? (
        <AdminUserKeysModal
          user={keyModalUser}
          modelPools={modelPools}
          accessTiers={accessTiers}
          onChanged={onChanged}
          onClose={() => setKeyModalUserId(null)}
          onError={onError}
        />
      ) : null}

      {mappingModalUser ? (
        <ModalShell
          title="模型映射"
          description={mappingModalUser.email}
          onClose={() => setMappingModalUserId(null)}
          wide
        >
          <form className="form" onSubmit={saveUserModelMappings}>
            <div className="modal-body">
              <div className="mapping-editor">
                {mappingRows.map((row, index) => (
                  <div className="mapping-row" key={row.id ?? index}>
                    <label className="field">
                      <span>调用模型</span>
                      <input
                        className="input"
                        onChange={(event) =>
                          updateMappingRow(
                            index,
                            "fromModel",
                            event.target.value,
                          )
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
                          updateMappingRow(
                            index,
                            "toModel",
                            event.target.value,
                          )
                        }
                        placeholder="gpt-4.1"
                        value={row.toModel}
                      />
                    </label>
                    <button
                      className="button secondary icon-button"
                      onClick={() => removeMappingRow(index)}
                      title="删除映射"
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={addMappingRow}
                type="button"
              >
                <Plus size={17} />
                添加映射
              </button>
              <button
                className="button"
                disabled={mappingSaving}
                type="submit"
              >
                <Save size={17} />
                {mappingSaving ? "保存中..." : "保存映射"}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {editingUser ? (
        <ModalShell
          title="编辑用户"
          description={editingUser.email}
          onClose={() => setEditingUser(null)}
          wide
        >
          <form className="form" onSubmit={saveEditingUser}>
            <div className="modal-body">
              <div className="grid cols-3">
                <label className="field">
                  <span>邮箱</span>
                  <input
                    className="input"
                    value={editEmail}
                    onChange={(event) => setEditEmail(event.target.value)}
                    type="email"
                  />
                </label>
                <label className="field">
                  <span>角色</span>
                  <select
                    className="input"
                    value={editRole}
                    onChange={(event) =>
                      setEditRole(
                        event.target.value === "ADMIN" ? "ADMIN" : "USER",
                      )
                    }
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </label>
                <label className="field">
                  <span>状态</span>
                  <select
                    className="input"
                    value={editStatus}
                    onChange={(event) =>
                      setEditStatus(
                        event.target.value === "DISABLED"
                          ? "DISABLED"
                          : "ACTIVE",
                      )
                    }
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DISABLED">DISABLED</option>
                  </select>
                </label>
              </div>
              <div className="grid cols-3">
                <label className="field">
                  <span>访问等级</span>
                  <select
                    className="input"
                    value={editTierId}
                    onChange={(event) => setEditTierId(event.target.value)}
                  >
                    {accessTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name} ({tier.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>账号每分钟限流</span>
                  <input
                    className="input"
                    value={editRateLimitPerMinute}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setEditRateLimitPerMinute(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>账号并发限制</span>
                  <input
                    className="input"
                    value={editConcurrencyLimit}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setEditConcurrencyLimit(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>公益展示名称</span>
                  <input
                    className="input"
                    value={editCharityDisplayName}
                    onChange={(event) =>
                      setEditCharityDisplayName(event.target.value)
                    }
                    placeholder="公开页展示名称"
                  />
                </label>
              </div>
              <label className="field">
                <span>公开页 API Key</span>
                <input
                  className="input"
                  value={editCharityKey}
                  onChange={(event) => setEditCharityKey(event.target.value)}
                  placeholder="粘贴要展示在公益页的完整 API Key"
                />
              </label>
              <label className="checkbox-row">
                <input
                  checked={editCharityEnabled}
                  onChange={(event) =>
                    setEditCharityEnabled(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>纳入公益公开统计</span>
              </label>
              <div className="grid cols-2">
                <label className="checkbox-row">
                  <input
                    checked={editCharityIpRateLimitEnabled}
                    disabled={!editCharityEnabled}
                    onChange={(event) =>
                      setEditCharityIpRateLimitEnabled(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>启用公益单 IP 限流</span>
                </label>
                <label className="field">
                  <span>单 IP 每分钟限制</span>
                  <input
                    className="input"
                    disabled={
                      !editCharityEnabled || !editCharityIpRateLimitEnabled
                    }
                    max={10000}
                    min={0}
                    onChange={(event) =>
                      setEditCharityIpRateLimitPerMinute(
                        Number(event.target.value),
                      )
                    }
                    type="number"
                    value={editCharityIpRateLimitPerMinute}
                  />
                </label>
              </div>
              <div className="grid cols-1">
                <label className="field">
                  <span>模型白名单</span>
                  <textarea
                    className="input textarea compact-textarea"
                    value={editAllowedModels}
                    onChange={(event) =>
                      setEditAllowedModels(event.target.value)
                    }
                    placeholder="留空不限；每行一个模型"
                  />
                </label>
              </div>
              <div className="chip-row">
                {modelSuggestions.slice(0, 8).map((modelName) => (
                  <button
                    className="chip"
                    key={modelName}
                    onClick={() =>
                      setEditAllowedModels((current) =>
                        Array.from(
                          new Set([...parseModelList(current), modelName]),
                        ).join("\n"),
                      )
                    }
                    type="button"
                  >
                    + {modelName}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setEditingUser(null)}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <Save size={17} />
                保存用户
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}

function AdminUserKeysModal({
  user,
  modelPools,
  accessTiers,
  onChanged,
  onError,
  onClose,
}: {
  user: AdminUser;
  modelPools: ModelPool[];
  accessTiers: AccessTier[];
  onChanged: () => void;
  onError: (error: string | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("default");
  const [rateLimit, setRateLimit] = useState(60);
  const [totalLimitUsd, setTotalLimitUsd] = useState("");
  const [concurrencyLimit, setConcurrencyLimit] = useState(0);
  const [tierId, setTierId] = useState(user.tierId ?? "");
  const [expiresAt, setExpiresAt] = useState("");
  const [allowedModelsText, setAllowedModelsText] = useState("");
  const [noticeEnabled, setNoticeEnabled] = useState(false);
  const [noticeText, setNoticeText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [ipWhitelistText, setIpWhitelistText] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [selectedKeyIds, setSelectedKeyIds] = useState<string[]>([]);
  const [batchNoticeEnabled, setBatchNoticeEnabled] = useState(true);
  const [batchNoticeText, setBatchNoticeText] = useState("");
  const [batchTierId, setBatchTierId] = useState(user.tierId ?? "");
  const [batchBusy, setBatchBusy] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState<
    "ACTIVE" | "DISABLED" | "REVOKED"
  >("ACTIVE");
  const [editRateLimit, setEditRateLimit] = useState(60);
  const [editTotalLimitUsd, setEditTotalLimitUsd] = useState("");
  const [editConcurrencyLimit, setEditConcurrencyLimit] = useState(0);
  const [editTierId, setEditTierId] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [editAllowedModels, setEditAllowedModels] = useState("");
  const [editNoticeEnabled, setEditNoticeEnabled] = useState(false);
  const [editNoticeText, setEditNoticeText] = useState("");
  const [editTagsText, setEditTagsText] = useState("");
  const [editIpWhitelistText, setEditIpWhitelistText] = useState("");
  const [editDisabledReason, setEditDisabledReason] = useState("");
  const modelSuggestions = Array.from(
    new Set(modelPools.map((pool) => pool.model)),
  ).sort();
  const activeTiers = accessTiers.filter((tier) => tier.status === "ACTIVE");
  const defaultTierId =
    user.tierId ?? activeTiers[0]?.id ?? accessTiers[0]?.id ?? "";
  const userApiKeys = user.apiKeys ?? [];
  const selectedKeySet = new Set(selectedKeyIds);
  const allKeysSelected =
    userApiKeys.length > 0 && selectedKeyIds.length === userApiKeys.length;

  useEffect(() => {
    setCreatedSecret(null);
    setEditingKey(null);
    setSelectedKeyIds([]);
    setBatchNoticeEnabled(true);
    setBatchNoticeText("");
    setTierId(user.tierId ?? defaultTierId);
    setBatchTierId(user.tierId ?? defaultTierId);
  }, [user.id]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    if (noticeEnabled && !noticeText.trim()) {
      onError("开启公告时请填写公告内容。");
      return;
    }

    try {
      const result = await apiFetch<{ apiKey: ApiKey; secret: string }>(
        `/admin/users/${user.id}/api-keys`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            rateLimitPerMinute: Number(rateLimit),
            totalLimitUsd: normalizeOptionalNumberText(totalLimitUsd),
            concurrencyLimit: Number(concurrencyLimit),
            tierId: tierId || defaultTierId || null,
            expiresAt: normalizeOptionalDateInput(expiresAt),
            allowedModels: parseModelList(allowedModelsText),
            noticeEnabled,
            noticeText: noticeText.trim() || null,
            tags: splitList(tagsText),
            ipWhitelist: splitList(ipWhitelistText),
          }),
        },
      );
      setCreatedSecret(result.secret);
      setName("default");
      setAllowedModelsText("");
      setNoticeEnabled(false);
      setNoticeText("");
      setTagsText("");
      setIpWhitelistText("");
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  function beginEditKey(key: ApiKey) {
    setEditingKey(key);
    setEditName(key.name);
    setEditStatus(normalizeApiKeyStatus(key.status));
    setEditRateLimit(key.rateLimitPerMinute);
    setEditTotalLimitUsd(limitValue(key.totalLimitUsd ?? key.dailyLimitUsd));
    setEditConcurrencyLimit(key.concurrencyLimit ?? 0);
    setEditTierId(key.tierId ?? defaultTierId);
    setEditExpiresAt(dateInputValue(key.expiresAt));
    setEditAllowedModels((key.allowedModels ?? []).join("\n"));
    setEditNoticeEnabled(Boolean(key.noticeEnabled));
    setEditNoticeText(key.noticeText ?? "");
    setEditTagsText((key.tags ?? []).join(", "));
    setEditIpWhitelistText((key.ipWhitelist ?? []).join("\n"));
    setEditDisabledReason(key.disabledReason ?? "");
  }

  async function saveEditingKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingKey) {
      return;
    }

    if (editNoticeEnabled && !editNoticeText.trim()) {
      onError("开启公告时请填写公告内容。");
      return;
    }

    onError(null);
    setBusyKeyId(editingKey.id);
    try {
      await apiFetch(`/admin/api-keys/${editingKey.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName,
          status: editStatus,
          rateLimitPerMinute: Number(editRateLimit),
          totalLimitUsd: normalizeOptionalNumberText(editTotalLimitUsd),
          concurrencyLimit: Number(editConcurrencyLimit),
          tierId: editTierId || null,
          expiresAt: normalizeOptionalDateInput(editExpiresAt),
          allowedModels: parseModelList(editAllowedModels),
          noticeEnabled: editNoticeEnabled,
          noticeText: editNoticeText.trim() || null,
          tags: splitList(editTagsText),
          ipWhitelist: splitList(editIpWhitelistText),
          disabledReason: editDisabledReason.trim() || null,
        }),
      });
      setEditingKey(null);
      onChanged();
    } catch (editError) {
      onError(errorToText(editError));
    } finally {
      setBusyKeyId(null);
    }
  }

  async function updateKeyStatus(
    key: ApiKey,
    status: "ACTIVE" | "DISABLED" | "REVOKED",
  ) {
    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/admin/api-keys/${key.id}`, {
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

  function toggleKeySelection(keyId: string) {
    setSelectedKeyIds((current) =>
      current.includes(keyId)
        ? current.filter((id) => id !== keyId)
        : [...current, keyId],
    );
  }

  function toggleAllKeySelection() {
    setSelectedKeyIds(allKeysSelected ? [] : userApiKeys.map((key) => key.id));
  }

  async function batchUpdateKeys(changes: {
    status?: "ACTIVE" | "DISABLED" | "REVOKED";
    tierId?: string | null;
    noticeEnabled?: boolean;
    noticeText?: string | null;
  }, keyIds = selectedKeyIds) {
    onError(null);

    if (keyIds.length === 0) {
      onError("请先选择要批量处理的 Key。");
      return;
    }

    if (changes.noticeEnabled && !changes.noticeText?.trim()) {
      onError("开启公告时请填写公告内容。");
      return;
    }

    setBatchBusy(true);
    try {
      await apiFetch(`/admin/users/${user.id}/api-keys/batch`, {
        method: "PATCH",
        body: JSON.stringify({
          keyIds,
          ...changes,
          ...(changes.noticeText !== undefined
            ? { noticeText: changes.noticeText?.trim() || null }
            : {}),
        }),
      });
      setSelectedKeyIds([]);
      onChanged();
    } catch (batchError) {
      onError(errorToText(batchError));
    } finally {
      setBatchBusy(false);
    }
  }

  async function syncAllKeyTiersToUserTier() {
    await batchUpdateKeys(
      { tierId: (user.tierId ?? defaultTierId) || null },
      userApiKeys.map((key) => key.id),
    );
  }

  async function submitBatchNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await batchUpdateKeys({
      noticeEnabled: batchNoticeEnabled,
      noticeText: batchNoticeEnabled ? batchNoticeText : null,
    });
  }

  async function deleteKey(key: ApiKey) {
    const confirmed = await confirmAdminAction({
      title: "删除用户 API Key",
      description: `确定删除 ${user.email} 的 API Key「${key.name}」吗？删除后将无法继续使用。`,
      confirmText: "删除",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/admin/api-keys/${key.id}`, {
        method: "DELETE",
      });
      if (editingKey?.id === key.id) {
        setEditingKey(null);
      }
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyKeyId(null);
    }
  }
  const userApiKeyRows = userApiKeys.map((key) => ({
    id: key.id,
    selected: (
      <input
        checked={selectedKeySet.has(key.id)}
        onChange={() => toggleKeySelection(key.id)}
        type="checkbox"
      />
    ),
    name: (
      <div className="key-name-cell">
        <strong>{key.name}</strong>
        <button
          className="icon-text-button"
          onClick={() => beginEditKey(key)}
          type="button"
        >
          <Pencil size={15} />
          编辑
        </button>
      </div>
    ),
    secret: (
      <code className="inline-secret">
        {key.keySecret ?? "未保存完整 Key"}
      </code>
    ),
    status: <StatusPill status={key.status} />,
    limits: `${key.rateLimitPerMinute}/min · 并发 ${formatConcurrencyLimit(key.concurrencyLimit)}`,
    quota: formatApiKeyLimitSummary(key),
    tagsAndIp: (
      <>
        <strong>{(key.tags ?? []).join(", ") || "-"}</strong>
        <span className="muted truncate">
          {(key.ipWhitelist ?? []).join(", ") || "不限 IP"}
        </span>
      </>
    ),
    notice: (
      <>
        <span className={key.noticeEnabled ? "pill ok" : "pill"}>
          {key.noticeEnabled ? "公告中" : "未开启"}
        </span>
        {key.noticeText ? (
          <div className="notice-preview">{key.noticeText}</div>
        ) : null}
      </>
    ),
    lastUsedAt: key.lastUsedAt ? dateTime(key.lastUsedAt) : "-",
    actions: (
      <div className="button-row compact">
        <button
          className="button secondary"
          onClick={() => beginEditKey(key)}
          type="button"
        >
          编辑
        </button>
        {key.status === "ACTIVE" ? (
          <button
            className="button secondary"
            disabled={busyKeyId === key.id}
            onClick={() => updateKeyStatus(key, "DISABLED")}
            type="button"
          >
            停用
          </button>
        ) : (
          <button
            className="button"
            disabled={busyKeyId === key.id}
            onClick={() => updateKeyStatus(key, "ACTIVE")}
            type="button"
          >
            启用
          </button>
        )}
        <button
          className="button danger"
          disabled={busyKeyId === key.id}
          onClick={() => deleteKey(key)}
          type="button"
        >
          删除
        </button>
      </div>
    ),
  }));

  return (
    <>
      <ModalShell
        title="用户 Key 管理"
        description={`${user.email} · ${userApiKeys.length} 个 Key`}
        onClose={onClose}
        wide
      >
        <div className="modal-body admin-key-modal">
          <form className="form" onSubmit={createKey}>
            <div className="grid cols-3">
              <label className="field">
                <span>名称</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>每分钟限流</span>
                <input
                  className="input"
                  value={rateLimit}
                  min={1}
                  max={10000}
                  onChange={(event) => setRateLimit(Number(event.target.value))}
                  type="number"
                />
              </label>
              <label className="field">
                <span>总限额 USD</span>
                <input
                  className="input"
                  value={totalLimitUsd}
                  min={0}
                  onChange={(event) => setTotalLimitUsd(event.target.value)}
                  placeholder="留空不限"
                  step="0.00000001"
                  type="number"
                />
              </label>
            </div>
            <div className="grid cols-3">
              <label className="field">
                <span>并发限制</span>
                <input
                  className="input"
                  value={concurrencyLimit}
                  min={0}
                  max={10000}
                  onChange={(event) =>
                    setConcurrencyLimit(Number(event.target.value))
                  }
                  type="number"
                />
              </label>
              <label className="field">
                <span>过期时间</span>
                <input
                  className="input"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  type="datetime-local"
                />
              </label>
              <label className="field">
                <span>访问等级</span>
                <select
                  className="input"
                  value={tierId || defaultTierId}
                  onChange={(event) => setTierId(event.target.value)}
                >
                  {accessTiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name} ({tier.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-field">
                <input
                  checked={noticeEnabled}
                  onChange={(event) => setNoticeEnabled(event.target.checked)}
                  type="checkbox"
                />
                开启公告
              </label>
            </div>
            <div className="grid cols-2">
              <label className="field">
                <span>模型白名单</span>
                <textarea
                  className="input textarea compact-textarea"
                  value={allowedModelsText}
                  onChange={(event) => setAllowedModelsText(event.target.value)}
                  placeholder="留空不限；每行一个模型"
                />
              </label>
              <label className="field">
                <span>公告内容</span>
                <textarea
                  className="input textarea compact-textarea"
                  value={noticeText}
                  disabled={!noticeEnabled}
                  onChange={(event) => setNoticeText(event.target.value)}
                  placeholder="开启公告后，这个 Key 的调用会返回这里的文字"
                />
              </label>
            </div>
            <div className="grid cols-2">
              <label className="field">
                <span>标签</span>
                <input
                  className="input"
                  value={tagsText}
                  onChange={(event) => setTagsText(event.target.value)}
                  placeholder="公益, 客户A, 测试"
                />
              </label>
              <label className="field">
                <span>IP 白名单</span>
                <textarea
                  className="input textarea compact-textarea"
                  value={ipWhitelistText}
                  onChange={(event) => setIpWhitelistText(event.target.value)}
                  placeholder="每行一个 IP 或 IPv4 CIDR，留空不限制"
                />
              </label>
            </div>
            <div className="chip-row">
              {modelSuggestions.slice(0, 8).map((modelName) => (
                <button
                  className="chip"
                  key={modelName}
                  onClick={() =>
                    setAllowedModelsText((current) =>
                      Array.from(
                        new Set([...parseModelList(current), modelName]),
                      ).join("\n"),
                    )
                  }
                  type="button"
                >
                  + {modelName}
                </button>
              ))}
            </div>
            <div className="button-row">
              <button className="button" type="submit">
                <Plus size={17} />
                创建 Key
              </button>
            </div>
          </form>

          {createdSecret ? (
            <div className="stack-top">
              <div className="notice">新 Key 已创建，完整密钥如下。</div>
              <div className="secret">{createdSecret}</div>
            </div>
          ) : null}

          <form className="batch-panel" onSubmit={submitBatchNotice}>
            <div className="batch-panel-head">
              <div>
                <strong>批量操作</strong>
                <p>
                  已选择 {selectedKeyIds.length} / {userApiKeys.length} 个 Key
                </p>
              </div>
              <div className="button-row compact">
                <button
                  className="button secondary"
                  onClick={toggleAllKeySelection}
                  type="button"
                >
                  {allKeysSelected ? "取消全选" : "全选"}
                </button>
                <button
                  className="button secondary"
                  disabled={batchBusy || selectedKeyIds.length === 0}
                  onClick={() => batchUpdateKeys({ status: "ACTIVE" })}
                  type="button"
                >
                  批量启用
                </button>
                <button
                  className="button secondary"
                  disabled={batchBusy || selectedKeyIds.length === 0}
                  onClick={() => batchUpdateKeys({ status: "DISABLED" })}
                  type="button"
                >
                  批量停用
                </button>
              </div>
            </div>
            <div className="grid cols-2">
              <label className="field">
                <span>Key 等级</span>
                <select
                  className="input"
                  value={batchTierId || defaultTierId}
                  onChange={(event) => setBatchTierId(event.target.value)}
                >
                  {accessTiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name} ({tier.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>公告动作</span>
                <select
                  className="input"
                  value={batchNoticeEnabled ? "on" : "off"}
                  onChange={(event) =>
                    setBatchNoticeEnabled(event.target.value === "on")
                  }
                >
                  <option value="on">开启并设置公告</option>
                  <option value="off">关闭公告</option>
                </select>
              </label>
              <label className="field">
                <span>公告内容</span>
                <input
                  className="input"
                  value={batchNoticeText}
                  disabled={!batchNoticeEnabled}
                  onChange={(event) => setBatchNoticeText(event.target.value)}
                  placeholder="批量开启公告时填写"
                />
              </label>
            </div>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={batchBusy || selectedKeyIds.length === 0}
                onClick={() =>
                  batchUpdateKeys({ tierId: batchTierId || defaultTierId || null })
                }
                type="button"
              >
                同步所选 Key 等级
              </button>
              <button
                className="button secondary"
                disabled={batchBusy || userApiKeys.length === 0}
                onClick={syncAllKeyTiersToUserTier}
                type="button"
              >
                同步全部 Key 到用户等级
              </button>
              <button
                className="button"
                disabled={batchBusy || selectedKeyIds.length === 0}
                type="submit"
              >
                <Save size={17} />
                应用公告设置
              </button>
            </div>
          </form>

          <div className="admin-key-table">
            <AdminDataTable
              columns={[
                { accessorKey: "selected", header: "选择" },
                { accessorKey: "name", header: "名称" },
                { accessorKey: "secret", header: "完整 Key" },
                { accessorKey: "status", header: "状态" },
                { accessorKey: "limits", header: "限制" },
                { accessorKey: "quota", header: "限额" },
                { accessorKey: "tagsAndIp", header: "标签/IP" },
                { accessorKey: "notice", header: "公告" },
                { accessorKey: "lastUsedAt", header: "上次使用" },
                { accessorKey: "actions", header: "操作" },
              ]}
              data={userApiKeyRows}
              empty="暂无 API Key"
            />
          </div>

          <div className="mobile-record-list">
            {userApiKeys.map((key) => (
              <MobileRecord
                key={key.id}
                title={key.name}
                meta={dateTime(key.createdAt)}
                badges={
                  <>
                    <StatusPill status={key.status} />
                    <span className={key.noticeEnabled ? "pill ok" : "pill"}>
                      {key.noticeEnabled ? "公告中" : "未开启"}
                    </span>
                  </>
                }
                actions={
                  <>
                    <button
                      className="button secondary"
                      onClick={() => beginEditKey(key)}
                      type="button"
                    >
                      编辑
                    </button>
                    {key.status === "ACTIVE" ? (
                      <button
                        className="button secondary"
                        disabled={busyKeyId === key.id}
                        onClick={() => updateKeyStatus(key, "DISABLED")}
                        type="button"
                      >
                        停用
                      </button>
                    ) : (
                      <button
                        className="button"
                        disabled={busyKeyId === key.id}
                        onClick={() => updateKeyStatus(key, "ACTIVE")}
                        type="button"
                      >
                        启用
                      </button>
                    )}
                    <button
                      className="button danger"
                      disabled={busyKeyId === key.id}
                      onClick={() => deleteKey(key)}
                      type="button"
                    >
                      删除
                    </button>
                  </>
                }
              >
                <MobileField label="选择">
                  <input
                    checked={selectedKeySet.has(key.id)}
                    onChange={() => toggleKeySelection(key.id)}
                    type="checkbox"
                  />
                </MobileField>
                <MobileField label="完整 Key" wide>
                  <code className="inline-secret">
                    {key.keySecret ?? "未保存完整 Key"}
                  </code>
                </MobileField>
                <MobileField label="限流">
                  {key.rateLimitPerMinute}/min
                </MobileField>
                <MobileField label="并发">
                  {formatConcurrencyLimit(key.concurrencyLimit)}
                </MobileField>
                <MobileField label="限额" wide>
                  {formatApiKeyLimitSummary(key)}
                </MobileField>
                <MobileField label="上次使用">
                  {key.lastUsedAt ? dateTime(key.lastUsedAt) : "-"}
                </MobileField>
                <MobileField label="公告" wide>
                  {key.noticeText ?? "未开启"}
                </MobileField>
                <MobileField label="标签" wide>
                  {(key.tags ?? []).join(", ") || "-"}
                </MobileField>
                <MobileField label="IP 白名单" wide>
                  {(key.ipWhitelist ?? []).join(", ") || "不限 IP"}
                </MobileField>
                <MobileField label="停用原因" wide>
                  {key.disabledReason ?? "-"}
                </MobileField>
              </MobileRecord>
            ))}
            {userApiKeys.length === 0 ? (
              <MobileEmpty>暂无 API Key</MobileEmpty>
            ) : null}
          </div>
        </div>
        <div className="modal-footer">
          <button className="button secondary" onClick={onClose} type="button">
            关闭
          </button>
        </div>
      </ModalShell>

      {editingKey ? (
        <ModalShell
          title="编辑用户 Key"
          description={editingKey.keySecret ?? editingKey.keyPrefix}
          onClose={() => setEditingKey(null)}
          wide
        >
          <form className="form" onSubmit={saveEditingKey}>
            <div className="modal-body">
              <div className="grid cols-3">
                <label className="field">
                  <span>名称</span>
                  <input
                    className="input"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>状态</span>
                  <select
                    className="input"
                    value={editStatus}
                    onChange={(event) =>
                      setEditStatus(normalizeApiKeyStatus(event.target.value))
                    }
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DISABLED">DISABLED</option>
                    <option value="REVOKED">REVOKED</option>
                  </select>
                </label>
                <label className="field">
                  <span>每分钟限流</span>
                  <input
                    className="input"
                    value={editRateLimit}
                    min={1}
                    max={10000}
                    onChange={(event) =>
                      setEditRateLimit(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
              </div>
              <div className="grid cols-3">
                <label className="field">
                  <span>总限额 USD</span>
                  <input
                    className="input"
                    value={editTotalLimitUsd}
                    min={0}
                    onChange={(event) =>
                      setEditTotalLimitUsd(event.target.value)
                    }
                    placeholder="留空不限"
                    step="0.00000001"
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>并发限制</span>
                  <input
                    className="input"
                    value={editConcurrencyLimit}
                    min={0}
                    max={10000}
                    onChange={(event) =>
                      setEditConcurrencyLimit(Number(event.target.value))
                    }
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>访问等级</span>
                  <select
                    className="input"
                    value={editTierId}
                    onChange={(event) => setEditTierId(event.target.value)}
                  >
                    {accessTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name} ({tier.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>过期时间</span>
                  <input
                    className="input"
                    value={editExpiresAt}
                    onChange={(event) => setEditExpiresAt(event.target.value)}
                    type="datetime-local"
                  />
                </label>
              </div>
              <div className="grid cols-2">
                <label className="field">
                  <span>模型白名单</span>
                  <textarea
                    className="input textarea compact-textarea"
                    value={editAllowedModels}
                    onChange={(event) =>
                      setEditAllowedModels(event.target.value)
                    }
                    placeholder="留空不限；每行一个模型"
                  />
                </label>
                <label className="field">
                  <span>公告内容</span>
                  <textarea
                    className="input textarea compact-textarea"
                    value={editNoticeText}
                    disabled={!editNoticeEnabled}
                    onChange={(event) => setEditNoticeText(event.target.value)}
                    placeholder="开启公告后，这个 Key 的调用会返回这里的文字"
                  />
                </label>
              </div>
              <div className="grid cols-2">
                <label className="field">
                  <span>标签</span>
                  <input
                    className="input"
                    value={editTagsText}
                    onChange={(event) => setEditTagsText(event.target.value)}
                    placeholder="公益, 客户A, 测试"
                  />
                </label>
                <label className="field">
                  <span>IP 白名单</span>
                  <textarea
                    className="input textarea compact-textarea"
                    value={editIpWhitelistText}
                    onChange={(event) =>
                      setEditIpWhitelistText(event.target.value)
                    }
                    placeholder="每行一个 IP 或 IPv4 CIDR，留空不限制"
                  />
                </label>
              </div>
              <label className="field">
                <span>停用原因</span>
                <input
                  className="input"
                  value={editDisabledReason}
                  onChange={(event) =>
                    setEditDisabledReason(event.target.value)
                  }
                  placeholder="可选，停用或风控时记录"
                />
              </label>
              <div className="button-row">
                <label className="inline-field">
                  <input
                    checked={editNoticeEnabled}
                    onChange={(event) =>
                      setEditNoticeEnabled(event.target.checked)
                    }
                    type="checkbox"
                  />
                  开启公告
                </label>
              </div>
              <div className="chip-row">
                {modelSuggestions.slice(0, 8).map((modelName) => (
                  <button
                    className="chip"
                    key={modelName}
                    onClick={() =>
                      setEditAllowedModels((current) =>
                        Array.from(
                          new Set([...parseModelList(current), modelName]),
                        ).join("\n"),
                      )
                    }
                    type="button"
                  >
                    + {modelName}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setEditingKey(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={busyKeyId === editingKey.id}
                type="submit"
              >
                <Save size={17} />
                保存 Key
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}
