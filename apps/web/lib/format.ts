export function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "0.00000000";
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(8) : "0.00000000";
}

export function seconds(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric / 1000).toFixed(3)}s` : "-";
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function dateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatDuration(secondsValue: number) {
  const seconds = Math.max(0, Math.floor(Number(secondsValue) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (seconds === 0) {
    return "0 分钟";
  }

  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return minutes > 0 ? `${minutes} 分钟` : "不足 1 分钟";
}

export function splitList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function signedMoney(value: string | number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "$0.00000000";
  }

  const sign = numeric > 0 ? "+" : numeric < 0 ? "-" : "";
  return `${sign}$${money(Math.abs(numeric))}`;
}
