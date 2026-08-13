"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  FileCode2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getModelPools,
  getPolicyRecoveryLibrary,
  getPolicyRecoverySettings,
  getPolicyRecoveryStats,
  previewPolicyRecovery,
  resetAllPolicyRecoverySettings,
  resetPolicyRecoveryLayer,
  updateModelPool,
  updatePolicyRecoverySettings,
  type PolicyRecoveryLayer,
  type PolicyRecoverySettings,
} from "../../../lib/api/routing";

const tabs = ["总览", "指令层", "合并预览", "恢复设置", "模型池", "资料库", "审计监控", "测试预览"] as const;
type Tab = (typeof tabs)[number];

export default function PolicyRecoveryPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("总览");
  const [draft, setDraft] = useState<PolicyRecoverySettings | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [selectedLibraryPath, setSelectedLibraryPath] = useState("");
  const [previewEndpoint, setPreviewEndpoint] = useState<"/v1/responses" | "/v1/responses/compact" | "/v1/chat/completions">("/v1/responses");
  const [previewRequest, setPreviewRequest] = useState('{"model":"gpt-5.6-sol","input":"ping"}');
  const [previewResponse, setPreviewResponse] = useState('{"error":{"codexErrorInfo":"cyberPolicy"}}');
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState("");

  const settingsQuery = useQuery({ queryKey: ["admin", "policy-recovery-settings"], queryFn: getPolicyRecoverySettings });
  const poolsQuery = useQuery({ queryKey: ["admin", "model-pools"], queryFn: getModelPools });
  const libraryQuery = useQuery({ queryKey: ["admin", "policy-recovery-library"], queryFn: getPolicyRecoveryLibrary });
  const statsQuery = useQuery({ queryKey: ["admin", "policy-recovery-stats"], queryFn: getPolicyRecoveryStats, refetchInterval: 30_000 });

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setDraft(structuredClone(settingsQuery.data.settings));
      setSelectedLayerId((current) => current || settingsQuery.data.settings.layers[0]?.id || "");
    }
  }, [settingsQuery.data?.settings]);

  const saveMutation = useMutation({
    mutationFn: (settings: PolicyRecoverySettings) => updatePolicyRecoverySettings(settings),
    onSuccess: (data) => {
      setDraft(structuredClone(data.settings));
      setNotice("完整破甲配置已保存并生成新版本");
      void queryClient.invalidateQueries({ queryKey: ["admin", "policy-recovery-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "policy-recovery-stats"] });
    },
    onError: (error) => setNotice(errorText(error)),
  });
  const resetLayerMutation = useMutation({
    mutationFn: resetPolicyRecoveryLayer,
    onSuccess: (settings) => {
      setDraft(structuredClone(settings));
      setNotice("该指令层已恢复内置版本");
      void queryClient.invalidateQueries({ queryKey: ["admin", "policy-recovery-settings"] });
    },
    onError: (error) => setNotice(errorText(error)),
  });
  const resetAllMutation = useMutation({
    mutationFn: resetAllPolicyRecoverySettings,
    onSuccess: (settings) => {
      setDraft(structuredClone(settings));
      setNotice("全部配置已恢复默认；全局总闸已关闭");
      void queryClient.invalidateQueries({ queryKey: ["admin", "policy-recovery-settings"] });
    },
    onError: (error) => setNotice(errorText(error)),
  });
  const poolMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateModelPool(id, { policyRecoveryEnabled: enabled }),
    onSuccess: () => {
      setNotice("模型池完整破甲开关已更新");
      void queryClient.invalidateQueries({ queryKey: ["admin", "model-pools"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "policy-recovery-stats"] });
    },
    onError: (error) => setNotice(errorText(error)),
  });
  const previewMutation = useMutation({
    mutationFn: previewPolicyRecovery,
    onSuccess: (result) => setPreviewResult(result),
    onError: (error) => setNotice(errorText(error)),
  });

  const selectedLayer = draft?.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const filteredLibrary = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    return (libraryQuery.data ?? []).filter((entry) => !query || entry.path.toLowerCase().includes(query) || entry.content.toLowerCase().includes(query));
  }, [libraryQuery.data, librarySearch]);
  const selectedLibrary = (libraryQuery.data ?? []).find((entry) => entry.path === selectedLibraryPath) ?? filteredLibrary[0] ?? null;
  const localMerged = useMemo(() => mergeLayers(draft?.layers ?? []), [draft?.layers]);
  const localBytes = new TextEncoder().encode(localMerged).byteLength;
  const limits = settingsQuery.data?.limits;
  const stats = statsQuery.data;
  const pools = poolsQuery.data?.modelPools ?? [];

  function updateLayer(layerId: string, patch: Partial<PolicyRecoveryLayer>) {
    setDraft((current) => current ? { ...current, layers: current.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer) } : current);
  }

  function runPreview() {
    try {
      const requestBody = JSON.parse(previewRequest) as Record<string, unknown>;
      const responseBody = previewResponse.trim() ? JSON.parse(previewResponse) : undefined;
      previewMutation.mutate({ endpoint: previewEndpoint, requestBody, responseStatus: 200, responseBody });
    } catch (error) {
      setNotice(`预览 JSON 格式错误：${errorText(error)}`);
    }
  }

  if (!draft) return <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">正在加载完整破甲配置…</div>;

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-4 pb-10">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700"><ShieldCheck className="h-4 w-4" />Policy Recovery Console</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">完整破甲功能</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">EXE 四层指令、净化 Seagull 专业规则与六个 Skill 固定组合。只有全局总闸和模型池开关同时开启时才进入注入、结构化拒绝识别、恢复重放和返回清洗链。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-800">
              <input type="checkbox" checked={draft.masterEnabled} onChange={(event) => setDraft({ ...draft, masterEnabled: event.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              全局总闸
            </label>
            <button className={secondaryButton} onClick={() => resetAllMutation.mutate()} disabled={resetAllMutation.isPending}><RotateCcw className="h-4 w-4" />恢复全部默认</button>
            <button className={primaryButton} onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending || localBytes > (limits?.maxMergedBytes ?? Infinity)}><Save className="h-4 w-4" />保存配置</button>
          </div>
        </div>
      </section>

      {notice ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">{notice}</div> : null}

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm" aria-label="破甲功能栏目">
        {tabs.map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`min-h-10 shrink-0 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${activeTab === tab ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>{tab}</button>)}
      </nav>

      {activeTab === "总览" ? <Overview draft={draft} bytes={localBytes} stats={stats} poolCount={pools.length} maxBytes={limits?.maxMergedBytes ?? 0} /> : null}
      {activeTab === "指令层" ? (
        <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-3 px-2 text-sm font-semibold text-slate-950">指令层顺序</div>
            <div className="grid gap-2">{draft.layers.map((layer, index) => <button key={layer.id} onClick={() => setSelectedLayerId(layer.id)} className={`rounded-lg border p-3 text-left ${selectedLayerId === layer.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-900">{index + 1}. {layer.name}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${layer.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{layer.enabled ? "启用" : "停用"}</span></div><div className="mt-1 text-xs text-slate-500">{layer.source.toUpperCase()} · {formatBytes(byteLength(layer.content))}</div></button>)}</div>
          </div>
          {selectedLayer ? <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-slate-950">{selectedLayer.name}</h2><p className="mt-1 text-xs text-slate-500">{selectedLayer.id} · 当前 {hashState(selectedLayer)}</p></div><div className="flex flex-wrap gap-2"><label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium"><input type="checkbox" checked={selectedLayer.enabled} onChange={(event) => updateLayer(selectedLayer.id, { enabled: event.target.checked })} className="h-4 w-4" />启用该层</label>{selectedLayer.source !== "custom" ? <button className={secondaryButton} onClick={() => resetLayerMutation.mutate(selectedLayer.id)}><RotateCcw className="h-4 w-4" />恢复内置</button> : null}</div></div><textarea value={selectedLayer.content} onChange={(event) => updateLayer(selectedLayer.id, { content: event.target.value })} className={`${textareaClass} mt-4 min-h-[540px] font-mono text-xs leading-5`} aria-label={`${selectedLayer.name}内容`} /><div className="mt-2 flex justify-between text-xs text-slate-500"><span>{formatBytes(byteLength(selectedLayer.content))} / {formatBytes(limits?.maxLayerBytes ?? 0)}</span><span>内置 SHA-256：{selectedLayer.builtinSha256 || "自定义层"}</span></div></div> : null}
        </section>
      ) : null}
      {activeTab === "合并预览" ? <CodeViewer title="真实注入顺序预览" content={localMerged} meta={`${formatBytes(localBytes)} · 约 ${Math.ceil(localBytes / 4).toLocaleString()} tokens`} /> : null}
      {activeTab === "恢复设置" ? <RecoverySettings draft={draft} setDraft={setDraft} limits={limits} /> : null}
      {activeTab === "模型池" ? <ModelPoolPanel pools={pools} masterEnabled={draft.masterEnabled} onToggle={(id, enabled) => poolMutation.mutate({ id, enabled })} /> : null}
      {activeTab === "资料库" ? <LibraryPanel entries={filteredLibrary} selected={selectedLibrary} search={librarySearch} setSearch={setLibrarySearch} select={setSelectedLibraryPath} /> : null}
      {activeTab === "审计监控" ? <AuditPanel stats={stats} /> : null}
      {activeTab === "测试预览" ? <PreviewPanel endpoint={previewEndpoint} setEndpoint={setPreviewEndpoint} request={previewRequest} setRequest={setPreviewRequest} response={previewResponse} setResponse={setPreviewResponse} result={previewResult} run={runPreview} loading={previewMutation.isPending} /> : null}
    </div>
  );
}

function Overview({ draft, bytes, stats, poolCount, maxBytes }: { draft: PolicyRecoverySettings; bytes: number; stats: Awaited<ReturnType<typeof getPolicyRecoveryStats>> | undefined; poolCount: number; maxBytes: number }) {
  const cards = [
    ["全局状态", draft.masterEnabled ? "已开启" : "已关闭"],
    ["模板版本", `v${draft.version}`],
    ["合并大小", formatBytes(bytes)],
    ["预计 Tokens", Math.ceil(bytes / 4).toLocaleString()],
    ["已启用模型池", `${stats?.enabledPools ?? 0} / ${poolCount}`],
    ["近 7 天恢复率", `${((stats?.recoveryRate ?? 0) * 100).toFixed(1)}%`],
  ];
  return <div className="grid gap-4"><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-2 text-xl font-bold text-slate-950">{value}</div></div>)}</section><section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-base font-semibold text-slate-950">执行条件</h2><div className="mt-4 grid gap-3 md:grid-cols-3"><StatusStep active={draft.masterEnabled} title="1. 全局总闸" text="关闭时所有模型池严格走原流程" /><StatusStep active={(stats?.enabledPools ?? 0) > 0} title="2. 模型池开关" text="只有开启池才进入完整破甲链" /><StatusStep active={bytes <= maxBytes} title="3. 模板校验" text={`${formatBytes(bytes)} / ${formatBytes(maxBytes)}`} /></div></section></div>;
}

function RecoverySettings({ draft, setDraft, limits }: { draft: PolicyRecoverySettings; setDraft: (value: PolicyRecoverySettings) => void; limits: Awaited<ReturnType<typeof getPolicyRecoverySettings>>["limits"] | undefined }) {
  return <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div><h2 className="text-lg font-semibold text-slate-950">恢复与探测参数</h2><p className="mt-1 text-sm text-slate-500">只识别结构化 JSON、Header 和 SSE 信号；普通 HTTP 200 文本拒绝不触发恢复。</p></div><div className="grid gap-4 lg:grid-cols-3"><NumberField label="每渠道恢复次数" value={draft.maxRecoveries} min={0} max={3} onChange={(value) => setDraft({ ...draft, maxRecoveries: value })} /><NumberField label="SSE 探测字节" value={draft.sseProbeBytes} min={limits?.minSseProbeBytes ?? 16384} max={limits?.maxSseProbeBytes ?? 1048576} onChange={(value) => setDraft({ ...draft, sseProbeBytes: value })} /><NumberField label="最大检测响应字节" value={draft.maxInspectableResponseBytes} min={limits?.minInspectableResponseBytes ?? 1048576} max={limits?.maxInspectableResponseBytes ?? 134217728} onChange={(value) => setDraft({ ...draft, maxInspectableResponseBytes: value })} /></div><label className="grid gap-2"><span className="text-sm font-semibold text-slate-800">恢复重放模板</span><textarea value={draft.retryInstructionsTemplate} onChange={(event) => setDraft({ ...draft, retryInstructionsTemplate: event.target.value })} className={`${textareaClass} min-h-[260px] font-mono text-xs leading-5`} /><span className="text-xs text-slate-500">变量：{"{{attempt}}"}、{"{{maxAttempts}}"}、{"{{signal}}"}、{"{{provider}}"}、{"{{model}}"}</span></label></section>;
}

function ModelPoolPanel({ pools, masterEnabled, onToggle }: { pools: Awaited<ReturnType<typeof getModelPools>>["modelPools"]; masterEnabled: boolean; onToggle: (id: string, enabled: boolean) => void }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-950">模型池完整破甲开关</h2><p className="mt-1 text-sm text-slate-500">模型池只控制开关；所有开启池共享当前全局套件。</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${masterEnabled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{masterEnabled ? "全局总闸已开" : "全局总闸已关"}</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-3">模型</th><th className="px-3 py-3">等级</th><th className="px-3 py-3">渠道</th><th className="px-3 py-3">状态</th><th className="px-3 py-3 text-right">完整破甲</th></tr></thead><tbody>{pools.map((pool) => <tr key={pool.id} className="border-b border-slate-100"><td className="px-3 py-3 font-semibold text-slate-950">{pool.model}</td><td className="px-3 py-3 text-slate-600">{pool.tier?.name ?? "Free"}</td><td className="px-3 py-3 text-slate-600">{pool.channels.length}</td><td className="px-3 py-3 text-slate-600">{pool.status}</td><td className="px-3 py-3 text-right"><input aria-label={`${pool.model} ${pool.tier?.name ?? "Free"}完整破甲`} type="checkbox" checked={pool.policyRecoveryEnabled} onChange={(event) => onToggle(pool.id, event.target.checked)} className="h-4 w-4 rounded border-slate-300" /></td></tr>)}</tbody></table></div></section>;
}

function LibraryPanel({ entries, selected, search, setSearch, select }: { entries: Awaited<ReturnType<typeof getPolicyRecoveryLibrary>>; selected: Awaited<ReturnType<typeof getPolicyRecoveryLibrary>>[number] | null; search: string; setSearch: (value: string) => void; select: (path: string) => void }) {
  return <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]"><div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 references 和 scripts" className={`${inputClass} pl-9`} /></label><div className="mt-3 grid max-h-[680px] gap-1 overflow-y-auto">{entries.map((entry) => <button key={entry.path} onClick={() => select(entry.path)} className={`rounded-lg px-3 py-2 text-left ${selected?.path === entry.path ? "bg-blue-50 text-blue-800" : "hover:bg-slate-50"}`}><div className="flex items-center gap-2 text-sm font-medium"><FileCode2 className="h-4 w-4 shrink-0" /><span className="truncate">{entry.path}</span></div><div className="mt-1 text-xs text-slate-500">{entry.kind} · {formatBytes(entry.bytes)}</div></button>)}</div></div>{selected ? <CodeViewer title={selected.path} content={selected.content} meta={`${selected.kind} · ${formatBytes(selected.bytes)} · ${selected.sha256}`} /> : null}</section>;
}

function AuditPanel({ stats }: { stats: Awaited<ReturnType<typeof getPolicyRecoveryStats>> | undefined }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid gap-3 sm:grid-cols-4"><Metric label="近 7 天请求" value={stats?.totalRequests ?? 0} /><Metric label="恢复成功" value={stats?.recovered ?? 0} /><Metric label="恢复耗尽" value={stats?.exhausted ?? 0} /><Metric label="恢复率" value={`${((stats?.recoveryRate ?? 0) * 100).toFixed(1)}%`} /></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead><tr className="border-b border-slate-200 text-slate-500"><th className="px-3 py-3">时间</th><th className="px-3 py-3">模型</th><th className="px-3 py-3">等级</th><th className="px-3 py-3">上游</th><th className="px-3 py-3">HTTP</th><th className="px-3 py-3">结果</th><th className="px-3 py-3">恢复次数</th><th className="px-3 py-3">延迟</th></tr></thead><tbody>{(stats?.recentRequests ?? []).map((row, index) => { const audit = record(row.audit); return <tr key={String(row.id ?? index)} className="border-b border-slate-100"><td className="px-3 py-3 text-slate-600">{formatDate(row.createdAt)}</td><td className="px-3 py-3 font-medium text-slate-900">{String(row.model ?? "-")}</td><td className="px-3 py-3 text-slate-600">{String(record(row.accessTier)?.name ?? "-")}</td><td className="px-3 py-3 text-slate-600">{String(row.upstreamProvider ?? "-")}</td><td className="px-3 py-3">{String(row.httpStatus ?? "-")}</td><td className="px-3 py-3">{String(audit?.finalOutcome ?? "-")}</td><td className="px-3 py-3">{String(audit?.totalRecoveries ?? 0)}</td><td className="px-3 py-3">{row.latencyMs ? `${row.latencyMs} ms` : "-"}</td></tr>; })}</tbody></table></div></section>;
}

function PreviewPanel({ endpoint, setEndpoint, request, setRequest, response, setResponse, result, run, loading }: { endpoint: "/v1/responses" | "/v1/responses/compact" | "/v1/chat/completions"; setEndpoint: (value: typeof endpoint) => void; request: string; setRequest: (value: string) => void; response: string; setResponse: (value: string) => void; result: Record<string, unknown> | null; run: () => void; loading: boolean }) {
  return <section className="grid gap-4"><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="grid flex-1 gap-2"><span className="text-sm font-semibold text-slate-800">接口</span><select value={endpoint} onChange={(event) => setEndpoint(event.target.value as typeof endpoint)} className={inputClass}><option>/v1/responses</option><option>/v1/responses/compact</option><option>/v1/chat/completions</option></select></label><button className={primaryButton} onClick={run} disabled={loading}><Eye className="h-4 w-4" />生成离线预览</button></div><div className="mt-4 grid gap-4 xl:grid-cols-2"><label className="grid gap-2"><span className="text-sm font-semibold text-slate-800">模拟请求 JSON</span><textarea value={request} onChange={(event) => setRequest(event.target.value)} className={`${textareaClass} min-h-[260px] font-mono text-xs`} /></label><label className="grid gap-2"><span className="text-sm font-semibold text-slate-800">模拟响应 JSON（用于检测信号）</span><textarea value={response} onChange={(event) => setResponse(event.target.value)} className={`${textareaClass} min-h-[260px] font-mono text-xs`} /></label></div></div>{result ? <CodeViewer title="预览结果" content={JSON.stringify(result, null, 2)} meta="仅本地构造，不调用上游、不产生费用" /> : null}</section>;
}

function CodeViewer({ title, content, meta }: { title: string; content: string; meta: string }) { return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-950">{title}</h2><p className="mt-1 break-all text-xs text-slate-500">{meta}</p></div><button className={secondaryButton} onClick={() => void navigator.clipboard.writeText(content)}><Copy className="h-4 w-4" />复制</button></div><pre className="mt-4 max-h-[720px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100">{content}</pre></section>; }
function StatusStep({ active, title, text }: { active: boolean; title: string; text: string }) { return <div className={`rounded-lg border p-4 ${active ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CheckCircle2 className={`h-4 w-4 ${active ? "text-emerald-600" : "text-amber-600"}`} />{title}</div><p className="mt-2 text-xs leading-5 text-slate-600">{text}</p></div>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-xl font-bold text-slate-950">{value}</div></div>; }
function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) { return <label className="grid gap-2"><span className="text-sm font-semibold text-slate-800">{label}</span><input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className={inputClass} /><span className="text-xs text-slate-500">范围 {min.toLocaleString()} – {max.toLocaleString()}</span></label>; }
function mergeLayers(layers: PolicyRecoveryLayer[]) { return layers.filter((layer) => layer.enabled).map((layer) => `[POLICY_RECOVERY_LAYER:${layer.id}]\n${layer.content.trim()}\n[/POLICY_RECOVERY_LAYER:${layer.id}]`).join("\n\n"); }
function byteLength(value: string) { return new TextEncoder().encode(value).byteLength; }
function formatBytes(value: number) { if (!value) return "0 B"; if (value < 1024) return `${value} B`; return `${(value / 1024).toFixed(1)} KiB`; }
function hashState(layer: PolicyRecoveryLayer) { return layer.builtinSha256 ? "可恢复内置版本" : "自定义层"; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function formatDate(value: unknown) { const date = new Date(String(value ?? "")); return Number.isNaN(date.valueOf()) ? "-" : date.toLocaleString("zh-CN", { hour12: false }); }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const inputClass = "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass = "w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
