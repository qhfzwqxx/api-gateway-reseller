"use client";

import { RefreshCw, Save, Send, SlidersHorizontal } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { dateTime, splitList } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";
import {
  AdminDataTable,
  AdminPanel,
  Metric,
  ModalShell,
  StatusPill,
  StatusTile,
} from "../_components/admin-ui";

type IpBanMode = "error" | "notice";

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

type RedisFailurePolicySettings = {
  policy: "fail-open" | "fail-closed" | "degraded";
  degradedAdminBypassEnabled: boolean;
  degradedUserIds: string[];
  message: string;
};

type GlobalCircuitBreakerSettings = {
  enabled: boolean;
  allowAdmins: boolean;
  allowedUserIds: string[];
  message: string;
};

type ExternalAlertSettings = {
  enabled: boolean;
  webhookUrl: string;
  minSeverity: "info" | "warning" | "critical";
  intervalSeconds: number;
  mentionText: string;
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

type RiskCenter = {
  ipBanRules: IpBanRule[];
  temporaryIpNoticeBans: TemporaryIpNoticeBan[];
  temporaryIpNoticeBanSettings: TemporaryIpNoticeBanSettings;
  pendingAutoTerminateSettings: PendingAutoTerminateSettings;
  gatewayNoticeSettings: GatewayNoticeSettings;
  redisFailurePolicySettings: RedisFailurePolicySettings;
  globalCircuitBreakerSettings: GlobalCircuitBreakerSettings;
  externalAlertSettings: ExternalAlertSettings;
  charityAnnouncementSettings: CharityAnnouncementSettings;
  counters: {
    pendingRequests: number;
    failedRequests24h: number;
    noticeRequests24h: number;
    rateLimitedRequests24h: number;
  };
  checkedAt: string;
};

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失败，请稍后再试。";
}

export function AdminRiskCenter({
  onError,
}: {
  onError: (error: string | null) => void;
}) {
  const {
    data: riskCenter,
    error,
    isFetching,
    refetch,
  } = useAdminResource<RiskCenter>("riskCenter", "/admin/risk-center");

  useEffect(() => {
    onError(error ? errorToText(error) : null);
  }, [error, onError]);

  return (
    <AdminRiskCenterPanel
      riskCenter={riskCenter ?? null}
      onRefresh={() => void refetch()}
      refreshing={isFetching}
    />
  );
}

function AdminRiskCenterPanel({
  riskCenter,
  onRefresh,
  refreshing = false,
}: {
  riskCenter: RiskCenter | null;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const ipNoticeSettings = riskCenter?.temporaryIpNoticeBanSettings;
  const autoTerminateSettings = riskCenter?.pendingAutoTerminateSettings;
  const charitySettings = riskCenter?.charityAnnouncementSettings;
  const [redisDraft, setRedisDraft] =
    useState<RedisFailurePolicySettings | null>(
      riskCenter?.redisFailurePolicySettings ?? null,
    );
  const [circuitDraft, setCircuitDraft] =
    useState<GlobalCircuitBreakerSettings | null>(
      riskCenter?.globalCircuitBreakerSettings ?? null,
    );
  const [externalAlertDraft, setExternalAlertDraft] =
    useState<ExternalAlertSettings | null>(
      riskCenter?.externalAlertSettings ?? null,
    );
  const [redisBusy, setRedisBusy] = useState(false);
  const [circuitBusy, setCircuitBusy] = useState(false);
  const [externalAlertBusy, setExternalAlertBusy] = useState(false);
  const [redisSaved, setRedisSaved] = useState<string | null>(null);
  const [redisError, setRedisError] = useState<string | null>(null);
  const [circuitSaved, setCircuitSaved] = useState<string | null>(null);
  const [circuitError, setCircuitError] = useState<string | null>(null);
  const [externalAlertSaved, setExternalAlertSaved] = useState<string | null>(
    null,
  );
  const [externalAlertError, setExternalAlertError] = useState<string | null>(
    null,
  );
  const [riskModal, setRiskModal] = useState<
    "circuit" | "redis" | "external-alert" | "ip-policy" | null
  >(null);

  useEffect(() => {
    setRedisDraft(riskCenter?.redisFailurePolicySettings ?? null);
    setCircuitDraft(riskCenter?.globalCircuitBreakerSettings ?? null);
    setExternalAlertDraft(riskCenter?.externalAlertSettings ?? null);
  }, [
    riskCenter?.redisFailurePolicySettings,
    riskCenter?.globalCircuitBreakerSettings,
    riskCenter?.externalAlertSettings,
  ]);
  const ipPolicyRows = [
    ...(riskCenter?.ipBanRules ?? []).slice(0, 20).map((rule) => ({
      id: `ban:${rule.ip}`,
      type: "永久规则",
      ip: rule.ip,
      modeOrTtl: <StatusPill status={rule.mode.toUpperCase()} />,
      note: rule.reason || rule.message || "-",
    })),
    ...(riskCenter?.temporaryIpNoticeBans ?? []).slice(0, 20).map((ban) => ({
      id: `temporary:${ban.ip}`,
      type: "临时 notice",
      ip: ban.ip,
      modeOrTtl: `${ban.ttlSeconds}s`,
      note: ban.message,
    })),
  ];

  async function saveRedisFailurePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!redisDraft) return;
    setRedisBusy(true);
    setRedisSaved(null);
    setRedisError(null);
    try {
      const result = await apiFetch<{
        settings: RedisFailurePolicySettings;
      }>("/admin/redis-failure-policy-settings", {
        method: "PUT",
        body: JSON.stringify(redisDraft),
      });
      setRedisDraft(result.settings);
      setRedisSaved("Redis 失败策略已保存。");
      onRefresh();
    } catch (error) {
      setRedisError(errorToText(error));
    } finally {
      setRedisBusy(false);
    }
  }

  async function saveGlobalCircuitBreaker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!circuitDraft) return;
    setCircuitBusy(true);
    setCircuitSaved(null);
    setCircuitError(null);
    try {
      const result = await apiFetch<{
        settings: GlobalCircuitBreakerSettings;
      }>("/admin/global-circuit-breaker-settings", {
        method: "PUT",
        body: JSON.stringify(circuitDraft),
      });
      setCircuitDraft(result.settings);
      setCircuitSaved("全局熔断策略已保存。");
      onRefresh();
    } catch (error) {
      setCircuitError(errorToText(error));
    } finally {
      setCircuitBusy(false);
    }
  }

  async function saveExternalAlertSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!externalAlertDraft) return;
    setExternalAlertBusy(true);
    setExternalAlertSaved(null);
    setExternalAlertError(null);
    try {
      const result = await apiFetch<{
        settings: ExternalAlertSettings;
      }>("/admin/external-alert-settings", {
        method: "PUT",
        body: JSON.stringify(externalAlertDraft),
      });
      setExternalAlertDraft(result.settings);
      setExternalAlertSaved("外部告警设置已保存。");
      onRefresh();
    } catch (error) {
      setExternalAlertError(errorToText(error));
    } finally {
      setExternalAlertBusy(false);
    }
  }

  async function testExternalAlertSettings() {
    if (!externalAlertDraft) return;
    setExternalAlertBusy(true);
    setExternalAlertSaved(null);
    setExternalAlertError(null);
    try {
      const result = await apiFetch<{
        settings: ExternalAlertSettings;
      }>("/admin/external-alert-settings/test", {
        method: "POST",
        body: JSON.stringify(externalAlertDraft),
      });
      setExternalAlertDraft(result.settings);
      setExternalAlertSaved("测试告警已发送。");
      onRefresh();
    } catch (error) {
      setExternalAlertError(errorToText(error));
    } finally {
      setExternalAlertBusy(false);
    }
  }

  return (
    <div className="stack admin-risk-page">
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">运行态</h2>
            <p className="section-subtitle">
              更新于 {riskCenter ? dateTime(riskCenter.checkedAt) : "-"}
            </p>
          </div>
          <button
            className="button secondary"
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw size={17} />
            {refreshing ? "刷新中..." : "刷新"}
          </button>
        </div>
        <div className="metric-grid">
          <Metric
            label="实时 PENDING"
            value={String(riskCenter?.counters.pendingRequests ?? 0)}
          />
          <Metric
            label="24h 失败"
            value={String(riskCenter?.counters.failedRequests24h ?? 0)}
          />
          <Metric
            label="24h 公告返回"
            value={String(riskCenter?.counters.noticeRequests24h ?? 0)}
          />
          <Metric
            label="24h 限流失败"
            value={String(riskCenter?.counters.rateLimitedRequests24h ?? 0)}
          />
        </div>
      </section>

      <div className="admin-risk-workbench">
        <section className="card admin-risk-status-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">策略状态</h2>
              <p className="section-subtitle">
                集中巡检当前风险策略，具体文案和规则仍在公告返回、全站调用等页面维护。
              </p>
            </div>
          </div>
          <div className="status-grid">
            <StatusTile
              label="临时 IP Notice"
              ok={ipNoticeSettings?.enabled}
              value={
                ipNoticeSettings
                  ? `${ipNoticeSettings.threshold} 次 / ${ipNoticeSettings.windowSeconds}s`
                  : "-"
              }
            />
            <StatusTile
              label="Pending 自动终止"
              ok={autoTerminateSettings?.enabled}
              value={
                autoTerminateSettings
                  ? `${autoTerminateSettings.timeoutSeconds}s`
                  : "-"
              }
            />
            <StatusTile
              label="公益服务"
              ok={charitySettings?.serviceEnabled}
              value={charitySettings?.serviceEnabled ? "开放" : "暂停"}
            />
            <StatusTile
              label="Redis 失败策略"
              ok={
                riskCenter?.redisFailurePolicySettings.policy === "fail-open"
                  ? undefined
                  : true
              }
              value={riskCenter?.redisFailurePolicySettings.policy ?? "-"}
            />
            <StatusTile
              label="全局熔断"
              ok={
                riskCenter?.globalCircuitBreakerSettings.enabled
                  ? true
                  : undefined
              }
              value={
                riskCenter?.globalCircuitBreakerSettings.enabled
                  ? "已开启"
                  : "未开启"
              }
            />
            <StatusTile
              label="外部告警"
              ok={riskCenter?.externalAlertSettings.enabled ? true : undefined}
              value={
                riskCenter?.externalAlertSettings.enabled
                  ? `${riskCenter.externalAlertSettings.minSeverity}+ / ${riskCenter.externalAlertSettings.intervalSeconds}s`
                  : "未开启"
              }
            />
            <StatusTile
              label="永久 IP 规则"
              ok={(riskCenter?.ipBanRules.length ?? 0) === 0 ? undefined : true}
              value={`${riskCenter?.ipBanRules.length ?? 0} 条`}
            />
          </div>
        </section>

        <section className="card admin-risk-actions-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">运维策略</h2>
              <p className="section-subtitle">
                高风险配置统一收进弹窗，页面保留状态和入口。
              </p>
            </div>
          </div>
          <div className="admin-settings-stack">
            <section className="admin-action-card">
            <div>
              <strong>全局熔断</strong>
              <small>
                暂停普通用户调用，只允许管理员或白名单用户继续通过。
              </small>
            </div>
            <div className="admin-action-card-side">
              <span className={circuitDraft?.enabled ? "pill warn" : "pill ok"}>
                {circuitDraft?.enabled ? "已开启" : "未开启"}
              </span>
              <button
                className="button secondary compact"
                disabled={!circuitDraft}
                onClick={() => setRiskModal("circuit")}
                type="button"
              >
                <SlidersHorizontal size={16} />
                配置
              </button>
            </div>
            </section>

            <section className="admin-action-card">
            <div>
              <strong>Redis 异常策略</strong>
              <small>控制限流和并发依赖 Redis 失败时的网关行为。</small>
            </div>
            <div className="admin-action-card-side">
              <span
                className={
                  redisDraft?.policy === "fail-closed" ? "pill warn" : "pill"
                }
              >
                {redisDraft?.policy ?? "加载中"}
              </span>
              <button
                className="button secondary compact"
                disabled={!redisDraft}
                onClick={() => setRiskModal("redis")}
                type="button"
              >
                <SlidersHorizontal size={16} />
                配置
              </button>
            </div>
            </section>

            <section className="admin-action-card">
            <div>
              <strong>外部告警推送</strong>
              <small>通过 webhook 推送到企业微信、飞书或自建通知服务。</small>
            </div>
            <div className="admin-action-card-side">
              <span
                className={externalAlertDraft?.enabled ? "pill ok" : "pill"}
              >
                {externalAlertDraft?.enabled ? "已开启" : "未开启"}
              </span>
              <button
                className="button secondary compact"
                disabled={!externalAlertDraft}
                onClick={() => setRiskModal("external-alert")}
                type="button"
              >
                <SlidersHorizontal size={16} />
                配置
              </button>
            </div>
            </section>
          </div>
        </section>

        <AdminPanel
          className="admin-risk-ip-card"
          actions={
            <button
              className="button secondary compact"
              onClick={() => setRiskModal("ip-policy")}
              type="button"
            >
              查看明细
            </button>
          }
          description="永久封禁与临时 notice 封禁集中预览。"
          title="IP 策略"
        >
          <div className="admin-risk-ip-summary">
            <StatusTile
              label="永久规则"
              ok={(riskCenter?.ipBanRules.length ?? 0) > 0 ? true : undefined}
              value={`${riskCenter?.ipBanRules.length ?? 0} 条`}
            />
            <StatusTile
              label="临时 Notice"
              ok={
                (riskCenter?.temporaryIpNoticeBans.length ?? 0) > 0
                  ? true
                  : undefined
              }
              value={`${riskCenter?.temporaryIpNoticeBans.length ?? 0} 条`}
            />
          </div>
        </AdminPanel>
      </div>

      {riskModal === "ip-policy" ? (
        <ModalShell
          description="永久封禁与临时 notice 封禁集中预览。"
          onClose={() => setRiskModal(null)}
          title="IP 策略"
          wide
        >
          <div className="modal-body">
            <AdminDataTable
              columns={[
                { accessorKey: "type", header: "类型" },
                { accessorKey: "ip", header: "IP" },
                { accessorKey: "modeOrTtl", header: "模式 / TTL" },
                { accessorKey: "note", header: "说明" },
              ]}
              data={ipPolicyRows}
              empty="暂无 IP 策略"
            />
          </div>
        </ModalShell>
      ) : null}

      {riskModal === "circuit" ? (
        <ModalShell
          description="暂停普通用户调用，只允许管理员或白名单用户继续通过。"
          onClose={() => setRiskModal(null)}
          title="全局熔断"
          wide
        >
          {circuitDraft ? (
            <form className="form" onSubmit={saveGlobalCircuitBreaker}>
              <div className="modal-body">
                <div className="grid cols-2">
                  <label className="field checkbox-field">
                    <input
                      checked={circuitDraft.enabled}
                      onChange={(event) =>
                        setCircuitDraft({
                          ...circuitDraft,
                          enabled: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>开启全局熔断</span>
                  </label>
                  <label className="field checkbox-field">
                    <input
                      checked={circuitDraft.allowAdmins}
                      onChange={(event) =>
                        setCircuitDraft({
                          ...circuitDraft,
                          allowAdmins: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>允许管理员绕过</span>
                  </label>
                  <label className="field">
                    <span>用户白名单</span>
                    <textarea
                      className="input textarea compact-textarea"
                      onChange={(event) =>
                        setCircuitDraft({
                          ...circuitDraft,
                          allowedUserIds: splitList(event.target.value),
                        })
                      }
                      placeholder="每行或逗号分隔 userId"
                      value={circuitDraft.allowedUserIds.join("\n")}
                    />
                  </label>
                  <label className="field">
                    <span>熔断文案</span>
                    <textarea
                      className="input textarea compact-textarea"
                      maxLength={1000}
                      onChange={(event) =>
                        setCircuitDraft({
                          ...circuitDraft,
                          message: event.target.value,
                        })
                      }
                      value={circuitDraft.message}
                    />
                  </label>
                </div>
                {circuitSaved ? (
                  <div className="success compact-success">{circuitSaved}</div>
                ) : null}
                {circuitError ? (
                  <div className="error compact-error">{circuitError}</div>
                ) : null}
              </div>
              <div className="modal-footer">
                <button
                  className="button secondary"
                  onClick={() => setRiskModal(null)}
                  type="button"
                >
                  取消
                </button>
                <button className="button" disabled={circuitBusy} type="submit">
                  <Save size={17} />
                  {circuitBusy ? "保存中..." : "保存熔断策略"}
                </button>
              </div>
            </form>
          ) : (
            <div className="modal-body">
              <p className="muted">熔断策略加载中...</p>
            </div>
          )}
        </ModalShell>
      ) : null}

      {riskModal === "redis" ? (
        <ModalShell
          description="控制限流和并发依赖 Redis 失败时的网关行为。"
          onClose={() => setRiskModal(null)}
          title="Redis 异常策略"
          wide
        >
          {redisDraft ? (
            <form className="form" onSubmit={saveRedisFailurePolicy}>
              <div className="modal-body">
                <div className="grid cols-2">
                  <label className="field">
                    <span>策略</span>
                    <select
                      className="input"
                      onChange={(event) =>
                        setRedisDraft({
                          ...redisDraft,
                          policy: event.target
                            .value as RedisFailurePolicySettings["policy"],
                        })
                      }
                      value={redisDraft.policy}
                    >
                      <option value="fail-open">
                        fail-open：Redis 异常时放行
                      </option>
                      <option value="fail-closed">
                        fail-closed：Redis 异常时拒绝
                      </option>
                      <option value="degraded">
                        degraded：只允许管理员/白名单
                      </option>
                    </select>
                  </label>
                  <label className="field checkbox-field">
                    <input
                      checked={redisDraft.degradedAdminBypassEnabled}
                      onChange={(event) =>
                        setRedisDraft({
                          ...redisDraft,
                          degradedAdminBypassEnabled: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>degraded 时允许管理员账号调用</span>
                  </label>
                  <label className="field">
                    <span>degraded 用户白名单</span>
                    <textarea
                      className="input textarea compact-textarea"
                      onChange={(event) =>
                        setRedisDraft({
                          ...redisDraft,
                          degradedUserIds: event.target.value
                            .split(/\s|,|，/)
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="每行或逗号分隔 userId"
                      value={redisDraft.degradedUserIds.join("\n")}
                    />
                  </label>
                  <label className="field">
                    <span>拒绝文案</span>
                    <textarea
                      className="input textarea compact-textarea"
                      maxLength={1000}
                      onChange={(event) =>
                        setRedisDraft({
                          ...redisDraft,
                          message: event.target.value,
                        })
                      }
                      value={redisDraft.message}
                    />
                  </label>
                </div>
                {redisSaved ? (
                  <div className="success compact-success">{redisSaved}</div>
                ) : null}
                {redisError ? (
                  <div className="error compact-error">{redisError}</div>
                ) : null}
              </div>
              <div className="modal-footer">
                <button
                  className="button secondary"
                  onClick={() => setRiskModal(null)}
                  type="button"
                >
                  取消
                </button>
                <button className="button" disabled={redisBusy} type="submit">
                  <Save size={17} />
                  {redisBusy ? "保存中..." : "保存 Redis 策略"}
                </button>
              </div>
            </form>
          ) : (
            <div className="modal-body">
              <p className="muted">Redis 策略加载中...</p>
            </div>
          )}
        </ModalShell>
      ) : null}

      {riskModal === "external-alert" ? (
        <ModalShell
          description="将运维告警通过通用 webhook 推送到企业微信、飞书或自建通知服务。"
          onClose={() => setRiskModal(null)}
          title="外部告警推送"
          wide
        >
          {externalAlertDraft ? (
            <form className="form" onSubmit={saveExternalAlertSettings}>
              <div className="modal-body">
                <div className="grid cols-2">
                  <label className="field checkbox-field">
                    <input
                      checked={externalAlertDraft.enabled}
                      onChange={(event) =>
                        setExternalAlertDraft({
                          ...externalAlertDraft,
                          enabled: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>开启外部告警</span>
                  </label>
                  <label className="field">
                    <span>最低推送级别</span>
                    <select
                      className="input"
                      onChange={(event) =>
                        setExternalAlertDraft({
                          ...externalAlertDraft,
                          minSeverity: event.target
                            .value as ExternalAlertSettings["minSeverity"],
                        })
                      }
                      value={externalAlertDraft.minSeverity}
                    >
                      <option value="warning">warning 及以上</option>
                      <option value="critical">critical 仅严重告警</option>
                      <option value="info">info 全部状态</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Webhook URL</span>
                    <input
                      className="input"
                      maxLength={2000}
                      onChange={(event) =>
                        setExternalAlertDraft({
                          ...externalAlertDraft,
                          webhookUrl: event.target.value,
                        })
                      }
                      placeholder="https://..."
                      value={externalAlertDraft.webhookUrl}
                    />
                  </label>
                  <label className="field">
                    <span>推送间隔秒</span>
                    <input
                      className="input"
                      min={60}
                      max={86400}
                      onChange={(event) =>
                        setExternalAlertDraft({
                          ...externalAlertDraft,
                          intervalSeconds: Number(event.target.value) || 60,
                        })
                      }
                      type="number"
                      value={externalAlertDraft.intervalSeconds}
                    />
                  </label>
                  <label className="field">
                    <span>附加提醒文本</span>
                    <input
                      className="input"
                      maxLength={500}
                      onChange={(event) =>
                        setExternalAlertDraft({
                          ...externalAlertDraft,
                          mentionText: event.target.value,
                        })
                      }
                      placeholder="@all 或值班人"
                      value={externalAlertDraft.mentionText}
                    />
                  </label>
                </div>
                {externalAlertSaved ? (
                  <div className="success compact-success">
                    {externalAlertSaved}
                  </div>
                ) : null}
                {externalAlertError ? (
                  <div className="error compact-error">
                    {externalAlertError}
                  </div>
                ) : null}
              </div>
              <div className="modal-footer">
                <button
                  className="button secondary"
                  onClick={() => setRiskModal(null)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={externalAlertBusy}
                  type="submit"
                >
                  <Save size={17} />
                  {externalAlertBusy ? "保存中..." : "保存告警设置"}
                </button>
                <button
                  className="button secondary"
                  disabled={
                    externalAlertBusy || !externalAlertDraft.webhookUrl.trim()
                  }
                  onClick={testExternalAlertSettings}
                  type="button"
                >
                  <Send size={17} />
                  测试推送
                </button>
              </div>
            </form>
          ) : (
            <div className="modal-body">
              <p className="muted">外部告警设置加载中...</p>
            </div>
          )}
        </ModalShell>
      ) : null}

    </div>
  );
}
