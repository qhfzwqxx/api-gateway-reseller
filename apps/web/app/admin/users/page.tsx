"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Crown,
  Edit3,
  GitBranch,
  KeyRound,
  LogOut,
  Network,
  Plus,
  Save,
  Trash2,
  Wallet,
} from "lucide-react";
import { Fragment, type FormEvent, useEffect, useState } from "react";
import { isAxiosError } from "axios";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import {
  createIpAccessTierRule,
  deleteIpAccessTierRule,
  getAccessTiers,
  getIpAccessTierRules,
  updateIpAccessTierRule,
  type AccessTierSummary,
  type IpAccessTierRule,
} from "../../../lib/api/routing";
import {
  adjustUserBalance,
  createAdminUserApiKey,
  createAdminUser,
  deleteAdminUserIpBanRule,
  deleteAdminUser,
  getAdminUserIps,
  getAdminUsers,
  logoutAdminUser,
  updateAdminApiKey,
  updateAdminUser,
  updateUserModelMappings,
  type AdminUser,
  type AdminUserApiKey,
  type AdminUserIpSummary,
  type AdminUserModelMapping,
  type UpsertAdminApiKeyInput,
  type UpsertAdminUserInput,
} from "../../../lib/api/users";
import {
  activateAdminUserSubscription,
  getAdminUserSubscriptions,
  getSubscriptionPlans,
  grantAdminUserSubscription,
  updateAdminUserSubscription,
  type UserSubscription,
} from "../../../lib/api/subscriptions";
import { BalanceAdjustModal } from "./components/balance-adjust-modal";
import { UserFormModal } from "./components/user-form-modal";

type ConfirmAction =
  | { type: "logout"; user: AdminUser }
  | { type: "delete"; user: AdminUser }
  | null;

const userGroupStorageKey = "admin-users-display-groups";
const userGroupOverrideStorageKey = "admin-users-display-group-overrides";

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [formUser, setFormUser] = useState<AdminUser | null | undefined>(
    undefined,
  );
  const [balanceUser, setBalanceUser] = useState<AdminUser | null>(null);
  const [keyUser, setKeyUser] = useState<AdminUser | null>(null);
  const [mappingUser, setMappingUser] = useState<AdminUser | null>(null);
  const [subscriptionUser, setSubscriptionUser] = useState<AdminUser | null>(
    null,
  );
  const [ipUser, setIpUser] = useState<AdminUser | null>(null);
  const [ipRulesOpen, setIpRulesOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [notice, setNotice] = useState<string>("");
  const [customGroups, setCustomGroups] = useState<string[]>([]);
  const [userGroupOverrides, setUserGroupOverrides] = useState<
    Record<string, string>
  >({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [groupsLoaded, setGroupsLoaded] = useState(false);

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => getAdminUsers(),
    staleTime: 30_000,
  });
  const tiersQuery = useQuery({
    queryKey: ["admin", "access-tiers"],
    queryFn: getAccessTiers,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: createAdminUser,
    onSuccess: () => {
      setFormUser(undefined);
      setNotice("用户已创建");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: Omit<UpsertAdminUserInput, "initialBalance">;
    }) => updateAdminUser(id, values),
    onSuccess: () => {
      setFormUser(undefined);
      setNotice("用户资料已更新");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const balanceMutation = useMutation({
    mutationFn: ({
      id,
      amount,
      remark,
    }: {
      id: string;
      amount: string;
      remark?: string;
    }) => adjustUserBalance(id, { amount, remark }),
    onSuccess: () => {
      setBalanceUser(null);
      setNotice("余额已调整");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const logoutMutation = useMutation({
    mutationFn: logoutAdminUser,
    onSuccess: () => {
      setConfirmAction(null);
      setNotice("已强制用户退出");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAdminUser,
    onSuccess: () => {
      setConfirmAction(null);
      setNotice("用户已删除");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const createKeyMutation = useMutation({
    mutationFn: ({
      userId,
      values,
    }: {
      userId: string;
      values: UpsertAdminApiKeyInput;
    }) => createAdminUserApiKey(userId, values),
    onSuccess: (result) => {
      setNotice(`API Key 已创建，明文 Key：${result.secret}`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const updateKeyMutation = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: Partial<UpsertAdminApiKeyInput>;
    }) => updateAdminApiKey(id, values),
    onSuccess: () => {
      setNotice("API Key 已更新");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const updateMappingsMutation = useMutation({
    mutationFn: ({
      userId,
      mappings,
    }: {
      userId: string;
      mappings: AdminUserModelMapping[];
    }) =>
      updateUserModelMappings(userId, {
        mappings: normalizeModelMappingRows(mappings),
      }),
    onSuccess: () => {
      setMappingUser(null);
      setNotice("模型映射已保存");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  async function handleSaveUser(values: UpsertAdminUserInput) {
    if (formUser) {
      const { initialBalance: _initialBalance, ...payload } = values;
      await updateMutation.mutateAsync({ id: formUser.id, values: payload });
      return;
    }

    await createMutation.mutateAsync(values);
  }

  async function handleConfirm() {
    if (!confirmAction) {
      return;
    }

    if (confirmAction.type === "logout") {
      await logoutMutation.mutateAsync(confirmAction.user.id);
      return;
    }

    await deleteMutation.mutateAsync(confirmAction.user.id);
  }

  useEffect(() => {
    setCustomGroups(readStringList(userGroupStorageKey));
    setUserGroupOverrides(readStringRecord(userGroupOverrideStorageKey));
    setGroupsLoaded(true);
  }, []);

  useEffect(() => {
    if (!groupsLoaded) return;
    window.localStorage.setItem(
      userGroupStorageKey,
      JSON.stringify(customGroups),
    );
  }, [customGroups, groupsLoaded]);

  useEffect(() => {
    if (!groupsLoaded) return;
    window.localStorage.setItem(
      userGroupOverrideStorageKey,
      JSON.stringify(userGroupOverrides),
    );
  }, [groupsLoaded, userGroupOverrides]);

  function handleCreateGroup() {
    const name = window.prompt("请输入新分组名称");
    const normalizedName = normalizeGroupName(name);
    if (!normalizedName) {
      return;
    }
    setCustomGroups((current) =>
      current.includes(normalizedName) ? current : [...current, normalizedName],
    );
    setExpandedGroups((current) => ({ ...current, [normalizedName]: false }));
  }

  function handleAssignUserGroup(userId: string, groupName: string) {
    setUserGroupOverrides((current) => {
      const next = { ...current };
      next[userId] = groupName;
      return next;
    });
  }

  function toggleGroup(groupName: string) {
    setExpandedGroups((current) => ({
      ...current,
      [groupName]: !(current[groupName] ?? false),
    }));
  }

  const users = usersQuery.data ?? [];
  const tiers = tiersQuery.data ?? [];
  const keyModalUser = keyUser
    ? (users.find((user) => user.id === keyUser.id) ?? keyUser)
    : null;
  const confirmLoading = logoutMutation.isPending || deleteMutation.isPending;
  const groupedUsers = groupUsersForDisplay(
    users,
    customGroups,
    userGroupOverrides,
  );
  const groupOptions = groupedUsers.map((group) => group.name);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Users & Wallets</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">
              用户与钱包
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              管理用户等级、用户限制、API Key 等级与 Key 限制。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIpRulesOpen(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Network className="h-4 w-4" aria-hidden="true" />
              IP 等级
            </button>
            <button
              type="button"
              onClick={handleCreateGroup}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              新建分组
            </button>
            <button
              type="button"
              onClick={() => setFormUser(null)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              新建用户
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
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">用户列表</h3>
          <span className="text-sm text-slate-500">共 {users.length} 条</span>
        </div>

        {usersQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-14 animate-pulse rounded-md bg-slate-100"
              />
            ))}
          </div>
        ) : usersQuery.isError ? (
          <div className="p-5 text-sm font-medium text-red-600">
            用户列表加载失败，请刷新页面重试。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1380px] w-full text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">ID / 邮箱</th>
                  <th className="px-5 py-3">角色 / 状态</th>
                  <th className="px-5 py-3">用户分组</th>
                  <th className="px-5 py-3">等级 / 钱包</th>
                  <th className="px-5 py-3">模型白名单</th>
                  <th className="px-5 py-3">额度限制</th>
                  <th className="px-5 py-3">统计</th>
                  <th className="px-5 py-3">创建时间</th>
                  <th className="px-5 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {groupedUsers.map((group) => {
                  const expanded = expandedGroups[group.name] ?? false;

                  return (
                    <Fragment key={group.name}>
                      <tr className="bg-slate-50/80">
                        <td colSpan={9} className="px-5 py-3">
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.name)}
                            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-100"
                          >
                            <span className="flex items-center gap-3">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-500">
                                {expanded ? "−" : "+"}
                              </span>
                              <span className="text-sm font-semibold text-slate-950">
                                {group.name}
                              </span>
                              <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-500">
                                {group.users.length} 人
                              </span>
                            </span>
                            <span className="text-xs font-medium text-slate-400">
                              {expanded ? "点击折叠" : "点击展开"}
                            </span>
                          </button>
                        </td>
                      </tr>
                      {expanded
                        ? group.users.map((user) => (
                            <tr key={user.id} className="hover:bg-slate-50/70">
                              <td className="px-5 py-4">
                                <div className="font-medium text-slate-950">
                                  {user.email}
                                </div>
                                <div className="mt-1 font-mono text-xs text-slate-400">
                                  {user.id}
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex flex-wrap gap-2">
                                  <Badge
                                    tone={
                                      user.role === "ADMIN" ? "blue" : "slate"
                                    }
                                  >
                                    {user.role}
                                  </Badge>
                                  <Badge tone={statusTone(user.status)}>
                                    {user.status}
                                  </Badge>
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <select
                                  value={displayGroupName(
                                    user,
                                    userGroupOverrides,
                                  )}
                                  onChange={(event) =>
                                    handleAssignUserGroup(
                                      user.id,
                                      event.target.value,
                                    )
                                  }
                                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                >
                                  {groupOptions.map((groupName) => (
                                    <option key={groupName} value={groupName}>
                                      {groupName}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-5 py-4">
                                <div className="text-sm font-medium text-slate-950">
                                  {tierLabel(user.tier)}
                                </div>
                                <div className="mt-1 font-semibold tabular-nums text-slate-950">
                                  {formatMoney(user.wallet?.balance ?? "0")}
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <ModelWhitelist models={user.allowedModels} />
                              </td>
                              <td className="px-5 py-4 text-sm text-slate-600">
                                <div>
                                  RPM：{limitText(user.rateLimitPerMinute)}
                                </div>
                                <div className="mt-1">
                                  并发：{limitText(user.concurrencyLimit)}
                                </div>
                              </td>
                              <td className="px-5 py-4 text-sm text-slate-600">
                                <div>API Key：{user._count.apiKeys}</div>
                                <div className="mt-1">
                                  请求：{formatInteger(user._count.apiRequests)}
                                </div>
                              </td>
                              <td className="px-5 py-4 text-sm text-slate-600">
                                {formatDate(user.createdAt)}
                              </td>
                              <td className="px-5 py-4 text-right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setFormUser(user)}
                                    className={tableActionButton}
                                  >
                                    <Edit3 className="h-4 w-4" />
                                    编辑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setMappingUser(user)}
                                    className={tableActionButton}
                                  >
                                    <GitBranch className="h-4 w-4" />
                                    模型映射
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setKeyUser(user)}
                                    className={tableActionButton}
                                  >
                                    <KeyRound className="h-4 w-4" />
                                    Key
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setIpUser(user)}
                                    className={tableActionButton}
                                  >
                                    <Network className="h-4 w-4" />
                                    IP
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSubscriptionUser(user)}
                                    className={tableActionButton}
                                  >
                                    <Crown className="h-4 w-4" />
                                    订阅
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setBalanceUser(user)}
                                    className={tableActionButton}
                                  >
                                    <Wallet className="h-4 w-4" />
                                    余额
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmAction({ type: "logout", user })
                                    }
                                    className={tableActionButton}
                                  >
                                    <LogOut className="h-4 w-4" />
                                    登出
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmAction({ type: "delete", user })
                                    }
                                    className={tableDangerButton}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    删除
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <UserFormModal
        open={formUser !== undefined}
        user={formUser ?? null}
        loading={createMutation.isPending || updateMutation.isPending}
        tiers={tiers}
        onClose={() => setFormUser(undefined)}
        onSubmit={handleSaveUser}
      />

      <UserKeysModal
        open={Boolean(keyModalUser)}
        user={keyModalUser}
        tiers={tiers}
        loading={createKeyMutation.isPending || updateKeyMutation.isPending}
        onClose={() => setKeyUser(null)}
        onCreate={async (values) => {
          if (!keyModalUser) return;
          await createKeyMutation.mutateAsync({
            userId: keyModalUser.id,
            values,
          });
        }}
        onUpdate={async (key, values) => {
          await updateKeyMutation.mutateAsync({ id: key.id, values });
        }}
      />

      <BalanceAdjustModal
        open={Boolean(balanceUser)}
        user={balanceUser}
        loading={balanceMutation.isPending}
        onClose={() => setBalanceUser(null)}
        onSubmit={async (values) => {
          if (!balanceUser) {
            return;
          }

          await balanceMutation.mutateAsync({ id: balanceUser.id, ...values });
        }}
      />

      <UserModelMappingsModal
        open={Boolean(mappingUser)}
        user={mappingUser}
        loading={updateMappingsMutation.isPending}
        onClose={() => setMappingUser(null)}
        onSubmit={async (mappings) => {
          if (!mappingUser) return;
          await updateMappingsMutation.mutateAsync({
            userId: mappingUser.id,
            mappings,
          });
        }}
      />

      <UserSubscriptionsModal
        open={Boolean(subscriptionUser)}
        user={subscriptionUser}
        onClose={() => setSubscriptionUser(null)}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
        }}
        onNotice={setNotice}
      />

      <UserIpsModal
        open={Boolean(ipUser)}
        user={ipUser}
        onClose={() => setIpUser(null)}
        onNotice={setNotice}
      />

      <IpAccessTierRulesDrawer
        open={ipRulesOpen}
        tiers={tiers}
        onClose={() => setIpRulesOpen(false)}
        onNotice={setNotice}
      />

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.type === "delete" ? "删除用户" : "强制退出用户"}
        description={
          confirmAction?.type === "delete"
            ? `将永久删除 ${confirmAction.user.email}，该操作不可撤销。不能删除当前管理员自己，后端也会执行校验。`
            : `将使 ${confirmAction?.user.email ?? ""} 的现有 Token 立即失效。`
        }
        confirmText={confirmAction?.type === "delete" ? "确认删除" : "确认退出"}
        requireInputText={
          confirmAction?.type === "delete" ? "确认删除" : undefined
        }
        loading={confirmLoading}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

function UserIpsModal({
  open,
  user,
  onClose,
  onNotice,
}: {
  open: boolean;
  user: AdminUser | null;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const ipsQuery = useQuery({
    queryKey: ["admin", "users", user?.id, "ips"],
    queryFn: () => getAdminUserIps(user?.id ?? ""),
    enabled: open && Boolean(user?.id),
  });
  const unbanMutation = useMutation({
    mutationFn: deleteAdminUserIpBanRule,
    onSuccess: async () => {
      onNotice("IP 封禁已解除");
      await queryClient.invalidateQueries({
        queryKey: ["admin", "users", user?.id, "ips"],
      });
    },
    onError: (error) => onNotice(errorToText(error)),
  });

  if (!open || !user) {
    return null;
  }

  const ips = ipsQuery.data?.ips ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">用户 IP</h2>
            <p className="mt-1 text-sm text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="overflow-auto p-6">
          {ipsQuery.isLoading ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              正在加载 IP 记录...
            </div>
          ) : ips.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              暂无登录或调用 IP 记录
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">来源统计</th>
                  <th className="px-4 py-3">首次出现</th>
                  <th className="px-4 py-3">最近出现</th>
                  <th className="px-4 py-3">封禁</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ips.map((item) => (
                  <UserIpRow
                    item={item}
                    key={item.ip}
                    unbanBusy={unbanMutation.isPending}
                    onUnban={(ip) => unbanMutation.mutate(ip)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function UserIpRow({
  item,
  unbanBusy,
  onUnban,
}: {
  item: AdminUserIpSummary;
  unbanBusy: boolean;
  onUnban: (ip: string) => void;
}) {
  const isBanned = Boolean(item.banRule);

  return (
    <tr className="hover:bg-slate-50/70">
      <td className="px-4 py-3">
        <code className="rounded bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-950">
          {item.ip}
        </code>
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        <div>API 调用：{formatInteger(item.apiRequestCount)}</div>
        <div className="mt-1">
          登录成功：{formatInteger(item.loginSuccessCount)} · 登录失败：
          {formatInteger(item.loginFailureCount)}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {item.firstSeenAt ? formatDate(item.firstSeenAt) : "-"}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {item.lastSeenAt ? formatDate(item.lastSeenAt) : "-"}
      </td>
      <td className="px-4 py-3 text-sm">
        {isBanned ? (
          <div className="grid gap-1">
            <span className="inline-flex w-fit rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
              已封禁 · {item.banRule?.mode === "notice" ? "公告" : "报错"}
            </span>
            {item.banRule?.reason ? (
              <span className="text-xs text-slate-500">
                {item.banRule.reason}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
            未封禁
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {isBanned ? (
          <button
            type="button"
            disabled={unbanBusy}
            onClick={() => onUnban(item.ip)}
            className={tableActionButton}
          >
            解封
          </button>
        ) : (
          <span className="text-sm text-slate-400">-</span>
        )}
      </td>
    </tr>
  );
}

function UserModelMappingsModal({
  open,
  user,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  user: AdminUser | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (mappings: AdminUserModelMapping[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<AdminUserModelMapping[]>([]);

  useEffect(() => {
    if (!open) return;
    setRows(
      user?.modelMappings?.length
        ? user.modelMappings.map((mapping) => ({ ...mapping }))
        : [{ fromModel: "", toModel: "" }],
    );
  }, [open, user]);

  if (!open || !user) {
    return null;
  }

  function updateRow(
    index: number,
    field: "fromModel" | "toModel",
    value: string,
  ) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  }

  function addRow() {
    setRows((current) => [...current, { fromModel: "", toModel: "" }]);
  }

  function removeRow(index: number) {
    setRows((current) =>
      current.length <= 1
        ? [{ fromModel: "", toModel: "" }]
        : current.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(rows);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">模型映射</h2>
            <p className="mt-1 text-sm text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100"
          >
            关闭
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto p-6">
          {rows.map((row, index) => (
            <div
              key={row.id ?? index}
              className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  调用模型
                </span>
                <input
                  value={row.fromModel}
                  onChange={(event) =>
                    updateRow(index, "fromModel", event.target.value)
                  }
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="gpt-4o"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  实际模型
                </span>
                <input
                  value={row.toModel}
                  onChange={(event) =>
                    updateRow(index, "toModel", event.target.value)
                  }
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="gpt-4.1"
                />
              </label>
              <button
                type="button"
                onClick={() => removeRow(index)}
                className="inline-flex h-10 items-center justify-center self-end rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={addRow} className={tableActionButton}>
            <Plus className="h-4 w-4" />
            添加映射
          </button>
          <button type="button" onClick={onClose} className={tableActionButton}>
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {loading ? "保存中..." : "保存映射"}
          </button>
        </div>
      </form>
    </div>
  );
}

function normalizeModelMappingRows(rows: AdminUserModelMapping[]) {
  const byFromModel = new Map<string, AdminUserModelMapping>();
  for (const row of rows) {
    const fromModel = row.fromModel.trim();
    const toModel = row.toModel.trim();
    if (!fromModel || !toModel) {
      continue;
    }
    byFromModel.set(fromModel, { fromModel, toModel });
  }
  return [...byFromModel.values()];
}

function IpAccessTierRulesDrawer({
  open,
  tiers,
  onClose,
  onNotice,
}: {
  open: boolean;
  tiers: AccessTierSummary[];
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [cidrOrIp, setCidrOrIp] = useState("");
  const [tierId, setTierId] = useState("");
  const [priority, setPriority] = useState("100");
  const [remark, setRemark] = useState("");
  const rulesQuery = useQuery({
    queryKey: ["admin", "ip-access-tiers"],
    queryFn: getIpAccessTierRules,
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });

  useEffect(() => {
    if (open && !tierId && tiers[0]?.id) {
      setTierId(tiers[0].id);
    }
  }, [open, tierId, tiers]);

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["admin", "ip-access-tiers"],
    });
  const createMutation = useMutation({
    mutationFn: () =>
      createIpAccessTierRule({
        cidrOrIp,
        tierId,
        status: "ACTIVE",
        priority: Number(priority || 100),
        remark: remark.trim() || null,
      }),
    onSuccess: () => {
      setCidrOrIp("");
      setRemark("");
      onNotice("IP 等级规则已创建");
      refresh();
    },
    onError: (error) => onNotice(errorToText(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      rule,
      status,
    }: {
      rule: IpAccessTierRule;
      status: IpAccessTierRule["status"];
    }) => updateIpAccessTierRule(rule.id, { status }),
    onSuccess: () => {
      onNotice("IP 等级规则已更新");
      refresh();
    },
    onError: (error) => onNotice(errorToText(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteIpAccessTierRule,
    onSuccess: () => {
      onNotice("IP 等级规则已删除");
      refresh();
    },
    onError: (error) => onNotice(errorToText(error)),
  });

  if (!open) {
    return null;
  }

  const rules = rulesQuery.data ?? [];
  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-4xl flex-col bg-white shadow-xl">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              IP 等级规则
            </h2>
            <p className="text-sm text-slate-500">
              优先级：IP 等级 &gt; API Key 等级 &gt; 用户等级 &gt; standard。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <form
            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!cidrOrIp.trim() || !tierId) {
                onNotice("请填写 IP/CIDR 并选择等级");
                return;
              }
              createMutation.mutate();
            }}
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_120px_minmax(0,1fr)_auto]">
              <input
                value={cidrOrIp}
                onChange={(event) => setCidrOrIp(event.target.value)}
                className={inputClass}
                placeholder="1.2.3.4 或 1.2.3.0/24"
              />
              <select
                value={tierId}
                onChange={(event) => setTierId(event.target.value)}
                className={inputClass}
              >
                <option value="">选择等级</option>
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} ({tier.code})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={10000}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className={inputClass}
              />
              <input
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                className={inputClass}
                placeholder="备注"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                新增
              </button>
            </div>
          </form>

          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
            <table className="min-w-[760px] w-full text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">IP / CIDR</th>
                  <th className="px-4 py-3">等级</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">优先级</th>
                  <th className="px-4 py-3">备注</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rulesQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      加载中...
                    </td>
                  </tr>
                ) : rules.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      暂无 IP 等级规则
                    </td>
                  </tr>
                ) : (
                  rules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-sm text-slate-700">
                        {rule.cidrOrIp}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {rule.tier.name} ({rule.tier.code})
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={rule.status === "ACTIVE" ? "green" : "slate"}
                        >
                          {rule.status === "ACTIVE" ? "启用" : "停用"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {rule.priority}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {rule.remark || "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              updateMutation.mutate({
                                rule,
                                status:
                                  rule.status === "ACTIVE"
                                    ? "DISABLED"
                                    : "ACTIVE",
                              })
                            }
                            className={tableActionButton}
                          >
                            {rule.status === "ACTIVE" ? "停用" : "启用"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => deleteMutation.mutate(rule.id)}
                            className={tableDangerButton}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </div>
  );
}

function UserSubscriptionsModal({
  open,
  user,
  onClose,
  onChanged,
  onNotice,
}: {
  open: boolean;
  user: AdminUser | null;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [planId, setPlanId] = useState("");
  const subscriptionsQuery = useQuery({
    queryKey: ["admin", "users", user?.id, "subscriptions"],
    queryFn: () => getAdminUserSubscriptions(user?.id ?? ""),
    enabled: open && Boolean(user?.id),
  });
  const plansQuery = useQuery({
    queryKey: ["admin", "subscription-plans"],
    queryFn: getSubscriptionPlans,
    enabled: open,
  });

  const grantMutation = useMutation({
    mutationFn: () =>
      grantAdminUserSubscription(user?.id ?? "", {
        planId,
        activate: false,
      }),
    onSuccess: () => {
      setPlanId("");
      onNotice("订阅已添加");
      void subscriptionsQuery.refetch();
      onChanged();
    },
    onError: (error) => onNotice(errorToText(error)),
  });
  const activateMutation = useMutation({
    mutationFn: activateAdminUserSubscription,
    onSuccess: () => {
      onNotice("订阅已切换");
      void subscriptionsQuery.refetch();
      onChanged();
    },
    onError: (error) => onNotice(errorToText(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: UserSubscription["status"];
    }) => updateAdminUserSubscription(id, { status }),
    onSuccess: () => {
      onNotice("订阅状态已更新");
      void subscriptionsQuery.refetch();
      onChanged();
    },
    onError: (error) => onNotice(errorToText(error)),
  });

  useEffect(() => {
    if (!open) return;
    const firstPlan = (plansQuery.data ?? []).find(
      (plan) => plan.status === "ACTIVE",
    );
    setPlanId(firstPlan?.id ?? "");
  }, [open, plansQuery.data]);

  if (!open || !user) return null;

  const subscriptions = subscriptionsQuery.data ?? [];
  const plans = (plansQuery.data ?? []).filter(
    (plan) => plan.status === "ACTIVE",
  );
  const activeSubscription =
    subscriptions.find(
      (subscription) => subscription.active && subscription.status === "ACTIVE",
    ) ?? null;
  const busy =
    grantMutation.isPending ||
    activateMutation.isPending ||
    updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-4xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">用户订阅</h2>
            <p className="mt-0.5 text-xs text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            ×
          </button>
        </div>
        <div className="grid gap-5 p-6">
          <div className="flex flex-col gap-3 rounded-md bg-slate-50 p-3 md:flex-row md:items-end">
            <label className="grid flex-1 gap-2">
              <span className="text-sm font-medium text-slate-700">
                添加订阅套餐
              </span>
              <select
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
                className={modalInputClass}
              >
                <option value="">请选择套餐</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {plan.durationDays} 天
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!planId || busy}
              onClick={() => grantMutation.mutate()}
              className={primaryModalButton}
            >
              <Plus className="h-4 w-4" />
              添加
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-xs font-medium text-slate-500">当前订阅</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">
                {activeSubscription ? activeSubscription.plan.name : "未订阅"}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-xs font-medium text-slate-500">今日已用</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">
                {activeSubscription
                  ? formatMoney(activeSubscription.todayUsedUsd)
                  : "$0.00"}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-xs font-medium text-slate-500">剩余额度</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">
                {activeSubscription
                  ? formatQuotaRemaining(activeSubscription)
                  : "-"}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-[760px] w-full text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">套餐</th>
                  <th className="px-4 py-3">等级</th>
                  <th className="px-4 py-3">剩余/到期</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {subscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-950">
                        {subscription.plan.name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {subscription.source}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {subscription.tier.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      <div>{formatRemaining(subscription.remainingSeconds)}</div>
                      <div className="mt-1">{formatDate(subscription.endsAt)}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        今日 {formatMoney(subscription.todayUsedUsd)} / {subscription.quotaMode === "DAILY" ? formatMoney(subscription.todayRemainingUsd ?? "0") : formatQuotaRemaining(subscription)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          subscription.active
                            ? "blue"
                            : subscriptionTone(subscription.status)
                        }
                      >
                        {subscription.active ? "CURRENT" : subscription.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={
                            busy ||
                            subscription.active ||
                            subscription.status === "DISABLED" ||
                            subscription.status === "EXPIRED"
                          }
                          onClick={() =>
                            activateMutation.mutate(subscription.id)
                          }
                          className={tableActionButton}
                        >
                          切换
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            updateMutation.mutate({
                              id: subscription.id,
                              status:
                                subscription.status === "DISABLED"
                                  ? "QUEUED"
                                  : "DISABLED",
                            })
                          }
                          className={tableActionButton}
                        >
                          {subscription.status === "DISABLED" ? "恢复" : "停用"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {subscriptions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      暂无订阅
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserKeysModal({
  open,
  user,
  tiers,
  loading,
  onClose,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  user: AdminUser | null;
  tiers: AccessTierSummary[];
  loading: boolean;
  onClose: () => void;
  onCreate: (values: UpsertAdminApiKeyInput) => Promise<void>;
  onUpdate: (
    key: AdminUserApiKey,
    values: Partial<UpsertAdminApiKeyInput>,
  ) => Promise<void>;
}) {
  const [editingKeyId, setEditingKeyId] = useState<string | "new" | null>(null);
  const keys = user?.apiKeys ?? [];
  const editingKey =
    editingKeyId && editingKeyId !== "new"
      ? (keys.find((key) => key.id === editingKeyId) ?? null)
      : null;

  useEffect(() => {
    if (open) {
      setEditingKeyId(null);
    }
  }, [open, user?.id]);

  if (!open || !user) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-5xl flex-col bg-white shadow-xl">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              管理用户 API Key
            </h2>
            <p className="text-sm text-slate-500">
              {user.email} · 用户等级 {tierLabel(user.tier)} · 用户 RPM{" "}
              {limitText(user.rateLimitPerMinute)} · 用户并发{" "}
              {limitText(user.concurrencyLimit)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            请求会同时校验用户限制和 Key 限制：用户等级/限速/并发必须满足，Key
            自己的等级/限速/并发也必须满足。
          </div>

          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => setEditingKeyId("new")}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              新建 Key
            </button>
          </div>

          {editingKeyId ? (
            <ApiKeyForm
              key={editingKeyId}
              apiKey={editingKey}
              tiers={tiers}
              userTierId={user.tierId}
              loading={loading}
              onCancel={() => setEditingKeyId(null)}
              onSubmit={async (values) => {
                if (editingKey) {
                  await onUpdate(editingKey, values);
                } else {
                  await onCreate(values);
                }
                setEditingKeyId(null);
              }}
            />
          ) : null}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="min-w-[1120px] w-full text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">名称 / API Key</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">等级</th>
                  <th className="px-4 py-3">Key 限制</th>
                  <th className="px-4 py-3">额度 / 使用</th>
                  <th className="px-4 py-3">最近使用</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {keys.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      暂无 API Key
                    </td>
                  </tr>
                ) : (
                  keys.map((key) => (
                    <tr key={key.id} className="hover:bg-slate-50/70">
	                      <td className="px-4 py-3">
	                        <div className="flex flex-wrap items-center gap-2">
	                          <div className="font-medium text-slate-950">
	                            {key.name}
	                          </div>
	                          <button
	                            type="button"
	                            onClick={() => setEditingKeyId(key.id)}
	                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
	                          >
	                            <Edit3 className="h-3.5 w-3.5" />
	                            编辑 Key
	                          </button>
	                        </div>
	                        <div className="mt-1 max-w-md break-all font-mono text-xs text-slate-400">
	                          {key.keySecret ?? key.keyPrefix}
	                        </div>
	                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            key.status === "ACTIVE"
                              ? "green"
                              : key.status === "DISABLED"
                                ? "amber"
                                : "red"
                          }
                        >
                          {key.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {apiKeyTierLabel(key.tier)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        <div>RPM：{limitText(key.rateLimitPerMinute)}</div>
                        <div className="mt-1">
                          并发：{limitText(key.concurrencyLimit)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        <div>
                          总额：
                          {key.totalLimitUsd
                            ? formatMoney(key.totalLimitUsd)
                            : "不限制"}
                        </div>
                        <div className="mt-1">
                          已用：
                          {formatMoney(key.totalUsedUsd ?? key.usedUsd ?? "0")}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {key.lastUsedAt ? formatDate(key.lastUsedAt) : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => copyApiKey(key)}
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Copy className="h-4 w-4" />
                            复制
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingKeyId(key.id)}
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Edit3 className="h-4 w-4" />
                            编辑
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ApiKeyForm({
  apiKey,
  tiers,
  userTierId,
  loading,
  onCancel,
  onSubmit,
}: {
  apiKey: AdminUserApiKey | null;
  tiers: AccessTierSummary[];
  userTierId: string | null;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (values: UpsertAdminApiKeyInput) => Promise<void>;
}) {
  const [name, setName] = useState(apiKey?.name ?? "default");
  const [status, setStatus] = useState(apiKey?.status ?? "ACTIVE");
  const [tierId, setTierId] = useState(apiKey?.tierId ?? "");
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(
    String(apiKey?.rateLimitPerMinute ?? 60),
  );
  const [concurrencyLimit, setConcurrencyLimit] = useState(
    String(apiKey?.concurrencyLimit ?? 0),
  );
  const [totalLimitUsd, setTotalLimitUsd] = useState(
    apiKey?.totalLimitUsd ?? "",
  );
  const [expiresAt, setExpiresAt] = useState(dateInputValue(apiKey?.expiresAt));
  const [allowedModels, setAllowedModels] = useState(
    (apiKey?.allowedModels ?? []).join("\n"),
  );
  const [ipWhitelist, setIpWhitelist] = useState(
    (apiKey?.ipWhitelist ?? []).join("\n"),
  );
  const [tags, setTags] = useState((apiKey?.tags ?? []).join(", "));
  const [noticeEnabled, setNoticeEnabled] = useState(
    Boolean(apiKey?.noticeEnabled),
  );
  const [noticeText, setNoticeText] = useState(apiKey?.noticeText ?? "");
  const [forceFastMode, setForceFastMode] = useState(
    Boolean(apiKey?.forceFastMode),
  );
  const [disabledReason, setDisabledReason] = useState(
    apiKey?.disabledReason ?? "",
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTotalLimitUsd = totalLimitUsd.trim();
    const usedUsd = Number(apiKey?.totalUsedUsd ?? apiKey?.usedUsd ?? 0);
    const nextTotalLimit = Number(nextTotalLimitUsd || 0);

    if (
      status === "ACTIVE" &&
      nextTotalLimitUsd &&
      Number.isFinite(usedUsd) &&
      Number.isFinite(nextTotalLimit) &&
      nextTotalLimit <= usedUsd
    ) {
      window.alert(
        `当前 Key 已用 $${usedUsd.toFixed(8)}，总额度必须大于已用额度才能启用。`,
      );
      return;
    }

    await onSubmit({
      name,
      status,
      tierId: tierId || null,
      rateLimitPerMinute: Number(rateLimitPerMinute || 60),
      concurrencyLimit: Number(concurrencyLimit || 0),
      totalLimitUsd: nextTotalLimitUsd || null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      allowedModels: splitLines(allowedModels),
      ipWhitelist: splitLines(ipWhitelist),
      tags: splitComma(tags),
      noticeEnabled,
      noticeText: noticeText.trim() || null,
      forceFastMode,
      disabledReason: disabledReason.trim() || null,
    });
  }

  return (
    <form
      onSubmit={submit}
      className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <FieldBlock label="Key 名称">
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
        </FieldBlock>
        <FieldBlock label="状态">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={inputClass}
          >
            <option value="ACTIVE">ACTIVE</option>
            <option value="DISABLED">DISABLED</option>
            <option value="REVOKED">REVOKED</option>
          </select>
        </FieldBlock>
        <FieldBlock label="Key 等级">
          <select
            value={tierId}
            onChange={(event) => setTierId(event.target.value)}
            className={inputClass}
          >
            <option value="">不单独设置（跟随用户）</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name} ({tier.code})
              </option>
            ))}
          </select>
        </FieldBlock>
        <FieldBlock label="过期时间">
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className={inputClass}
          />
        </FieldBlock>
        <FieldBlock label="Key RPM">
          <input
            required
            type="number"
            min={1}
            value={rateLimitPerMinute}
            onChange={(event) => setRateLimitPerMinute(event.target.value)}
            className={inputClass}
          />
        </FieldBlock>
        <FieldBlock label="Key 并发">
          <input
            required
            type="number"
            min={0}
            value={concurrencyLimit}
            onChange={(event) => setConcurrencyLimit(event.target.value)}
            className={inputClass}
          />
        </FieldBlock>
        <FieldBlock label="总额度 USD">
          <input
            inputMode="decimal"
            value={totalLimitUsd ?? ""}
            onChange={(event) => setTotalLimitUsd(event.target.value)}
            placeholder="不填为不限制"
            className={inputClass}
          />
        </FieldBlock>
        <FieldBlock label="禁用原因">
          <input
            value={disabledReason}
            onChange={(event) => setDisabledReason(event.target.value)}
            className={inputClass}
          />
        </FieldBlock>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <FieldBlock label="允许模型">
          <textarea
            value={allowedModels}
            onChange={(event) => setAllowedModels(event.target.value)}
            className={textareaClass}
            placeholder="每行一个模型，空为不限制"
          />
        </FieldBlock>
        <FieldBlock label="IP 白名单">
          <textarea
            value={ipWhitelist}
            onChange={(event) => setIpWhitelist(event.target.value)}
            className={textareaClass}
            placeholder="每行一个 IP/CIDR，空为不限制"
          />
        </FieldBlock>
        <FieldBlock label="标签">
          <textarea
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className={textareaClass}
            placeholder="逗号分隔"
          />
        </FieldBlock>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={noticeEnabled}
          onChange={(event) => setNoticeEnabled(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        启用 Key 公告
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={forceFastMode}
          onChange={(event) => setForceFastMode(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        强制 Fast 模式
      </label>
      {noticeEnabled ? (
        <textarea
          value={noticeText}
          onChange={(event) => setNoticeText(event.target.value)}
          className={`mt-3 ${textareaClass}`}
          placeholder="公告内容"
        />
      ) : null}
      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-white"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "保存中" : "保存 Key"}
        </button>
      </div>
    </form>
  );
}

async function copyApiKey(key: AdminUserApiKey) {
  const apiKey = key.keySecret ?? key.keyPrefix;

  try {
    await navigator.clipboard.writeText(apiKey);
    window.alert(
      key.keySecret ? "完整 API Key 已复制" : "仅复制到 Key 前缀，无法用于调用",
    );
  } catch {
    window.prompt("复制 API Key", apiKey);
  }
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "blue" | "green" | "amber" | "red" | "slate";
}) {
  const styles = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

function statusTone(status: AdminUser["status"]) {
  if (status === "ACTIVE") return "green";
  if (status === "TRIAL" || status === "RISK_REVIEW") return "amber";
  if (status === "DISABLED" || status === "SUSPENDED") return "red";
  return "slate";
}

function userGroupInfo(user: AdminUser): {
  label: string;
  tone: "blue" | "green" | "amber" | "red" | "slate";
} {
  if (user.role === "ADMIN") {
    return { label: "管理员组", tone: "blue" };
  }
  if (user.charityEnabled) {
    return { label: "公益组", tone: "green" };
  }
  if (user.status === "RISK_REVIEW") {
    return { label: "风控组", tone: "amber" };
  }
  if (user.status === "DISABLED" || user.status === "SUSPENDED") {
    return { label: "受限组", tone: "red" };
  }
  return { label: "普通组", tone: "slate" };
}

function defaultGroupName(user: AdminUser) {
  return userGroupInfo(user).label;
}

function normalizeGroupName(value: string | null) {
  return (value ?? "").trim().slice(0, 32);
}

function displayGroupName(user: AdminUser, overrides: Record<string, string>) {
  return overrides[user.id] || defaultGroupName(user);
}

function groupUsersForDisplay(
  users: AdminUser[],
  customGroups: string[],
  overrides: Record<string, string>,
) {
  const baseGroupNames = ["管理员组", "公益组", "风控组", "受限组", "普通组"];
  const orderedNames = Array.from(
    new Set([...customGroups, ...baseGroupNames]),
  );
  const groupMap = new Map<string, AdminUser[]>(
    orderedNames.map((groupName) => [groupName, []]),
  );

  for (const user of users) {
    const groupName = displayGroupName(user, overrides);
    groupMap.set(groupName, [...(groupMap.get(groupName) ?? []), user]);
  }

  return Array.from(groupMap.entries())
    .filter(
      ([groupName, groupUsers]) =>
        customGroups.includes(groupName) || groupUsers.length > 0,
    )
    .map(([name, groupUsers]) => ({ name, users: groupUsers }));
}

function readStringList(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? Array.from(
          new Set(
            parsed
              .map((item) => normalizeGroupName(String(item)))
              .filter(Boolean),
          ),
        )
      : [];
  } catch {
    return [];
  }
}

function readStringRecord(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([userId, groupName]) => [
          String(userId),
          normalizeGroupName(String(groupName)),
        ])
        .filter(([, groupName]) => Boolean(groupName)),
    );
  } catch {
    return {};
  }
}

function limitText(value: number) {
  return value === 0 ? "不限制" : formatInteger(value);
}

function ModelWhitelist({ models }: { models: string[] }) {
  if (models.length === 0) {
    return <span className="text-sm text-slate-500">不限</span>;
  }

  const visibleModels = models.slice(0, 3);
  const hiddenCount = models.length - visibleModels.length;

  return (
    <div className="flex max-w-xs flex-wrap gap-1.5">
      {visibleModels.map((model) => (
        <span
          key={model}
          className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700"
        >
          {model}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
          +{hiddenCount}
        </span>
      ) : null}
    </div>
  );
}

function tierLabel(tier: AdminUser["tier"]) {
  return tier ? `${tier.name} (${tier.code})` : "standard";
}

function apiKeyTierLabel(tier: AdminUserApiKey["tier"]) {
  return tier ? `${tier.name} (${tier.code})` : "跟随用户";
}

function dateInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitComma(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMoney(value: string | number) {
  const numeric = Number(value);
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(Number.isFinite(numeric) ? numeric : 0)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRemaining(seconds: number) {
  if (seconds <= 0) return "已用完";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时 ${minutes} 分钟`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${Math.max(1, minutes)} 分钟`;
}

function subscriptionTone(status: UserSubscription["status"]) {
  if (status === "ACTIVE") return "blue";
  if (status === "QUEUED") return "slate";
  if (status === "DISABLED") return "red";
  return "amber";
}

function formatQuotaRemaining(subscription: UserSubscription) {
  if (subscription.quotaMode === "UNLIMITED") return "∞";
  if (subscription.quotaMode === "DAILY") {
    return formatMoney(subscription.todayRemainingUsd ?? "0");
  }
  return formatMoney(subscription.totalRemainingUsd ?? "0");
}

function errorToText(error: unknown) {
  if (isAxiosError(error)) {
    const data = error.response?.data as
      | {
          message?: string;
          issues?: Array<{ path?: Array<string | number>; message?: string }>;
          error?: { message?: string };
        }
      | undefined;

    if (data?.issues?.length) {
      return data.issues
        .map((issue) => {
          const field = issue.path?.join(".");
          return field ? `${field}: ${issue.message}` : issue.message;
        })
        .filter(Boolean)
        .join("；");
    }

    return data?.message ?? data?.error?.message ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "操作失败，请稍后再试。";
}

const inputClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass =
  "min-h-24 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const modalInputClass = inputClass;
const primaryModalButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const tableActionButton =
  "inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
const tableDangerButton =
  "inline-flex h-9 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-100";
