"use client";

import { useState } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  requireInputText?: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  requireInputText,
  loading = false,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState("");

  if (!open) {
    return null;
  }

  const canConfirm = !requireInputText || inputValue === requireInputText;

  async function handleConfirm() {
    if (!canConfirm || loading) {
      return;
    }

    await onConfirm();
  }

  function handleClose() {
    if (loading) {
      return;
    }

    setInputValue("");
    onOpenChange(false);
  }

  return (
    <div className="admin-confirm-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="admin-confirm-dialog w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>

        {requireInputText ? (
          <div className="mt-5 space-y-2">
            <label className="text-sm font-medium text-slate-700">
              请输入 <span className="font-semibold text-slate-950">{requireInputText}</span> 以继续
            </label>
            <input
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-100"
              autoFocus
            />
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="inline-flex h-10 items-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            className="inline-flex h-10 items-center rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "处理中" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
