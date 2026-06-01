"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  className?: string;
  pageSizeOptions?: number[];
  totalLabel?: string;
};

export function Pagination({
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  className,
  pageSizeOptions = [10, 20, 50, 100],
  totalLabel,
}: PaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), safeTotalPages);

  function handlePageChange(page: number) {
    onPageChange(Math.min(Math.max(1, page), safeTotalPages));
  }

  function handlePageSizeChange(size: number) {
    onPageSizeChange(size);
    onPageChange(1);
  }

  return (
    <div
      aria-label="分页"
      className={
        className ? `pagination-container ${className}` : "pagination-container"
      }
    >
      <span className="pagination-total">
        {totalLabel ?? `总页数：${safeTotalPages}`}
      </span>
      <button
        aria-label="上一页"
        className="pagination-btn"
        disabled={safeCurrentPage === 1}
        onClick={() => handlePageChange(safeCurrentPage - 1)}
        type="button"
      >
        <ChevronLeft size={16} />
      </button>
      <div className="pagination-pages">
        {getPaginationPages(safeCurrentPage, safeTotalPages).map(
          (page, index) =>
            page === "..." ? (
              <button
                className="pagination-page-item ellipsis"
                disabled
                key={`ellipsis-${index}`}
                type="button"
              >
                ...
              </button>
            ) : (
              <button
                aria-current={page === safeCurrentPage ? "page" : undefined}
                className={
                  page === safeCurrentPage
                    ? "pagination-page-item active"
                    : "pagination-page-item"
                }
                key={page}
                onClick={() => handlePageChange(page)}
                type="button"
              >
                {page}
              </button>
            ),
        )}
      </div>
      <button
        aria-label="下一页"
        className="pagination-btn"
        disabled={safeCurrentPage === safeTotalPages}
        onClick={() => handlePageChange(safeCurrentPage + 1)}
        type="button"
      >
        <ChevronRight size={16} />
      </button>
      <label className="pagination-size-selector">
        <span className="sr-only">每页条数</span>
        <select
          onChange={(event) => handlePageSizeChange(Number(event.target.value))}
          value={pageSize}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              每页条数：{size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function getPaginationPages(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "...", totalPages] as const;
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "...",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ] as const;
  }

  return [
    1,
    "...",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "...",
    totalPages,
  ] as const;
}
