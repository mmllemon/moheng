import { moneyToCents } from './contract-amount-math.js';

export type OriginalAmountUpdateDecision = 'UNCHANGED' | 'INITIAL_BASE_UPDATE' | 'IMMUTABLE';

/**
 * The original main-contract amount may be corrected while a project is still
 * in initial setup, but it must not be rewritten after a formal main contract
 * or any external-confirmation record exists. Contract adjustments belong in
 * the change ledger, never in the original baseline.
 */
export function classifyOriginalAmountUpdate(input: {
  currentAmount: unknown;
  requestedAmount: unknown;
  hasMainContract: boolean;
  hasExternalConfirmation: boolean;
}): OriginalAmountUpdateDecision {
  if (moneyToCents(input.currentAmount) === moneyToCents(input.requestedAmount)) return 'UNCHANGED';
  if (input.hasMainContract || input.hasExternalConfirmation) return 'IMMUTABLE';
  return 'INITIAL_BASE_UPDATE';
}

/** External confirmed amounts remain authoritative; this helper only flags a discrepancy for separate internal review. */
export function hasInternalExternalAmountMismatch(internalReferenceAmount: unknown, externalConfirmedAmount: unknown): boolean {
  return moneyToCents(internalReferenceAmount) !== moneyToCents(externalConfirmedAmount);
}
