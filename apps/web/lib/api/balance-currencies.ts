import http from "../http";

export interface BalanceCurrencyAccessTier {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
}

export interface BalanceCurrency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  icon: string;
  baseUnitsPerUnit: string;
  unitsPerBase: string;
  isBase: boolean;
  enabled: boolean;
  sortOrder: number;
  accessTiers: BalanceCurrencyAccessTier[];
  walletCount: number;
  balance: string;
  reservedBalance: string;
  balanceBase: string;
  reservedBalanceBase: string;
  createdAt: string;
  updatedAt: string;
}

export interface BalanceCurrencySettings {
  currencies: BalanceCurrency[];
  baseCurrencyCode: string;
}

export interface CreateBalanceCurrencyInput {
  code: string;
  name: string;
  symbol: string;
  icon: string;
  unitsPerBase: string;
}

export interface SetBalanceCurrencyEnabledResult extends BalanceCurrencySettings {
  currency: BalanceCurrency;
}

export async function getBalanceCurrencySettings() {
  const response = await http.get<BalanceCurrencySettings>(
    "/admin/balance-currencies",
  );
  return response.data;
}

export async function createBalanceCurrency(input: CreateBalanceCurrencyInput) {
  const response = await http.post<
    BalanceCurrencySettings & { currency: BalanceCurrency }
  >("/admin/balance-currencies", input);
  return response.data;
}

export async function setBalanceCurrencyEnabled(code: string, enabled: boolean) {
  const response = await http.post<SetBalanceCurrencyEnabledResult>(
    `/admin/balance-currencies/${encodeURIComponent(code)}/enabled`,
    { enabled },
  );
  return response.data;
}

export async function setBalanceCurrencyOrder(currencyCodes: string[]) {
  const response = await http.put<BalanceCurrencySettings>(
    "/admin/balance-currencies/order",
    { currencyCodes },
  );
  return response.data;
}

export async function setBalanceCurrencyAccessTiers(
  code: string,
  accessTierIds: string[],
) {
  const response = await http.put<BalanceCurrencySettings>(
    `/admin/balance-currencies/${encodeURIComponent(code)}/access-tiers`,
    { accessTierIds },
  );
  return response.data;
}
