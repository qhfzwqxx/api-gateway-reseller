"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, Eye, EyeOff, KeyRound, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import { SecretInput } from "../../../components/shared/secret-input";
import {
  createUpstreamProviderKey,
  createUpstreamProvider,
  deleteUpstreamProviderKey,
  deleteUpstreamProviderKeys,
  deleteUpstreamProvider,
  getUpstreamProviders,
  updateUpstreamProviderKey,
  updateUpstreamProvider,
  type UpstreamProvider,
  type UpstreamProviderInput,
  type UpstreamProviderKey,
  type UpstreamProviderKeyInput,
} from "../../../lib/api/supply-chain";

const providerSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(80),
  baseUrl: z.string().trim().url("请输入有效 URL"),
  apiKey: z.string().optional().or(z.literal("")),
  priority: z.coerce.number().int().min(1).max(10000),
  timeoutMs: z.coerce.number().int().min(5000).max(600000),
  compactItemType: z.enum(["compaction", "compaction_summary"]),
  status: z.enum(["ACTIVE", "DISABLED"]),
});

const providerKeySchema = z.object({
  name: z.string().trim().max(80).optional().or(z.literal("")),
  key: z.string().optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "DISABLED"]),
  priority: z.coerce.number().int().min(1).max(10000),
  dailyLimitUsd: z.string().trim().optional().or(z.literal("")),
  monthlyLimitUsd: z.string().trim().optional().or(z.literal("")),
  providerRateLimit: z.coerce.number().int().min(0).max(1000000).optional(),
});

type ProviderInput = z.input<typeof providerSchema>;
type ProviderValues = z.output<typeof providerSchema>;
type ProviderKeyInput = z.input<typeof providerKeySchema>;
type ProviderKeyValues = z.output<typeof providerKeySchema>;

type KeyEditorState = {
  provider: UpstreamProvider;
  key: UpstreamProviderKey | null;
} | null;

type BatchKeyState = {
  provider: UpstreamProvider;
} | null;

export default function AdminUpstreamsPage() {
  const queryClient = useQueryClient();
  const [editingProvider, setEditingProvider] = useState<
    UpstreamProvider | null | undefined
  >(undefined);
  const [keyManagerProviderId, setKeyManagerProviderId] = useState<
    string | null
  >(null);
  const [editingKey, setEditingKey] = useState<KeyEditorState>(null);
  const [batchKeyState, setBatchKeyState] = useState<BatchKeyState>(null);
  const [deletingProvider, setDeletingProvider] =
    useState<UpstreamProvider | null>(null);
  const [deletingKey, setDeletingKey] = useState<UpstreamProviderKey | null>(
    null,
  );
  const [deletingKeys, setDeletingKeys] = useState<UpstreamProviderKey[]>([]);
  const [hiddenProviderIds, setHiddenProviderIds] = useState<string[]>([]);
  const [hiddenProvidersOpen, setHiddenProvidersOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const providersQuery = useQuery({
    queryKey: ["admin", "upstream-providers"],
    queryFn: getUpstreamProviders,
  });

  const refreshSupplyChain = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin", "upstream-providers"],
    });
    void queryClient.invalidateQueries({ queryKey: ["admin", "model-prices"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: ProviderValues) => {
      const payload: UpstreamProviderInput = {
        name: values.name.trim(),
        baseUrl: values.baseUrl,
        apiKey: values.apiKey ?? "",
        priority: values.priority,
        timeoutMs: values.timeoutMs,
        compactItemType: values.compactItemType,
        status: values.status,
      };

      if (editingProvider) {
        return updateUpstreamProvider(editingProvider.id, payload);
      }

      return createUpstreamProvider({
        ...payload,
        apiKey: values.apiKey ?? "",
      });
    },
    onSuccess: () => {
      setEditingProvider(undefined);
      setNotice("上游配置已保存");
      refreshSupplyChain();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUpstreamProvider,
    onSuccess: () => {
      setDeletingProvider(null);
      setNotice("上游 Provider 已删除，相关模型价格与模型池渠道缓存已刷新");
      refreshSupplyChain();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const saveKeyMutation = useMutation({
    mutationFn: async ({
      provider,
      key,
      values,
    }: {
      provider: UpstreamProvider;
      key: UpstreamProviderKey | null;
      values: ProviderKeyValues;
    }) => {
      const payload: UpstreamProviderKeyInput = {
        name: values.name?.trim() || undefined,
        key: values.key?.trim() || undefined,
        status: values.status,
        priority: values.priority,
        dailyLimitUsd: values.dailyLimitUsd?.trim() || null,
        monthlyLimitUsd: values.monthlyLimitUsd?.trim() || null,
        providerRateLimit: values.providerRateLimit ?? null,
      };

      if (key) {
        return updateUpstreamProviderKey(key.id, payload);
      }

      if (!payload.key) {
        throw new Error("新建 Key 必须填写密钥");
      }

      return createUpstreamProviderKey(provider.id, {
        ...payload,
        key: payload.key,
      });
    },
    onSuccess: () => {
      setEditingKey(null);
      setNotice("上游 Key 已保存");
      refreshSupplyChain();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: deleteUpstreamProviderKey,
    onSuccess: () => {
      setDeletingKey(null);
      setNotice("上游 Key 已删除");
      refreshSupplyChain();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const deleteKeysMutation = useMutation({
    mutationFn: async (keys: UpstreamProviderKey[]) =>
      deleteUpstreamProviderKeys(keys.map((key) => key.id)),
    onSuccess: (_data, variables) => {
      setDeletingKeys([]);
      setNotice(`已批量删除 ${variables.length} 个上游 Key`);
      refreshSupplyChain();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const batchKeyMutation = useMutation({
    mutationFn: async ({
      keys,
      priority,
    }: {
      keys: Array<{ name: string; key: string }>;
      priority: number;
    }) => {
      if (!batchKeyState) {
        throw new Error("请选择上游 Provider");
      }

      for (const item of keys) {
        await createUpstreamProviderKey(batchKeyState.provider.id, {
          name: item.name,
          key: item.key,
          status: "ACTIVE",
          priority,
          dailyLimitUsd: null,
          monthlyLimitUsd: null,
          providerRateLimit: null,
        });
      }
    },
    onSuccess: (_data, variables) => {
      setBatchKeyState(null);
      setNotice(`已批量添加 ${variables.keys.length} 个上游 Key`);
      refreshSupplyChain();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const providers = providersQuery.data ?? [];
  const visibleProviders = providers.filter(
    (provider) => !hiddenProviderIds.includes(provider.id),
  );
  const hiddenProviders = providers.filter((provider) =>
    hiddenProviderIds.includes(provider.id),
  );
  const keyManagerProvider =
    providers.find((provider) => provider.id === keyManagerProviderId) ?? null;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(
        "admin:hidden-upstream-providers",
      );
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setHiddenProviderIds(
          parsed.filter((item): item is string => typeof item === "string"),
        );
      }
    } catch {
      // Local view preference only.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "admin:hidden-upstream-providers",
        JSON.stringify(hiddenProviderIds),
      );
    } catch {
      // Local view preference only.
    }
  }, [hiddenProviderIds]);

  const hideProvider = (provider: UpstreamProvider) => {
    setHiddenProviderIds((current) =>
      current.includes(provider.id) ? current : [...current, provider.id],
    );
  };

  const showProvider = (provider: UpstreamProvider) => {
    setHiddenProviderIds((current) =>
      current.filter((providerId) => providerId !== provider.id),
    );
    setHiddenProvidersOpen(false);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Supply Chain</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">
              上游管理
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              管理上游 Provider、密钥、优先级与请求超时策略。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHiddenProvidersOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              隐藏区
              {hiddenProviders.length > 0 ? ` (${hiddenProviders.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setEditingProvider(null)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              新建 Provider
            </button>
          </div>
        </div>
      </section>

      {notice ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          {notice}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {providersQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-16 animate-pulse rounded-md bg-slate-100"
              />
            ))}
          </div>
        ) : providersQuery.isError ? (
          <div className="p-5 text-sm font-medium text-red-600">
            上游列表加载失败。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">名称 / Base URL</th>
                  <th className="px-5 py-3">密钥</th>
                  <th className="px-5 py-3">优先级</th>
                  <th className="px-5 py-3">超时</th>
                  <th className="px-5 py-3">Compact</th>
                  <th className="px-5 py-3">状态</th>
                  <th className="px-5 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleProviders.map((provider) => (
                  <tr key={provider.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-950">
                        {provider.name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {provider.baseUrl}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-mono text-xs text-slate-600">
                        {provider.apiKey}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {provider.keys?.filter((key) => key.status === "ACTIVE")
                          .length ?? 0}
                        /{provider.keys?.length ?? 0} 个 ACTIVE Key
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm tabular-nums text-slate-700">
                      {provider.priority}
                    </td>
                    <td className="px-5 py-4 text-sm tabular-nums text-slate-700">
                      {provider.timeoutMs} ms
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {provider.compactItemType}
                    </td>
                    <td className="px-5 py-4">
                      <Badge active={provider.status === "ACTIVE"}>
                        {provider.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => hideProvider(provider)}
                          className={secondaryButton}
                        >
                          <EyeOff className="h-4 w-4" /> 隐藏
                        </button>
                        <button
                          type="button"
                          onClick={() => setKeyManagerProviderId(provider.id)}
                          className={secondaryButton}
                        >
                          <KeyRound className="h-4 w-4" /> Key 管理
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingProvider(provider)}
                          className={secondaryButton}
                        >
                          <Edit3 className="h-4 w-4" /> 编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingProvider(provider)}
                          className={dangerButton}
                        >
                          <Trash2 className="h-4 w-4" /> 删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleProviders.length === 0 ? (
                  <tr>
                    <td
                      className="px-5 py-8 text-center text-sm text-slate-500"
                      colSpan={7}
                    >
                      暂无可见上游，已隐藏的上游可在隐藏区恢复。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {hiddenProvidersOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4">
          <section className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">隐藏区</h2>
                <p className="mt-1 text-sm text-slate-500">
                  只影响当前浏览器里的显示整理，不会修改上游状态、Key、价格或路由。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHiddenProvidersOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-[980px] w-full text-left">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3">名称 / Base URL</th>
                      <th className="px-5 py-3">密钥</th>
                      <th className="px-5 py-3">优先级</th>
                      <th className="px-5 py-3">超时</th>
                      <th className="px-5 py-3">Compact</th>
                      <th className="px-5 py-3">状态</th>
                      <th className="px-5 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {hiddenProviders.map((provider) => (
                      <tr key={provider.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-4">
                          <div className="font-semibold text-slate-950">
                            {provider.name}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {provider.baseUrl}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="font-mono text-xs text-slate-600">
                            {provider.apiKey}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {provider.keys?.filter(
                              (key) => key.status === "ACTIVE",
                            ).length ?? 0}
                            /{provider.keys?.length ?? 0} 个 ACTIVE Key
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm tabular-nums text-slate-700">
                          {provider.priority}
                        </td>
                        <td className="px-5 py-4 text-sm tabular-nums text-slate-700">
                          {provider.timeoutMs} ms
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-700">
                          {provider.compactItemType}
                        </td>
                        <td className="px-5 py-4">
                          <Badge active={provider.status === "ACTIVE"}>
                            {provider.status}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => showProvider(provider)}
                            className={secondaryButton}
                          >
                            <Eye className="h-4 w-4" /> 取消隐藏
                          </button>
                        </td>
                      </tr>
                    ))}
                    {hiddenProviders.length === 0 ? (
                      <tr>
                        <td
                          className="px-5 py-8 text-center text-sm text-slate-500"
                          colSpan={7}
                        >
                          隐藏区暂无上游
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <ProviderModal
        open={editingProvider !== undefined}
        provider={editingProvider ?? null}
        loading={saveMutation.isPending}
        onClose={() => setEditingProvider(undefined)}
        onSubmit={(values) => saveMutation.mutateAsync(values)}
      />

      <ProviderKeysDrawer
        provider={keyManagerProvider}
        onClose={() => setKeyManagerProviderId(null)}
        onBatchCreate={() => {
          if (keyManagerProvider)
            setBatchKeyState({ provider: keyManagerProvider });
        }}
        onCreate={() => {
          if (keyManagerProvider)
            setEditingKey({ provider: keyManagerProvider, key: null });
        }}
        onEdit={(key) => {
          if (keyManagerProvider)
            setEditingKey({ provider: keyManagerProvider, key });
        }}
        onDelete={setDeletingKey}
        onBatchDelete={setDeletingKeys}
      />

      <ProviderKeyModal
        state={editingKey}
        loading={saveKeyMutation.isPending}
        onClose={() => setEditingKey(null)}
        onSubmit={(values) => {
          if (!editingKey) return Promise.resolve();
          return saveKeyMutation.mutateAsync({ ...editingKey, values });
        }}
      />

      <BatchProviderKeyModal
        state={batchKeyState}
        loading={batchKeyMutation.isPending}
        onClose={() => setBatchKeyState(null)}
        onSubmit={(values) => {
          if (!batchKeyState) return Promise.resolve();
          return batchKeyMutation.mutateAsync(values);
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingProvider)}
        title="删除上游 Provider"
        description={`删除 ${deletingProvider?.name ?? ""} 会级联删除相关模型价格和模型池渠道，此操作不可撤销。`}
        confirmText="确认删除"
        requireInputText="确认删除"
        loading={deleteMutation.isPending}
        onOpenChange={(open) => !open && setDeletingProvider(null)}
        onConfirm={async () => {
          if (deletingProvider)
            await deleteMutation.mutateAsync(deletingProvider.id);
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingKey)}
        title="删除上游 Key"
        description={`确定删除 ${deletingKey?.name ?? ""} 吗？删除后该 Key 不再参与调度。`}
        confirmText="确认删除"
        loading={deleteKeyMutation.isPending}
        onOpenChange={(open) => !open && setDeletingKey(null)}
        onConfirm={async () => {
          if (deletingKey) await deleteKeyMutation.mutateAsync(deletingKey.id);
        }}
      />

      <ConfirmDialog
        open={deletingKeys.length > 0}
        title="批量删除上游 Key"
        description={`确定删除选中的 ${deletingKeys.length} 个上游 Key 吗？删除后这些 Key 不再参与调度。`}
        confirmText="确认删除"
        loading={deleteKeysMutation.isPending}
        onOpenChange={(open) => !open && setDeletingKeys([])}
        onConfirm={async () => {
          if (deletingKeys.length > 0)
            await deleteKeysMutation.mutateAsync(deletingKeys);
        }}
      />
    </div>
  );
}

function ProviderKeysDrawer({
  provider,
  onClose,
  onBatchCreate,
  onCreate,
  onEdit,
  onDelete,
  onBatchDelete,
}: {
  provider: UpstreamProvider | null;
  onClose: () => void;
  onBatchCreate: () => void;
  onCreate: () => void;
  onEdit: (key: UpstreamProviderKey) => void;
  onDelete: (key: UpstreamProviderKey) => void;
  onBatchDelete: (keys: UpstreamProviderKey[]) => void;
}) {
  const [selectedKeyIds, setSelectedKeyIds] = useState<string[]>([]);
  const keys = provider?.keys ?? [];
  const selectedKeys = keys.filter((key) => selectedKeyIds.includes(key.id));
  const allSelected = keys.length > 0 && selectedKeys.length === keys.length;

  useEffect(() => {
    setSelectedKeyIds([]);
  }, [provider?.id]);

  if (!provider) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-4xl flex-col bg-white shadow-xl">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Key 管理</h2>
            <p className="text-sm text-slate-500">
              {provider.name} ·{" "}
              {provider.keys?.filter((key) => key.status === "ACTIVE").length ??
                0}
              /{provider.keys?.length ?? 0} 个 ACTIVE Key
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-slate-950"
                checked={allSelected}
                disabled={keys.length === 0}
                onChange={(event) =>
                  setSelectedKeyIds(
                    event.target.checked ? keys.map((key) => key.id) : [],
                  )
                }
              />
              已选 {selectedKeys.length}/{keys.length}
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onBatchDelete(selectedKeys)}
                disabled={selectedKeys.length === 0}
                className={dangerButton}
              >
                <Trash2 className="h-4 w-4" /> 批量删除
              </button>
              <button
                type="button"
                onClick={onBatchCreate}
                className={secondaryButton}
              >
                <Plus className="h-4 w-4" /> 批量添加
              </button>
              <button
                type="button"
                onClick={onCreate}
                className={primaryButton}
              >
                <Plus className="h-4 w-4" /> 新增 Key
              </button>
            </div>
          </div>
          <ProviderKeysList
            provider={provider}
            selectedKeyIds={selectedKeyIds}
            onToggleKey={(keyId) => {
              setSelectedKeyIds((current) =>
                current.includes(keyId)
                  ? current.filter((id) => id !== keyId)
                  : [...current, keyId],
              );
            }}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </aside>
    </div>
  );
}

function ProviderKeysList({
  provider,
  selectedKeyIds,
  onToggleKey,
  onEdit,
  onDelete,
}: {
  provider: UpstreamProvider;
  selectedKeyIds: string[];
  onToggleKey: (keyId: string) => void;
  onEdit: (key: UpstreamProviderKey) => void;
  onDelete: (key: UpstreamProviderKey) => void;
}) {
  const keys = provider.keys ?? [];
  if (keys.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
        暂无独立 Key，保存 Provider API Key 后会生成 key-1。
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {keys.map((key) => (
        <div
          key={key.id}
          className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_110px_90px_110px_110px_140px] lg:items-center"
        >
          <div className="flex min-w-0 gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-slate-950"
              checked={selectedKeyIds.includes(key.id)}
              onChange={() => onToggleKey(key.id)}
              aria-label={`选择 ${key.name}`}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-950">{key.name}</span>
                <Badge active={key.status === "ACTIVE"}>{key.status}</Badge>
                <span className="font-mono text-xs text-slate-500">
                  {key.keyPrefix}
                </span>
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                最近检测：{key.lastCheckStatus ?? "-"} · 最近使用：
                {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "-"}
              </div>
              {key.lastError ? (
                <div className="mt-1 truncate text-xs text-red-600">
                  {key.lastError}
                </div>
              ) : null}
            </div>
          </div>
          <Info label="优先级" value={String(key.priority)} />
          <Info
            label="限速"
            value={
              key.providerRateLimit ? `${key.providerRateLimit}/min` : "不限制"
            }
          />
          <Info
            label="日限额"
            value={key.dailyLimitUsd ? `$${key.dailyLimitUsd}` : "不限制"}
          />
          <Info
            label="月限额"
            value={key.monthlyLimitUsd ? `$${key.monthlyLimitUsd}` : "不限制"}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onEdit(key)}
              className={secondaryButton}
            >
              <Edit3 className="h-4 w-4" />
              编辑
            </button>
            <button
              type="button"
              onClick={() => onDelete(key)}
              className={dangerButton}
            >
              <Trash2 className="h-4 w-4" />
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProviderKeyModal({
  state,
  loading,
  onClose,
  onSubmit,
}: {
  state: KeyEditorState;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: ProviderKeyValues) => Promise<unknown>;
}) {
  const isEdit = Boolean(state?.key);
  const form = useForm<ProviderKeyInput, unknown, ProviderKeyValues>({
    resolver: zodResolver(providerKeySchema),
    defaultValues: defaultKeyValues(state?.key ?? null),
  });

  useEffect(() => {
    if (state) form.reset(defaultKeyValues(state.key));
  }, [form, state]);

  if (!state) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              {isEdit ? "编辑上游 Key" : "新增上游 Key"}
            </h2>
            <p className="text-sm text-slate-500">
              {state.provider.name} ·{" "}
              {isEdit ? "留空密钥表示不修改原 Key" : "可为同一上游添加多个 Key"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          className="flex-1 overflow-y-auto p-6"
          onSubmit={form.handleSubmit((values) => onSubmit(values))}
        >
          <div className="grid gap-5">
            <Field label="Key 名称" error={form.formState.errors.name?.message}>
              <input
                className={inputClass}
                placeholder={
                  isEdit ? "留空表示不修改名称" : "留空自动生成 key-n"
                }
                {...form.register("name")}
              />
            </Field>
            <Field label="密钥" error={form.formState.errors.key?.message}>
              <SecretInput
                placeholder={
                  isEdit ? "留空表示不修改原密钥" : "请输入上游 API Key"
                }
                {...form.register("key", { required: !isEdit })}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="状态" error={form.formState.errors.status?.message}>
                <select className={inputClass} {...form.register("status")}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DISABLED">DISABLED</option>
                </select>
              </Field>
              <Field
                label="优先级"
                error={form.formState.errors.priority?.message}
              >
                <input
                  type="number"
                  className={inputClass}
                  {...form.register("priority")}
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field
                label="日限额 USD"
                error={form.formState.errors.dailyLimitUsd?.message}
              >
                <input
                  className={inputClass}
                  placeholder="不填为不限制"
                  {...form.register("dailyLimitUsd")}
                />
              </Field>
              <Field
                label="月限额 USD"
                error={form.formState.errors.monthlyLimitUsd?.message}
              >
                <input
                  className={inputClass}
                  placeholder="不填为不限制"
                  {...form.register("monthlyLimitUsd")}
                />
              </Field>
              <Field
                label="Provider 限速"
                error={form.formState.errors.providerRateLimit?.message}
              >
                <input
                  type="number"
                  className={inputClass}
                  {...form.register("providerRateLimit")}
                />
              </Field>
            </div>
          </div>
          <div className="mt-8 flex justify-end gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className={secondaryButton}
            >
              取消
            </button>
            <button type="submit" disabled={loading} className={primaryButton}>
              {loading ? "保存中" : "保存 Key"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function BatchProviderKeyModal({
  state,
  loading,
  onClose,
  onSubmit,
}: {
  state: BatchKeyState;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: {
    keys: Array<{ name: string; key: string }>;
    priority: number;
  }) => Promise<unknown>;
}) {
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState(100);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state) {
      setContent("");
      setPriority(100);
      setError("");
    }
  }, [state]);

  if (!state) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    try {
      const keys = uniquifyBatchProviderKeyNames(
        parseBatchProviderKeys(content),
        state.provider.keys?.map((key) => key.name) ?? [],
      );
      if (keys.length === 0) {
        throw new Error("请至少输入一行 Key。");
      }
      await onSubmit({ keys, priority });
    } catch (submitError) {
      setError(errorToText(submitError));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              批量添加上游 Key
            </h2>
            <p className="text-sm text-slate-500">
              {state.provider.name} · 每行一个名称和密钥
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form className="flex-1 overflow-y-auto p-6" onSubmit={submit}>
          <div className="grid gap-5">
            <Field label="批量 Key" error={error}>
              <textarea
                className="min-h-56 w-full rounded-md border border-slate-200 bg-white px-3 py-3 font-mono text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={
                  "名称一    sk-********************************\n名称二    sk-********************************\n名称可包含空格    sk-********************************"
                }
              />
              <p className="text-xs leading-5 text-slate-500">
                格式：名称 空格 上游 API Key。名称可以包含空格，系统会从 sk-
                开始识别密钥，空行会自动忽略。
              </p>
            </Field>
            <Field label="优先级">
              <input
                type="number"
                min={1}
                max={10000}
                className={inputClass}
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
              />
            </Field>
          </div>
          <div className="mt-8 flex justify-end gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className={secondaryButton}
            >
              取消
            </button>
            <button type="submit" disabled={loading} className={primaryButton}>
              {loading ? "添加中" : "批量添加"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function ProviderModal({
  open,
  provider,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  provider: UpstreamProvider | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: ProviderValues) => Promise<unknown>;
}) {
  const isEdit = Boolean(provider);
  const form = useForm<ProviderInput, unknown, ProviderValues>({
    resolver: zodResolver(providerSchema),
    defaultValues: defaultValues(provider),
  });

  useEffect(() => {
    if (open) form.reset(defaultValues(provider));
  }, [form, open, provider]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              {isEdit ? "编辑 Provider" : "新建 Provider"}
            </h2>
            <p className="text-sm text-slate-500">
              {isEdit ? "留空 API Key 表示不修改原密钥" : "创建时 API Key 必填"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          className="flex-1 overflow-y-auto p-6"
          onSubmit={form.handleSubmit((values) => onSubmit(values))}
        >
          <div className="grid gap-5">
            <Field label="名称" error={form.formState.errors.name?.message}>
              <input className={inputClass} {...form.register("name")} />
            </Field>
            <Field
              label="Base URL"
              error={form.formState.errors.baseUrl?.message}
            >
              <input
                className={inputClass}
                placeholder="https://api.example.com"
                {...form.register("baseUrl")}
              />
            </Field>
            <Field
              label="API Key"
              error={form.formState.errors.apiKey?.message}
            >
              <SecretInput
                placeholder={
                  isEdit ? "留空表示不修改原密钥" : "请输入上游 API Key"
                }
                {...form.register("apiKey", { required: !isEdit })}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="优先级"
                error={form.formState.errors.priority?.message}
              >
                <input
                  type="number"
                  className={inputClass}
                  {...form.register("priority")}
                />
              </Field>
              <Field
                label="超时毫秒"
                error={form.formState.errors.timeoutMs?.message}
              >
                <input
                  type="number"
                  className={inputClass}
                  {...form.register("timeoutMs")}
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Compact 类型"
                error={form.formState.errors.compactItemType?.message}
              >
                <select
                  className={inputClass}
                  {...form.register("compactItemType")}
                >
                  <option value="compaction_summary">compaction_summary</option>
                  <option value="compaction">compaction</option>
                </select>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  用于二次 compact 替换时写回请求的 item 类型。New API
                  中转站一般选 compaction；subAPI 类中转站一般选
                  compaction_summary。这个选项不会让上游自动支持
                  compact，真正可用必须看 /v1/responses/compact 是否返回
                  encrypted_content。
                </p>
              </Field>
              <Field label="状态" error={form.formState.errors.status?.message}>
                <select className={inputClass} {...form.register("status")}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DISABLED">DISABLED</option>
                </select>
              </Field>
            </div>
          </div>
          <div className="mt-8 flex justify-end gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className={secondaryButton}
            >
              取消
            </button>
            <button type="submit" disabled={loading} className={primaryButton}>
              {loading ? "保存中" : "保存"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function defaultValues(provider: UpstreamProvider | null): ProviderInput {
  return {
    name: provider?.name ?? "",
    baseUrl: provider?.baseUrl ?? "",
    apiKey: "",
    priority: provider?.priority ?? 100,
    timeoutMs: provider?.timeoutMs ?? 180000,
    compactItemType: provider?.compactItemType ?? "compaction_summary",
    status: provider?.status ?? "ACTIVE",
  };
}

function defaultKeyValues(key: UpstreamProviderKey | null): ProviderKeyInput {
  return {
    name: key?.name ?? "",
    key: "",
    status: key?.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    priority: key?.priority ?? 100,
    dailyLimitUsd: key?.dailyLimitUsd ?? "",
    monthlyLimitUsd: key?.monthlyLimitUsd ?? "",
    providerRateLimit: key?.providerRateLimit ?? 0,
  };
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 font-medium text-slate-700">{value}</div>
    </div>
  );
}

function Badge({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}
    >
      {children}
    </span>
  );
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function parseBatchProviderKeys(value: string) {
  return value
    .split(/\r?\n/)
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return null;

      const keyMatch = trimmed.match(/\bsk-\S+/);
      const key = keyMatch?.[0];
      const name = keyMatch ? trimmed.slice(0, keyMatch.index).trim() : "";
      if (!name || !key) {
        throw new Error(
          `第 ${index + 1} 行格式不正确，请使用：名称 空格 sk-...`,
        );
      }

      return { name, key };
    })
    .filter((item): item is { name: string; key: string } => Boolean(item));
}

function uniquifyBatchProviderKeyNames(
  items: Array<{ name: string; key: string }>,
  existingNames: string[],
) {
  const used = new Set(existingNames);

  return items.map((item) => {
    if (!used.has(item.name)) {
      used.add(item.name);
      return item;
    }

    let index = 2;
    let name = `${item.name}-${index}`;
    while (used.has(name)) {
      index += 1;
      name = `${item.name}-${index}`;
    }
    used.add(name);
    return { ...item, name };
  });
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const inputClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton =
  "inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const dangerButton =
  "inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100";
