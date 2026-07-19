"use client";

import {
  Braces,
  Eye,
  EyeOff,
  KeyRound,
  RotateCcw,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiFetch, apiV1BaseUrl } from "../../../lib/api";
import { formatNumber, seconds } from "../../../lib/format";
import type { FrontAvailableModel } from "../../../lib/types/front";
import {
  FrontAlert,
  FrontBadge,
  FrontButton,
  FrontCard,
  FrontCodeBlock,
  FrontCopyButton,
  FrontField,
  FrontIconButton,
  useFrontToast,
} from "./ui/front-ui";

export type AvailableModel = FrontAvailableModel;

type TestResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  outputText: string;
  body: string;
  usage?: unknown;
  error?: string;
};

type StreamSnapshot = {
  raw: string;
  outputText: string;
  usage?: unknown;
};

export function CallTester({
  availableModels,
  onChanged,
}: {
  availableModels: FrontAvailableModel[];
  onChanged: () => Promise<void> | void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [endpoint, setEndpoint] = useState<"responses" | "chat">("responses");
  const [model, setModel] = useState("gpt-4o-mini");
  const [prompt, setPrompt] = useState("用一句话回复：API 网关测试成功。");
  const [stream, setStream] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toast = useFrontToast();

  const readyModels = useMemo(
    () => availableModels.filter((item) => item.status === "READY").map((item) => item.model),
    [availableModels],
  );

  useEffect(() => {
    if (readyModels.length > 0 && !readyModels.includes(model)) {
      setModel(readyModels[0] ?? model);
    }
  }, [readyModels.join("|"), model]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const gatewayUrl = `${apiV1BaseUrl}${endpoint === "responses" ? "/responses" : "/chat/completions"}`;

  async function createTestKey() {
    if (creatingKey || loading) return;
    setCreatingKey(true);
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const created = await apiFetch<{ secret: string }>("/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: `test-${new Date().toISOString().slice(0, 19)}`,
          rateLimitPerMinute: 60,
          concurrencyLimit: 1,
          expiresAt,
          allowedModels: [],
          tags: ["test", "24h"],
          ipWhitelist: [],
        }),
      });
      setApiKey(created.secret);
      toast("已创建 24 小时测试 Key");
      try {
        await onChanged();
      } catch (refreshError) {
        toast(
          `测试 Key 已创建，但 Key 列表刷新失败：${errorToText(refreshError)}`,
          "error",
        );
      }
    } catch (error) {
      toast(errorToText(error), "error");
    } finally {
      setCreatingKey(false);
    }
  }

  async function runTest(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (loading) return;
    if (!apiKey.trim()) {
      toast("请先粘贴 API Key，或创建一枚 24 小时测试 Key", "error");
      return;
    }
    if (!model.trim()) {
      toast("请选择或输入模型名称", "error");
      return;
    }
    if (!prompt.trim()) {
      toast("请输入测试 Prompt", "error");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setResult({
      ok: false,
      status: 0,
      latencyMs: 0,
      outputText: "",
      body: "",
    });
    const startedAt = performance.now();

    try {
      const requestBody =
        endpoint === "responses"
          ? { model: model.trim(), stream, input: prompt }
          : {
              model: model.trim(),
              stream,
              messages: [{ role: "user", content: prompt }],
            };
      const response = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (stream && response.body) {
        const snapshot = await readStreamingResponse(response, (nextSnapshot) => {
          setResult({
            ok: response.ok,
            status: response.status,
            latencyMs: Math.round(performance.now() - startedAt),
            outputText: nextSnapshot.outputText,
            body: nextSnapshot.raw,
            usage: nextSnapshot.usage,
          });
        });
        setResult({
          ok: response.ok,
          status: response.status,
          latencyMs: Math.round(performance.now() - startedAt),
          outputText: snapshot.outputText,
          body: snapshot.raw,
          usage: snapshot.usage,
          error: response.ok ? undefined : snapshot.raw || `HTTP ${response.status}`,
        });
      } else {
        const text = await response.text();
        const parsed = parseJson(text);
        setResult({
          ok: response.ok,
          status: response.status,
          latencyMs: Math.round(performance.now() - startedAt),
          outputText: parsed ? extractOutputText(parsed) : "",
          body: parsed ? JSON.stringify(parsed, null, 2) : text,
          usage: getUsage(parsed),
          error: response.ok ? undefined : extractError(parsed, text),
        });
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setResult((current) => ({
        ok: false,
        status: current?.status ?? 0,
        latencyMs: Math.round(performance.now() - startedAt),
        outputText: current?.outputText ?? "",
        body: current?.body ?? "",
        usage: current?.usage,
        error: aborted ? "请求已由用户停止" : errorToText(error),
      }));
    } finally {
      setLoading(false);
      abortRef.current = null;
      try {
        await onChanged();
      } catch (refreshError) {
        toast(`请求已结束，但用量刷新失败：${errorToText(refreshError)}`, "error");
      }
    }
  }

  function stopTest() {
    abortRef.current?.abort();
  }

  return (
    <div className="front-test-layout">
      <FrontCard className="front-test-form-card">
        <div className="front-page-section-head">
          <div>
            <h2>请求配置</h2>
            <p>配置接口、模型、响应模式和 Prompt 后发送真实网关请求。</p>
          </div>
          <FrontButton
            variant="secondary"
            loading={creatingKey}
            disabled={loading}
            onClick={() => void createTestKey()}
          >
            {creatingKey ? null : <KeyRound aria-hidden="true" size={17} />}
            {creatingKey ? "创建中" : "创建 24 小时测试 Key"}
          </FrontButton>
        </div>
        <FrontAlert tone="info">
          “创建测试 Key”会生成一枚新密钥，并默认设置为 24 小时后过期。
        </FrontAlert>

        <form className="front-test-form" onSubmit={runTest}>
          <FrontField label="API Key" htmlFor="front-test-api-key" required hint="敏感信息不会以普通文本自动填充">
            <div className="front-input-affix front-input-affix-action">
              <KeyRound aria-hidden="true" size={18} />
              <input
                id="front-test-api-key"
                className="front-input front-input-mono"
                type={showApiKey ? "text" : "password"}
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk_live_..."
                disabled={loading || creatingKey}
              />
              <FrontIconButton
                label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                onClick={() => setShowApiKey((current) => !current)}
              >
                {showApiKey ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
              </FrontIconButton>
            </div>
          </FrontField>

          <div className="front-test-form-grid">
            <FrontField label="接口" htmlFor="front-test-endpoint">
              <div className="front-segmented front-test-endpoint" id="front-test-endpoint">
                <button
                  aria-pressed={endpoint === "responses"}
                  className={`front-segment-button${endpoint === "responses" ? " front-active" : ""}`}
                  type="button"
                  disabled={loading}
                  onClick={() => setEndpoint("responses")}
                >
                  Responses
                </button>
                <button
                  aria-pressed={endpoint === "chat"}
                  className={`front-segment-button${endpoint === "chat" ? " front-active" : ""}`}
                  type="button"
                  disabled={loading}
                  onClick={() => setEndpoint("chat")}
                >
                  Chat
                </button>
              </div>
            </FrontField>
            <FrontField label="模型" htmlFor="front-test-model" required hint="可搜索建议，也可输入自定义模型名">
              <input
                id="front-test-model"
                className="front-input front-input-mono"
                list="front-test-models"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={loading}
              />
              <datalist id="front-test-models">
                {readyModels.map((item) => <option key={item} value={item} />)}
              </datalist>
            </FrontField>
          </div>

          <div className="front-gateway-row">
            <div>
              <span>网关地址</span>
              <code>{gatewayUrl}</code>
            </div>
            <FrontCopyButton value={gatewayUrl} label="复制网关地址" compact />
          </div>

          <label className="front-switch-row">
            <span>
              <strong>流式响应</strong>
              <small>开启后实时追加模型文本，可随时停止请求。</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={stream}
              disabled={loading}
              onChange={(event) => setStream(event.target.checked)}
            />
          </label>

          <FrontField label="测试 Prompt" htmlFor="front-test-prompt" required>
            <textarea
              id="front-test-prompt"
              className="front-textarea front-test-prompt"
              value={prompt}
              disabled={loading}
              maxLength={12000}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className="front-prompt-meta">
              <span>{prompt.length} / 12000 字符</span>
              <button type="button" disabled={loading || !prompt} onClick={() => setPrompt("")}>
                <Trash2 aria-hidden="true" size={14} /> 清空
              </button>
            </div>
          </FrontField>

          <div className="front-test-actions">
            <FrontButton type="submit" loading={loading} disabled={loading}>
              {loading ? "请求中" : <><Send aria-hidden="true" size={18} />发送请求</>}
            </FrontButton>
            {loading && stream ? (
              <FrontButton variant="secondary" type="button" onClick={stopTest}>
                <Square aria-hidden="true" size={16} /> 停止
              </FrontButton>
            ) : null}
          </div>
        </form>
      </FrontCard>

      <FrontCard className="front-test-result-card">
        <div className="front-page-section-head">
          <div>
            <h2>测试结果</h2>
            <p>状态、HTTP、耗时、模型回复、Usage 与原始响应。</p>
          </div>
          {result ? (
            <FrontButton variant="secondary" disabled={loading} onClick={() => void runTest()}>
              <RotateCcw aria-hidden="true" size={17} /> 重新发送
            </FrontButton>
          ) : null}
        </div>

        {result ? (
          <div className="front-test-result">
            <div className="front-test-status-grid">
              <ResultMetric
                label="状态"
                value={loading ? "处理中" : result.ok ? "成功" : "失败"}
                tone={loading ? "warning" : result.ok ? "success" : "danger"}
              />
              <ResultMetric label="HTTP" value={result.status ? String(result.status) : "-"} />
              <ResultMetric label="耗时" value={seconds(result.latencyMs)} />
            </div>

            {result.error ? (
              <FrontAlert tone="error" title="请求失败">
                <div className="front-test-error-copy"><span>{result.error}</span><FrontButton variant="secondary" onClick={() => void runTest()}>重新发送</FrontButton></div>
              </FrontAlert>
            ) : null}

            <section className="front-answer-panel">
              <div className="front-result-section-head">
                <h3>模型回复</h3>
                <FrontCopyButton value={result.outputText} label="复制回复" compact />
              </div>
              <div className="front-answer-body">
                {result.outputText || (loading ? "正在等待模型输出…" : "响应中没有可读文本。")}
              </div>
            </section>

            {result.usage ? <UsageMetrics usage={result.usage} /> : null}

            <details className="front-raw-response">
              <summary><Braces aria-hidden="true" size={17} /> 原始响应 JSON / SSE</summary>
              <div>
                <FrontCodeBlock value={result.body || "暂无原始响应"} label="原始响应" />
              </div>
            </details>
          </div>
        ) : (
          <div className="front-test-empty">
            <Send aria-hidden="true" size={26} />
            <strong>等待发送测试请求</strong>
            <p>结果区域会固定保留尺寸，避免请求过程中页面布局跳动。</p>
          </div>
        )}
      </FrontCard>
    </div>
  );
}

function ResultMetric({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="front-result-metric">
      <span>{label}</span>
      {tone ? <FrontBadge tone={tone}>{value}</FrontBadge> : <strong className="front-data-number">{value}</strong>}
    </div>
  );
}

function UsageMetrics({ usage }: { usage: unknown }) {
  const metrics = normalizeUsage(usage);
  return (
    <section className="front-usage-panel">
      <div className="front-result-section-head"><h3>Usage</h3><FrontCopyButton value={JSON.stringify(usage, null, 2)} label="复制 Usage" compact /></div>
      <div className="front-usage-grid">
        <ResultMetric label="输入 Token" value={formatNumber(metrics.input)} />
        <ResultMetric label="缓存 Token" value={formatNumber(metrics.cached)} />
        <ResultMetric label="输出 Token" value={formatNumber(metrics.output)} />
        <ResultMetric label="总 Token" value={formatNumber(metrics.total)} />
      </div>
    </section>
  );
}

async function readStreamingResponse(
  response: Response,
  onUpdate: (snapshot: StreamSnapshot) => void,
): Promise<StreamSnapshot> {
  if (!response.body) return { raw: "", outputText: "" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    onUpdate({
      raw,
      outputText: extractOutputFromSse(raw),
      usage: extractUsageFromSse(raw),
    });
  }
  raw += decoder.decode();
  const snapshot = {
    raw,
    outputText: extractOutputFromSse(raw),
    usage: extractUsageFromSse(raw),
  };
  onUpdate(snapshot);
  return snapshot;
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractOutputText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  if ("response" in value) return extractOutputText(value.response);
  if ("output_text" in value && typeof value.output_text === "string") return value.output_text;
  if ("choices" in value && Array.isArray(value.choices)) {
    return value.choices.map((choice) => {
      if (!choice || typeof choice !== "object") return "";
      if ("message" in choice && choice.message && typeof choice.message === "object" && "content" in choice.message && typeof choice.message.content === "string") return choice.message.content;
      if ("text" in choice && typeof choice.text === "string") return choice.text;
      if ("delta" in choice && choice.delta && typeof choice.delta === "object" && "content" in choice.delta && typeof choice.delta.content === "string") return choice.delta.content;
      return "";
    }).filter(Boolean).join("\n");
  }
  if ("output" in value && Array.isArray(value.output)) {
    return value.output.flatMap((item) => item && typeof item === "object" && "content" in item && Array.isArray(item.content) ? item.content : []).map((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n");
  }
  if ("delta" in value && typeof value.delta === "string") return value.delta;
  return "";
}

function extractOutputFromSse(text: string) {
  const fragments: string[] = [];
  let finalText = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const parsed = parseJson(payload);
    const extracted = extractOutputText(parsed);
    if (!extracted) continue;
    if (parsed && typeof parsed === "object" && "delta" in parsed) fragments.push(extracted);
    else if (parsed && typeof parsed === "object" && "choices" in parsed) fragments.push(extracted);
    else finalText = extracted;
  }
  return finalText || fragments.join("");
}

function extractUsageFromSse(text: string) {
  let usage: unknown;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const parsed = parseJson(line.slice(5).trim());
    if (parsed && typeof parsed === "object" && "usage" in parsed) {
      usage = parsed.usage;
    } else if (
      parsed &&
      typeof parsed === "object" &&
      "response" in parsed &&
      parsed.response &&
      typeof parsed.response === "object" &&
      "usage" in parsed.response
    ) {
      usage = parsed.response.usage;
    }
  }
  return usage;
}

function getUsage(value: unknown) {
  return value && typeof value === "object" && "usage" in value ? value.usage : undefined;
}

function extractError(value: unknown, fallback: string) {
  if (value && typeof value === "object") {
    if ("message" in value && typeof value.message === "string") return value.message;
    if ("error" in value && value.error && typeof value.error === "object" && "message" in value.error && typeof value.error.message === "string") return value.error.message;
  }
  return fallback || "请求失败";
}

function normalizeUsage(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const input = numberFrom(source.input_tokens ?? source.prompt_tokens);
  const output = numberFrom(source.output_tokens ?? source.completion_tokens);
  const total = numberFrom(source.total_tokens) || input + output;
  const details = source.input_tokens_details && typeof source.input_tokens_details === "object" ? source.input_tokens_details as Record<string, unknown> : source.prompt_tokens_details && typeof source.prompt_tokens_details === "object" ? source.prompt_tokens_details as Record<string, unknown> : {};
  const cached = numberFrom(details.cached_tokens);
  return { input, cached, output, total };
}

function numberFrom(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}
