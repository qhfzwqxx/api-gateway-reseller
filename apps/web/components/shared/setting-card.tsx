"use client";

import { Save } from "lucide-react";
import type { ReactNode } from "react";
import type { FieldValues, SubmitHandler, UseFormReturn } from "react-hook-form";

interface SettingCardProps<TInput extends FieldValues, TOutput extends FieldValues = TInput> {
  title: string;
  description: string;
  form: UseFormReturn<TInput, unknown, TOutput>;
  formId?: string;
  hideActions?: boolean;
  loading?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit: SubmitHandler<TOutput>;
}

export function SettingCard<TInput extends FieldValues, TOutput extends FieldValues = TInput>({
  title,
  description,
  form,
  formId,
  hideActions = false,
  loading = false,
  children,
  footer,
  onSubmit,
}: SettingCardProps<TInput, TOutput>) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
      <form id={formId} className="p-5" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid gap-4">{children}</div>
        {hideActions ? null : (
          <div className="setting-card-actions mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-5">
            {footer}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {loading ? "保存中" : "保存更改"}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
