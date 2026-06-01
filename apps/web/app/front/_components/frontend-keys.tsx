"use client";

import { Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { apiBaseUrl, apiFetch } from "../../../lib/api";
import { confirmAdminAction } from "../../admin/_components/admin-confirm";
import { dateTime, money, splitList } from "../../admin/_components/admin-format";
import { AdminDataTable, MobileEmpty, MobileField, MobileRecord, ModalShell, StatusPill } from "../../admin/_components/admin-ui";
import { Pagination } from "./Pagination";

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

function errorToText(error: unknown) { return error instanceof Error ? error.message : "未知错误"; }
function limitValue(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return String(value);
}
function normalizeOptionalNumberText(value: string) { const trimmed = value.trim(); return trimmed ? trimmed : null; }
function normalizeOptionalDateInput(value: string) { const trimmed = value.trim(); return trimmed ? new Date(trimmed).toISOString() : null; }
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
function formatConcurrencyLimit(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  return !Number.isFinite(numeric) || numeric <= 0 ? "不限" : `${numeric}`;
}

export function Keys({
  apiKeys,
  onChanged,
  onError,
}: {
  apiKeys: ApiKey[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("default");
  const [rateLimit, setRateLimit] = useState(60);
  const [totalLimitUsd, setTotalLimitUsd] = useState("");
  const [concurrencyLimit, setConcurrencyLimit] = useState(0);
  const [expiresAt, setExpiresAt] = useState("");
  const [tags, setTags] = useState("");
  const [ipWhitelist, setIpWhitelist] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [configKey, setConfigKey] = useState<ApiKey | null>(null);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [editName, setEditName] = useState("");
  const [editRateLimit, setEditRateLimit] = useState(60);
  const [editTotalLimitUsd, setEditTotalLimitUsd] = useState("");
  const [editConcurrencyLimit, setEditConcurrencyLimit] = useState(0);
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editIpWhitelist, setEditIpWhitelist] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(apiKeys.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleApiKeys = apiKeys.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [apiKeys, pageSize]);

  function resetCreateForm() {
    setName("default");
    setRateLimit(60);
    setTotalLimitUsd("");
    setConcurrencyLimit(0);
    setExpiresAt("");
    setTags("");
    setIpWhitelist("");
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    try {
      const result = await apiFetch<{ apiKey: ApiKey; secret: string }>(
        "/api-keys",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            rateLimitPerMinute: Number(rateLimit),
            totalLimitUsd: normalizeOptionalNumberText(totalLimitUsd),
            concurrencyLimit: Number(concurrencyLimit),
            expiresAt: normalizeOptionalDateInput(expiresAt),
            allowedModels: [],
            tags: splitList(tags),
            ipWhitelist: splitList(ipWhitelist),
          }),
        },
      );
      const createdKey = {
        ...result.apiKey,
        keySecret: result.apiKey.keySecret ?? result.secret,
      };
      setSecret(result.secret);
      setConfigKey(createdKey);
      setCreateOpen(false);
      resetCreateForm();
      onChanged();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  function beginEditKey(key: ApiKey) {
    setEditingKey(key);
    setEditName(key.name);
    setEditRateLimit(key.rateLimitPerMinute);
    setEditTotalLimitUsd(limitValue(key.totalLimitUsd ?? key.dailyLimitUsd));
    setEditConcurrencyLimit(key.concurrencyLimit ?? 0);
    setEditExpiresAt(dateInputValue(key.expiresAt));
    setEditTags((key.tags ?? []).join(", "));
    setEditIpWhitelist((key.ipWhitelist ?? []).join("\n"));
  }
  const apiKeyRows = visibleApiKeys.map((key) => ({
    id: key.id,
    name: key.name,
    secret: (
      <code className="inline-secret">{key.keySecret ?? key.keyPrefix}</code>
    ),
    status: <StatusPill status={key.status} />,
    rateLimit: `${key.rateLimitPerMinute}/min`,
    quota: formatApiKeyLimitSummary(key),
    concurrency: formatConcurrencyLimit(key.concurrencyLimit),
    expiresAt: key.expiresAt ? dateTime(key.expiresAt) : "永不过期",
    createdAt: dateTime(key.createdAt),
    tags: (key.tags ?? []).length > 0 ? (key.tags ?? []).join(", ") : "-",
    actions: (
      <div className="button-row compact">
        <button
          className="button secondary"
          disabled={!key.keySecret}
          onClick={() => setConfigKey(key)}
          type="button"
        >
          使用 / 配置
        </button>
        <button
          className="button secondary"
          disabled={busyKeyId === key.id}
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
        ) : null}
        {key.status === "DISABLED" ? (
          <button
            className="button"
            disabled={busyKeyId === key.id}
            onClick={() => updateKeyStatus(key, "ACTIVE")}
            type="button"
          >
            启用
          </button>
        ) : null}
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

  async function saveEditingKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingKey) {
      return;
    }

    onError(null);
    setBusyKeyId(editingKey.id);
    try {
      await apiFetch(`/api-keys/${editingKey.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName,
          rateLimitPerMinute: Number(editRateLimit),
          totalLimitUsd: normalizeOptionalNumberText(editTotalLimitUsd),
          concurrencyLimit: Number(editConcurrencyLimit),
          expiresAt: normalizeOptionalDateInput(editExpiresAt),
          tags: splitList(editTags),
          ipWhitelist: splitList(editIpWhitelist),
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
      await apiFetch(`/api-keys/${key.id}`, {
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

  async function deleteKey(key: ApiKey) {
    const confirmed = await confirmAdminAction({
      title: "删除 API Key",
      description: `确定删除 API Key「${key.name}」吗？删除后将无法继续使用。`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    onError(null);
    setBusyKeyId(key.id);
    try {
      await apiFetch(`/api-keys/${key.id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyKeyId(null);
    }
  }

  return (
    <>
      <div className="user-key-workbench user-key-workbench-single">
        <section className="card wide-card user-key-list-card user-key-list-card-paged">
          <div className="section-head">
            <div>
              <h2 className="section-title">API Key 列表</h2>
              <p className="section-subtitle">查看密钥状态、限额、过期时间和操作入口。</p>
            </div>
            <div className="button-row compact">
              <span className="pill strong">{apiKeys.length} keys</span>
              <button
                className="button"
                onClick={() => setCreateOpen(true)}
                type="button"
              >
                <Plus size={17} />
                创建 API Key
              </button>
            </div>
          </div>
          <AdminDataTable
            columns={[
              { accessorKey: "name", header: "名称" },
              { accessorKey: "secret", header: "API Key" },
              { accessorKey: "status", header: "状态" },
              { accessorKey: "rateLimit", header: "限流" },
              { accessorKey: "quota", header: "限额" },
              { accessorKey: "concurrency", header: "并发" },
              { accessorKey: "expiresAt", header: "过期" },
              { accessorKey: "createdAt", header: "创建时间" },
              { accessorKey: "tags", header: "标签" },
              { accessorKey: "actions", header: "操作" },
            ]}
            data={apiKeyRows}
            empty="暂无 API Key"
          />
          <div className="mobile-record-list">
            {visibleApiKeys.map((key) => (
              <MobileRecord
                key={key.id}
                title={key.name}
                meta={dateTime(key.createdAt)}
                badges={<StatusPill status={key.status} />}
                actions={
                  <>
                    <button
                      className="button secondary"
                      disabled={!key.keySecret}
                      onClick={() => setConfigKey(key)}
                      type="button"
                    >
                      使用 / 配置
                    </button>
                    <button
                      className="button secondary"
                      disabled={busyKeyId === key.id}
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
                    ) : null}
                    {key.status === "DISABLED" ? (
                      <button
                        className="button"
                        disabled={busyKeyId === key.id}
                        onClick={() => updateKeyStatus(key, "ACTIVE")}
                        type="button"
                      >
                        启用
                      </button>
                    ) : null}
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
                <MobileField label="API Key" wide>
                  <code className="inline-secret">
                    {key.keySecret ?? key.keyPrefix}
                  </code>
                </MobileField>
                <MobileField label="限流">
                  {key.rateLimitPerMinute}/min
                </MobileField>
                <MobileField label="限额" wide>
                  {formatApiKeyLimitSummary(key)}
                </MobileField>
                <MobileField label="并发">
                  {formatConcurrencyLimit(key.concurrencyLimit)}
                </MobileField>
                <MobileField label="过期">
                  {key.expiresAt ? dateTime(key.expiresAt) : "永不过期"}
                </MobileField>
                <MobileField label="创建时间">
                  {dateTime(key.createdAt)}
                </MobileField>
                <MobileField label="标签" wide>
                  {(key.tags ?? []).join(", ") || "-"}
                </MobileField>
                <MobileField label="IP 白名单" wide>
                  {(key.ipWhitelist ?? []).join(", ") || "-"}
                </MobileField>
              </MobileRecord>
            ))}
            {visibleApiKeys.length === 0 ? (
              <MobileEmpty>暂无 API Key</MobileEmpty>
            ) : null}
          </div>
          <Pagination
            className="front-requests-pagination"
            currentPage={activePage}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            pageSize={pageSize}
            totalPages={pageCount}
          />
        </section>
      </div>
      {configKey?.keySecret ? (
        <ApiKeyConfigModal
          apiKey={configKey.keySecret}
          onClose={() => setConfigKey(null)}
        />
      ) : null}
      {createOpen ? (
        <ModalShell
          title="创建 API Key"
          description="创建新的调用密钥，可设置限流、限额、过期时间和 IP 白名单。"
          onClose={() => {
            setCreateOpen(false);
            resetCreateForm();
          }}
          wide
        >
          <form className="form" onSubmit={createKey}>
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
                <span>标签</span>
                <input
                  className="input"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="个人, 测试"
                />
              </label>
              <label className="field">
                <span>IP 白名单</span>
                <textarea
                  className="input textarea compact-textarea"
                  value={ipWhitelist}
                  onChange={(event) => setIpWhitelist(event.target.value)}
                  placeholder="每行一个 IP 或 IPv4 CIDR，留空不限制"
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => {
                  setCreateOpen(false);
                  resetCreateForm();
                }}
                type="button"
              >
                取消
              </button>
              <button className="button" type="submit">
                <Plus size={17} />
                创建
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
      {editingKey ? (
        <ModalShell
          title="编辑 API Key"
          description={editingKey.keyPrefix}
          onClose={() => setEditingKey(null)}
          wide
        >
          <form className="form" onSubmit={saveEditingKey}>
            <div className="modal-body">
              <label className="field">
                <span>名称</span>
                <input
                  className="input"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                />
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
              <label className="field">
                <span>总限额 USD</span>
                <input
                  className="input"
                  value={editTotalLimitUsd}
                  min={0}
                  onChange={(event) => setEditTotalLimitUsd(event.target.value)}
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
                <span>过期时间</span>
                <input
                  className="input"
                  value={editExpiresAt}
                  onChange={(event) => setEditExpiresAt(event.target.value)}
                  type="datetime-local"
                />
              </label>
              <label className="field">
                <span>标签</span>
                <input
                  className="input"
                  value={editTags}
                  onChange={(event) => setEditTags(event.target.value)}
                  placeholder="个人, 测试, 客户A"
                />
              </label>
              <label className="field">
                <span>IP 白名单</span>
                <textarea
                  className="input textarea compact-textarea"
                  value={editIpWhitelist}
                  onChange={(event) => setEditIpWhitelist(event.target.value)}
                  placeholder="每行一个 IP 或 IPv4 CIDR，留空不限制"
                />
              </label>
              {editingKey.disabledReason ? (
                <div className="notice-inline">
                  停用原因：{editingKey.disabledReason}
                </div>
              ) : null}
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
                保存
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}

function ApiKeyConfigModal({
  apiKey,
  onClose,
}: {
  apiKey: string;
  onClose: () => void;
}) {
  const [tool, setTool] = useState("Codex CLI");
  const [os, setOs] = useState("macOS / Linux");
  const configPath =
    os === "Windows"
      ? "%USERPROFILE%\\.codex\\config.toml"
      : "~/.codex/config.toml";
  const authPath =
    os === "Windows"
      ? "%USERPROFILE%\\.codex\\auth.json"
      : "~/.codex/auth.json";
  const mkdirCommand =
    os === "Windows" ? "mkdir %USERPROFILE%\\.codex" : "mkdir -p ~/.codex";
  const config = codexConfigToml(tool);
  const auth = JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2);

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="config-modal"
        role="dialog"
        aria-modal="true"
        aria-label="使用 API 密钥"
      >
        <div className="modal-header">
          <div>
            <h2>使用 API 密钥</h2>
            <p>将以下配置文件添加到 Codex CLI 配置目录中。</p>
          </div>
          <button className="modal-close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="tab-row">
          {[
            "Codex CLI",
            "Codex CLI (WebSocket)",
            "Claude Code",
            "OpenCode",
          ].map((item) => (
            <button
              className={tool === item ? "tab active" : "tab"}
              key={item}
              onClick={() => setTool(item)}
              type="button"
            >
              ▻ {item}
            </button>
          ))}
        </div>
        <div className="tab-row os-tabs">
          {["macOS / Linux", "Windows"].map((item) => (
            <button
              className={os === item ? "tab active" : "tab"}
              key={item}
              onClick={() => setOs(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="config-tip">
          请确保以下内容位于 config.toml 文件的开头部分。
        </div>
        <ConfigBlock title={configPath} value={config} />
        <ConfigBlock title={authPath} value={auth} />
        <div className="info-box">
          请确保配置目录存在。{os} 用户可运行 <code>{mkdirCommand}</code>{" "}
          创建目录。
        </div>
      </div>
    </div>
  );
}

function ConfigBlock({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="config-block">
      <div className="config-block-title">
        <span>{title}</span>
        <button onClick={copy} type="button">
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

function codexConfigToml(tool: string) {
  const providerName =
    tool === "Codex CLI (WebSocket)" ? "codex_local_access" : "OpenAI";

  return `model_provider = "${providerName}"
model = "gpt-5.5"
review_model = "gpt-5.5"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"
windows_wsl_setup_acknowledged = true
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.OpenAI]
name = "OpenAI"
base_url = "${apiBaseUrl}"
wire_api = "responses"
requires_openai_auth = true

[model_providers.codex_local_access]
name = "OpenAI"
base_url = "${apiBaseUrl}"
wire_api = "responses"
	requires_openai_auth = true`;
}
