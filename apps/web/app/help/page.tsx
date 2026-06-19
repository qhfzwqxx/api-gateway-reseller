import {
  Activity,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Code2,
  CreditCard,
  ExternalLink,
  KeyRound,
  LifeBuoy,
  LockKeyhole,
  MessageSquareText,
  Route,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { EmergencyAdminCallButton } from "./emergency-admin-call-button";

const quickSteps = [
  {
    icon: KeyRound,
    title: "创建 API Key",
    body: "登录控制台后进入密钥管理，创建一枚用于服务端调用的 API Key。",
  },
  {
    icon: CreditCard,
    title: "确认余额",
    body: "在钱包里完成充值或领取可用额度，网关会按实际模型消耗计费。",
  },
  {
    icon: TerminalSquare,
    title: "替换 Base URL",
    body: "把 SDK 的 Base URL 替换为 https://gateway.l-kx.cn/v1 即可开始调用。",
  },
];

const endpoints = [
  {
    method: "POST",
    path: "/v1/chat/completions",
    desc: "OpenAI 兼容聊天补全接口，支持流式返回。",
  },
  {
    method: "POST",
    path: "/v1/responses",
    desc: "OpenAI Responses 兼容接口，适合新项目接入。",
  },
  {
    method: "POST",
    path: "/v1/embeddings",
    desc: "Embedding 向量接口，按账号密钥权限和后台路由转发。",
  },
  {
    method: "POST",
    path: "/v1/completions",
    desc: "旧版 Completions 兼容接口。",
  },
  {
    method: "POST",
    path: "/v1/images/generations",
    desc: "图片生成接口，需使用后台已配置可用的模型和上游。",
  },
  {
    method: "POST",
    path: "/v1/images/edits",
    desc: "图片编辑接口，支持 multipart 请求转发。",
  },
];

const faqs = [
  {
    q: "APIshare 的调用方式和 OpenAI SDK 兼容吗？",
    a: "兼容。大多数 SDK 只需要把 baseURL 设置为 https://gateway.l-kx.cn/v1，并把 API Key 改成 APIshare 控制台生成的密钥。",
  },
  {
    q: "为什么请求会返回余额不足或并发限制？",
    a: "网关会在请求进入上游前检查账号余额、密钥状态、频率限制和并发限制。请在控制台查看钱包、密钥和用量记录。",
  },
  {
    q: "模型不可用时应该怎么处理？",
    a: "建议客户端保留重试和降级模型策略。若控制台显示模型已开放但仍不可用，请带上请求时间、模型名和错误信息联系支持。",
  },
];

export const metadata = {
  title: "帮助中心 | APIshare",
  description: "APIshare 网关接入文档、调用示例、计费说明和常见问题。",
};

export default function HelpPage() {
  return (
    <main className="h-dvh overflow-x-hidden overflow-y-auto bg-[#f6f8fb] text-slate-950">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-5 sm:min-h-[76vh] sm:px-8 sm:py-6 lg:px-10">
          <header className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
            <Link
              href="/"
              className="flex min-h-11 min-w-0 items-center gap-3 rounded-md px-1 text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <span className="grid size-10 place-items-center rounded-md border border-blue-200 bg-blue-50 text-blue-700">
                <Route className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold leading-tight">
                  APIshare
                </span>
                <span className="block text-sm leading-tight text-slate-500">
                  Gateway Docs
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                控制台
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </header>

          <div className="grid flex-1 items-center gap-6 py-8 sm:gap-10 sm:py-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(360px,0.72fr)] lg:py-16">
            <div className="min-w-0 max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">
                <Sparkles className="size-4" aria-hidden="true" />
                OpenAI 兼容网关
              </div>
              <h1 className="text-3xl font-bold leading-tight tracking-normal text-slate-950 sm:text-5xl lg:text-6xl">
                APIshare 帮助中心
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:mt-6 sm:text-lg sm:leading-8">
                从创建密钥、替换网关地址到查看用量和处理错误，这里放着接入
                APIshare 网关最常用的信息。
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row">
                <a
                  href="#quick-start"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  快速接入
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
                <a
                  href="#examples"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  查看示例
                  <Code2 className="size-4" aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-950 p-3 shadow-xl sm:p-4">
              <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-3 text-sm text-slate-300">
                <span className="size-3 rounded-full bg-red-400" />
                <span className="size-3 rounded-full bg-amber-300" />
                <span className="size-3 rounded-full bg-emerald-400" />
                <span className="ml-2 font-medium">curl</span>
              </div>
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-slate-100 sm:text-sm sm:leading-7">
                <code>{`curl https://gateway.l-kx.cn/v1/chat/completions \\
  -H "Authorization: Bearer $APISHARE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "user", "content": "你好，介绍一下 APIshare" }
    ],
    "stream": true
  }'`}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section
        id="quick-start"
        className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-8 sm:px-8 sm:py-10 lg:grid-cols-3 lg:px-10"
      >
        {quickSteps.map((step) => (
          <article
            key={step.title}
            className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <step.icon className="mb-4 size-6 text-blue-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-slate-950">
              {step.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
          </article>
        ))}
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-10 sm:px-8 sm:pb-12 lg:grid-cols-[0.9fr_1.1fr] lg:px-10">
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <BookOpen className="size-6 text-blue-600" aria-hidden="true" />
            <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">
              支持的网关端点
            </h2>
          </div>
          <div className="divide-y divide-slate-200">
            {endpoints.map((endpoint) => (
              <div
                key={endpoint.path}
                className="grid min-w-0 gap-2 py-4 sm:grid-cols-[92px_1fr]"
              >
                <span className="w-fit rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  {endpoint.method}
                </span>
                <div className="min-w-0">
                  <code className="break-words font-mono text-sm font-semibold text-slate-950">
                    {endpoint.path}
                  </code>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {endpoint.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          id="examples"
          className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
        >
          <div className="mb-5 flex items-center gap-3">
            <Code2 className="size-6 text-blue-600" aria-hidden="true" />
            <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">
              SDK 示例
            </h2>
          </div>
          <pre className="max-w-full overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-slate-100 sm:p-4 sm:text-sm sm:leading-7">
            <code>{`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.APISHARE_API_KEY,
  baseURL: "https://gateway.l-kx.cn/v1",
});

const result = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "写一段欢迎语" }],
});`}</code>
          </pre>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <InfoLine icon={LockKeyhole} text="API Key 只放在服务端环境变量中。" />
            <InfoLine icon={ShieldCheck} text="生产环境建议配置超时、重试和日志脱敏。" />
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-8 sm:px-8 sm:py-10 lg:grid-cols-3 lg:px-10">
          <InfoPanel
            icon={WalletCards}
            title="余额与计费"
            body="控制台会展示钱包余额、充值记录和调用扣费记录。不同模型按后台价格策略结算。"
          />
          <InfoPanel
            icon={Activity}
            title="用量记录"
            body="请求列表可查看模型、状态、Token、耗时和扣费，方便定位异常调用。"
          />
          <InfoPanel
            icon={MessageSquareText}
            title="错误反馈"
            body="联系支持时请附上请求时间、模型名、状态码和响应错误信息，排查会更快。"
          />
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-8 sm:py-12 lg:grid-cols-[1fr_360px] lg:px-10">
        <div className="min-w-0">
          <div className="mb-6 flex items-center gap-3">
            <LifeBuoy className="size-6 text-blue-600" aria-hidden="true" />
            <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">
              常见问题
            </h2>
          </div>
          <div className="grid gap-4">
            {faqs.map((faq) => (
              <article
                key={faq.q}
                className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
              >
                <h3 className="text-base font-semibold text-slate-950">
                  {faq.q}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{faq.a}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="min-w-0 rounded-lg border border-blue-200 bg-blue-50 p-4 sm:p-6">
          <CheckCircle2 className="size-7 text-blue-700" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-bold text-slate-950">接入检查</h2>
          <ul className="mt-4 grid gap-3 text-sm leading-6 text-slate-700">
            <li>已生成 API Key</li>
            <li>已设置服务端环境变量</li>
            <li>已替换 SDK Base URL</li>
            <li>已确认模型名和账号余额</li>
          </ul>
          <Link
            href="/"
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            进入控制台
            <ExternalLink className="size-4" aria-hidden="true" />
          </Link>
          <div className="mt-4 border-t border-blue-200 pt-4">
            <EmergencyAdminCallButton />
          </div>
        </aside>
      </section>
    </main>
  );
}

function InfoLine({
  icon: Icon,
  text,
}: {
  icon: typeof LockKeyhole;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
      <Icon className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function InfoPanel({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof WalletCards;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 p-5">
      <Icon className="mb-4 size-6 text-blue-600" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </article>
  );
}
