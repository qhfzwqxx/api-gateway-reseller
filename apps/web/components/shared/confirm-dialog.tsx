"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState } from "react";

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
  const inputId = useId();

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
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && handleClose()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="admin-confirm-backdrop" />
        <Dialog.Content
          className="admin-confirm-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title className="text-lg font-semibold text-slate-950">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-slate-500">
            {description}
          </Dialog.Description>

          {requireInputText ? (
            <div className="mt-5 space-y-2">
              <label
                htmlFor={inputId}
                className="text-sm font-medium text-slate-700"
              >
                请输入{" "}
                <span className="font-semibold text-slate-950">
                  {requireInputText}
                </span>{" "}
                以继续
              </label>
              <input
                id={inputId}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-100"
                autoFocus
              />
            </div>
          ) : null}

          <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm || loading}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "处理中" : confirmText}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
