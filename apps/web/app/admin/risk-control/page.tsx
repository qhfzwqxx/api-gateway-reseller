"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleStop, FileText, Flame, RadioTower, Save, ShieldAlert, TextSearch, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import { SettingCard } from "../../../components/shared/setting-card";
import {
  deleteIpBanRule,
  getRiskCenter,
  saveIpBanRule,
  updateGatewayNoticeSettings,
  updateGlobalCircuitBreakerSettings,
  updateIpBanRule,
  updatePendingAutoTerminateSettings,
  updateRedisFailurePolicySettings,
  updateTemporaryIpNoticeBanSettings,
  updateUpstreamOutputFilterSettings,
  type GatewayNoticeSettings,
  type GlobalCircuitBreakerSettings,
  type IpBanRule,
  type RedisFailurePolicySettings,
  type UpstreamOutputFilterSettings,
} from "../../../lib/api/settings";

const autoTerminateSchema = z.object({
  pendingEnabled: z.boolean(),
  pendingTimeoutSeconds: z.coerce.number().int().min(5).max(3600),
  pendingMessage: z.string().trim().min(1),
  ipBanEnabled: z.boolean(),
  ipBanThreshold: z.coerce.number().int().min(2).max(20),
  ipBanWindowSeconds: z.coerce.number().int().min(60).max(86400),
  ipBanSeconds: z.coerce.number().int().min(10).max(3600),
  ipBanMessage: z.string().trim().min(1),
});
const gatewaySchema = z.record(z.string(), z.string().trim().min(1));
const upstreamOutputFilterSchema = z.object({
  enabled: z.boolean(),
  phrasesText: z.string(),
});
const redisSchema = z.object({
  policy: z.enum(["fail-open", "fail-closed", "degraded"]),
  degradedAdminBypassEnabled: z.boolean(),
  degradedUserIdsText: z.string(),
  message: z.string().trim().min(1),
});
const circuitSchema = z.object({
  enabled: z.boolean(),
  allowAdmins: z.boolean(),
  allowedUserIdsText: z.string(),
  message: z.string().trim().min(1),
});
const ipBanRuleSchema = z.object({
  ip: z.string().trim().min(1, "请输入 IP"),
  mode: z.enum(["notice", "error"]),
  message: z.string().trim().optional(),
  reason: z.string().trim().optional(),
});

type AutoTerminateInput = z.input<typeof autoTerminateSchema>;
type AutoTerminateValues = z.output<typeof autoTerminateSchema>;
type GatewayValues = GatewayNoticeSettings;
type UpstreamOutputFilterInput = z.input<typeof upstreamOutputFilterSchema>;
type UpstreamOutputFilterValues = z.output<typeof upstreamOutputFilterSchema>;
type RedisInput = z.input<typeof redisSchema>;
type RedisValues = z.infer<typeof redisSchema>;
type CircuitInput = z.input<typeof circuitSchema>;
type CircuitValues = z.infer<typeof circuitSchema>;
type IpBanRuleInput = z.input<typeof ipBanRuleSchema>;
type IpBanRuleValues = z.output<typeof ipBanRuleSchema>;

const gatewayNoticeFields: Array<{
  key: keyof GatewayNoticeSettings;
  title: string;
  trigger: string;
  placeholders?: string;
}> = [
  {
    key: "userConcurrencyMessage",
    title: "用户并发限制",
    trigger: "当用户级并发数达到该用户的并发上限时返回。",
    placeholders: "{limit}=用户并发上限",
  },
  {
    key: "keyConcurrencyMessage",
    title: "API Key 并发限制",
    trigger: "当当前 API Key 的并发数达到该 Key 的并发上限时返回。",
    placeholders: "{limit}=Key 并发上限",
  },
  {
    key: "userRateLimitMessage",
    title: "用户每分钟速率限制",
    trigger: "当用户级每分钟请求数达到用户 RPM 上限时返回。",
    placeholders: "{limit}=用户 RPM；{seconds}=建议等待秒数",
  },
  {
    key: "keyRateLimitMessage",
    title: "API Key 每分钟速率限制",
    trigger: "当当前 API Key 每分钟请求数达到 Key RPM 上限时返回。",
    placeholders: "{limit}=Key RPM；{seconds}=建议等待秒数",
  },
  {
    key: "charityIpRateLimitMessage",
    title: "公益 IP 速率限制",
    trigger: "当公益模式开启 IP 维度限速，且客户端 IP 达到限制时返回。",
    placeholders: "{limit}=IP RPM；{seconds}=建议等待秒数",
  },
  {
    key: "modelUnavailableMessage",
    title: "模型不可用",
    trigger: "当路由不到可调用模型池/渠道，或目标模型当前不可用时返回。",
  },
  {
    key: "missingUsageMessage",
    title: "缺少 Usage 计费信息",
    trigger: "当上游响应缺少必要 usage 字段，网关无法完成计费时返回。",
  },
  {
    key: "staleResponsesContextMessage",
    title: "Responses 上下文过期",
    trigger: "当 Responses API 的上下文引用已失效或过期时返回。",
  },
  {
    key: "invalidEncryptedContentMessage",
    title: "加密内容无效",
    trigger: "当上游返回 encrypted_content 无效，无法继续处理上下文时返回。",
  },
  {
    key: "upstreamBalanceInsufficientMessage",
    title: "上游余额或额度不足",
    trigger: "当本次请求遇到上游余额不足、额度不足、欠费或 quota exhausted 类错误时返回。",
  },
];

export default function AdminRiskControlPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [confirmAction, setConfirmAction] = useState<null | "redis" | "circuit">(null);
  const [activeModal, setActiveModal] = useState<null | "auto" | "gateway" | "upstream-filter" | "redis" | "circuit" | "ip-ban">(null);
  const [editingIpRule, setEditingIpRule] = useState<IpBanRule | null>(null);
  const riskQuery = useQuery({ queryKey: ["admin", "risk-center"], queryFn: getRiskCenter });

  const autoTerminateForm = useForm<AutoTerminateInput, unknown, AutoTerminateValues>({ resolver: zodResolver(autoTerminateSchema) });
  const gatewayForm = useForm<GatewayValues>();
  const upstreamOutputFilterForm = useForm<UpstreamOutputFilterInput, unknown, UpstreamOutputFilterValues>({
    resolver: zodResolver(upstreamOutputFilterSchema),
  });
  const redisForm = useForm<RedisInput, unknown, RedisValues>({ resolver: zodResolver(redisSchema) });
  const circuitForm = useForm<CircuitInput, unknown, CircuitValues>({ resolver: zodResolver(circuitSchema) });
  const ipBanForm = useForm<IpBanRuleInput, unknown, IpBanRuleValues>({
    resolver: zodResolver(ipBanRuleSchema),
    defaultValues: { ip: "", mode: "notice", message: "当前 IP 已被网关封禁，请联系管理员。", reason: "" },
  });

  useEffect(() => {
    const data = riskQuery.data;
    if (!data) return;
    autoTerminateForm.reset({
      pendingEnabled: data.pendingAutoTerminateSettings.enabled,
      pendingTimeoutSeconds: data.pendingAutoTerminateSettings.timeoutSeconds,
      pendingMessage: data.pendingAutoTerminateSettings.message,
      ipBanEnabled: data.temporaryIpNoticeBanSettings.enabled,
      ipBanThreshold: data.temporaryIpNoticeBanSettings.threshold,
      ipBanWindowSeconds: data.temporaryIpNoticeBanSettings.windowSeconds,
      ipBanSeconds: data.temporaryIpNoticeBanSettings.banSeconds,
      ipBanMessage: data.temporaryIpNoticeBanSettings.message,
    });
    gatewayForm.reset(data.gatewayNoticeSettings);
    upstreamOutputFilterForm.reset({
      enabled: data.upstreamOutputFilterSettings.enabled,
      phrasesText: data.upstreamOutputFilterSettings.phrases.join("\n"),
    });
    redisForm.reset({
      ...data.redisFailurePolicySettings,
      degradedUserIdsText: data.redisFailurePolicySettings.degradedUserIds.join("\n"),
    });
    circuitForm.reset({
      ...data.globalCircuitBreakerSettings,
      allowedUserIdsText: data.globalCircuitBreakerSettings.allowedUserIds.join("\n"),
    });
  }, [autoTerminateForm, circuitForm, gatewayForm, redisForm, riskQuery.data, upstreamOutputFilterForm]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "risk-center"] });
  const autoTerminateMutation = useMutation({
    mutationFn: async (values: AutoTerminateValues) => {
      await Promise.all([
        updatePendingAutoTerminateSettings({
          enabled: values.pendingEnabled,
          timeoutSeconds: values.pendingTimeoutSeconds,
          message: values.pendingMessage,
        }),
        updateTemporaryIpNoticeBanSettings({
          enabled: values.ipBanEnabled,
          threshold: values.ipBanThreshold,
          windowSeconds: values.ipBanWindowSeconds,
          banSeconds: values.ipBanSeconds,
          message: values.ipBanMessage,
        }),
      ]);
    },
    onSuccess: () => { setActiveModal(null); setNotice("Pending 自动终止与 IP 封禁已保存"); refresh(); },
    onError: (error) => setNotice(errorToText(error)),
  });
  const gatewayMutation = useMutation({ mutationFn: updateGatewayNoticeSettings, onSuccess: () => { setActiveModal(null); setNotice("网关提示文案已保存"); refresh(); }, onError: (error) => setNotice(errorToText(error)) });
  const upstreamOutputFilterMutation = useMutation({
    mutationFn: (values: UpstreamOutputFilterValues) =>
      updateUpstreamOutputFilterSettings({
        enabled: values.enabled,
        phrases: lines(values.phrasesText),
      }),
    onSuccess: () => { setActiveModal(null); setNotice("上游输出过滤已保存"); refresh(); },
    onError: (error) => setNotice(errorToText(error)),
  });
  const redisMutation = useMutation({ mutationFn: updateRedisFailurePolicySettings, onSuccess: () => { setConfirmAction(null); setNotice("Redis 失败策略已保存"); refresh(); }, onError: (error) => setNotice(errorToText(error)) });
  const circuitMutation = useMutation({ mutationFn: updateGlobalCircuitBreakerSettings, onSuccess: () => { setConfirmAction(null); setNotice("全局熔断配置已保存"); refresh(); }, onError: (error) => setNotice(errorToText(error)) });
  const ipBanMutation = useMutation({
    mutationFn: async (values: IpBanRuleValues) => {
      const payload = { mode: values.mode, message: values.message || null, reason: values.reason || null };
      if (editingIpRule) {
        return updateIpBanRule(editingIpRule.ip, payload);
      }
      return saveIpBanRule({ ip: values.ip, ...payload });
    },
    onSuccess: () => {
      setNotice(editingIpRule ? "手动 IP 封禁规则已更新" : "手动 IP 封禁规则已新增");
      setEditingIpRule(null);
      ipBanForm.reset({ ip: "", mode: "notice", message: "当前 IP 已被网关封禁，请联系管理员。", reason: "" });
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const deleteIpBanMutation = useMutation({
    mutationFn: deleteIpBanRule,
    onSuccess: () => { setNotice("手动 IP 封禁规则已删除"); refresh(); },
    onError: (error) => setNotice(errorToText(error)),
  });

  const counters = riskQuery.data?.counters;
  const tempSettings = riskQuery.data?.temporaryIpNoticeBanSettings;
  const pendingSettings = riskQuery.data?.pendingAutoTerminateSettings;
  const redisSettings = riskQuery.data?.redisFailurePolicySettings;
  const circuitSettings = riskQuery.data?.globalCircuitBreakerSettings;
  const upstreamOutputFilterSettings = riskQuery.data?.upstreamOutputFilterSettings;
  const ipBanRules = riskQuery.data?.ipBanRules ?? [];

  return (
    <div className="risk-control-page space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Risk Control</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">风控与公告</h2>
        <p className="mt-2 text-sm text-slate-500">集中管理熔断、Redis 失败策略、网关提示和 IP 临时封禁。</p>
      </section>
      {notice ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</div> : null}
      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="PENDING 请求" value={counters?.pendingRequests ?? 0} />
        <Metric label="24h 失败" value={counters?.failedRequests24h ?? 0} />
        <Metric label="24h 网关提示" value={counters?.noticeRequests24h ?? 0} />
        <Metric label="24h 限流" value={counters?.rateLimitedRequests24h ?? 0} />
      </section>
      {riskQuery.isLoading ? <SkeletonGrid /> : (
        <section className="risk-action-grid">
          <RiskActionCard
            icon={CircleStop}
            title="Pending 自动终止与 IP 封禁"
            description="超时 Pending 会自动终止，同一 IP 多次自动终止后可临时封禁。"
            status={pendingSettings?.enabled ? `终止 ${pendingSettings.timeoutSeconds}s · 封禁 ${tempSettings?.enabled ? `${tempSettings.threshold} 次` : "关闭"}` : "自动终止未启用"}
            onClick={() => setActiveModal("auto")}
          />
          <RiskActionCard icon={Ban} title="手动 IP 封禁" description="指定 IP 命中后直接返回公告或 403 错误，不再转发上游。" status={`${ipBanRules.length} 条规则`} danger={ipBanRules.length > 0} onClick={() => setActiveModal("ip-ban")} />
          <RiskActionCard icon={FileText} title="网关公告提示" description="限流、并发、模型不可用等返回文案。" status={`${gatewayNoticeFields.length} 个模板`} onClick={() => setActiveModal("gateway")} />
          <RiskActionCard icon={TextSearch} title="上游输出过滤" description="流式和非流式响应命中固定句子时屏蔽，不展示给用户。" status={upstreamOutputFilterSettings?.enabled ? `${upstreamOutputFilterSettings.phrases.length} 条已启用` : "未启用"} onClick={() => setActiveModal("upstream-filter")} />
          <RiskActionCard icon={ShieldAlert} title="Redis 失败策略" description="控制 Redis 异常时网关放行、拒绝或降级。" status={redisSettings?.policy ?? "未加载"} onClick={() => setActiveModal("redis")} />
          <RiskActionCard icon={Flame} title="全局熔断" description="紧急维护或故障隔离时阻断普通 API 调用。" status={circuitSettings?.enabled ? "已开启" : "未开启"} danger={Boolean(circuitSettings?.enabled)} onClick={() => setActiveModal("circuit")} />
        </section>
      )}

      {activeModal === "auto" ? (
        <Modal title="Pending 自动终止与 IP 封禁" description="这是一组联动规则：只有 Pending 自动终止会累计 IP 命中，达到阈值后才临时封禁该 IP。" onClose={() => setActiveModal(null)} formId="risk-auto-form" loading={autoTerminateMutation.isPending} showHeaderSave={false}>
          <SettingCard formId="risk-auto-form" title="Pending 自动终止与 IP 封禁" description="手动终止、普通失败和其他网关提示不会累计 IP 封禁命中次数。" form={autoTerminateForm} loading={autoTerminateMutation.isPending} onSubmit={(values) => autoTerminateMutation.mutate(values)}>
            <section className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-950">Pending 自动终止</h4>
                <p className="mt-1 text-sm text-slate-500">超过设定秒数仍为 PENDING 的调用，会被系统自动终止。</p>
              </div>
              <Toggle label="启用 Pending 自动终止" register={autoTerminateForm.register("pendingEnabled")} />
              <NumberField label="超时秒数" register={autoTerminateForm.register("pendingTimeoutSeconds")} />
              <TextArea label="终止记录文案" register={autoTerminateForm.register("pendingMessage")} />
            </section>
            <section className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-950">自动终止 IP 封禁</h4>
                <p className="mt-1 text-sm text-slate-500">同一 IP 在统计窗口内多次被自动终止后，临时阻断该 IP。</p>
              </div>
              <Toggle label="启用自动终止 IP 封禁" register={autoTerminateForm.register("ipBanEnabled")} />
              <NumberField label="自动终止次数阈值" register={autoTerminateForm.register("ipBanThreshold")} />
              <NumberField label="统计窗口秒数" register={autoTerminateForm.register("ipBanWindowSeconds")} />
              <NumberField label="封禁秒数" register={autoTerminateForm.register("ipBanSeconds")} />
              <TextArea label="提示文案" register={autoTerminateForm.register("ipBanMessage")} />
            </section>
          </SettingCard>
        </Modal>
      ) : null}

      {activeModal === "ip-ban" ? (
        <Modal title="手动 IP 封禁" description="命中手动封禁规则的请求会在网关侧直接返回，不会继续消耗上游。" onClose={() => { setActiveModal(null); setEditingIpRule(null); }} formId="risk-ip-ban-form" loading={ipBanMutation.isPending} wide showHeaderSave={false}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-950">已封禁 IP</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">规则立即生效，后端最多有数秒缓存延迟。</p>
              </div>
              <div className="divide-y divide-slate-200">
                {ipBanRules.length ? ipBanRules.map((rule) => (
                  <article key={rule.ip} className="grid gap-3 px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-sm font-semibold text-slate-950">{rule.ip}</div>
                        <div className="mt-1 text-xs text-slate-500">更新于 {formatDateTime(rule.updatedAt)}</div>
                      </div>
                      <span className={rule.mode === "notice" ? "rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700" : "rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700"}>{rule.mode === "notice" ? "公告返回" : "403 错误"}</span>
                    </div>
                    <p className="text-sm leading-6 text-slate-600">{rule.message}</p>
                    {rule.reason ? <p className="text-xs text-slate-500">备注：{rule.reason}</p> : null}
                    <div className="flex flex-wrap justify-end gap-2">
                      <button className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button" onClick={() => { setEditingIpRule(rule); ipBanForm.reset({ ip: rule.ip, mode: rule.mode, message: rule.message, reason: rule.reason ?? "" }); }}>编辑</button>
                      <button className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 px-3 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60" type="button" disabled={deleteIpBanMutation.isPending} onClick={() => deleteIpBanMutation.mutate(rule.ip)}><Trash2 className="h-4 w-4" aria-hidden="true" />删除</button>
                    </div>
                  </article>
                )) : <div className="px-5 py-10 text-center text-sm text-slate-500">暂无手动封禁 IP</div>}
              </div>
            </section>
            <SettingCard formId="risk-ip-ban-form" hideActions title={editingIpRule ? "编辑封禁规则" : "新增封禁规则"} description="notice 会按兼容响应格式返回文案；error 会返回 403。默认为公告返回。" form={ipBanForm} loading={ipBanMutation.isPending} onSubmit={(values) => ipBanMutation.mutate(values)}>
              <label className="grid gap-2"><span className={labelClass}>IP 地址</span><input className={inputClass} disabled={Boolean(editingIpRule)} placeholder="120.231.123.73" {...ipBanForm.register("ip")} /></label>
              <label className="grid gap-2"><span className={labelClass}>返回方式</span><select className={inputClass} {...ipBanForm.register("mode")}><option value="notice">公告返回</option><option value="error">403 错误</option></select></label>
              <TextArea label="返回文案" register={ipBanForm.register("message")} />
              <TextArea label="备注" register={ipBanForm.register("reason")} />
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                {editingIpRule ? <button className="h-10 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={() => { setEditingIpRule(null); ipBanForm.reset({ ip: "", mode: "notice", message: "当前 IP 已被网关封禁，请联系管理员。", reason: "" }); }}>取消编辑</button> : null}
                <button className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60" type="submit" disabled={ipBanMutation.isPending}><Save className="h-4 w-4" aria-hidden="true" />{ipBanMutation.isPending ? "保存中" : editingIpRule ? "保存规则" : "新增规则"}</button>
              </div>
            </SettingCard>
          </div>
        </Modal>
      ) : null}

      {activeModal === "gateway" ? (
        <Modal title="网关公告提示" description="每一项都说明什么时候触发，以及命中后返回给用户的文案内容。" onClose={() => setActiveModal(null)} formId="risk-gateway-form" loading={gatewayMutation.isPending} wide>
          <SettingCard formId="risk-gateway-form" hideActions title="网关公告提示" description="集中维护网关直接返回给用户的文案。" form={gatewayForm} loading={gatewayMutation.isPending} onSubmit={(values) => gatewayMutation.mutate(values)}>
            {gatewayNoticeFields.map((field) => (
              <GatewayNoticeField
                key={field.key}
                title={field.title}
                trigger={field.trigger}
                placeholders={field.placeholders}
                register={gatewayForm.register(field.key)}
              />
            ))}
          </SettingCard>
        </Modal>
      ) : null}

      {activeModal === "upstream-filter" ? (
        <Modal title="上游输出过滤" description="每行填写一句需要屏蔽的固定文本；流式输出会先缓存可能命中的前缀，确认不是目标句子后再下发。" onClose={() => setActiveModal(null)} formId="risk-upstream-filter-form" loading={upstreamOutputFilterMutation.isPending}>
          <SettingCard formId="risk-upstream-filter-form" hideActions title="上游输出过滤" description="适合屏蔽上游固定追加的广告词或污染文本。保存后后端最多有数秒缓存延迟。" form={upstreamOutputFilterForm} loading={upstreamOutputFilterMutation.isPending} onSubmit={(values) => upstreamOutputFilterMutation.mutate(values)}>
            <Toggle label="启用输出过滤" register={upstreamOutputFilterForm.register("enabled")} />
            <TextArea label="屏蔽文本，每行一句" register={upstreamOutputFilterForm.register("phrasesText")} />
          </SettingCard>
        </Modal>
      ) : null}

      {activeModal === "redis" ? (
        <Modal title="Redis 失败策略" description="从 fail-open 切换到 fail-closed 或 degraded 会改变请求放行策略，属于高危操作。" onClose={() => setActiveModal(null)} formId="risk-redis-form" loading={redisMutation.isPending}>
          <SettingCard formId="risk-redis-form" hideActions title="Redis 失败策略" description="保存前会要求二次确认。" form={redisForm} loading={redisMutation.isPending} onSubmit={() => setConfirmAction("redis")}>
            <label className="grid gap-2"><span className={labelClass}>策略</span><select className={inputClass} {...redisForm.register("policy")}><option value="fail-open">fail-open</option><option value="fail-closed">fail-closed</option><option value="degraded">degraded</option></select></label>
            <Toggle label="降级时管理员绕过" register={redisForm.register("degradedAdminBypassEnabled")} />
            <TextArea label="降级白名单用户 ID，每行一个" register={redisForm.register("degradedUserIdsText")} />
            <TextArea label="失败提示" register={redisForm.register("message")} />
          </SettingCard>
        </Modal>
      ) : null}

      {activeModal === "circuit" ? (
        <Modal title="全局熔断配置" description="启用后会阻断普通 API 调用，请仅在紧急维护或故障隔离时使用。" onClose={() => setActiveModal(null)} formId="risk-circuit-form" loading={circuitMutation.isPending}>
          <SettingCard formId="risk-circuit-form" hideActions title="全局熔断配置" description="保存前会要求二次确认。" form={circuitForm} loading={circuitMutation.isPending} onSubmit={() => setConfirmAction("circuit")}>
            <Toggle label="启用全局熔断" register={circuitForm.register("enabled")} />
            <Toggle label="允许管理员调用" register={circuitForm.register("allowAdmins")} />
            <TextArea label="允许用户 ID，每行一个" register={circuitForm.register("allowedUserIdsText")} />
            <TextArea label="熔断提示" register={circuitForm.register("message")} />
          </SettingCard>
        </Modal>
      ) : null}
      <ConfirmDialog open={Boolean(confirmAction)} title="确认高危配置变更" description={confirmAction === "circuit" ? "全局熔断启用后会阻断普通 API 调用。请确认你了解影响范围。" : "Redis 失败策略切换为 fail-closed 或 degraded 可能阻断或限制请求。"} confirmText="确认保存" requireInputText="确认保存" loading={redisMutation.isPending || circuitMutation.isPending} onOpenChange={(open) => !open && setConfirmAction(null)} onConfirm={async () => {
        if (confirmAction === "redis") {
          const values = redisForm.getValues();
          await redisMutation.mutateAsync({ policy: values.policy, degradedAdminBypassEnabled: values.degradedAdminBypassEnabled, degradedUserIds: lines(values.degradedUserIdsText), message: values.message });
        }
        if (confirmAction === "circuit") {
          const values = circuitForm.getValues();
          await circuitMutation.mutateAsync({ enabled: values.enabled, allowAdmins: values.allowAdmins, allowedUserIds: lines(values.allowedUserIdsText), message: values.message });
        }
        setActiveModal(null);
      }} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{value.toLocaleString("en-US")}</p></div>; }
function RiskActionCard({ icon: Icon, title, description, status, danger = false, onClick }: { icon: typeof RadioTower; title: string; description: string; status: string; danger?: boolean; onClick: () => void }) { return <article className="risk-action-card"><div className={danger ? "risk-action-icon danger" : "risk-action-icon"}><Icon className="h-5 w-5" aria-hidden="true" /></div><div className="min-w-0"><h3>{title}</h3><p>{description}</p><span>{status}</span></div><button type="button" onClick={onClick}>配置</button></article>; }
function Modal({ title, description, children, onClose, formId, loading = false, wide = false, showHeaderSave = true }: { title: string; description: string; children: React.ReactNode; onClose: () => void; formId?: string; loading?: boolean; wide?: boolean; showHeaderSave?: boolean }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6"><div className={wide ? "risk-modal risk-modal-wide" : "risk-modal"}><div className="risk-modal-head"><div><h2>{title}</h2><p>{description}</p></div><div className="risk-modal-head-actions">{formId && showHeaderSave ? <button className="risk-modal-save" type="submit" form={formId} disabled={loading}><Save className="h-4 w-4" aria-hidden="true" />{loading ? "保存中" : "保存"}</button> : null}<button className="risk-modal-close" type="button" onClick={onClose}>×</button></div></div><div className="risk-modal-body">{children}</div></div></div>; }
function NumberField({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><input type="number" className={inputClass} {...register} /></label>; }
function TextArea({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><textarea rows={3} className={textareaClass} {...register} /></label>; }
function GatewayNoticeField({ title, trigger, placeholders, register }: { title: string; trigger: string; placeholders?: string; register: object }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-1">
        <div className="text-sm font-semibold text-slate-950">触发时机：{title}</div>
        <p className="text-sm leading-6 text-slate-500">{trigger}</p>
        {placeholders ? <p className="text-xs font-medium text-blue-700">可用变量：{placeholders}</p> : null}
      </div>
      <label className="mt-3 grid gap-2">
        <span className={labelClass}>返回内容</span>
        <textarea rows={3} className={textareaClass} {...register} />
      </label>
    </div>
  );
}
function Toggle({ label, register }: { label: string; register: object }) { return <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register} />{label}</label>; }
function SkeletonGrid() { return <div className="grid gap-5 xl:grid-cols-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-80 animate-pulse rounded-lg bg-slate-100" />)}</div>; }
function lines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
function errorToText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }
const labelClass = "text-sm font-medium text-slate-700";
const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass = "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
