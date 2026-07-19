"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  Bot,
  Braces,
  ChevronDown,
  CirclePause,
  CirclePlay,
  ExternalLink,
  KeyRound,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { apiBaseUrl, apiFetch, apiV1BaseUrl } from "../../../lib/api";
import { dateTime, money, splitList } from "../../../lib/format";
import {
  FrontAlert,
  FrontBadge,
  FrontButton,
  FrontCard,
  FrontCodeBlock,
  FrontCopyButton,
  FrontDataTable,
  FrontDialog,
  FrontEmptyState,
  FrontField,
  FrontIconButton,
  FrontPagination,
  useFrontConfirm,
  useFrontToast,
} from "./ui/front-ui";

export type ApiKey = {
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

type KeyFormState = {
  name: string;
  rateLimit: string;
  totalLimitUsd: string;
  concurrencyLimit: string;
  expiresAt: string;
  tags: string;
  ipWhitelist: string;
};

type KeyFormErrors = Partial<Record<keyof KeyFormState, string>>;

const emptyForm: KeyFormState = {
  name: "default",
  rateLimit: "60",
  totalLimitUsd: "",
  concurrencyLimit: "0",
  expiresAt: "",
  tags: "",
  ipWhitelist: "",
};

export function Keys({
  apiKeys,
  loading = false,
  onChanged,
}: {
  apiKeys: ApiKey[];
  loading?: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<KeyFormState>(emptyForm);
  const [createErrors, setCreateErrors] = useState<KeyFormErrors>({});
  const [creating, setCreating] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [editForm, setEditForm] = useState<KeyFormState>(emptyForm);
  const [editErrors, setEditErrors] = useState<KeyFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdKeyName, setCreatedKeyName] = useState("");
  const [configSecret, setConfigSecret] = useState<string | null>(null);
  const confirm = useFrontConfirm();
  const toast = useFrontToast();

  const filteredKeys = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return apiKeys.filter((key) => {
      const matchesStatus = status === "ALL" || key.status === status;
      const matchesSearch =
        !keyword ||
        key.name.toLowerCase().includes(keyword) ||
        key.keyPrefix.toLowerCase().includes(keyword);
      return matchesStatus && matchesSearch;
    });
  }, [apiKeys, search, status]);

  const pageCount = Math.max(1, Math.ceil(filteredKeys.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleKeys = filteredKeys.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search, status, pageSize]);

  const columns = useMemo<ColumnDef<ApiKey, unknown>[]>(
    () => [
      {
        id: "name",
        header: "名称与 Key 前缀",
        cell: ({ row }) => (
          <div className="front-key-identity">
            <strong title={row.original.name}>{row.original.name}</strong>
            <code>{maskKey(row.original.keyPrefix)}</code>
          </div>
        ),
      },
      {
        id: "status",
        header: "状态",
        cell: ({ row }) => keyStatusBadge(row.original.status),
      },
      {
        accessorKey: "rateLimitPerMinute",
        header: "每分钟限流",
        cell: ({ row }) => (
          <span className="front-data-number">{row.original.rateLimitPerMinute}/min</span>
        ),
      },
      {
        id: "quota",
        header: "总额度 / 已用 / 剩余",
        cell: ({ row }) => <QuotaCell apiKey={row.original} />,
      },
      {
        accessorKey: "concurrencyLimit",
        header: "并发限制",
        cell: ({ row }) => (
          <span className="front-data-number">
            {row.original.concurrencyLimit > 0 ? row.original.concurrencyLimit : "不限"}
          </span>
        ),
      },
      {
        id: "time",
        header: "过期 / 最近使用",
        cell: ({ row }) => (
          <div className="front-table-secondary-stack">
            <span>{row.original.expiresAt ? dateTime(row.original.expiresAt) : "永不过期"}</span>
            <span>{row.original.lastUsedAt ? dateTime(row.original.lastUsedAt) : "尚未使用"}</span>
          </div>
        ),
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <KeyActions
            apiKey={row.original}
            busy={busyKeyId === row.original.id}
            onConfigure={() => {
              if (row.original.keySecret) setConfigSecret(row.original.keySecret);
            }}
            onEdit={() => beginEdit(row.original)}
            onStatus={(nextStatus) => void updateStatus(row.original, nextStatus)}
            onDelete={() => void deleteKey(row.original)}
          />
        ),
      },
    ],
    [busyKeyId],
  );

  function beginEdit(apiKey: ApiKey) {
    setEditingKey(apiKey);
    setEditErrors({});
    setEditForm(formFromKey(apiKey));
  }

  async function refreshAfterMutation(successMessage: string) {
    try {
      await onChanged();
      toast(successMessage);
    } catch (error) {
      toast(
        `${successMessage}，但列表刷新失败：${errorToText(error)}`,
        "error",
      );
    }
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateKeyForm(createForm);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstKeyError("front-create-key-form", errors);
      return;
    }

    setCreating(true);
    try {
      const result = await apiFetch<{ apiKey: ApiKey; secret: string }>("/api-keys", {
        method: "POST",
        body: JSON.stringify(formPayload(createForm, [])),
      });
      setCreatedSecret(result.secret);
      setCreatedKeyName(result.apiKey.name);
      setCreateOpen(false);
      setCreateForm(emptyForm);
      await refreshAfterMutation("API Key 已创建");
    } catch (error) {
      toast(errorToText(error), "error");
    } finally {
      setCreating(false);
    }
  }

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingKey) return;
    const errors = validateKeyForm(editForm, {
      unchangedExpiresAt: localDateInput(editingKey.expiresAt),
    });
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstKeyError("front-edit-key-form", errors);
      return;
    }

    setSaving(true);
    try {
      await apiFetch(`/api-keys/${editingKey.id}`, {
        method: "PATCH",
        body: JSON.stringify(formPayload(editForm)),
      });
      setEditingKey(null);
      await refreshAfterMutation("API Key 配置已保存");
    } catch (error) {
      toast(errorToText(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(apiKey: ApiKey, nextStatus: "ACTIVE" | "DISABLED") {
    setBusyKeyId(apiKey.id);
    try {
      await apiFetch(`/api-keys/${apiKey.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      await refreshAfterMutation(
        nextStatus === "ACTIVE" ? "API Key 已启用" : "API Key 已停用",
      );
    } catch (error) {
      toast(errorToText(error), "error");
    } finally {
      setBusyKeyId(null);
    }
  }

  async function deleteKey(apiKey: ApiKey) {
    const accepted = await confirm({
      title: "删除 API Key",
      description: `确定删除「${apiKey.name}」吗？删除后密钥将立即失效且无法恢复。`,
      confirmText: "删除 Key",
      danger: true,
    });
    if (!accepted) return;

    setBusyKeyId(apiKey.id);
    try {
      await apiFetch(`/api-keys/${apiKey.id}`, { method: "DELETE" });
      await refreshAfterMutation("API Key 已删除");
    } catch (error) {
      toast(errorToText(error), "error");
    } finally {
      setBusyKeyId(null);
    }
  }

  return (
    <div className="front-page-stack">
      <FrontCard>
        <div className="front-key-toolbar">
          <div className="front-key-toolbar-copy">
            <h2 className="front-section-title">API Key 列表</h2>
            <p className="front-section-subtitle">
              默认只展示密钥前缀，完整 Secret 仅在创建成功和配置向导中出现。
            </p>
          </div>
          <div className="front-key-toolbar-controls">
            <label className="front-search-field">
              <Search aria-hidden="true" size={17} />
              <input
                className="front-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索名称或前缀"
                aria-label="搜索 API Key"
              />
            </label>
            <select
              className="front-select front-key-status-filter"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="按状态筛选 API Key"
            >
              <option value="ALL">全部状态</option>
              <option value="ACTIVE">启用</option>
              <option value="DISABLED">停用</option>
              <option value="REVOKED">已撤销</option>
            </select>
            <FrontBadge tone="neutral">
              {filteredKeys.length === apiKeys.length
                ? `共 ${apiKeys.length} 个`
                : `显示 ${filteredKeys.length} / ${apiKeys.length} 个`}
            </FrontBadge>
            <FrontButton onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" size={18} />
              创建 API Key
            </FrontButton>
          </div>
        </div>

        <FrontDataTable
          columns={columns}
          data={visibleKeys}
          getRowId={(row) => row.id}
          loading={loading}
          empty={
            <FrontEmptyState
              icon={<KeyRound aria-hidden="true" size={24} />}
              title={apiKeys.length === 0 ? "还没有 API Key" : "没有匹配的 API Key"}
              description={
                apiKeys.length === 0
                  ? "创建第一枚密钥后，即可接入 APIshare 网关。"
                  : "调整搜索内容或状态筛选后重试。"
              }
              action={
                apiKeys.length === 0 ? (
                  <FrontButton onClick={() => setCreateOpen(true)}>
                    <Plus aria-hidden="true" size={18} />
                    创建 API Key
                  </FrontButton>
                ) : undefined
              }
            />
          }
          mobileRow={(apiKey) => (
            <ApiKeyMobileCard
              apiKey={apiKey}
              busy={busyKeyId === apiKey.id}
              onConfigure={() => {
                if (apiKey.keySecret) setConfigSecret(apiKey.keySecret);
              }}
              onEdit={() => beginEdit(apiKey)}
              onStatus={(nextStatus) => void updateStatus(apiKey, nextStatus)}
              onDelete={() => void deleteKey(apiKey)}
            />
          )}
          className="front-key-data-table"
        />

        <FrontPagination
          currentPage={activePage}
          totalPages={pageCount}
          totalLabel={`共 ${filteredKeys.length} 个 Key`}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
        />
      </FrontCard>

      <FrontDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateErrors({});
            setCreateForm(emptyForm);
          }
        }}
        title="创建 API Key"
        description="先完成基础设置；并发、过期、标签和 IP 白名单可在高级设置中配置。"
        wide
        footer={
          <>
            <FrontButton variant="secondary" onClick={() => setCreateOpen(false)}>
              取消
            </FrontButton>
            <FrontButton loading={creating} form="front-create-key-form" type="submit">
              {creating ? "创建中" : "创建 API Key"}
            </FrontButton>
          </>
        }
      >
        <KeyForm
          id="front-create-key-form"
          value={createForm}
          errors={createErrors}
          disabled={creating}
          onChange={setCreateForm}
          onSubmit={createKey}
        />
      </FrontDialog>

      <FrontDialog
        open={Boolean(editingKey)}
        onOpenChange={(open) => {
          if (!open) setEditingKey(null);
        }}
        title="编辑 API Key"
        description={
          editingKey ? `${editingKey.name} · ${maskKey(editingKey.keyPrefix)}` : undefined
        }
        wide
        footer={
          <>
            <FrontButton variant="secondary" onClick={() => setEditingKey(null)}>
              取消
            </FrontButton>
            <FrontButton loading={saving} form="front-edit-key-form" type="submit">
              {saving ? "保存中" : "保存配置"}
            </FrontButton>
          </>
        }
      >
        {editingKey ? (
          <div className="front-key-edit-summary">
            <div>
              <span>Key 前缀</span>
              <code>{maskKey(editingKey.keyPrefix)}</code>
            </div>
            {keyStatusBadge(editingKey.status)}
          </div>
        ) : null}
        {editingKey?.disabledReason ? (
          <FrontAlert tone="warning" title="当前停用原因">
            {editingKey.disabledReason}
          </FrontAlert>
        ) : null}
        <KeyForm
          id="front-edit-key-form"
          value={editForm}
          errors={editErrors}
          disabled={saving}
          onChange={setEditForm}
          onSubmit={saveKey}
        />
      </FrontDialog>

      <FrontDialog
        open={Boolean(createdSecret)}
        onOpenChange={(open) => {
          if (!open) setCreatedSecret(null);
        }}
        title="API Key 创建成功"
        description={`「${createdKeyName}」的 Secret 只应保存在可信环境中。`}
        footer={
          <>
            <FrontButton variant="secondary" onClick={() => setCreatedSecret(null)}>
              关闭
            </FrontButton>
            <FrontButton
              onClick={() => {
                setConfigSecret(createdSecret);
                setCreatedSecret(null);
              }}
            >
              <Settings2 aria-hidden="true" size={18} />
              进入配置向导
            </FrontButton>
          </>
        }
      >
        {createdSecret ? (
          <div className="front-key-success">
            <FrontAlert tone="warning" title="请立即妥善保存">
              不要把 Secret 提交到代码仓库、截图或发送到公开聊天中。
            </FrontAlert>
            <div className="front-secret-display">
              <code>{createdSecret}</code>
              <FrontCopyButton value={createdSecret} label="复制 Key" />
            </div>
          </div>
        ) : null}
      </FrontDialog>

      <ApiKeyConfigDialog
        secret={configSecret}
        onOpenChange={(open) => {
          if (!open) setConfigSecret(null);
        }}
      />
    </div>
  );
}

function KeyForm({
  id,
  value,
  errors,
  disabled,
  onChange,
  onSubmit,
}: {
  id: string;
  value: KeyFormState;
  errors: KeyFormErrors;
  disabled: boolean;
  onChange: (value: KeyFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  function update(field: keyof KeyFormState, nextValue: string) {
    onChange({ ...value, [field]: nextValue });
  }

  return (
    <form className="front-key-form" id={id} onSubmit={onSubmit} noValidate>
      <div className="front-form-grid front-form-grid-3">
        <FrontField label="名称" htmlFor={`${id}-name`} required error={errors.name}>
          <input
            id={`${id}-name`}
            className="front-input"
            value={value.name}
            maxLength={80}
            disabled={disabled}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => update("name", event.target.value)}
            placeholder="例如 production"
          />
        </FrontField>
        <FrontField
          label="每分钟限流"
          htmlFor={`${id}-rate`}
          required
          error={errors.rateLimit}
          hint="范围 1–10000"
        >
          <input
            id={`${id}-rate`}
            className="front-input front-input-mono"
            type="number"
            min={1}
            max={10000}
            value={value.rateLimit}
            disabled={disabled}
            aria-invalid={Boolean(errors.rateLimit)}
            onChange={(event) => update("rateLimit", event.target.value)}
          />
        </FrontField>
        <FrontField
          label="总限额 USD"
          htmlFor={`${id}-limit`}
          error={errors.totalLimitUsd}
          hint="留空或 0 表示不限"
        >
          <input
            id={`${id}-limit`}
            className="front-input front-input-mono"
            type="number"
            min={0}
            step="0.00000001"
            value={value.totalLimitUsd}
            disabled={disabled}
            aria-invalid={Boolean(errors.totalLimitUsd)}
            onChange={(event) => update("totalLimitUsd", event.target.value)}
            placeholder="不限"
          />
        </FrontField>
      </div>

      <details className="front-advanced-details">
        <summary>
          <span>
            <ShieldCheck aria-hidden="true" size={18} />
            高级设置
          </span>
          <ChevronDown aria-hidden="true" size={18} />
        </summary>
        <div className="front-advanced-body">
          <div className="front-form-grid front-form-grid-2">
            <FrontField
              label="并发限制"
              htmlFor={`${id}-concurrency`}
              error={errors.concurrencyLimit}
              hint="0 表示不限"
            >
              <input
                id={`${id}-concurrency`}
                className="front-input front-input-mono"
                type="number"
                min={0}
                max={10000}
                value={value.concurrencyLimit}
                disabled={disabled}
                aria-invalid={Boolean(errors.concurrencyLimit)}
                onChange={(event) => update("concurrencyLimit", event.target.value)}
              />
            </FrontField>
            <FrontField
              label="过期时间"
              htmlFor={`${id}-expires`}
              error={errors.expiresAt}
              hint="留空表示永不过期"
            >
              <input
                id={`${id}-expires`}
                className="front-input"
                type="datetime-local"
                value={value.expiresAt}
                disabled={disabled}
                aria-invalid={Boolean(errors.expiresAt)}
                onChange={(event) => update("expiresAt", event.target.value)}
              />
            </FrontField>
          </div>
          <FrontField label="标签" htmlFor={`${id}-tags`} error={errors.tags} hint="使用逗号或空格分隔，最多 20 个">
            <input
              id={`${id}-tags`}
              className="front-input"
              value={value.tags}
              disabled={disabled}
              aria-invalid={Boolean(errors.tags)}
              onChange={(event) => update("tags", event.target.value)}
              placeholder="生产, 服务端"
            />
          </FrontField>
          <FrontField
            label="IP 白名单"
            htmlFor={`${id}-ips`}
            error={errors.ipWhitelist}
            hint="每行一个 IPv4、IPv6 或 CIDR；留空表示不限制来源 IP"
          >
            <textarea
              id={`${id}-ips`}
              className="front-textarea front-input-mono front-key-ip-textarea"
              value={value.ipWhitelist}
              disabled={disabled}
              aria-invalid={Boolean(errors.ipWhitelist)}
              onChange={(event) => update("ipWhitelist", event.target.value)}
              placeholder={"192.0.2.10\n10.0.0.0/24"}
            />
          </FrontField>
        </div>
      </details>
    </form>
  );
}

function KeyActions({
  apiKey,
  busy,
  onConfigure,
  onEdit,
  onStatus,
  onDelete,
}: {
  apiKey: ApiKey;
  busy: boolean;
  onConfigure: () => void;
  onEdit: () => void;
  onStatus: (status: "ACTIVE" | "DISABLED") => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const left = Math.min(
      window.innerWidth - menuRect.width - viewportPadding,
      Math.max(viewportPadding, triggerRect.right - menuRect.width),
    );
    const canOpenBelow =
      triggerRect.bottom + gap + menuRect.height <= window.innerHeight - viewportPadding;
    const top = canOpenBelow
      ? triggerRect.bottom + gap
      : Math.max(viewportPadding, triggerRect.top - menuRect.height - gap);
    setMenuPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    positionMenu();
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menuOpen, positionMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    const closeOnViewportChange = () => setMenuOpen(false);
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [menuOpen]);

  function runAction(action: () => void) {
    setMenuOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
      action();
    });
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + direction + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <div className="front-row-actions">
      <FrontButton
        variant="secondary"
        disabled={!apiKey.keySecret}
        onClick={onConfigure}
        title={apiKey.keySecret ? "打开配置向导" : "当前 Key 无法读取完整 Secret"}
      >
        <Settings2 aria-hidden="true" size={16} />
        配置
      </FrontButton>
      <FrontIconButton
        ref={triggerRef}
        label={`更多操作：${apiKey.name}`}
        tooltip="更多操作"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}
      >
        <MoreHorizontal aria-hidden="true" size={19} />
      </FrontIconButton>
      {menuOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="front-row-menu-popover"
              role="menu"
              aria-label={`API Key 操作：${apiKey.name}`}
              style={menuPosition}
              onKeyDown={handleMenuKeyDown}
            >
              <button role="menuitem" type="button" disabled={busy} onClick={() => runAction(onEdit)}>
                编辑
              </button>
              {apiKey.status === "ACTIVE" ? (
                <button role="menuitem" type="button" disabled={busy} onClick={() => runAction(() => onStatus("DISABLED"))}>
                  <CirclePause aria-hidden="true" size={16} /> 停用
                </button>
              ) : apiKey.status === "DISABLED" ? (
                <button role="menuitem" type="button" disabled={busy} onClick={() => runAction(() => onStatus("ACTIVE"))}>
                  <CirclePlay aria-hidden="true" size={16} /> 启用
                </button>
              ) : null}
              <button className="front-danger" role="menuitem" type="button" disabled={busy} onClick={() => runAction(onDelete)}>
                <Trash2 aria-hidden="true" size={16} /> 删除
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ApiKeyMobileCard(props: {
  apiKey: ApiKey;
  busy: boolean;
  onConfigure: () => void;
  onEdit: () => void;
  onStatus: (status: "ACTIVE" | "DISABLED") => void;
  onDelete: () => void;
}) {
  const { apiKey } = props;
  return (
    <FrontCard className="front-mobile-record front-key-mobile-card">
      <div className="front-mobile-record-head">
        <div>
          <strong>{apiKey.name}</strong>
          <code>{maskKey(apiKey.keyPrefix)}</code>
        </div>
        {keyStatusBadge(apiKey.status)}
      </div>
      <div className="front-mobile-record-grid">
        <MobileValue label="每分钟限流" value={`${apiKey.rateLimitPerMinute}/min`} />
        <MobileValue label="并发" value={apiKey.concurrencyLimit > 0 ? String(apiKey.concurrencyLimit) : "不限"} />
        <MobileValue label="额度" value={formatLimit(apiKey)} wide />
        <MobileValue label="过期" value={apiKey.expiresAt ? dateTime(apiKey.expiresAt) : "永不过期"} wide />
        <MobileValue label="最近使用" value={apiKey.lastUsedAt ? dateTime(apiKey.lastUsedAt) : "尚未使用"} wide />
      </div>
      <KeyActions {...props} />
    </FrontCard>
  );
}

function MobileValue({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`front-mobile-value${wide ? " front-mobile-value-wide" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function QuotaCell({ apiKey }: { apiKey: ApiKey }) {
  const limit = Number(apiKey.totalLimitUsd ?? apiKey.dailyLimitUsd ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return <span>不限</span>;
  }
  return (
    <div className="front-quota-cell front-data-number">
      <span>总 ${money(limit)}</span>
      <span>已用 ${money(apiKey.totalUsedUsd ?? "0")}</span>
      <strong>剩余 ${money(apiKey.totalRemainingUsd ?? Math.max(0, limit - Number(apiKey.totalUsedUsd ?? 0)))}</strong>
    </div>
  );
}

type ToolId = "codex" | "codex-ws" | "claude" | "opencode";

function ApiKeyConfigDialog({
  secret,
  onOpenChange,
}: {
  secret: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [tool, setTool] = useState<ToolId>("codex");
  const [os, setOs] = useState<"unix" | "windows">("unix");
  const templates = secret ? buildToolTemplates(tool, os, secret) : [];
  const tools: Array<{ id: ToolId; label: string; icon: ReactNode }> = [
    { id: "codex", label: "Codex CLI", icon: <Terminal aria-hidden="true" size={18} /> },
    { id: "codex-ws", label: "Codex WebSocket", icon: <ExternalLink aria-hidden="true" size={18} /> },
    { id: "claude", label: "Claude Code", icon: <Bot aria-hidden="true" size={18} /> },
    { id: "opencode", label: "OpenCode", icon: <Braces aria-hidden="true" size={18} /> },
  ];

  return (
    <FrontDialog
      open={Boolean(secret)}
      onOpenChange={onOpenChange}
      title="API Key 配置向导"
      description="选择工具与操作系统，复制对应配置文件或命令。"
      wide
      mobileFull
    >
      {secret ? (
        <div className="front-config-dialog">
          <FrontAlert tone="warning">
            下方配置包含完整 Secret。完成配置后请关闭弹窗，并避免录屏或公开分享。
          </FrontAlert>
          <div className="front-tool-tabs" role="tablist" aria-label="选择开发工具">
            {tools.map((item) => (
              <button
                className={tool === item.id ? "front-active" : ""}
                data-tool-tab={item.id}
                id={`front-tool-tab-${item.id}`}
                key={item.id}
                role="tab"
                aria-selected={tool === item.id}
                aria-controls="front-tool-config-panel"
                tabIndex={tool === item.id ? 0 : -1}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                    return;
                  }
                  event.preventDefault();
                  const currentIndex = tools.findIndex((item) => item.id === tool);
                  const nextIndex =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tools.length - 1
                        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tools.length) % tools.length;
                  const nextTool = tools[nextIndex];
                  if (!nextTool) return;
                  setTool(nextTool.id);
                  window.requestAnimationFrame(() => {
                    document
                      .querySelector<HTMLButtonElement>(`[data-tool-tab="${nextTool.id}"]`)
                      ?.focus();
                  });
                }}
                onClick={() => setTool(item.id)}
                type="button"
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
          <div
            aria-labelledby={`front-tool-tab-${tool}`}
            className="front-tool-panel"
            id="front-tool-config-panel"
            role="tabpanel"
          >
            {tool !== "opencode" ? (
              <div className="front-segmented" role="group" aria-label="选择操作系统">
                <button
                  aria-pressed={os === "unix"}
                  className={`front-segment-button${os === "unix" ? " front-active" : ""}`}
                  onClick={() => setOs("unix")}
                  type="button"
                >
                  macOS / Linux
                </button>
                <button
                  aria-pressed={os === "windows"}
                  className={`front-segment-button${os === "windows" ? " front-active" : ""}`}
                  onClick={() => setOs("windows")}
                  type="button"
                >
                  Windows
                </button>
              </div>
            ) : null}
            <div className="front-config-secret-row">
              <div>
                <span>当前 API Key</span>
                <code>{secret}</code>
              </div>
              <FrontCopyButton value={secret} label="复制 Key" />
            </div>
            <div className="front-config-blocks">
              {templates.map((template) => (
                <div key={template.label}>
                  <FrontCodeBlock label={template.label} value={template.value} />
                  <p>{template.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </FrontDialog>
  );
}

function buildToolTemplates(tool: ToolId, os: "unix" | "windows", secret: string) {
  const codexDir = os === "windows" ? "%USERPROFILE%\\.codex" : "~/.codex";
  const configPath = `${codexDir}${os === "windows" ? "\\" : "/"}config.toml`;
  const authPath = `${codexDir}${os === "windows" ? "\\" : "/"}auth.json`;
  if (tool === "codex" || tool === "codex-ws") {
    const provider = tool === "codex-ws" ? "apishare_websocket" : "apishare";
    const config = `model_provider = "${provider}"
model = "gpt-5.5"
disable_response_storage = true

[model_providers.${provider}]
name = "APIshare"
base_url = "${apiV1BaseUrl}"
wire_api = "responses"
requires_openai_auth = true${tool === "codex-ws" ? "\npreferred_transport = \"websocket\"" : ""}`;
    return [
      {
        label: configPath,
        value: config,
        description: tool === "codex-ws" ? "WebSocket 模式使用独立 provider，并优先选择 WebSocket 传输。" : "将该文件保存为 Codex CLI 主配置。",
      },
      {
        label: authPath,
        value: JSON.stringify({ OPENAI_API_KEY: secret }, null, 2),
        description: "认证文件仅应由当前系统用户读取。",
      },
    ];
  }

  if (tool === "claude") {
    const value =
      os === "windows"
        ? `$env:ANTHROPIC_BASE_URL="${apiBaseUrl}"\n$env:ANTHROPIC_AUTH_TOKEN="${secret}"`
        : `export ANTHROPIC_BASE_URL="${apiBaseUrl}"\nexport ANTHROPIC_AUTH_TOKEN="${secret}"`;
    return [
      {
        label: os === "windows" ? "PowerShell 环境变量" : "Shell 环境变量",
        value,
        description: "仅在当前终端会话中注入 APIshare 地址与令牌；如工具要求 Anthropic 原生协议，请先确认网关已启用对应兼容层。",
      },
    ];
  }

  return [
    {
      label: "opencode.json",
      value: JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          provider: {
            apishare: {
              npm: "@ai-sdk/openai-compatible",
              name: "APIshare",
              options: { baseURL: apiV1BaseUrl, apiKey: secret },
            },
          },
          model: "apishare/gpt-5.5",
        },
        null,
        2,
      ),
      description: "OpenCode 使用 OpenAI Compatible provider，并通过 APIshare Base URL 发起请求。",
    },
  ];
}

function validateKeyForm(
  form: KeyFormState,
  options: { unchangedExpiresAt?: string } = {},
): KeyFormErrors {
  const errors: KeyFormErrors = {};
  if (!form.name.trim()) errors.name = "请输入 Key 名称";
  if (form.name.trim().length > 80) errors.name = "名称不能超过 80 个字符";

  const rateLimit = Number(form.rateLimit);
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 10000) {
    errors.rateLimit = "请输入 1–10000 的整数";
  }
  if (form.totalLimitUsd.trim()) {
    const limit = Number(form.totalLimitUsd);
    if (!Number.isFinite(limit) || limit < 0) errors.totalLimitUsd = "总限额不能为负数";
  }
  const concurrency = Number(form.concurrencyLimit);
  if (!Number.isInteger(concurrency) || concurrency < 0 || concurrency > 10000) {
    errors.concurrencyLimit = "请输入 0–10000 的整数";
  }
  if (form.expiresAt) {
    const expires = new Date(form.expiresAt);
    if (Number.isNaN(expires.getTime())) errors.expiresAt = "请输入有效日期";
    else if (
      expires.getTime() <= Date.now() &&
      form.expiresAt !== options.unchangedExpiresAt
    ) {
      errors.expiresAt = "过期时间必须晚于当前时间";
    }
  }
  const tags = splitList(form.tags);
  if (tags.length > 20) errors.tags = "标签不能超过 20 个";
  else {
    const longTag = tags.find((tag) => tag.length > 40);
    if (longTag) errors.tags = `单个标签不能超过 40 个字符：${longTag}`;
  }
  const ipEntries = splitList(form.ipWhitelist);
  if (ipEntries.length > 100) {
    errors.ipWhitelist = "IP 白名单不能超过 100 条";
  } else {
    const invalidIp = ipEntries.find((entry) => !isIpOrCidr(entry));
    if (invalidIp) errors.ipWhitelist = `无法识别 IP 或 CIDR：${invalidIp}`;
  }
  return errors;
}

function formPayload(form: KeyFormState, allowedModels?: string[]) {
  return {
    name: form.name.trim(),
    rateLimitPerMinute: Number(form.rateLimit),
    totalLimitUsd: form.totalLimitUsd.trim() ? form.totalLimitUsd.trim() : null,
    concurrencyLimit: Number(form.concurrencyLimit),
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    ...(allowedModels ? { allowedModels } : {}),
    tags: splitList(form.tags),
    ipWhitelist: splitList(form.ipWhitelist),
  };
}

function formFromKey(apiKey: ApiKey): KeyFormState {
  return {
    name: apiKey.name,
    rateLimit: String(apiKey.rateLimitPerMinute),
    totalLimitUsd: positiveLimit(apiKey.totalLimitUsd ?? apiKey.dailyLimitUsd),
    concurrencyLimit: String(apiKey.concurrencyLimit ?? 0),
    expiresAt: localDateInput(apiKey.expiresAt),
    tags: (apiKey.tags ?? []).join(", "),
    ipWhitelist: (apiKey.ipWhitelist ?? []).join("\n"),
  };
}

function isIpOrCidr(value: string) {
  const parts = value.split("/");
  if (parts.length > 2) return false;
  const [address, prefix] = parts;
  if (!address || address.length > 128) return false;
  const ipv4 = isIpv4(address);
  const ipv6 = !ipv4 && isIpv6(address);
  if (!ipv4 && !ipv6) return false;
  if (prefix === undefined) return true;
  const numericPrefix = Number(prefix);
  return Number.isInteger(numericPrefix) && numericPrefix >= 0 && numericPrefix <= (ipv4 ? 32 : 128);
}

function isIpv4(value: string) {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^\d{1,3}$/.test(part) &&
        String(Number(part)) === part.replace(/^0+(?=\d)/, "") &&
        Number(part) >= 0 &&
        Number(part) <= 255,
    )
  );
}

function isIpv6(value: string) {
  if (!value.includes(":") || value.includes(":::")) return false;
  const compressionParts = value.split("::");
  if (compressionParts.length > 2) return false;

  let normalized = value;
  const lastColon = normalized.lastIndexOf(":");
  const ipv4Tail = normalized.slice(lastColon + 1);
  if (ipv4Tail.includes(".")) {
    if (!isIpv4(ipv4Tail)) return false;
    normalized = `${normalized.slice(0, lastColon + 1)}0:0`;
  }

  const [left = "", right = ""] = normalized.split("::");
  const leftGroups = left ? left.split(":") : [];
  const rightGroups = right ? right.split(":") : [];
  const validGroups = [...leftGroups, ...rightGroups].every((group) =>
    /^[0-9a-f]{1,4}$/i.test(group),
  );
  if (!validGroups) return false;

  const groupCount = leftGroups.length + rightGroups.length;
  return normalized.includes("::") ? groupCount < 8 : groupCount === 8;
}

function keyStatusBadge(status: string) {
  if (status === "ACTIVE") return <FrontBadge tone="success">启用</FrontBadge>;
  if (status === "DISABLED") return <FrontBadge tone="warning">停用</FrontBadge>;
  if (status === "REVOKED") return <FrontBadge tone="danger">已撤销</FrontBadge>;
  return <FrontBadge tone="neutral">{status}</FrontBadge>;
}

function formatLimit(apiKey: ApiKey) {
  const limit = Number(apiKey.totalLimitUsd ?? apiKey.dailyLimitUsd ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return "不限";
  return `剩余 $${money(apiKey.totalRemainingUsd ?? 0)} / 总 $${money(limit)}`;
}

function positiveLimit(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? String(value) : "";
}

function localDateInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function maskKey(prefix: string) {
  return `${prefix}${"•".repeat(10)}`;
}

function focusFirstKeyError(formId: string, errors: KeyFormErrors) {
  const field = (Object.keys(errors) as Array<keyof KeyFormState>)[0];
  if (!field) return;
  const suffix: Record<keyof KeyFormState, string> = {
    name: "name",
    rateLimit: "rate",
    totalLimitUsd: "limit",
    concurrencyLimit: "concurrency",
    expiresAt: "expires",
    tags: "tags",
    ipWhitelist: "ips",
  };
  window.requestAnimationFrame(() => {
    document.getElementById(`${formId}-${suffix[field]}`)?.focus();
  });
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
