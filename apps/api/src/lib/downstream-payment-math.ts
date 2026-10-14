import { centsToMoney, moneyToCents } from './contract-amount-math.js';

export type DownstreamPaymentType = 'ADVANCE' | 'PROGRESS' | 'SETTLEMENT' | 'RETENTION' | 'REFUND' | 'OTHER';
export type PaymentEntry = { id?: string; type: DownstreamPaymentType; amount: unknown; paymentPlanId?: string | null; refundOfPaymentId?: string | null };

function sum(values: unknown[]): bigint {
  return values.reduce<bigint>((total, value) => total + moneyToCents(value), 0n);
}

export function netPaymentCents(payments: PaymentEntry[]): bigint {
  return payments.reduce<bigint>((total, payment) => total + (payment.type === 'REFUND' ? -moneyToCents(payment.amount) : moneyToCents(payment.amount)), 0n);
}

export function grossPaymentCents(payments: PaymentEntry[]): bigint {
  return sum(payments.filter((payment) => payment.type !== 'REFUND').map((payment) => payment.amount));
}

export function refundPaymentCents(payments: PaymentEntry[]): bigint {
  return sum(payments.filter((payment) => payment.type === 'REFUND').map((payment) => payment.amount));
}

export function paymentTotals(payments: PaymentEntry[]) {
  return {
    grossPaidAmount: centsToMoney(grossPaymentCents(payments)),
    refundedAmount: centsToMoney(refundPaymentCents(payments)),
    netPaidAmount: centsToMoney(netPaymentCents(payments)),
  };
}

export type PaymentPlanBalance = { plannedAmount: unknown; payments: PaymentEntry[] };

/** Require each refund to point to a genuine outgoing payment and prevent cumulative over-refunding it. */
export function assertRefundTargetsPayment(input: {
  existingPayments: PaymentEntry[];
  refundOfPaymentId: string | null | undefined;
  requestedAmount: unknown;
  requestedPlanId?: string | null;
}): PaymentEntry {
  if (!input.refundOfPaymentId) throw new Error('REFUND_ORIGINAL_PAYMENT_REQUIRED');
  const original = input.existingPayments.find((payment) => payment.id === input.refundOfPaymentId);
  if (!original || original.type === 'REFUND') throw new Error('REFUND_ORIGINAL_PAYMENT_INVALID');
  const requestedPlanId = input.requestedPlanId ?? null;
  const originalPlanId = original.paymentPlanId ?? null;
  if (requestedPlanId && requestedPlanId !== originalPlanId) throw new Error('REFUND_PAYMENT_PLAN_MISMATCH');
  const alreadyRefunded = input.existingPayments.reduce<bigint>((total, payment) => (
    payment.type === 'REFUND' && payment.refundOfPaymentId === original.id ? total + moneyToCents(payment.amount) : total
  ), 0n);
  if (alreadyRefunded + moneyToCents(input.requestedAmount) > moneyToCents(original.amount)) throw new Error('REFUND_EXCEEDS_ORIGINAL_PAYMENT');
  return original;
}

/** Validate a new cash-flow entry using cumulative net paid amounts, never gross outflow. */
export function assertPaymentWithinBounds(input: {
  existingPayments: PaymentEntry[];
  requestedType: DownstreamPaymentType;
  requestedAmount: unknown;
  currentContractAmount: unknown;
  /** A posted payable is the controlling limit; contract current amount is not a second ceiling. */
  paymentIsAllocatedToPayable?: boolean;
  plan?: PaymentPlanBalance | null;
}): void {
  const requested = moneyToCents(input.requestedAmount);
  const currentNetPaid = netPaymentCents(input.existingPayments);
  if (input.requestedType === 'REFUND') {
    if (requested > currentNetPaid) throw new Error('REFUND_EXCEEDS_NET_PAID');
  } else if (!input.paymentIsAllocatedToPayable && currentNetPaid + requested > moneyToCents(input.currentContractAmount)) {
    throw new Error('PAYMENT_EXCEEDS_CONTRACT');
  }

  if (input.plan) {
    const planNetPaid = netPaymentCents(input.plan.payments);
    if (input.requestedType === 'REFUND') {
      if (requested > planNetPaid) throw new Error('REFUND_EXCEEDS_PLAN_PAID');
    } else if (planNetPaid + requested > moneyToCents(input.plan.plannedAmount)) {
      throw new Error('PAYMENT_EXCEEDS_PLAN');
    }
  }
}
