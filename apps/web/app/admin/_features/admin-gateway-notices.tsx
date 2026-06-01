"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleStop, FileSearch, HeartHandshake, RefreshCw, Save, Shield } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { adminQueryKeys } from "../_components/admin-api";
import { formatDuration } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";

type IpBanMode = "error" | "notice";

const defaultIpBanMessage = "当前 IP 已被管理员限制访问。";

type IpBanRule = {
  ip: string;
  mode: IpBanMode;
  message: string;
  reason?: string | null;
  createdAt: string;
  updatedAt: string;
};

type TemporaryIpNoticeBan = {
  ip: string;
  message: string;
  ttlSeconds: number;
};

type TemporaryIpNoticeBanSettings = {
  enabled: boolean;
  threshold: number;
  windowSeconds: number;
  banSeconds: number;
  message: string;
  minBanSeconds?: number;
  maxBanSeconds?: number;
  minThreshold?: number;
  maxThreshold?: number;
  minWindowSeconds?: number;
  maxWindowSeconds?: number;
};

type PendingAutoTerminateSettings = {
  enabled: boolean;
  timeoutSeconds: number;
  message: string;
  minTimeoutSeconds?: number;
  maxTimeoutSeconds?: number;
};

type GatewayNoticeSettings = {
  userConcurrencyMessage: string;
  keyConcurrencyMessage: string;
  userRateLimitMessage: string;
  keyRateLimitMessage: string;
  charityIpRateLimitMessage: string;
  modelUnavailableMessage: string;
  missingUsageMessage: string;
  staleResponsesContextMessage: string;
  invalidEncryptedContentMessage: string;
  upstreamBalanceInsufficientMessage: string;
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

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失败，请稍后再试。";
}

export function AdminGatewayNotices({
  onError,
}: {
  onError: (error: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const gateway = useAdminResource<{ settings: GatewayNoticeSettings; defaults: GatewayNoticeSettings }>("gatewayNotices", "/admin/gateway-notice-settings");
  const charity = useAdminResource<{ settings: CharityAnnouncementSettings }>("charityAnnouncements", "/admin/charity-announcement-settings");
  const pending = useAdminResource<{ settings: PendingAutoTerminateSettings }>("pendingAutoTerminate", "/admin/pending-auto-terminate-settings");
  const ipRules = useAdminResource<{ rules: IpBanRule[] }>("requests", "/admin/ip-ban-rules");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.resource("gatewayNotices", "/admin/gateway-notice-settings") });
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.resource("charityAnnouncements", "/admin/charity-announcement-settings") });
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.resource("pendingAutoTerminate", "/admin/pending-auto-terminate-settings") });
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.resource("requests", "/admin/ip-ban-rules") });
  };

  const firstError = gateway.error ?? charity.error ?? pending.error ?? ipRules.error;
  useEffect(() => {
    onError(firstError ? errorToText(firstError) : null);
  }, [firstError, onError]);

  return (
    <AdminGatewayNoticesPanel
      gatewayNoticeSettings={gateway.data?.settings ?? null}
      gatewayNoticeDefaults={gateway.data?.defaults ?? null}
      charityAnnouncementSettings={charity.data?.settings ?? null}
      pendingAutoTerminateSettings={pending.data?.settings ?? null}
      ipBanRules={ipRules.data?.rules ?? []}
      onGatewayNoticeSettingsChanged={() => invalidate()}
      onCharityAnnouncementSettingsChanged={() => invalidate()}
      onPendingAutoTerminateSettingsChanged={() => invalidate()}
      onIpBanRulesChanged={() => invalidate()}
      onChanged={invalidate}
      onError={onError}
    />
  );
}

const gatewayNoticeFields: Array<{
  key: keyof GatewayNoticeSettings;
  label: string;
  hint: string;
}> = [
  { key: "userConcurrencyMessage", label: "用户并发限制", hint: "{limit}" },
  { key: "keyConcurrencyMessage", label: "Key 并发限制", hint: "{limit}" },
  {
    key: "userRateLimitMessage",
    label: "用户速率限制",
    hint: "{limit} {seconds}",
  },
  {
    key: "keyRateLimitMessage",
    label: "Key 速率限制",
    hint: "{limit} {seconds}",
  },
  {
    key: "charityIpRateLimitMessage",
    label: "公益单 IP 速率限制",
    hint: "{limit} {seconds}",
  },
  {
    key: "modelUnavailableMessage",
    label: "模型池不可用",
    hint: "模型池空、无可用渠道或未定价",
  },
  {
    key: "missingUsageMessage",
    label: "上游缺少计费用量",
    hint: "缺 usage 时返回",
  },
  {
    key: "staleResponsesContextMessage",
    label: "Responses 上下文失效",
    hint: "previous_response_id 不可用",
  },
  {
    key: "invalidEncryptedContentMessage",
    label: "加密上下文失效",
    hint: "encrypted content 不可用",
  },
  {
    key: "upstreamBalanceInsufficientMessage",
    label: "上游余额或额度不足",
    hint: "余额、额度、欠费或 quota exhausted",
  },
];

function AdminGatewayNoticesPanel({
  gatewayNoticeSettings,
  gatewayNoticeDefaults,
  charityAnnouncementSettings,
  pendingAutoTerminateSettings,
  ipBanRules,
  onGatewayNoticeSettingsChanged,
  onCharityAnnouncementSettingsChanged,
  onPendingAutoTerminateSettingsChanged,
  onIpBanRulesChanged,
  onChanged,
  onError,
}: {
  gatewayNoticeSettings: GatewayNoticeSettings | null;
  gatewayNoticeDefaults: GatewayNoticeSettings | null;
  charityAnnouncementSettings: CharityAnnouncementSettings | null;
  pendingAutoTerminateSettings: PendingAutoTerminateSettings | null;
  ipBanRules: IpBanRule[];
  onGatewayNoticeSettingsChanged: (settings: GatewayNoticeSettings) => void;
  onCharityAnnouncementSettingsChanged: (
    settings: CharityAnnouncementSettings,
  ) => void;
  onPendingAutoTerminateSettingsChanged: (
    settings: PendingAutoTerminateSettings,
  ) => void;
  onIpBanRulesChanged: (rules: IpBanRule[]) => void;
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [gatewayDraft, setGatewayDraft] =
    useState<GatewayNoticeSettings | null>(gatewayNoticeSettings);
  const [charityDraft, setCharityDraft] =
    useState<CharityAnnouncementSettings | null>(charityAnnouncementSettings);
  const [autoDraft, setAutoDraft] =
    useState<PendingAutoTerminateSettings | null>(pendingAutoTerminateSettings);
  const [tempSettings, setTempSettings] =
    useState<TemporaryIpNoticeBanSettings | null>(null);
  const [tempBans, setTempBans] = useState<TemporaryIpNoticeBan[]>([]);
  const [ipInput, setIpInput] = useState("");
  const [ipMode, setIpMode] = useState<IpBanMode>("notice");
  const [ipMessage, setIpMessage] = useState(defaultIpBanMessage);
  const [ipReason, setIpReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<
    "copy" | "charity" | "auto" | "ip"
  >("copy");
  const [activeGatewayField, setActiveGatewayField] =
    useState<keyof GatewayNoticeSettings>("userConcurrencyMessage");

  useEffect(
    () => setGatewayDraft(gatewayNoticeSettings),
    [gatewayNoticeSettings],
  );
  useEffect(
    () => setCharityDraft(charityAnnouncementSettings),
    [charityAnnouncementSettings],
  );
  useEffect(
    () => setAutoDraft(pendingAutoTerminateSettings),
    [pendingAutoTerminateSettings],
  );
  useEffect(() => {
    void loadTemporaryBans();
  }, []);

  async function loadTemporaryBans() {
    try {
      const result = await apiFetch<{
        bans: TemporaryIpNoticeBan[];
        settings: TemporaryIpNoticeBanSettings;
      }>("/admin/temporary-ip-notice-bans");
      setTempBans(result.bans);
      setTempSettings(result.settings);
    } catch (error) {
      setLocalError(errorToText(error));
    }
  }

  async function saveGateway(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gatewayDraft) return;
    setBusy("gateway");
    setLocalError(null);
    try {
      const result = await apiFetch<{
        settings: GatewayNoticeSettings;
        defaults: GatewayNoticeSettings;
      }>("/admin/gateway-notice-settings", {
        method: "PUT",
        body: JSON.stringify(gatewayDraft),
      });
      onGatewayNoticeSettingsChanged(result.settings);
      setSaved("网关公告文案已保存。");
    } catch (error) {
      setLocalError(errorToText(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveCharity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!charityDraft) return;
    setBusy("charity");
    setLocalError(null);
    try {
      const result = await apiFetch<{ settings: CharityAnnouncementSettings }>(
        "/admin/charity-announcement-settings",
        {
          method: "PUT",
          body: JSON.stringify(charityDraft),
        },
      );
      onCharityAnnouncementSettingsChanged(result.settings);
      setSaved("公益总开关和公益页公告已保存。");
      onChanged();
    } catch (error) {
      setLocalError(errorToText(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveAutoTerminate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!autoDraft) return;
    setBusy("auto");
    setLocalError(null);
    try {
      const result = await apiFetch<{ settings: PendingAutoTerminateSettings }>(
        "/admin/pending-auto-terminate-settings",
        {
          method: "PUT",
          body: JSON.stringify({
            enabled: autoDraft.enabled,
            timeoutSeconds: Number(autoDraft.timeoutSeconds),
            message: autoDraft.message,
          }),
        },
      );
      onPendingAutoTerminateSettingsChanged(result.settings);
      setSaved("自动终止设置已保存。");
    } catch (error) {
      setLocalError(errorToText(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveTemporarySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tempSettings) return;
    setBusy("temporary");
    setLocalError(null);
    try {
      const result = await apiFetch<{
        bans: TemporaryIpNoticeBan[];
        settings: TemporaryIpNoticeBanSettings;
      }>("/admin/temporary-ip-notice-bans/settings", {
        method: "PUT",
        body: JSON.stringify({
          enabled: tempSettings.enabled,
          threshold: Number(tempSettings.threshold),
          windowSeconds: Number(tempSettings.windowSeconds),
          banSeconds: Number(tempSettings.banSeconds),
          message: tempSettings.message,
        }),
      });
      setTempSettings(result.settings);
      setTempBans(result.bans);
      setSaved("自动公告封禁设置已保存。");
    } catch (error) {
      setLocalError(errorToText(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveIpRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ipInput.trim()) {
      setLocalError("请填写 IP。");
      return;
    }
    setBusy("ip");
    setLocalError(null);
    try {
      const result = await apiFetch<{ rules: IpBanRule[] }>(
        "/admin/ip-ban-rules",
        {
          method: "POST",
          body: JSON.stringify({
            ip: ipInput.trim(),
            mode: ipMode,
            message: ipMessage.trim() || defaultIpBanMessage,
            reason: ipReason.trim() || null,
          }),
        },
      );
      onIpBanRulesChanged(result.rules);
      setIpInput("");
      setIpReason("");
      setSaved("IP 封禁规则已保存。");
    } catch (error) {
      setLocalError(errorToText(error));
    } finally {
      setBusy(null);
    }
  }

  async function deleteIpRule(ip: string) {
    setBusy(`ip:${ip}`);
    setLocalError(null);
    try {
      const result = await apiFetch<{ rules: IpBanRule[] }>(
        `/admin/ip-ban-rules/${encodeURIComponent(ip)}`,
        { method: "DELETE" },
      );
      onIpBanRulesChanged(result.rules);
      setSaved("IP 已解封。");
    } catch (error) {
      setLocalError(errorToText(error));
    } finally {
      setBusy(null);
    }
  }

  async function deleteTemporaryBan(ip: string) {
    setBusy(`temp:${ip}`);
    setLocalError(null);
    try {
      const result = await apiFetch<{ bans: TemporaryIpNoticeBan[] }>(
        `/admin/temporary-ip-notice-bans/${encodeURIComponent(ip)}`,
        { method: "DELETE" },
      );
      setTempBans(result.bans);
      setSaved("自动封禁 IP 已解除。");
    } catch (error) {
      setLocalError(errorToText(error));
    } finally {
      setBusy(null);
    }
  }

  const pageError = localError;
  useEffect(() => {
    onError(pageError);
  }, [pageError, onError]);

  const panels = [
    {
      id: "copy" as const,
      label: "文案模板",
      description: `${gatewayNoticeFields.length} 个网关返回模板`,
      status: gatewayDraft ? "已加载" : "加载中",
      icon: FileSearch,
    },
    {
      id: "charity" as const,
      label: "公益策略",
      description: "公益总开关与页面弹窗",
      status: charityDraft?.serviceEnabled ? "可用" : "关闭",
      icon: HeartHandshake,
    },
    {
      id: "auto" as const,
      label: "自动封禁",
      description: "超时终止和临时 IP 封禁",
      status: tempSettings?.enabled
        ? `${tempSettings.threshold} 次触发`
        : "关闭",
      icon: CircleStop,
    },
    {
      id: "ip" as const,
      label: "手动封禁",
      description: "固定 IP 封禁规则",
      status: `${ipBanRules.length} 条`,
      icon: Shield,
    },
  ];

  return (
    <div className="admin-notice-console">
      <section className="notice-console-hero">
        <div>
          <span className="eyebrow">Gateway Notice Center</span>
          <h2>公告返回策略中心</h2>
          <p>
            把网关直接返回给用户的文案、限制策略和封禁规则集中维护，
            日常只需要切换左侧分类处理对应设置。
          </p>
        </div>
        <div className="notice-console-metrics">
          <div>
            <span>文案模板</span>
            <strong>{gatewayNoticeFields.length}</strong>
          </div>
          <div>
            <span>自动封禁 IP</span>
            <strong>{tempBans.length}</strong>
          </div>
          <div>
            <span>手动封禁 IP</span>
            <strong>{ipBanRules.length}</strong>
          </div>
        </div>
      </section>

      {saved ? <div className="success compact-success">{saved}</div> : null}
      {pageError ? (
        <div className="error compact-error">{pageError}</div>
      ) : null}

      <div className="notice-console-shell">
        <aside className="notice-console-nav">
          {panels.map((panel) => {
            const Icon = panel.icon;
            return (
              <button
                className={
                  activePanel === panel.id
                    ? "notice-console-nav-item active"
                    : "notice-console-nav-item"
                }
                key={panel.id}
                onClick={() => setActivePanel(panel.id)}
                type="button"
              >
                <Icon size={18} />
                <span>
                  <strong>{panel.label}</strong>
                  <small>{panel.description}</small>
                </span>
                <em>{panel.status}</em>
              </button>
            );
          })}
        </aside>

        <div className="notice-console-content">
          {activePanel === "copy" ? (
            <section className="card notice-console-panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title">网关统一返回文案</h2>
                  <p className="section-subtitle">
                    限流、并发、模型不可用、上下文恢复和缺少计费数据都会走这里。
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={!gatewayNoticeDefaults}
                  onClick={() =>
                    gatewayNoticeDefaults &&
                    setGatewayDraft(gatewayNoticeDefaults)
                  }
                  type="button"
                >
                  恢复默认
                </button>
              </div>
              {gatewayDraft ? (
                <form className="form" onSubmit={saveGateway}>
                  <div className="notice-field-editor">
                    <div className="notice-field-list">
                      {gatewayNoticeFields.map((field) => (
                        <button
                          className={
                            activeGatewayField === field.key
                              ? "notice-field-item active"
                              : "notice-field-item"
                          }
                          key={field.key}
                          onClick={() => setActiveGatewayField(field.key)}
                          type="button"
                        >
                          <strong>{field.label}</strong>
                          <span>{field.hint}</span>
                        </button>
                      ))}
                    </div>
                    <label className="field notice-field-current">
                      <span>
                        {
                          gatewayNoticeFields.find(
                            (field) => field.key === activeGatewayField,
                          )?.label
                        }
                      </span>
                      <textarea
                        className="input textarea"
                        maxLength={8000}
                        onChange={(event) =>
                          setGatewayDraft({
                            ...gatewayDraft,
                            [activeGatewayField]: event.target.value,
                          })
                        }
                        placeholder={
                          gatewayNoticeDefaults?.[activeGatewayField] ?? ""
                        }
                        value={gatewayDraft[activeGatewayField]}
                      />
                      <small className="muted">
                        {
                          gatewayNoticeFields.find(
                            (field) => field.key === activeGatewayField,
                          )?.hint
                        }
                      </small>
                    </label>
                  </div>
                  <div className="button-row">
                    <button
                      className="button"
                      disabled={busy === "gateway"}
                      type="submit"
                    >
                      <Save size={17} />
                      保存网关文案
                    </button>
                  </div>
                </form>
              ) : (
                <p className="muted">网关文案加载中...</p>
              )}
            </section>
          ) : null}

          {activePanel === "charity" ? (
            <section className="card notice-console-panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title">公益服务与公益页公告</h2>
                  <p className="section-subtitle">
                    总开关关闭后，公益 Key 调用直接返回这里的文案。
                  </p>
                </div>
                <span
                  className={
                    charityDraft?.serviceEnabled ? "pill ok" : "pill warn"
                  }
                >
                  {charityDraft?.serviceEnabled ? "服务可用" : "服务关闭"}
                </span>
              </div>
              {charityDraft ? (
                <details className="admin-collapsible-panel">
                  <summary>
                    <span>
                      <strong>编辑公益公告设置</strong>
                      <small>
                        {charityDraft.enabled ? "弹窗已开启" : "弹窗未开启"} ·{" "}
                        {charityDraft.frequency === "interval"
                          ? `${charityDraft.intervalHours} 小时`
                          : "每次打开"}
                      </small>
                    </span>
                    <em>展开</em>
                  </summary>
                  <form className="form" onSubmit={saveCharity}>
                    <div className="grid cols-2">
                      <label className="checkbox-row">
                        <input
                          checked={charityDraft.serviceEnabled}
                          onChange={(event) =>
                            setCharityDraft({
                              ...charityDraft,
                              serviceEnabled: event.target.checked,
                            })
                          }
                          type="checkbox"
                        />
                        <span>启用公益服务</span>
                      </label>
                      <label className="checkbox-row">
                        <input
                          checked={charityDraft.enabled}
                          onChange={(event) =>
                            setCharityDraft({
                              ...charityDraft,
                              enabled: event.target.checked,
                            })
                          }
                          type="checkbox"
                        />
                        <span>启用公益页弹窗</span>
                      </label>
                      <label className="field">
                        <span>关闭时返回文案</span>
                        <textarea
                          className="input textarea compact-textarea"
                          onChange={(event) =>
                            setCharityDraft({
                              ...charityDraft,
                              serviceDisabledMessage: event.target.value,
                            })
                          }
                          value={charityDraft.serviceDisabledMessage}
                        />
                      </label>
                      <label className="field">
                        <span>弹窗标题</span>
                        <input
                          className="input"
                          onChange={(event) =>
                            setCharityDraft({
                              ...charityDraft,
                              title: event.target.value,
                            })
                          }
                          value={charityDraft.title}
                        />
                      </label>
                      <label className="field">
                        <span>弹窗频率</span>
                        <select
                          className="input"
                          onChange={(event) =>
                            setCharityDraft({
                              ...charityDraft,
                              frequency:
                                event.target.value === "interval"
                                  ? "interval"
                                  : "every_visit",
                            })
                          }
                          value={charityDraft.frequency}
                        >
                          <option value="every_visit">每次打开</option>
                          <option value="interval">按间隔</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>间隔小时</span>
                        <input
                          className="input"
                          max={charityDraft.maxIntervalHours ?? 720}
                          min={charityDraft.minIntervalHours ?? 1}
                          onChange={(event) =>
                            setCharityDraft({
                              ...charityDraft,
                              intervalHours: Number(event.target.value),
                            })
                          }
                          type="number"
                          value={charityDraft.intervalHours}
                        />
                      </label>
                      <label className="field">
                        <span>弹窗内容</span>
                        <textarea
                          className="input textarea compact-textarea"
                          onChange={(event) =>
                            setCharityDraft({
                              ...charityDraft,
                              content: event.target.value,
                            })
                          }
                          value={charityDraft.content}
                        />
                      </label>
                    </div>
                    <div className="button-row">
                      <button
                        className="button"
                        disabled={busy === "charity"}
                        type="submit"
                      >
                        <Save size={17} />
                        保存公益设置
                      </button>
                    </div>
                  </form>
                </details>
              ) : (
                <p className="muted">公益设置加载中...</p>
              )}
            </section>
          ) : null}

          {activePanel === "auto" ? (
            <section className="card notice-console-panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title">自动终止与自动公告封禁</h2>
                  <p className="section-subtitle">
                    Pending 超时终止后，同一 IP 连续命中会临时公告封禁。
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => void loadTemporaryBans()}
                  type="button"
                >
                  <RefreshCw size={16} />
                  刷新
                </button>
              </div>
              <div className="grid cols-2">
                {autoDraft ? (
                  <form className="form" onSubmit={saveAutoTerminate}>
                    <label className="checkbox-row">
                      <input
                        checked={autoDraft.enabled}
                        onChange={(event) =>
                          setAutoDraft({
                            ...autoDraft,
                            enabled: event.target.checked,
                          })
                        }
                        type="checkbox"
                      />
                      <span>启用 Pending 自动终止</span>
                    </label>
                    <label className="field">
                      <span>超时秒数</span>
                      <input
                        className="input"
                        max={autoDraft.maxTimeoutSeconds ?? 3600}
                        min={autoDraft.minTimeoutSeconds ?? 5}
                        onChange={(event) =>
                          setAutoDraft({
                            ...autoDraft,
                            timeoutSeconds: Number(event.target.value),
                          })
                        }
                        type="number"
                        value={autoDraft.timeoutSeconds}
                      />
                    </label>
                    <label className="field">
                      <span>终止记录文案</span>
                      <input
                        className="input"
                        onChange={(event) =>
                          setAutoDraft({
                            ...autoDraft,
                            message: event.target.value,
                          })
                        }
                        value={autoDraft.message}
                      />
                    </label>
                    <button
                      className="button"
                      disabled={busy === "auto"}
                      type="submit"
                    >
                      <Save size={17} />
                      保存自动终止
                    </button>
                  </form>
                ) : null}
                {tempSettings ? (
                  <form className="form" onSubmit={saveTemporarySettings}>
                    <label className="checkbox-row">
                      <input
                        checked={tempSettings.enabled}
                        onChange={(event) =>
                          setTempSettings({
                            ...tempSettings,
                            enabled: event.target.checked,
                          })
                        }
                        type="checkbox"
                      />
                      <span>启用连续终止自动封禁</span>
                    </label>
                    <div className="grid cols-3">
                      <label className="field">
                        <span>连续次数</span>
                        <input
                          className="input"
                          max={tempSettings.maxThreshold ?? 20}
                          min={tempSettings.minThreshold ?? 2}
                          onChange={(event) =>
                            setTempSettings({
                              ...tempSettings,
                              threshold: Number(event.target.value),
                            })
                          }
                          type="number"
                          value={tempSettings.threshold}
                        />
                      </label>
                      <label className="field">
                        <span>统计窗口秒</span>
                        <input
                          className="input"
                          max={tempSettings.maxWindowSeconds ?? 86400}
                          min={tempSettings.minWindowSeconds ?? 60}
                          onChange={(event) =>
                            setTempSettings({
                              ...tempSettings,
                              windowSeconds: Number(event.target.value),
                            })
                          }
                          type="number"
                          value={tempSettings.windowSeconds}
                        />
                      </label>
                      <label className="field">
                        <span>封禁秒数</span>
                        <input
                          className="input"
                          max={tempSettings.maxBanSeconds ?? 3600}
                          min={tempSettings.minBanSeconds ?? 10}
                          onChange={(event) =>
                            setTempSettings({
                              ...tempSettings,
                              banSeconds: Number(event.target.value),
                            })
                          }
                          type="number"
                          value={tempSettings.banSeconds}
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span>自动封禁返回文案</span>
                      <textarea
                        className="input textarea compact-textarea"
                        onChange={(event) =>
                          setTempSettings({
                            ...tempSettings,
                            message: event.target.value,
                          })
                        }
                        value={tempSettings.message}
                      />
                    </label>
                    <button
                      className="button"
                      disabled={busy === "temporary"}
                      type="submit"
                    >
                      <Save size={17} />
                      保存自动封禁
                    </button>
                  </form>
                ) : null}
              </div>
              <div className="ip-ban-rule-list">
                <details className="admin-collapsible-panel">
                  <summary>
                    <span>
                      <strong>临时封禁 IP</strong>
                      <small>{tempBans.length} 条自动公告封禁记录</small>
                    </span>
                    <em>展开</em>
                  </summary>
                  {tempBans.map((ban) => (
                    <div className="ip-ban-rule" key={ban.ip}>
                      <div>
                        <strong>{ban.ip}</strong>
                        <p>
                          剩余 {formatDuration(ban.ttlSeconds)} · {ban.message}
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        disabled={busy === `temp:${ban.ip}`}
                        onClick={() => void deleteTemporaryBan(ban.ip)}
                        type="button"
                      >
                        解封
                      </button>
                    </div>
                  ))}
                  {tempBans.length === 0 ? (
                    <div className="empty-state compact">暂无自动封禁 IP</div>
                  ) : null}
                </details>
              </div>
            </section>
          ) : null}

          {activePanel === "ip" ? (
            <section className="card notice-console-panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title">手动 IP 封禁</h2>
                  <p className="section-subtitle">
                    支持普通错误返回，也支持文本接口以公告形式返回。
                  </p>
                </div>
                <span className="pill">{ipBanRules.length} 条</span>
              </div>
              <details className="admin-collapsible-panel">
                <summary>
                  <span>
                    <strong>新增或更新 IP 规则</strong>
                    <small>点击后填写 IP、返回方式和备注</small>
                  </span>
                  <em>展开</em>
                </summary>
                <form className="form" onSubmit={saveIpRule}>
                  <div className="grid cols-2">
                    <label className="field">
                      <span>IP</span>
                      <input
                        className="input"
                        onChange={(event) => setIpInput(event.target.value)}
                        placeholder="203.0.113.10"
                        value={ipInput}
                      />
                    </label>
                    <label className="field">
                      <span>返回方式</span>
                      <select
                        className="input"
                        onChange={(event) =>
                          setIpMode(event.target.value as IpBanMode)
                        }
                        value={ipMode}
                      >
                        <option value="notice">公告返回</option>
                        <option value="error">错误返回</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>返回文案</span>
                      <input
                        className="input"
                        onChange={(event) => setIpMessage(event.target.value)}
                        placeholder={defaultIpBanMessage}
                        value={ipMessage}
                      />
                    </label>
                    <label className="field">
                      <span>备注</span>
                      <input
                        className="input"
                        onChange={(event) => setIpReason(event.target.value)}
                        placeholder="可选"
                        value={ipReason}
                      />
                    </label>
                  </div>
                  <button
                    className="button"
                    disabled={busy === "ip"}
                    type="submit"
                  >
                    <Shield size={17} />
                    保存 IP 规则
                  </button>
                </form>
              </details>
              <div className="ip-ban-rule-list">
                <details className="admin-collapsible-panel">
                  <summary>
                    <span>
                      <strong>已封禁 IP 列表</strong>
                      <small>{ipBanRules.length} 条手动规则</small>
                    </span>
                    <em>展开</em>
                  </summary>
                  {ipBanRules.map((rule) => (
                    <div className="ip-ban-rule" key={rule.ip}>
                      <div>
                        <strong>{rule.ip}</strong>
                        <p>{rule.reason || rule.message}</p>
                      </div>
                      <span
                        className={
                          rule.mode === "notice" ? "pill ok" : "pill warn"
                        }
                      >
                        {rule.mode === "notice" ? "公告返回" : "错误返回"}
                      </span>
                      <button
                        className="button secondary"
                        disabled={busy === `ip:${rule.ip}`}
                        onClick={() => void deleteIpRule(rule.ip)}
                        type="button"
                      >
                        解封
                      </button>
                    </div>
                  ))}
                  {ipBanRules.length === 0 ? (
                    <div className="empty-state compact">暂无手动封禁 IP</div>
                  ) : null}
                </details>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
