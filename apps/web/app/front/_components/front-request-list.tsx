"use client";

import { FileSearch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { apiFetch } from "../../../lib/api";
import {
  dateTime,
  formatNumber,
  money,
  seconds,
} from "../../../lib/format";
import type {
  FrontPaginationMeta,
  PublicApiRequest,
} from "../../../lib/types/front";
import {
  FrontAlert,
  FrontBadge,
  FrontButton,
  FrontCard,
  FrontDataTable,
  FrontDialog,
  FrontEmptyState,
  FrontPagination,
} from "./ui/front-ui";

const REQUESTS_PAGE_SIZE = 10;

export function FrontRequestList({
  requests = [],
  mode = "recent",
  loading: externalLoading = false,
  refreshSignal = 0,
  onViewAll,
}: {
  requests?: PublicApiRequest[];
  mode?: "recent" | "paged";
  loading?: boolean;
  refreshSignal?: number;
  onViewAll?: () => void;
}) {
  const [rows, setRows] = useState<PublicApiRequest[]>(requests);
  const [pagination, setPagination] = useState<FrontPaginationMeta>({
    page: 1,
    pageSize: REQUESTS_PAGE_SIZE,
    total: requests.length,
    totalPages: 1,
  });
  const [pageLoading, setPageLoading] = useState(mode === "paged");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicApiRequest | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (mode === "recent") {
      setRows(requests);
    }
  }, [mode, requests]);

  const loadPage = useCallback(
    async (page = pagination.page) => {
      if (mode !== "paged") {
        return;
      }
      const requestId = ++requestIdRef.current;
      setPageLoading(true);
      setError(null);
      try {
        const result = await apiFetch<{
          requests: PublicApiRequest[];
          pagination?: FrontPaginationMeta;
        }>(`/usage/requests?page=${page}&pageSize=${REQUESTS_PAGE_SIZE}`);
        if (requestId !== requestIdRef.current) return;
        const nextPagination = result.pagination ?? {
          page: 1,
          pageSize: REQUESTS_PAGE_SIZE,
          total: result.requests.length,
          totalPages: 1,
        };
        const totalPages = Math.max(1, nextPagination.totalPages || 1);
        if (nextPagination.page > totalPages) {
          await loadPage(totalPages);
          return;
        }
        setRows(result.requests);
        setPagination({
          ...nextPagination,
          pageSize: REQUESTS_PAGE_SIZE,
          totalPages,
        });
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return;
        setError(errorToText(loadError));
      } finally {
        if (requestId === requestIdRef.current) {
          setPageLoading(false);
        }
      }
    },
    [mode, pagination.page],
  );

  useEffect(() => {
    if (mode === "paged") {
      void loadPage();
    }
  }, [mode, refreshSignal]);

  const columns = useMemo<ColumnDef<PublicApiRequest, unknown>[]>(
    () => [
      {
        id: "identity",
        header: "模型与 API Key",
        cell: ({ row }) => (
          <div className="front-table-primary-cell">
            <code title={row.original.model}>{row.original.model}</code>
            <span title={formatApiKey(row.original)}>
              {formatApiKey(row.original)}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        header: "请求状态",
        cell: ({ row }) => requestStatusBadge(row.original),
      },
      {
        id: "tokens",
        header: "Token 明细",
        cell: ({ row }) => (
          <div className="front-token-stack front-data-number">
            <strong>{formatNumber(row.original.totalTokens)}</strong>
            <span>
              输入 {formatNumber(row.original.inputTokens)} · 缓存 {formatNumber(row.original.cachedInputTokens)} · 输出 {formatNumber(row.original.outputTokens)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "chargedAmountUsd",
        header: "扣费",
        cell: ({ row }) => (
          <span className="front-money">${money(row.original.chargedAmountUsd)}</span>
        ),
      },
      {
        id: "latency",
        header: "首 Token / 总耗时",
        cell: ({ row }) => (
          <div className="front-table-secondary-stack front-data-number">
            <span>{seconds(row.original.upstreamFirstChunkLatencyMs)}</span>
            <span>{seconds(row.original.latencyMs)}</span>
          </div>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "请求时间",
        cell: ({ row }) => <span className="front-table-date">{dateTime(row.original.createdAt)}</span>,
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <FrontButton variant="ghost" onClick={() => setSelected(row.original)}>
            详情
          </FrontButton>
        ),
      },
    ],
    [],
  );

  const visibleRows = mode === "recent" ? rows.slice(0, 8) : rows;
  const loading = mode === "recent" ? externalLoading : pageLoading;

  return (
    <>
      <section className="front-card front-request-card">
        <div className="front-page-section-head">
          <div>
            <h2>{mode === "recent" ? "最近调用" : "调用记录"}</h2>
            <p>
              {mode === "recent"
                ? "最近 8 条请求的状态、用量与费用。"
                : `真实服务端分页，每页固定 ${REQUESTS_PAGE_SIZE} 条，共 ${pagination.total} 条记录。`}
            </p>
          </div>
          {mode === "recent" && onViewAll ? (
            <FrontButton variant="secondary" onClick={onViewAll}>
              查看全部
            </FrontButton>
          ) : mode === "paged" ? (
            <FrontButton
              variant="secondary"
              loading={loading}
              onClick={() => void loadPage()}
            >
              {loading ? null : <RefreshCw aria-hidden="true" size={17} />}
              刷新本页
            </FrontButton>
          ) : null}
        </div>

        {error ? (
          <FrontAlert tone="error" title="调用记录加载失败">
            <div className="front-inline-retry">
              <span>{error}</span>
              <FrontButton variant="secondary" onClick={() => void loadPage()}>
                重试本页
              </FrontButton>
            </div>
          </FrontAlert>
        ) : null}

        <FrontDataTable
          key={`request-table-${mode}-${pagination.page}`}
          columns={columns}
          data={visibleRows}
          getRowId={(row) => row.id}
          loading={loading}
          empty={
            <FrontEmptyState
              icon={<FileSearch aria-hidden="true" size={24} />}
              title="暂无调用记录"
              description="使用 API Key 发起请求后，模型、Token、费用与耗时会显示在这里。"
            />
          }
          mobileRow={(item) => (
            <RequestMobileCard item={item} onOpen={() => setSelected(item)} />
          )}
          className={
            mode === "recent"
              ? "front-request-data-table front-request-table-recent"
              : "front-request-data-table front-fixed-page-data-table"
          }
        />

        {mode === "paged" ? (
          <FrontPagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalLabel={`共 ${pagination.total} 条 · 每页 ${REQUESTS_PAGE_SIZE} 条`}
            disabled={loading}
            onPageChange={(page) => void loadPage(page)}
          />
        ) : null}
      </section>

      <FrontDialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
          }
        }}
        title="调用详情"
        description={selected ? `${selected.model} · ${dateTime(selected.createdAt)}` : undefined}
      >
        {selected ? <RequestDetail request={selected} /> : null}
      </FrontDialog>
    </>
  );
}

function RequestMobileCard({
  item,
  onOpen,
}: {
  item: PublicApiRequest;
  onOpen: () => void;
}) {
  return (
    <FrontCard className="front-mobile-record">
      <div className="front-mobile-record-head">
        <div>
          <code>{item.model}</code>
          <span>{formatApiKey(item)}</span>
        </div>
        {requestStatusBadge(item)}
      </div>
      <div className="front-mobile-record-grid">
        <MobileValue label="费用" value={`$${money(item.chargedAmountUsd)}`} mono />
        <MobileValue label="Token" value={formatNumber(item.totalTokens)} mono />
        <MobileValue label="耗时" value={seconds(item.latencyMs)} mono />
        <MobileValue label="时间" value={dateTime(item.createdAt)} />
      </div>
      <FrontButton variant="secondary" onClick={onOpen}>
        查看详情
      </FrontButton>
    </FrontCard>
  );
}

function RequestDetail({ request }: { request: PublicApiRequest }) {
  return (
    <div className="front-detail-grid">
      <DetailItem label="模型" value={request.model} mono />
      <DetailItem label="API Key" value={formatApiKey(request)} mono />
      <DetailItem label="状态" value={statusLabel(request.status)} />
      <DetailItem label="HTTP 状态" value={String(request.httpStatus ?? "-")} mono />
      <DetailItem label="接口" value={`${request.method ?? "POST"} ${request.endpoint}`} mono />
      <DetailItem label="总 Token" value={formatNumber(request.totalTokens)} mono />
      <DetailItem label="输入 Token" value={formatNumber(request.inputTokens)} mono />
      <DetailItem label="缓存 Token" value={formatNumber(request.cachedInputTokens)} mono />
      <DetailItem label="输出 Token" value={formatNumber(request.outputTokens)} mono />
      <DetailItem label="扣费" value={`$${money(request.chargedAmountUsd)}`} mono />
      <DetailItem label="首 Token" value={seconds(request.upstreamFirstChunkLatencyMs)} mono />
      <DetailItem label="总耗时" value={seconds(request.latencyMs)} mono />
      <DetailItem label="请求时间" value={dateTime(request.createdAt)} />
      {request.errorMessage ? (
        <div className="front-detail-wide">
          <FrontAlert tone="error" title="请求错误">
            <span className="front-break-anywhere">{request.errorMessage}</span>
          </FrontAlert>
        </div>
      ) : null}
    </div>
  );
}

function MobileValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="front-mobile-value">
      <span>{label}</span>
      <strong className={mono ? "front-data-number" : undefined}>{value}</strong>
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="front-detail-item">
      <span>{label}</span>
      <strong className={mono ? "front-mono" : undefined}>{value}</strong>
    </div>
  );
}

function requestStatusBadge(request: PublicApiRequest) {
  const status = request.status.toUpperCase();
  const tone =
    status === "SUCCESS"
      ? "success"
      : status === "PENDING" || status === "PROCESSING"
        ? "warning"
        : "danger";
  return <FrontBadge tone={tone}>{statusLabel(status)}</FrontBadge>;
}

function statusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "SUCCESS") return "成功";
  if (normalized === "PENDING" || normalized === "PROCESSING") return "处理中";
  if (normalized === "FAILED" || normalized === "ERROR") return "失败";
  return status;
}

function formatApiKey(request: PublicApiRequest) {
  if (!request.apiKey) {
    return "未知 Key";
  }
  return `${request.apiKey.name} (${request.apiKey.keyPrefix})`;
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "加载失败，请稍后重试。";
}
