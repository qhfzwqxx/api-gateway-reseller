export type FrontPaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type FrontAuthSettings = {
  emailCodeLoginEnabled: boolean;
  emailCodeAutoRegisterEnabled: boolean;
  smtpConfigured: boolean;
  newUserBonusUsd?: string;
  newUserBonusCurrency?: string;
};

export type PublicApiRequest = {
  id: string;
  traceCode?: string | null;
  clientIp?: string | null;
  apiKey?: {
    id: string;
    name: string;
    keyPrefix: string;
  } | null;
  model: string;
  endpoint: string;
  method?: string | null;
  status: string;
  httpStatus?: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  chargedAmountUsd: string;
  latencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  upstreamFirstChunkLatencyMs?: number | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type FrontAccessTier = {
  id: string;
  code: string;
  name: string;
};

export type FrontConfiguredAccessTier = FrontAccessTier & {
  status: "ACTIVE" | "DISABLED" | string;
  sortOrder: number;
  billingMultiplier: string;
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  walletRequired: boolean;
  userSelectable: boolean;
  description: string | null;
  currencies: Array<FrontBalanceCurrency & {
    balance: string;
    reservedBalance: string;
  }>;
  currencyPreference: string[];
  defaultCurrencyOrder: string[];
  preferenceSource: "USER" | "DEFAULT";
};

export type FrontSelectableAccessTier = FrontConfiguredAccessTier & {
  status: "ACTIVE";
  userSelectable: true;
};

export type FrontWallet = {
  id: string;
  balance: string;
  reservedBalance?: string;
  currency: string;
  balanceCurrency?: FrontBalanceCurrency | null;
};

export type FrontBalanceCurrency = {
  code: string;
  name: string;
  symbol: string;
  icon: string;
  baseUnitsPerUnit?: string;
  unitsPerBase?: string;
  isBase?: boolean;
  enabled?: boolean;
};

export type FrontTransaction = {
  id: string;
  type: string;
  source?: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  currency?: string;
  balanceCurrency?: Pick<FrontBalanceCurrency, "name" | "symbol" | "icon"> | null;
  remark?: string | null;
  metadata?: {
    chargedAmountUsd?: string;
    subscriptionChargedAmountUsd?: string;
    walletChargedAmountUsd?: string;
    walletAmount?: string;
    walletCurrency?: string;
  } | null;
  apiRequest?: {
    chargedAmountUsd?: string;
    subscriptionChargedAmountUsd?: string;
    walletChargedAmountUsd?: string;
  } | null;
  createdAt: string;
};

export type FrontUser = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED" | string;
  statusReason?: string | null;
  allowedModels: string[];
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  tierId?: string | null;
  tier?: FrontAccessTier | null;
  createdAt?: string;
  wallets?: FrontWallet[];
};

export type FrontAvailableModel = {
  model: string;
  status: "READY" | "UNAVAILABLE" | string;
  readyChannelCount: number;
};

export type FrontModelMapping = {
  id?: string;
  fromModel: string;
  toModel: string;
  createdAt?: string;
  updatedAt?: string;
};

export type FrontUsageSummary = {
  totals: {
    requests: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    chargedAmountUsd: number;
  };
  requests: PublicApiRequest[];
};
