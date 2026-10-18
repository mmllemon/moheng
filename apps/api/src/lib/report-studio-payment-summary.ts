import { centsToMoney, moneyToCents } from './contract-amount-math.js';

export interface DownstreamPaymentAmount {
  type: string;
  amount: unknown;
}
export interface DownstreamPaymentTotals {
  downstreamPaymentTotal: string | null;
  downstreamRefundTotal: string | null;
  downstreamNetPaymentTotal: string | null;
}

/**
 * Summarizes actual downstream cash movements without conflating them with posted
 * payables or cost entries. A REFUND is a positive source amount that offsets cash
 * paid; it is not a negative row and must be subtracted once here.
 */
export function summarizeDownstreamPaymentTotals(
  payments: readonly DownstreamPaymentAmount[],
  truncated = false,
): DownstreamPaymentTotals {
  if (truncated) {
    return {
      downstreamPaymentTotal: null,
      downstreamRefundTotal: null,
      downstreamNetPaymentTotal: null,
    };
  }
  let paidCents = 0n;
  let refundCents = 0n;
  for (const payment of payments) {
    const amountCents = moneyToCents(payment.amount);
    if (payment.type === 'REFUND') refundCents += amountCents;
    else paidCents += amountCents;
  }
  return {
    downstreamPaymentTotal: centsToMoney(paidCents),
    downstreamRefundTotal: centsToMoney(refundCents),
    downstreamNetPaymentTotal: centsToMoney(paidCents - refundCents),
  };
}
