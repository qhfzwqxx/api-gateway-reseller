import {
  Activity,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  CreditCard,
  KeyRound,
  LifeBuoy,
  LockKeyhole,
  Route,
  ShieldCheck,
  Terminal,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { configuredApiV1BaseUrl } from "../../lib/public-config";
import {
  FrontBadge,
  FrontCard,
  FrontCodeBlock,
  FrontCopyButton,
  FrontLogo,
  FrontProviders,
} from "../front/_components/ui/front-ui";
import { EmergencyAdminCallButton } from "./emergency-admin-call-button";

export const metadata = {
  title: "帮助中心 | APIshare",
  description: "APIshare 网关接入文档、调用示例、计费说明和常见问题。",
};

export default function HelpPage() {
  const baseUrl = configuredApiV1BaseUrl();
  const curlExample = `curl ${baseUrl}/responses \\
  -H "Authorization: Bearer $APISHARE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4.1",
    "input": "Hello from APIshare"
  }'`;
  const nodeExample = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.APISHARE_API_KEY,
  baseURL: "${baseUrl}"
});

const response = await client.responses.create({
  model: "gpt-4.1",
  input: "Hello from APIshare"
});

console.log(response.output_text);`;
  const pythonExample = `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["APISHARE_API_KEY"],
    base_url="${baseUrl}"
)

response = client.responses.create(
    model="gpt-4.1",
    input="Hello from APIshare"
)

print(response.output_text)`;

  return (
    <FrontProviders>
      <main id="top" className="front-public-page front-help-page">
        <header className="front-public-header front-help-header">
          <Link href="/" aria-label="APIshare 控制台"><FrontLogo /></Link>
          <nav aria-label="帮助中心公共导航">
            <Link href="/">进入控制台</Link>
            <a href="#top"><ArrowUp aria-hidden="true" size={16} />返回顶部</a>
          </nav>
        </header>

        <section className="front-help-hero">
          <div>
            <FrontBadge tone="primary"><BookOpen aria-hidden="true" size={14} />开发者文档</FrontBadge>
            <h1>APIshare 接入帮助中心</h1>
            <p>从创建 API Key、替换 Base URL 到理解计费与排查错误，按步骤完成稳定接入。</p>
            <div className="front-help-hero-actions">
              <Link className="front-button front-button-primary" href="/?tab=keys"><KeyRound aria-hidden="true" size={17} />创建 API Key</Link>
              <Link className="front-button front-button-secondary" href="/?tab=test"><Terminal aria-hidden="true" size={17} />打开调用测试</Link>
            </div>
          </div>
          <div className="front-help-base-url">
            <span>Base URL</span>
            <code>{baseUrl}</code>
            <FrontCopyButton value={baseUrl} label="复制 Base URL" />
          </div>
        </section>

        <div className="front-help-content">
          <section aria-labelledby="help-quick-start">
            <div className="front-help-section-head"><div><span>01</span><h2 id="help-quick-start">快速开始</h2></div><p>完成三个基础步骤即可发起第一条请求。</p></div>
            <div className="front-help-card-grid">
              <HelpStep icon={<KeyRound aria-hidden="true" size={20} />} title="创建 API Key" body="进入控制台的 API Key 页面，创建一枚用于服务端调用的密钥。" />
              <HelpStep icon={<WalletCards aria-hidden="true" size={20} />} title="确认余额或订阅" body="确保钱包有可用余额，或已有生效订阅套餐。" />
              <HelpStep icon={<Route aria-hidden="true" size={20} />} title="替换 Base URL" body={`将 SDK 的 Base URL 替换为 ${baseUrl}。`} />
            </div>
          </section>

          <section aria-labelledby="help-endpoints">
            <div className="front-help-section-head"><div><span>02</span><h2 id="help-endpoints">兼容端点</h2></div><p>以下地址均使用控制台生成的 API Key 鉴权。</p></div>
            <FrontCard className="front-help-endpoints">
              {[
                ["POST", "/v1/responses", "OpenAI Responses 兼容接口，推荐新项目使用。"],
                ["POST", "/v1/chat/completions", "Chat Completions 兼容接口，支持流式响应。"],
                ["POST", "/v1/embeddings", "Embedding 向量接口。"],
                ["POST", "/v1/completions", "旧版 Completions 兼容接口。"],
                ["POST", "/v1/images/generations", "图片生成接口，取决于后台已开放模型。"],
                ["POST", "/v1/images/edits", "图片编辑 multipart 请求转发。"],
              ].map(([method, path, description]) => (
                <div className="front-help-endpoint" key={path}>
                  <FrontBadge tone="primary">{method}</FrontBadge>
                  <code>{path}</code>
                  <p>{description}</p>
                </div>
              ))}
            </FrontCard>
          </section>

          <section aria-labelledby="help-examples">
            <div className="front-help-section-head"><div><span>03</span><h2 id="help-examples">调用示例</h2></div><p>复制后将环境变量替换为自己的 API Key。</p></div>
            <div className="front-help-code-grid">
              <FrontCodeBlock label="cURL" value={curlExample} />
              <FrontCodeBlock label="Node.js" value={nodeExample} />
              <FrontCodeBlock label="Python" value={pythonExample} />
            </div>
          </section>

          <section aria-labelledby="help-billing">
            <div className="front-help-section-head"><div><span>04</span><h2 id="help-billing">计费与限制</h2></div><p>请求进入上游前会检查账号、Key、余额和并发状态。</p></div>
            <div className="front-help-card-grid front-help-card-grid-2">
              <HelpStep icon={<CreditCard aria-hidden="true" size={20} />} title="余额与订阅" body="系统优先按生效订阅规则扣费；需要钱包兜底时再使用可用余额。" />
              <HelpStep icon={<Activity aria-hidden="true" size={20} />} title="频率与并发" body="每枚 API Key 可独立设置每分钟限流、并发限制、总额度与过期时间。" />
              <HelpStep icon={<ShieldCheck aria-hidden="true" size={20} />} title="访问等级" body="访问等级决定模型池、路由规则和扣费倍率，切换后立即生效。" />
              <HelpStep icon={<LockKeyhole aria-hidden="true" size={20} />} title="密钥安全" body="Secret 仅应保存在服务端环境变量中，不要写入浏览器或提交到仓库。" />
            </div>
          </section>

          <section aria-labelledby="help-checklist">
            <div className="front-help-section-head"><div><span>05</span><h2 id="help-checklist">接入检查</h2></div><p>遇到错误时优先核对以下项目。</p></div>
            <FrontCard className="front-help-checklist">
              {["Authorization 使用 Bearer + API Key", "Base URL 指向当前环境配置的网关地址", "模型名已在控制台“可用模型”中显示", "API Key 未停用、未过期且未超过总额度", "钱包有可用余额或存在生效订阅", "客户端保留超时、重试和错误日志"].map((item) => (
                <div key={item}><CheckCircle2 aria-hidden="true" size={18} /><span>{item}</span></div>
              ))}
            </FrontCard>
          </section>

          <section aria-labelledby="help-faq">
            <div className="front-help-section-head"><div><span>06</span><h2 id="help-faq">常见问题</h2></div><p>可使用键盘聚焦并展开每个问题。</p></div>
            <div className="front-help-faq-list">
              <Faq question="APIshare 与 OpenAI SDK 兼容吗？">兼容。通常只需要替换 baseURL，并将 API Key 改为 APIshare 控制台生成的密钥。</Faq>
              <Faq question="为什么返回余额不足或并发限制？">网关会在请求进入上游前检查余额、订阅、密钥状态、每分钟限流和并发限制。请分别查看钱包、API Key 与调用记录。</Faq>
              <Faq question="模型不可用时如何处理？">确认模型在控制台显示为可用；客户端应保留重试与降级策略。若仍失败，请记录请求时间、模型名、HTTP 状态和错误内容。</Faq>
            </div>
          </section>

          <section aria-labelledby="help-support">
            <div className="front-help-section-head"><div><span>07</span><h2 id="help-support">需要支持</h2></div><p>紧急问题可触发管理员邮件提醒。</p></div>
            <FrontCard className="front-help-support-card">
              <div><LifeBuoy aria-hidden="true" size={26} /><div><h3>仍然无法解决？</h3><p>请准备请求时间、模型、HTTP 状态、错误摘要和调用记录截图。</p></div></div>
              <EmergencyAdminCallButton />
            </FrontCard>
          </section>
        </div>

        <footer className="front-help-footer">
          <FrontLogo />
          <nav><Link href="/">控制台</Link><Link href="/access">白名单验证</Link><Link href="/help">帮助中心</Link></nav>
        </footer>
      </main>
    </FrontProviders>
  );
}

function HelpStep({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <FrontCard className="front-help-step"><span>{icon}</span><h3>{title}</h3><p>{body}</p></FrontCard>
  );
}

function Faq({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <details className="front-help-faq"><summary>{question}</summary><div>{children}</div></details>
  );
}
