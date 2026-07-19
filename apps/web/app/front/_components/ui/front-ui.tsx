"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Info,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function frontButtonClass(
  variant: ButtonVariant = "primary",
  className = "",
) {
  return ["front-button", `front-button-${variant}`, className]
    .filter(Boolean)
    .join(" ");
}

export function FrontButton({
  variant = "primary",
  loading = false,
  disabled,
  type = "button",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      className={frontButtonClass(variant, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      type={type}
      {...props}
    >
      {loading ? <Loader2 className="front-spin" aria-hidden="true" size={18} /> : null}
      {children}
    </button>
  );
}

export const FrontIconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    tooltip?: string;
    wrapperClassName?: string;
  }
>(function FrontIconButton(
  {
    label,
    tooltip = label,
    className = "",
    wrapperClassName = "",
    children,
    ...props
  },
  ref,
) {
  return (
    <span
      className={["front-tooltip", wrapperClassName].filter(Boolean).join(" ")}
      data-tooltip={tooltip}
    >
      <button
        ref={ref}
        aria-label={label}
        className={["front-icon-button", className].filter(Boolean).join(" ")}
        title={tooltip}
        type="button"
        {...props}
      >
        {children}
      </button>
    </span>
  );
});

export function FrontCard({
  variant = "default",
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "metric" | "clickable";
}) {
  return (
    <div
      className={["front-card", `front-card-${variant}`, className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

export function FrontField({
  label,
  htmlFor,
  required,
  hint,
  error,
  className = "",
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["front-field", className].filter(Boolean).join(" ")}>
      <label className="front-field-label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <>
            <span aria-hidden="true">*</span>
            <span className="front-sr-only">（必填）</span>
          </>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="front-field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="front-field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

const alertIcons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
};

export function FrontAlert({
  tone = "info",
  title,
  children,
  className = "",
}: {
  tone?: keyof typeof alertIcons;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const Icon = alertIcons[tone];
  return (
    <div
      className={["front-alert", `front-alert-${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" size={18} />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function FrontBadge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={["front-badge", `front-badge-${tone}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

export function FrontDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
  mobileFull = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  mobileFull?: boolean;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const rememberExternalFocus = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        !target.closest(".front-dialog-content")
      ) {
        returnFocusRef.current = target;
      }
    };
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      !activeElement.closest(".front-dialog-content")
    ) {
      returnFocusRef.current = activeElement;
    }
    document.addEventListener("focusin", rememberExternalFocus);
    return () => document.removeEventListener("focusin", rememberExternalFocus);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="front-dialog-overlay" />
        <Dialog.Content
          className={[
            "front-dialog-content",
            wide ? "front-dialog-wide" : "",
            mobileFull ? "front-dialog-mobile-full" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onCloseAutoFocus={(event) => {
            const returnTarget = returnFocusRef.current;
            returnFocusRef.current = null;
            if (!returnTarget?.isConnected) return;
            event.preventDefault();
            window.requestAnimationFrame(() => returnTarget.focus());
          }}
        >
          <header className="front-dialog-header">
            <div>
              <Dialog.Title className="front-dialog-title">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="front-dialog-description">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <FrontIconButton
                label="关闭弹窗"
                tooltip="关闭"
                wrapperClassName="front-dialog-close-control"
              >
                <X aria-hidden="true" size={20} />
              </FrontIconButton>
            </Dialog.Close>
          </header>
          <div className="front-dialog-body">{children}</div>
          {footer ? <footer className="front-dialog-footer">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type ConfirmOptions = {
  title: string;
  description: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ConfirmState = ConfirmOptions & {
  resolve: (result: boolean) => void;
};

const ConfirmContext = createContext<
  ((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function FrontConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState((current) => {
        current?.resolve(false);
        return { ...options, resolve };
      });
    });
  }, []);

  const finish = useCallback((result: boolean) => {
    setState((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <FrontDialog
        open={Boolean(state)}
        onOpenChange={(open) => {
          if (!open) {
            finish(false);
          }
        }}
        title={state?.title ?? "确认操作"}
        description={state?.description}
        footer={
          <>
            <FrontButton variant="secondary" onClick={() => finish(false)}>
              {state?.cancelText ?? "取消"}
            </FrontButton>
            <FrontButton
              variant={state?.danger ? "danger" : "primary"}
              onClick={() => finish(true)}
            >
              {state?.confirmText ?? "确认"}
            </FrontButton>
          </>
        }
      >
        {state?.danger ? (
          <FrontAlert tone="warning">此操作完成后可能无法恢复，请确认信息无误。</FrontAlert>
        ) : (
          <div className="front-dialog-confirm-spacer" />
        )}
      </FrontDialog>
    </ConfirmContext.Provider>
  );
}

export function useFrontConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useFrontConfirm must be used inside FrontConfirmProvider");
  }
  return confirm;
}

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; message: string };

const ToastContext = createContext<
  ((message: string, tone?: ToastTone) => void) | null
>(null);

export function FrontToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = nextId.current++;
    setItems((current) => [...current, { id, message, tone }]);
    const timer = window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 3000);
    timersRef.current.push(timer);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="front-toast-region" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <div
            className={`front-toast front-toast-${item.tone}`}
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
          >
            {item.tone === "error" ? (
              <AlertCircle aria-hidden="true" size={18} />
            ) : item.tone === "info" ? (
              <Info aria-hidden="true" size={18} />
            ) : (
              <CheckCircle2 aria-hidden="true" size={18} />
            )}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useFrontToast() {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error("useFrontToast must be used inside FrontToastProvider");
  }
  return toast;
}

export function FrontProviders({ children }: { children: ReactNode }) {
  return (
    <FrontToastProvider>
      <FrontConfirmProvider>{children}</FrontConfirmProvider>
    </FrontToastProvider>
  );
}

export function FrontCopyButton({
  value,
  label = "复制",
  compact = false,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const toast = useFrontToast();

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function copyValue() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("当前浏览器不支持自动复制");
      }
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast("已复制到剪贴板");
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1800);
    } catch (error) {
      toast(error instanceof Error ? error.message : "复制失败，请手动复制", "error");
    }
  }

  return compact ? (
    <FrontIconButton
      label={copied ? "已复制" : label}
      tooltip={copied ? "已复制" : label}
      onClick={() => void copyValue()}
    >
      {copied ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
    </FrontIconButton>
  ) : (
    <FrontButton variant="secondary" onClick={() => void copyValue()}>
      {copied ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
      {copied ? "已复制" : label}
    </FrontButton>
  );
}

export function FrontDataTable<TData extends object>({
  columns,
  data,
  getRowId,
  loading = false,
  empty,
  mobileRow,
  className = "",
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId?: (row: TData) => string;
  loading?: boolean;
  empty?: ReactNode;
  mobileRow?: (row: TData) => ReactNode;
  className?: string;
}) {
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  });

  return (
    <div
      aria-busy={loading || undefined}
      className={["front-data-table", className].filter(Boolean).join(" ")}
    >
      <div className="front-table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && data.length === 0
              ? Array.from({ length: 5 }).map((_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`}>
                    {columns.map((_, cellIndex) => (
                      <td key={`skeleton-${rowIndex}-${cellIndex}`}>
                        <FrontSkeleton height={16} />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && data.length === 0 ? (
          <div className="front-table-empty">{empty ?? "暂无数据"}</div>
        ) : null}
        {loading && data.length > 0 ? <div className="front-table-loading-bar" /> : null}
      </div>
      {mobileRow ? (
        <div className="front-mobile-record-list">
          {loading && data.length === 0
            ? Array.from({ length: 3 }).map((_, index) => (
                <FrontCard key={index} className="front-mobile-record-skeleton">
                  <FrontSkeleton height={18} width="45%" />
                  <FrontSkeleton height={14} />
                  <FrontSkeleton height={14} width="70%" />
                </FrontCard>
              ))
            : data.map((row, index) => (
                <div key={getRowId?.(row) ?? index}>{mobileRow(row)}</div>
              ))}
          {!loading && data.length === 0 ? empty ?? "暂无数据" : null}
        </div>
      ) : null}
    </div>
  );
}

export function FrontEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="front-empty-state">
      {icon ? <div className="front-empty-icon">{icon}</div> : null}
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div className="front-empty-action">{action}</div> : null}
    </div>
  );
}

export function FrontSkeleton({
  height = 20,
  width = "100%",
  className = "",
}: {
  height?: number;
  width?: number | string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={["front-skeleton", className].filter(Boolean).join(" ")}
      style={{ height, width }}
    />
  );
}

export function FrontPagination({
  currentPage,
  totalPages,
  totalLabel,
  pageSize,
  disabled = false,
  pageSizeOptions = [10, 20, 50],
  onPageChange,
  onPageSizeChange,
}: {
  currentPage: number;
  totalPages: number;
  totalLabel?: string;
  pageSize?: number;
  disabled?: boolean;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const safeTotalPages = Math.max(1, Math.floor(totalPages) || 1);
  const safeCurrentPage = Math.min(
    safeTotalPages,
    Math.max(1, Math.floor(currentPage) || 1),
  );

  return (
    <nav className="front-pagination" aria-label="分页导航">
      <div className="front-pagination-summary">
        {totalLabel ?? `第 ${safeCurrentPage} / ${safeTotalPages} 页`}
      </div>
      <div className="front-pagination-controls">
        <FrontIconButton
          label="上一页"
          disabled={disabled || safeCurrentPage <= 1}
          onClick={() => onPageChange(Math.max(1, safeCurrentPage - 1))}
        >
          <ChevronLeft aria-hidden="true" size={18} />
        </FrontIconButton>
        <span className="front-pagination-current">
          {safeCurrentPage} / {safeTotalPages}
        </span>
        <FrontIconButton
          label="下一页"
          disabled={disabled || safeCurrentPage >= safeTotalPages}
          onClick={() =>
            onPageChange(Math.min(safeTotalPages, safeCurrentPage + 1))
          }
        >
          <ChevronRight aria-hidden="true" size={18} />
        </FrontIconButton>
      </div>
      {pageSize && onPageSizeChange ? (
        <label className="front-pagination-size">
          每页
          <select
            aria-label="每页显示条数"
            className="front-select front-select-compact"
            disabled={disabled}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </nav>
  );
}

export function FrontLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "front-logo front-logo-compact" : "front-logo"}>
      <svg
        aria-hidden="true"
        className="front-logo-mark"
        viewBox="0 0 40 40"
        fill="none"
      >
        <rect width="40" height="40" rx="10" fill="currentColor" />
        <path
          d="M11 25.5 18.3 11h4.2L29 25.5h-4.6l-1.2-3.1h-6.7l-1.3 3.1H11Zm7-6.8h3.8l-1.9-4.9-1.9 4.9Z"
          fill="white"
        />
        <path d="M27 11h3v7h-3z" fill="#93C5FD" />
      </svg>
      {compact ? null : (
        <span className="front-logo-copy">
          <strong>APIshare</strong>
          <small>Developer Gateway</small>
        </span>
      )}
    </span>
  );
}

export function FrontCodeBlock({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  return (
    <div className="front-code-block">
      <div className="front-code-head">
        <span>{label ?? "代码"}</span>
        <FrontCopyButton value={value} label="复制代码" compact />
      </div>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
}
