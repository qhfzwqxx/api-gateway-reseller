"use client";

import { computed, createApp, h, onBeforeUnmount, onMounted, ref, type App as VueApp } from "vue";
import { useEffect, useRef } from "react";

type CharityDashboard = {
  generatedAt: string;
  gateway?: string;
  charityKey?: string | null;
  announcement?: {
    serviceEnabled?: boolean;
    serviceDisabledMessage?: string;
    enabled: boolean;
    frequency: "every_visit" | "interval";
    intervalHours: number;
    title: string;
    content: string;
  };
  totals: {
    charityUsers: number;
    requests: number;
    successRequests: number;
    failedRequests: number;
    successRate: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    chargedAmountUsd: string;
    upstreamCostUsd: string;
  };
  trend30d: Array<{
    date: string;
    requests: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
  ranking: Array<{
    name: string;
    requests: number;
    successRate: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
  models: Array<{
    model: string;
    requests: number;
    successRate: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
};

export default function CharityVueApp({ data }: { data: CharityDashboard | null }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<VueApp<Element> | null>(null);

  useEffect(() => {
    const viewport = document.querySelector<HTMLMetaElement>("meta[name='viewport']");
    const previousContent = viewport?.getAttribute("content");
    const desktopWidth = 1120;
    const scale = Math.min(1, window.innerWidth / desktopWidth);

    viewport?.setAttribute(
      "content",
      `width=${desktopWidth}, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=1`,
    );

    return () => {
      if (previousContent) {
        viewport?.setAttribute("content", previousContent);
      }
    };
  }, []);

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }

    const vueApp = createApp({
      setup() {
        const dashboard = ref<CharityDashboard | null>(data);
        const fallbackTotals = {
          charityUsers: 0,
          requests: 0,
          successRequests: 0,
          failedRequests: 0,
          successRate: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          chargedAmountUsd: "0",
          upstreamCostUsd: "0",
        };
        const totals = computed(() => dashboard.value?.totals ?? fallbackTotals);
        const trend = computed(() => dashboard.value?.trend30d ?? []);
        const today = computed(() => trend.value.at(-1));
        const maxTokens = computed(() => Math.max(1, ...trend.value.map((item) => item.totalTokens)));
        const maxRequests = computed(() => Math.max(1, ...trend.value.map((item) => item.requests)));
        const hasTrendData = computed(() =>
          trend.value.some((item) => item.requests > 0 || item.totalTokens > 0),
        );
        const gateway = computed(() => dashboard.value?.gateway ?? "https://free.l-kx.cn");
        const charityKey = computed(() => dashboard.value?.charityKey ?? "未填写公益 Key");
        const apiBaseUrl = computed(() => `${gateway.value.replace(/\/+$/, "")}/v1`);
        const serviceAvailable = ref(false);
        const statusLoaded = ref(false);
        const showAnnouncement = ref(false);
        const announcement = computed(() => dashboard.value?.announcement);
        const displayModels = ["gpt-5.5"];

        const currency = (value: string) => `$${Number(value).toFixed(2)}`;
        const compact = (value: number) =>
          new Intl.NumberFormat("en-US", {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(value);
        const int = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
        const sparkPoints = (value: number, max: number, index: number) => {
          const width = 100 / Math.max(1, trend.value.length - 1);
          const x = index * width;
          const y = 100 - (value / Math.max(1, max)) * 100;
          return `${x},${y}`;
        };
        let statusTimer: number | null = null;
        let dashboardTimer: number | null = null;
        let statusRefreshing = false;
        let dashboardRefreshing = false;

        async function refreshStatus() {
          if (statusRefreshing) {
            return;
          }
          statusRefreshing = true;
          try {
            const response = await fetch("/public/charity-status", {
              cache: "no-store",
            });
            if (response.ok) {
              const status = (await response.json()) as { available?: boolean };
              serviceAvailable.value = Boolean(status.available);
            } else {
              serviceAvailable.value = false;
            }
          } catch {
            serviceAvailable.value = false;
          } finally {
            statusLoaded.value = true;
            statusRefreshing = false;
          }
        }

        async function refreshDashboard() {
          if (dashboardRefreshing) {
            return;
          }
          dashboardRefreshing = true;
          try {
            const response = await fetch("/public/charity-dashboard", {
              cache: "no-store",
            });
            if (response.ok) {
              dashboard.value = (await response.json()) as CharityDashboard;
            }
          } catch {
            // Keep the server-rendered snapshot when the live refresh misses.
          } finally {
            dashboardRefreshing = false;
          }
        }

        onMounted(async () => {
          showAnnouncement.value = shouldShowAnnouncement(announcement.value);

          await refreshStatus();
          void refreshDashboard();
          statusTimer = window.setInterval(refreshStatus, 3_000);
          dashboardTimer = window.setInterval(refreshDashboard, 3_000);
        });

        onBeforeUnmount(() => {
          if (statusTimer) {
            window.clearInterval(statusTimer);
          }
          if (dashboardTimer) {
            window.clearInterval(dashboardTimer);
          }
          statusTimer = null;
          dashboardTimer = null;
        });

        return () =>
          h("main", { class: "charity-vue-page" }, [
            showAnnouncement.value && announcement.value?.enabled
              ? h("div", { class: "charity-announcement-backdrop" }, [
                  h("section", { class: "charity-announcement-modal" }, [
                    h("div", { class: "announcement-orbit" }),
                    h("div", { class: "charity-announcement-kicker" }, "APIshare 公益"),
                    h("h2", announcement.value.title || "公益 API 使用公告"),
                    h("p", announcement.value.content || "请合理使用公益 API 资源。"),
                    h("button", {
                      class: "announcement-primary-button",
                      onClick: () => dismissAnnouncement(announcement.value),
                      type: "button",
                    }, "我知道了"),
                  ]),
                ])
              : null,
            h("section", { class: "charity-vue-hero" }, [
              h("div", { class: "charity-vue-title" }, [
                h("span", { class: "hero-kicker" }, "Public AI Gateway"),
                h("h1", "APIshare公益"),
                h("p", "永久免费公益API"),
              ]),
            ]),
            h("section", { class: "charity-vue-info-grid" }, [
              h("article", { class: "content-panel quick-start" }, [
                h("div", { class: "section-head compact" }, [h("h2", "快速使用")]),
                h("div", { class: "usage-lines" }, [
                  usageLine("Base URL", apiBaseUrl.value),
                  usageLine("API Key", charityKey.value),
                ]),
              ]),
              h("article", { class: "content-panel service-panel service-panel-minimal" }, [
                h("div", { class: "section-head compact" }, [h("h2", "服务状态")]),
                h(
                  "div",
                  {
                    class: statusLoaded.value
                      ? serviceAvailable.value
                        ? "status-row ok"
                        : "status-row down"
                      : "status-row checking",
                  },
                  [
                    h("span"),
                    h(
                      "strong",
                      statusLoaded.value
                        ? serviceAvailable.value
                          ? "可用"
                          : "不可用"
                        : "检测中",
                    ),
                  ],
                ),
                !serviceAvailable.value && dashboard.value?.announcement?.serviceDisabledMessage
                  ? h("p", { class: "service-disabled-message" }, dashboard.value.announcement.serviceDisabledMessage)
                  : null,
              ]),
            ]),
            h("section", { class: "model-rules-grid" }, [
              h("article", { class: "content-panel model-card" }, [
                h("div", { class: "section-head compact" }, [h("h2", "可用模型")]),
                h("div", { class: "model-focus" }, displayModels.map((model) => h("span", model))),
              ]),
              h("article", { class: "content-panel rules-card" }, [
                h("div", { class: "section-head compact" }, [h("h2", "使用规则")]),
                h("ul", { class: "rule-list" }, [
                  h("li", "永久免费公益使用，不承诺商业 SLA。"),
                  h("li", "禁止批量滥用、倒卖、攻击和违法用途。"),
                  h("li", "公益 Key 会不定期轮换，旧 Key 会失效。"),
                  h("li", "服务可能按负载进行限流，请合理调用。"),
                ]),
              ]),
            ]),
            h("section", { class: "charity-vue-grid" }, [
              metricCard("总统计", [
                metricItem("总请求", int(totals.value.requests)),
                metricItem("总 Token", compact(totals.value.totalTokens)),
                metricItem("总费用", currency(totals.value.chargedAmountUsd)),
              ]),
              metricCard("每日统计", [
                metricItem("今日请求", int(today.value?.requests ?? 0)),
                metricItem("今日 Token", compact(today.value?.totalTokens ?? 0)),
                metricItem("今日费用", currency(today.value?.chargedAmountUsd ?? "0")),
              ]),
            ]),
            h("section", { class: "charity-vue-chart" }, [
              h("div", { class: "section-head" }, [
                h("div", null, [h("h2", "请求 / Token 趋势"), h("p", "最近 30 天按日聚合")]),
              ]),
              hasTrendData.value
                ? h("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none" }, [
                    h("polyline", {
                      class: "line rpm",
                      points: trend.value.map((item, index) => sparkPoints(item.requests, maxRequests.value, index)).join(" "),
                    }),
                    h("polyline", {
                      class: "line tpm",
                      points: trend.value.map((item, index) => sparkPoints(item.totalTokens, maxTokens.value, index)).join(" "),
                    }),
                    ...trend.value.flatMap((item, index) => [
                      h("circle", {
                        class: "chart-dot rpm",
                        cx: index * (100 / Math.max(1, trend.value.length - 1)),
                        cy: 100 - (item.requests / Math.max(1, maxRequests.value)) * 100,
                        r: "0.9",
                      }),
                      h("circle", {
                        class: "chart-dot tpm",
                        cx: index * (100 / Math.max(1, trend.value.length - 1)),
                        cy: 100 - (item.totalTokens / Math.max(1, maxTokens.value)) * 100,
                        r: "0.9",
                      }),
                    ]),
                  ])
                : h("div", { class: "chart-empty-state" }, [
                    h("strong", "暂无趋势数据"),
                    h("span", "产生公益调用后，这里会展示最近 30 天的请求量和 Token 变化。"),
                  ]),
              h("div", { class: "chart-legend" }, [
                h("span", { class: "legend rpm" }, "请求"),
                h("span", { class: "legend tpm" }, "Token"),
              ]),
            ]),
          ]);

        function metricCard(title: string, items: any[]) {
          return h("article", { class: "metric-card" }, [
            h("div", { class: "section-head compact" }, [h("h2", title)]),
            h("div", { class: items.length === 3 ? "metric-grid three" : "metric-grid" }, items),
          ]);
        }

        function metricItem(label: string, value: string) {
          return h("div", { class: "metric-item" }, [h("span", label), h("strong", value)]);
        }

        function usageLine(label: string, value: string) {
          return h("div", null, [
            h("span", label),
            h("div", { class: "usage-value" }, [
              h("code", value),
              h(
                "button",
                {
                  "aria-label": `复制${label}`,
                  class: "copy-icon-button",
                  onClick: () => copyText(value),
                  title: `复制${label}`,
                  type: "button",
                },
                [
                  h(
                    "svg",
                    {
                      "aria-hidden": "true",
                      fill: "none",
                      height: "18",
                      stroke: "currentColor",
                      "stroke-linecap": "round",
                      "stroke-linejoin": "round",
                      "stroke-width": "2",
                      viewBox: "0 0 24 24",
                      width: "18",
                    },
                    [
                      h("rect", { height: "14", rx: "2", ry: "2", width: "14", x: "8", y: "8" }),
                      h("path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }),
                    ],
                  ),
                ],
              ),
            ]),
          ]);
        }

        async function copyText(value: string) {
          await navigator.clipboard?.writeText(value);
        }

        function shouldShowAnnouncement(
          settings: CharityDashboard["announcement"] | undefined,
        ) {
          if (!settings?.enabled || !settings.content.trim()) {
            return false;
          }
          if (settings.frequency === "every_visit") {
            return true;
          }
          const lastShownAt = Number(
            window.localStorage.getItem("charity-announcement-last-shown-at") ?? "0",
          );
          const intervalMs = Math.max(1, settings.intervalHours) * 60 * 60 * 1000;
          return Date.now() - lastShownAt >= intervalMs;
        }

        function dismissAnnouncement(
          settings: CharityDashboard["announcement"],
        ) {
          if (settings?.frequency === "interval") {
            window.localStorage.setItem(
              "charity-announcement-last-shown-at",
              String(Date.now()),
            );
          }
          showAnnouncement.value = false;
        }

      },
    });

    vueApp.mount(mountRef.current);
    appRef.current = vueApp;

    return () => {
      appRef.current?.unmount();
      appRef.current = null;
    };
  }, [data]);

  return <div ref={mountRef} className="charity-vue-root" />;
}
