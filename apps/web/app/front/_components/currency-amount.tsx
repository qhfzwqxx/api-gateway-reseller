import { Coins, Zap } from "lucide-react";
import { money } from "../../../lib/format";
import type { FrontBalanceCurrency } from "../../../lib/types/front";

type CurrencyLike = Pick<FrontBalanceCurrency, "name" | "symbol" | "icon"> | null | undefined;

export function CurrencyAmount({
  value,
  currency,
  signed = false,
  className = "",
}: {
  value: string | number;
  currency?: CurrencyLike;
  signed?: boolean;
  className?: string;
}) {
  const numeric = Number(value);
  const amount = Number.isFinite(numeric) ? numeric : 0;
  const sign = signed ? (amount > 0 ? "+" : amount < 0 ? "-" : "") : "";
  const absolute = Math.abs(amount);

  if (currency?.icon === "zap") {
    return (
      <span className={`front-currency-amount ${className}`.trim()}>
        <Zap aria-hidden="true" size={16} />
        <span>{sign}{money(absolute)} {currency.symbol || currency.name}</span>
      </span>
    );
  }

  if (!currency || currency.symbol === "$") {
    return <span className={className}>{sign}${money(absolute)}</span>;
  }

  return (
    <span className={`front-currency-amount ${className}`.trim()}>
      <Coins aria-hidden="true" size={16} />
      <span>{sign}{money(absolute)} {currency.symbol || currency.name}</span>
    </span>
  );
}
