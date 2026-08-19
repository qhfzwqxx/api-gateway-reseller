import http from "../http";

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
  createdAt: string;
  updatedAt: string;
}

export interface BalanceCurrencySettings {
  currencies: BalanceCurrency[];
  baseCurrencyCode: string;
  activeCurrencyCode: string;
  activeCurrency: BalanceCurrency | null;
}

export interface CreateBalanceCurrencyInput {
  code: string;
  name: string;
  symbol: string;
  icon: string;
  unitsPerBase: string;
}

export interface ActivateBalanceCurrencyResult extends BalanceCurrencySettings {
  target: BalanceCurrency;
  convertedWallets: number;
  totalWallets: number;
  migratedBaseBalance: string;
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

export async function activateBalanceCurrency(code: string) {
  const response = await http.post<ActivateBalanceCurrencyResult>(
    `/admin/balance-currencies/${encodeURIComponent(code)}/activate`,
  );
  return response.data;
}
