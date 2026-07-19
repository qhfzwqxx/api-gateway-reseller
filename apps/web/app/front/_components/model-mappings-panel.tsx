"use client";

import { ArrowRight, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiFetch } from "../../../lib/api";
import type {
  FrontAvailableModel,
  FrontModelMapping,
} from "../../../lib/types/front";
import {
  FrontAlert,
  FrontBadge,
  FrontButton,
  FrontCard,
  FrontField,
  FrontIconButton,
  useFrontToast,
} from "./ui/front-ui";

type MappingError = { fromModel?: string; toModel?: string };

export function ModelMappingsPanel({
  mappings,
  availableModels,
  onChanged,
}: {
  mappings: FrontModelMapping[];
  availableModels: FrontAvailableModel[];
  onChanged: (mappings: FrontModelMapping[]) => void;
}) {
  const [rows, setRows] = useState<FrontModelMapping[]>([]);
  const [errors, setErrors] = useState<MappingError[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const toast = useFrontToast();

  useEffect(() => {
    restoreRows();
  }, [mappings]);

  const dirty = useMemo(
    () => JSON.stringify(normalize(rows)) !== JSON.stringify(normalize(mappings)),
    [mappings, rows],
  );

  function restoreRows() {
    setRows(
      mappings.length > 0
        ? mappings.map((mapping) => ({ ...mapping }))
        : [{ fromModel: "", toModel: "" }],
    );
    setErrors([]);
    setSaveError(null);
  }

  function updateRow(index: number, field: "fromModel" | "toModel", value: string) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
    setErrors((current) =>
      current.map((error, rowIndex) =>
        rowIndex === index ? { ...error, [field]: undefined } : error,
      ),
    );
  }

  function addRow() {
    setRows((current) => [...current, { fromModel: "", toModel: "" }]);
  }

  function removeRow(index: number) {
    setRows((current) => {
      const next = current.filter((_, rowIndex) => rowIndex !== index);
      return next.length > 0 ? next : [{ fromModel: "", toModel: "" }];
    });
    setErrors([]);
  }

  function validate() {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const from = row.fromModel.trim();
      if (from) counts.set(from, (counts.get(from) ?? 0) + 1);
    });
    const nextErrors = rows.map((row) => {
      const from = row.fromModel.trim();
      const to = row.toModel.trim();
      if (!from && !to) {
        return {};
      }
      return {
        fromModel: !from
          ? "请输入调用模型"
          : (counts.get(from) ?? 0) > 1
            ? "调用模型不能重复"
            : undefined,
        toModel: !to ? "请输入实际模型" : undefined,
      };
    });
    setErrors(nextErrors);
    const firstInvalidIndex = nextErrors.findIndex(
      (error) => Boolean(error.fromModel || error.toModel),
    );
    if (firstInvalidIndex >= 0) {
      const field = nextErrors[firstInvalidIndex]?.fromModel ? "from" : "to";
      window.requestAnimationFrame(() => {
        document
          .getElementById(`front-mapping-${field}-${firstInvalidIndex}`)
          ?.focus();
      });
      return false;
    }
    return true;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    if (!validate()) {
      return;
    }

    setSaving(true);
    try {
      const result = await apiFetch<{ mappings: FrontModelMapping[] }>(
        "/model-mappings",
        {
          method: "PUT",
          body: JSON.stringify({ mappings: normalize(rows) }),
        },
      );
      onChanged(result.mappings);
      toast("模型映射已保存");
    } catch (error) {
      setSaveError(errorToText(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="front-page-stack">
      <FrontCard>
        <div className="front-page-section-head">
          <div>
            <h2>模型映射</h2>
            <p>每一行表示“调用模型 → 实际模型”，保存后立即用于后续请求。</p>
          </div>
          <div className="front-section-actions">
            <FrontBadge tone={dirty ? "warning" : "success"}>
              {dirty ? "有未保存修改" : `${mappings.length} 条已保存`}
            </FrontBadge>
            {dirty ? (
              <FrontButton variant="ghost" disabled={saving} onClick={restoreRows}>
                <RotateCcw aria-hidden="true" size={17} />
                恢复已保存内容
              </FrontButton>
            ) : null}
          </div>
        </div>

        {saveError ? (
          <FrontAlert tone="error" title="保存失败">
            {saveError}。你填写的内容已保留，可修改后重试。
          </FrontAlert>
        ) : null}

        <form className="front-mapping-form" onSubmit={save} noValidate>
          <datalist id="front-model-suggestions">
            {availableModels.map((model) => (
              <option key={model.model} value={model.model} />
            ))}
          </datalist>

          <div className="front-mapping-list">
            {rows.map((row, index) => (
              <div className="front-mapping-row" key={row.id ?? index}>
                <span className="front-mapping-number">{index + 1}</span>
                <FrontField
                  label="调用模型"
                  htmlFor={`front-mapping-from-${index}`}
                  error={errors[index]?.fromModel}
                >
                  <input
                    id={`front-mapping-from-${index}`}
                    className="front-input front-input-mono"
                    list="front-model-suggestions"
                    placeholder="例如 gpt-4o"
                    value={row.fromModel}
                    disabled={saving}
                    aria-invalid={Boolean(errors[index]?.fromModel)}
                    onChange={(event) => updateRow(index, "fromModel", event.target.value)}
                  />
                </FrontField>
                <ArrowRight className="front-mapping-arrow" aria-hidden="true" size={20} />
                <FrontField
                  label="实际模型"
                  htmlFor={`front-mapping-to-${index}`}
                  error={errors[index]?.toModel}
                >
                  <input
                    id={`front-mapping-to-${index}`}
                    className="front-input front-input-mono"
                    list="front-model-suggestions"
                    placeholder="例如 gpt-4.1"
                    value={row.toModel}
                    disabled={saving}
                    aria-invalid={Boolean(errors[index]?.toModel)}
                    onChange={(event) => updateRow(index, "toModel", event.target.value)}
                  />
                </FrontField>
                <FrontIconButton
                  label={`删除第 ${index + 1} 条模型映射`}
                  tooltip="删除映射"
                  disabled={saving}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 aria-hidden="true" size={18} />
                </FrontIconButton>
              </div>
            ))}
          </div>

          <div className="front-form-actions">
            <FrontButton variant="secondary" type="button" disabled={saving} onClick={addRow}>
              <Plus aria-hidden="true" size={18} />
              添加映射
            </FrontButton>
            <FrontButton type="submit" loading={saving} disabled={!dirty}>
              {saving ? null : <Save aria-hidden="true" size={18} />}
              {saving ? "保存中" : "保存映射"}
            </FrontButton>
          </div>
        </form>
      </FrontCard>
    </div>
  );
}

function normalize(rows: FrontModelMapping[]) {
  return rows
    .map((row) => ({
      fromModel: row.fromModel.trim(),
      toModel: row.toModel.trim(),
    }))
    .filter((row) => row.fromModel || row.toModel);
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请稍后重试";
}
