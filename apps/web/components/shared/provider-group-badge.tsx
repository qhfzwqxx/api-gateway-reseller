export function ProviderGroupBadge({
  groupName,
  className = "",
}: {
  groupName?: string | null;
  className?: string;
}) {
  const normalizedGroupName = groupName?.trim() || null;

  return (
    <span
      title={`上游分组：${normalizedGroupName ?? "未分组"}`}
      className={`inline-flex max-w-[180px] items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
        normalizedGroupName
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-slate-200 bg-slate-50 text-slate-500"
      } ${className}`}
    >
      <span className="truncate">{normalizedGroupName ?? "未分组"}</span>
    </span>
  );
}
