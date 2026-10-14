import { centsToMoney, moneyToCents } from './contract-amount-math.js';

export type SettlementKind = 'PROGRESS' | 'FINAL' | 'ADJUSTMENT';
export type RetentionEntry = { type: 'RETAIN' | 'RELEASE' | 'FORFEIT'; amount: unknown };
export type AdvanceCashEntry = { id: string; type: 'ADVANCE' | 'REFUND' | string; amount: unknown; refundOfPaymentId?: string | null };

function sum(values: unknown[]): bigint {
  return values.reduce<bigint>((total, value) => total + moneyToCents(value), 0n);
}

/** Progress settlement is an increment; final settlement is cumulative; adjustment is a signed delta. */
export function calculatePostedSettlementDelta(input: {
  type: SettlementKind;
  confirmedAmount: unknown;
  previousCumulativeAmount: unknown;
}): string {
  const confirmed = moneyToCents(input.confirmedAmount);
  const previous = moneyToCents(input.previousCumulativeAmount);
  if (input.type === 'PROGRESS' && confirmed <= 0n) throw new Error('PROGRESS_AMOUNT_MUST_BE_POSITIVE');
  if (input.type === 'FINAL' && confirmed <= 0n) throw new Error('FINAL_AMOUNT_MUST_BE_POSITIVE');
  if (input.type === 'ADJUSTMENT' && confirmed === 0n) throw new Error('ADJUSTMENT_AMOUNT_MUST_BE_NONZERO');
  const delta = input.type === 'FINAL' ? confirmed - previous : confirmed;
  if (previous + delta < 0n) throw new Error('SETTLEMENT_TOTAL_BELOW_ZERO');
  return centsToMoney(delta);
}

export function calculateNetPayable(input: {
  postedDeltaAmount: unknown;
  advanceRecoveryAmount?: unknown;
  retentionAmount?: unknown;
  otherDeductionAmount?: unknown;
  availableAdvanceAmount?: unknown;
}): string {
  const delta = moneyToCents(input.postedDeltaAmount);
  const advanceRecovery = moneyToCents(input.advanceRecoveryAmount ?? 0);
  const retention = moneyToCents(input.retentionAmount ?? 0);
  const otherDeduction = moneyToCents(input.otherDeductionAmount ?? 0);
  const deductions = advanceRecovery + retention + otherDeduction;
  if (advanceRecovery < 0n || retention < 0n || otherDeduction < 0n) throw new Error('DEDUCTION_MUST_BE_NONNEGATIVE');
  if (delta <= 0n && deductions > 0n) throw new Error('NEGATIVE_SETTLEMENT_CANNOT_HAVE_DEDUCTIONS');
  if (delta > 0n && deductions > delta) throw new Error('SETTLEMENT_DEDUCTIONS_EXCEED_AMOUNT');
  if (advanceRecovery > moneyToCents(input.availableAdvanceAmount ?? 0)) throw new Error('ADVANCE_RECOVERY_EXCEEDS_BALANCE');
  return centsToMoney(delta - deductions);
}

/** Current prepayment asset: advance cash paid, minus refunds to those advance payments, minus posted recoveries. */
export function calculateAdvanceBalance(input: { payments: AdvanceCashEntry[]; recoveredAmount?: unknown }): string {
  const advanceIds = new Set(input.payments.filter((payment) => payment.type === 'ADVANCE').map((payment) => payment.id));
  const advancePaid = sum(input.payments.filter((payment) => payment.type === 'ADVANCE').map((payment) => payment.amount));
  const advanceRefunds = sum(input.payments.filter((payment) => payment.type === 'REFUND' && payment.refundOfPaymentId && advanceIds.has(payment.refundOfPaymentId)).map((payment) => payment.amount));
  const balance = advancePaid - advanceRefunds - moneyToCents(input.recoveredAmount ?? 0);
  return centsToMoney(balance > 0n ? balance : 0n);
}

/** Retained security amount, less releases and approved forfeitures. */
export function calculateRetentionBalance(movements: RetentionEntry[]): string {
  const balance = movements.reduce<bigint>((total, movement) => total + (movement.type === 'RETAIN' ? moneyToCents(movement.amount) : -moneyToCents(movement.amount)), 0n);
  return centsToMoney(balance > 0n ? balance : 0n);
}

/** Payable open balance is signed, so negative adjustment credits remain visible. */
export function calculatePayableOpenAmount(netAmount: unknown, allocations: unknown[]): string {
  return centsToMoney(moneyToCents(netAmount) - sum(allocations));
}

export function assertOptionalLineTotal(input: { submittedAmount: unknown; lineAmounts: unknown[] }): void {
  if (input.lineAmounts.length === 0) return;
  if (sum(input.lineAmounts) !== moneyToCents(input.submittedAmount)) throw new Error('SETTLEMENT_LINES_TOTAL_MISMATCH');
}

/** Optional payment schedules, when supplied, must exactly partition a positive payable. */
export function assertPayableScheduleTotal(input: { payableAmount: unknown; scheduleAmounts: unknown[] }): void {
  const payable = moneyToCents(input.payableAmount);
  if (payable <= 0n) throw new Error('PAYABLE_SCHEDULE_REQUIRES_POSITIVE_PAYABLE');
  if (input.scheduleAmounts.length === 0) throw new Error('PAYABLE_SCHEDULE_REQUIRED');
  const amounts = input.scheduleAmounts.map((value) => moneyToCents(value));
  if (amounts.some((value) => value <= 0n)) throw new Error('PAYABLE_SCHEDULE_AMOUNT_MUST_BE_POSITIVE');
  if (sum(input.scheduleAmounts) !== payable) throw new Error('PAYABLE_SCHEDULE_TOTAL_MISMATCH');
}

/** A schedule's remaining balance uses signed allocations to correctly reverse refunds. */
export function calculatePayableScheduleOpenAmount(amount: unknown, allocations: unknown[]): string {
  return centsToMoney(moneyToCents(amount) - sum(allocations));
}
