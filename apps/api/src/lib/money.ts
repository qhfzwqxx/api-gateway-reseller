import { Decimal } from "decimal.js";
import type { ModelPrice } from "@gateway/db";
import type { Usage } from "../types.js";

const ONE_MILLION = new Decimal(1_000_000);

type PriceValue = { toString(): string } | string | number;

export type ChargePrice = Omit<
  ModelPrice,
  | "customerInputPer1MTok"
  | "customerCachedInputPer1MTok"
  | "customerOutputPer1MTok"
  | "customerPriceMultiplier"
  | "perRequestUsd"
> & {
  customerInputPer1MTok: PriceValue;
  customerCachedInputPer1MTok: PriceValue;
  customerOutputPer1MTok: PriceValue;
  customerPriceMultiplier: PriceValue;
  perRequestUsd: PriceValue;
};

export function toDecimal(value: Decimal.Value) {
  return new Decimal(value);
}

export function calculateCharges(price: ChargePrice, usage: Usage) {
  const upstreamMultiplier = new Decimal(price.upstreamPriceMultiplier.toString());
  const customerMultiplier = new Decimal(price.customerPriceMultiplier.toString());
  const minimumCharge = new Decimal(price.minimumChargeUsd.toString());

  if (price.pricingMode === "request") {
    const upstreamCostUsd = new Decimal(price.upstreamPerRequestUsd.toString())
      .mul(upstreamMultiplier)
      .toDecimalPlaces(8);
    const computedCustomerCharge = new Decimal(price.perRequestUsd.toString())
      .mul(customerMultiplier)
      .toDecimalPlaces(8);
    return {
      upstreamCostUsd,
      chargedAmountUsd: Decimal.max(
        computedCustomerCharge,
        minimumCharge,
      ).toDecimalPlaces(8),
    };
  }

  const inputTokens = new Decimal(usage.inputTokens);
  const cachedInputTokens = new Decimal(usage.cachedInputTokens);
  const outputTokens = new Decimal(usage.outputTokens);

  const upstreamInput = inputTokens
    .div(ONE_MILLION)
    .mul(price.upstreamInputPer1MTok.toString())
    .mul(upstreamMultiplier);
  const upstreamCachedInput = cachedInputTokens
    .div(ONE_MILLION)
    .mul(price.upstreamCachedInputPer1MTok.toString())
    .mul(upstreamMultiplier);
  const upstreamOutput = outputTokens
    .div(ONE_MILLION)
    .mul(price.upstreamOutputPer1MTok.toString())
    .mul(upstreamMultiplier);
  const customerInput = inputTokens
    .div(ONE_MILLION)
    .mul(price.customerInputPer1MTok.toString())
    .mul(customerMultiplier);
  const customerCachedInput = cachedInputTokens
    .div(ONE_MILLION)
    .mul(price.customerCachedInputPer1MTok.toString())
    .mul(customerMultiplier);
  const customerOutput = outputTokens
    .div(ONE_MILLION)
    .mul(price.customerOutputPer1MTok.toString())
    .mul(customerMultiplier);

  const upstreamCostUsd = upstreamInput
    .plus(upstreamCachedInput)
    .plus(upstreamOutput)
    .toDecimalPlaces(8);
  const computedCustomerCharge = customerInput
    .plus(customerCachedInput)
    .plus(customerOutput)
    .toDecimalPlaces(8);
  const chargedAmountUsd = Decimal.max(
    computedCustomerCharge,
    minimumCharge,
  ).toDecimalPlaces(8);

  return {
    upstreamCostUsd,
    chargedAmountUsd,
  };
}
