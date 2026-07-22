"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleStop, FileText, Flame, KeyRound, RadioTower, Save, Search, ShieldAlert, ShieldCheck, Trash2, UserX } from "lucide-react";
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
  updateResponseContentFilterSettings,
  updateTemporaryIpNoticeBanSettings,
  updateWhitelistFilterSettings,
  updateBannedUserNoticeSettings,
  rotateWhitelistFilterSecret,
  type BannedUserNoticeSettings,
  type GatewayNoticeSettings,
  type GlobalCircuitBreakerSettings,
  type IpBanRule,
  type RedisFailurePolicySettings,
  type ResponseContentFilterSettings,
  type WhitelistFilterSettings,
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
const whitelistSchema = z.object({
  enabled: z.boolean(),
  applyToAdmins: z.boolean(),
  noticeText: z.string().trim().min(1),
});
const bannedUserNoticeSchema = z.object({
  noticeText: z.string().trim().min(1),
});
const responseContentFilterSchema = z.object({
  enabled: z.boolean(),
  blockedTermsText: z.string().superRefine((value, context) => {
    const terms = parseBlockedTerms(value);
    if (terms.length > 200) {
      context.addIssue({ code: "custom", message: "自定义屏蔽词最多 200 条" });
    }
    if (terms.some((term) => term.length > 2048)) {
      context.addIssue({ code: "custom", message: "单条屏蔽词最多 2048 个字符" });
    }
  }),
  replacement: z
    .string()
    .max(200, "替换文本最多 200 个字符")
    .refine((value) => !/["\\\u0000-\u001f\u007f]/.test(value), {
      message: "替换文本不能包含引号、反斜杠或换行等控制字符",
    }),
  caseSensitive: z.boolean(),
  includeUpstreamBaseUrls: z.boolean(),
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
type RedisInput = z.input<typeof redisSchema>;
type RedisValues = z.infer<typeof redisSchema>;
type CircuitInput = z.input<typeof circuitSchema>;
type CircuitValues = z.infer<typeof circuitSchema>;
type WhitelistInput = z.input<typeof whitelistSchema>;
type WhitelistValues = z.infer<typeof whitelistSchema>;
type BannedUserNoticeInput = z.input<typeof bannedUserNoticeSchema>;
type BannedUserNoticeValues = z.infer<typeof bannedUserNoticeSchema>;
type ResponseContentFilterValues = z.output<typeof responseContentFilterSchema>;
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
    key: "tierConcurrencyMessage",
    title: "访问等级并发限制",
    trigger: "当用户在当前访问等级下的并发数达到该等级上限时返回。",
    placeholders: "{limit}=等级并发上限",
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
    key: "tierRateLimitMessage",
    title: "访问等级每分钟速率限制",
    trigger: "当用户在当前访问等级下每分钟请求数达到该等级 RPM 上限时返回。",
    placeholders: "{limit}=等级 RPM；{seconds}=建议等待秒数",
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
  const [activeModal, setActiveModal] = useState<null | "auto" | "gateway" | "redis" | "circuit" | "ip-ban" | "whitelist" | "banned-users" | "response-filter">(null);
  const [editingIpRule, setEditingIpRule] = useState<IpBanRule | null>(null);
  const [ipBanSearch, setIpBanSearch] = useState("");
  const [bannedUserSearch, setBannedUserSearch] = useState("");
  const riskQuery = useQuery({ queryKey: ["admin", "risk-center"], queryFn: getRiskCenter });

  const autoTerminateForm = useForm<AutoTerminateInput, unknown, AutoTerminateValues>({ resolver: zodResolver(autoTerminateSchema) });
  const gatewayForm = useForm<GatewayValues>();
  const redisForm = useForm<RedisInput, unknown, RedisValues>({ resolver: zodResolver(redisSchema) });
  const circuitForm = useForm<CircuitInput, unknown, CircuitValues>({ resolver: zodResolver(circuitSchema) });
  const whitelistForm = useForm<WhitelistInput, unknown, WhitelistValues>({ resolver: zodResolver(whitelistSchema) });
  const bannedUserNoticeForm = useForm<BannedUserNoticeInput, unknown, BannedUserNoticeValues>({ resolver: zodResolver(bannedUserNoticeSchema) });
  const responseContentFilterForm = useForm<ResponseContentFilterValues>({
    resolver: zodResolver(responseContentFilterSchema),
    defaultValues: {
      enabled: false,
      blockedTermsText: "",
      replacement: "[内容已屏蔽]",
      caseSensitive: false,
      includeUpstreamBaseUrls: false,
    },
  });
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
    redisForm.reset({
      ...data.redisFailurePolicySettings,
      degradedUserIdsText: data.redisFailurePolicySettings.degradedUserIds.join("\n"),
    });
    circuitForm.reset({
      ...data.globalCircuitBreakerSettings,
      allowedUserIdsText: data.globalCircuitBreakerSettings.allowedUserIds.join("\n"),
    });
    whitelistForm.reset({
      enabled: data.whitelistFilterSettings.enabled,
      applyToAdmins: data.whitelistFilterSettings.applyToAdmins,
      noticeText: data.whitelistFilterSettings.noticeText,
    });
    bannedUserNoticeForm.reset(data.bannedUserNoticeSettings);
    responseContentFilterForm.reset(
      toResponseContentFilterValues(data.responseContentFilterSettings),
    );
  }, [autoTerminateForm, bannedUserNoticeForm, circuitForm, gatewayForm, redisForm, responseContentFilterForm, whitelistForm, riskQuery.data]);

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
  const redisMutation = useMutation({ mutationFn: updateRedisFailurePolicySettings, onSuccess: () => { setConfirmAction(null); setNotice("Redis 失败策略已保存"); refresh(); }, onError: (error) => setNotice(errorToText(error)) });
  const circuitMutation = useMutation({ mutationFn: updateGlobalCircuitBreakerSettings, onSuccess: () => { setConfirmAction(null); setNotice("全局熔断配置已保存"); refresh(); }, onError: (error) => setNotice(errorToText(error)) });
  const whitelistMutation = useMutation({
    mutationFn: updateWhitelistFilterSettings,
    onSuccess: () => { setActiveModal(null); setNotice("白名单过滤设置已保存"); refresh(); },
    onError: (error) => setNotice(errorToText(error)),
  });
  const rotateWhitelistMutation = useMutation({
    mutationFn: rotateWhitelistFilterSecret,
    onSuccess: () => { setNotice("白名单密钥已切换，所有用户需要重新验证"); refresh(); },
    onError: (error) => setNotice(errorToText(error)),
  });
  const bannedUserNoticeMutation = useMutation({
    mutationFn: updateBannedUserNoticeSettings,
    onSuccess: () => { setNotice("封禁用户返回文案已保存"); refresh(); },
    onError: (error) => setNotice(errorToText(error)),
  });
  const responseContentFilterMutation = useMutation({
    mutationFn: (values: ResponseContentFilterValues) =>
      updateResponseContentFilterSettings(
        fromResponseContentFilterValues(values),
      ),
    onSuccess: () => {
      setActiveModal(null);
      setNotice("响应内容脱敏设置已保存");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
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
  const whitelistSettings = riskQuery.data?.whitelistFilterSettings;
  const bannedUserNoticeSettings = riskQuery.data?.bannedUserNoticeSettings;
  const responseContentFilterSettings = riskQuery.data?.responseContentFilterSettings;
  const upstreamBaseUrlBlockedTerms = riskQuery.data?.upstreamBaseUrlBlockedTerms ?? [];
  const responseContentFilterTermCount = parseBlockedTerms(
    responseContentFilterForm.watch("blockedTermsText"),
  ).length;
  const bannedUsers = riskQuery.data?.bannedUsers ?? [];
  const filteredBannedUsers = bannedUsers.filter((user) => {
    const keyword = bannedUserSearch.trim().toLowerCase();
    if (!keyword) return true;
    return [
      user.email,
      user.displayGroup,
      user.statusReason ?? "",
      String(user._count.apiKeys),
      String(user._count.apiRequests),
    ].some((value) => value.toLowerCase().includes(keyword));
  });
  const ipBanRules = riskQuery.data?.ipBanRules ?? [];
  const filteredIpBanRules = ipBanRules.filter((rule) => {
    const keyword = ipBanSearch.trim().toLowerCase();
    if (!keyword) return true;
    return [rule.ip, rule.message, rule.reason ?? ""].some((value) =>
      value.toLowerCase().includes(keyword),
    );
  });

  return (
    <div className="risk-control-page space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Risk Control</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">风控与公告</h2>
        <p className="mt-2 text-sm text-slate-500">集中管理熔断、Redis 失败策略、响应内容脱敏、网关提示和 IP 临时封禁。</p>
      </section>
      {notice ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</div> : null}
      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="实时 PENDING" value={counters?.pendingRequests ?? 0} />
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
          <RiskActionCard icon={UserX} title="封禁用户" description="查看当前被封禁的账号，封禁账号请求会收到公告返回。" status={`${bannedUsers.length} 个账号`} danger={bannedUsers.length > 0} onClick={() => setActiveModal("banned-users")} />
          <RiskActionCard icon={FileText} title="网关公告提示" description="限流、并发、模型不可用等返回文案。" status={`${gatewayNoticeFields.length} 个模板`} onClick={() => setActiveModal("gateway")} />
          <RiskActionCard icon={ShieldAlert} title="Redis 失败策略" description="控制 Redis 异常时网关放行、拒绝或降级。" status={redisSettings?.policy ?? "未加载"} onClick={() => setActiveModal("redis")} />
          <RiskActionCard icon={Flame} title="全局熔断" description="紧急维护或故障隔离时阻断普通 API 调用。" status={circuitSettings?.enabled ? "已开启" : "未开启"} danger={Boolean(circuitSettings?.enabled)} onClick={() => setActiveModal("circuit")} />
          <RiskActionCard icon={KeyRound} title="白名单过滤" description="开启后所有账号先公告封禁，输入当前密钥后自动解封。" status={whitelistSettings?.enabled ? "已开启" : "未开启"} danger={Boolean(whitelistSettings?.enabled)} onClick={() => setActiveModal("whitelist")} />
          <RiskActionCard
            icon={ShieldCheck}
            title="响应内容脱敏"
            description="屏蔽自定义敏感词，并可自动纳管全部上游 Base URL。"
            status={
              responseContentFilterSettings?.enabled
                ? `${responseContentFilterSettings.blockedTerms.length} 条自定义${responseContentFilterSettings.includeUpstreamBaseUrls ? ` · ${upstreamBaseUrlBlockedTerms.length} 个自动项` : ""}`
                : "未开启"
            }
            onClick={() => setActiveModal("response-filter")}
          />
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
        <Modal title="手动 IP 封禁" description="命中手动封禁规则的请求会在网关侧直接返回，不会继续消耗上游。" onClose={() => { setActiveModal(null); setEditingIpRule(null); setIpBanSearch(""); }} formId="risk-ip-ban-form" loading={ipBanMutation.isPending} wide showHeaderSave={false}>
          <div className="risk-ip-ban-layout">
            <div className="risk-ip-ban-form-pane">
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
            <section className="risk-ip-ban-list-pane">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">已封禁 IP</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">规则立即生效，后端最多有数秒缓存延迟。</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{filteredIpBanRules.length}/{ipBanRules.length}</span>
                </div>
                <label className="risk-ip-ban-search">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <input
                    type="search"
                    value={ipBanSearch}
                    onChange={(event) => setIpBanSearch(event.target.value)}
                    placeholder="搜索 IP、文案或备注"
                    aria-label="搜索已封禁 IP"
                  />
                </label>
              </div>
              <div className="risk-ip-ban-list-scroll divide-y divide-slate-200">
                {filteredIpBanRules.length ? filteredIpBanRules.map((rule) => (
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
                )) : <div className="px-5 py-10 text-center text-sm text-slate-500">{ipBanRules.length ? "没有匹配的封禁 IP" : "暂无手动封禁 IP"}</div>}
              </div>
            </section>
          </div>
        </Modal>
      ) : null}

      {activeModal === "banned-users" ? (
        <Modal title="封禁用户" description="这些账号状态为封禁，调用代理接口时会收到封禁公告，不会继续请求上游。" onClose={() => { setActiveModal(null); setBannedUserSearch(""); }} wide showHeaderSave={false}>
          <div className="grid gap-4">
          <SettingCard formId="risk-banned-notice-form" title="自定义返回文案" description="被封禁账号调用代理接口时，会按公告格式返回这段内容。" form={bannedUserNoticeForm} loading={bannedUserNoticeMutation.isPending} onSubmit={(values) => bannedUserNoticeMutation.mutate(values)}>
            <TextArea label="封禁公告返回内容" register={bannedUserNoticeForm.register("noticeText")} />
            {bannedUserNoticeSettings?.noticeText ? <p className="text-xs text-slate-500">当前生效：{bannedUserNoticeSettings.noticeText}</p> : null}
          </SettingCard>
          <section className="risk-ip-ban-list-pane risk-banned-users-pane">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">被封禁账号</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">如需解封，请到用户管理里编辑账号状态。</p>
                </div>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">{filteredBannedUsers.length}/{bannedUsers.length} 个</span>
              </div>
              <label className="risk-ip-ban-search">
                <Search className="h-4 w-4" aria-hidden="true" />
                <input
                  type="search"
                  value={bannedUserSearch}
                  onChange={(event) => setBannedUserSearch(event.target.value)}
                  placeholder="搜索邮箱、分组、原因或请求数"
                  aria-label="搜索被封禁账号"
                />
              </label>
            </div>
            <div className="risk-ip-ban-list-scroll divide-y divide-slate-200">
              {filteredBannedUsers.length ? filteredBannedUsers.map((user) => (
                <article key={user.id} className="grid gap-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950">{user.email}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {user.displayGroup} · 创建于 {formatDateTime(user.createdAt)} · 封禁更新 {formatDateTime(user.updatedAt)}
                      </div>
                    </div>
                    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">封禁</span>
                  </div>
                  {user.statusReason ? (
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">原因：{user.statusReason}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">API Key：{user._count.apiKeys}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">历史请求：{user._count.apiRequests.toLocaleString("en-US")}</span>
                  </div>
                </article>
              )) : <div className="px-5 py-10 text-center text-sm text-slate-500">{bannedUsers.length ? "没有匹配的封禁用户" : "暂无封禁用户"}</div>}
            </div>
          </section>
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

      {activeModal === "response-filter" ? (
        <Modal
          title="响应内容脱敏"
          description="在所有代理响应离开网关前统一过滤，覆盖正常输出、错误信息、网关提示和 SSE 流式分片。"
          onClose={() => setActiveModal(null)}
          formId="risk-response-filter-form"
          loading={responseContentFilterMutation.isPending}
          wide
        >
          <SettingCard
            formId="risk-response-filter-form"
            hideActions
            title="响应屏蔽词设置"
            description="自定义词与自动提取的上游 Base URL 会在运行时合并，不会把自动项写进手工列表。"
            form={responseContentFilterForm}
            loading={responseContentFilterMutation.isPending}
            onSubmit={(values) => responseContentFilterMutation.mutate(values)}
          >
            <Toggle
              label="启用响应内容脱敏"
              register={responseContentFilterForm.register("enabled")}
            />
            <Toggle
              label="自动屏蔽上游管理中的全部 Base URL（去除 http:// 和 https://）"
              register={responseContentFilterForm.register("includeUpstreamBaseUrls")}
            />
            <section className="grid gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-950">自动纳管预览</h4>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  当前上游管理中可生成 {upstreamBaseUrlBlockedTerms.length} 个屏蔽项，包括去协议完整地址、主机名和必要的父域名。新建、修改或删除上游也会自动同步。
                </p>
              </div>
              {upstreamBaseUrlBlockedTerms.length ? (
                <div className="max-h-44 overflow-y-auto rounded-md border border-blue-100 bg-white p-3">
                  <div className="grid gap-2">
                    {upstreamBaseUrlBlockedTerms.map((term) => (
                      <code key={term} className="break-all font-mono text-xs leading-5 text-slate-700">
                        {term}
                      </code>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-blue-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  当前没有可自动纳管的上游 Base URL。
                </div>
              )}
            </section>
            <label className="grid gap-2">
              <span className={labelClass}>自定义屏蔽词</span>
              <textarea
                rows={8}
                className={textareaClass}
                placeholder={"渠道品牌名\n额外域名\n需要隐藏的错误提示片段"}
                aria-describedby="risk-response-filter-terms-help"
                aria-invalid={Boolean(responseContentFilterForm.formState.errors.blockedTermsText)}
                {...responseContentFilterForm.register("blockedTermsText")}
              />
              <div className="flex flex-wrap items-start justify-between gap-2 text-xs leading-5">
                <p
                  id="risk-response-filter-terms-help"
                  className={responseContentFilterForm.formState.errors.blockedTermsText ? "text-red-600" : "text-slate-500"}
                >
                  {responseContentFilterForm.formState.errors.blockedTermsText?.message ?? "每行一个词，按子串匹配；空行和重复项会自动忽略。"}
                </p>
                <span className="shrink-0 font-medium text-slate-500">
                  {responseContentFilterTermCount}/{riskQuery.data?.responseContentFilterLimits.maxTerms ?? 200}
                </span>
              </div>
            </label>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="grid gap-2">
                <span className={labelClass}>命中后的替换文本</span>
                <input
                  className={inputClass}
                  placeholder="[内容已屏蔽]"
                  aria-describedby="risk-response-filter-replacement-help"
                  aria-invalid={Boolean(responseContentFilterForm.formState.errors.replacement)}
                  {...responseContentFilterForm.register("replacement")}
                />
                <p
                  id="risk-response-filter-replacement-help"
                  className={responseContentFilterForm.formState.errors.replacement ? "text-xs leading-5 text-red-600" : "text-xs leading-5 text-slate-500"}
                >
                  {responseContentFilterForm.formState.errors.replacement?.message ?? "可留空以直接删除。为保证 JSON 与 SSE 有效，不能包含引号、反斜杠或换行。"}
                </p>
              </label>
              <div className="grid content-start gap-2">
                <span className={labelClass}>匹配方式</span>
                <Toggle
                  label="区分大小写"
                  register={responseContentFilterForm.register("caseSensitive")}
                />
                <p className="text-xs leading-5 text-slate-500">
                  默认不区分大小写，更适合域名与渠道名称。
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              请避免使用 api、http、error 等过短常用词，以免误伤模型正常回答。自动规则还会纳管上游主机名及一级父域名，防止 Cloudflare 错误页只显示根域名时泄露渠道。
            </div>
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

      {activeModal === "whitelist" ? (
        <Modal title="白名单过滤" description="开启后未验证账号会收到公告封禁；切换密钥会让已验证用户全部重新验证。" onClose={() => setActiveModal(null)} formId="risk-whitelist-form" loading={whitelistMutation.isPending}>
          <SettingCard formId="risk-whitelist-form" hideActions title="白名单过滤设置" description="密钥只在这里展示，用户需要在 /access 页面登录后填写。" form={whitelistForm} loading={whitelistMutation.isPending} onSubmit={(values) => whitelistMutation.mutate(values)}>
            <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-950">当前密钥</h4>
                  <p className="mt-1 text-sm text-slate-500">复制给需要放行的账号；切换后旧密钥立即失效。</p>
                </div>
                <button
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  type="button"
                  disabled={!whitelistSettings?.secret}
                  onClick={() => {
                    if (whitelistSettings?.secret) {
                      void navigator.clipboard.writeText(whitelistSettings.secret);
                      setNotice("白名单密钥已复制");
                    }
                  }}
                >
                  复制密钥
                </button>
              </div>
              <code className="block min-h-10 break-all rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-800">{whitelistSettings?.secret || "开启并保存后自动生成密钥"}</code>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                type="button"
                disabled={rotateWhitelistMutation.isPending}
                onClick={() => rotateWhitelistMutation.mutate()}
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                {rotateWhitelistMutation.isPending ? "切换中" : "随机切换密钥"}
              </button>
            </section>
            <Toggle label="开启白名单过滤" register={whitelistForm.register("enabled")} />
            <Toggle label="对管理员账号也生效" register={whitelistForm.register("applyToAdmins")} />
            <TextArea label="公告封禁返回内容" register={whitelistForm.register("noticeText")} />
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
function Toggle({ label, register }: { label: string; register: object }) { return <label className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 shrink-0 rounded border-slate-300" {...register} />{label}</label>; }
function SkeletonGrid() { return <div className="grid gap-5 xl:grid-cols-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-80 animate-pulse rounded-lg bg-slate-100" />)}</div>; }
function lines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function parseBlockedTerms(value: string) { return [...new Set(lines(value))]; }
function toResponseContentFilterValues(settings: ResponseContentFilterSettings): ResponseContentFilterValues {
  return {
    enabled: settings.enabled,
    blockedTermsText: settings.blockedTerms.join("\n"),
    replacement: settings.replacement,
    caseSensitive: settings.caseSensitive,
    includeUpstreamBaseUrls: settings.includeUpstreamBaseUrls,
  };
}
function fromResponseContentFilterValues(values: ResponseContentFilterValues): ResponseContentFilterSettings {
  return {
    enabled: values.enabled,
    blockedTerms: parseBlockedTerms(values.blockedTermsText),
    replacement: values.replacement,
    caseSensitive: values.caseSensitive,
    includeUpstreamBaseUrls: values.includeUpstreamBaseUrls,
  };
}
function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
function errorToText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }
const labelClass = "text-sm font-medium text-slate-700";
const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass = "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
