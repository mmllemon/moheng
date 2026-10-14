import { calculateEffectiveContractAmount, centsToMoney, moneyToCents, type ContractAdjustment } from './contract-amount-math.js';

export type DownstreamCommitmentStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'SETTLED' | 'TERMINATED';

export function calculateDownstreamCurrentAmount(originalAmount: unknown, effectiveAmendments: ContractAdjustment[]): string {
  return calculateEffectiveContractAmount(originalAmount, effectiveAmendments);
}

/**
 * A transparent arithmetic gap only: contract amount minus cost entries already linked
 * to an ACTIVE or COMPLETED-but-not-settled contract. It is not a substitute for measured fulfillment,
 * accrued-not-invoiced cost, retention, tax reconciliation or an EAC forecast.
 */
export function calculateContractCostGap(input: {
  status: DownstreamCommitmentStatus;
  currentAmount: unknown;
  linkedActualCost: unknown;
}): { contractValueMinusLinkedActualCost: string; linkedActualCostOverContractValue: string } {
  if (input.status !== 'ACTIVE' && input.status !== 'COMPLETED') return { contractValueMinusLinkedActualCost: '0.00', linkedActualCostOverContractValue: '0.00' };
  const contractValue = moneyToCents(input.currentAmount);
  const cost = moneyToCents(input.linkedActualCost);
  return {
    contractValueMinusLinkedActualCost: centsToMoney(contractValue > cost ? contractValue - cost : 0n),
    linkedActualCostOverContractValue: centsToMoney(cost > contractValue ? cost - contractValue : 0n),
  };
}


/** A confirmed settlement is not proof that every payable item has been paid. */
export function canRegisterPaymentForContractStatus(status: DownstreamCommitmentStatus): boolean {
  return status === 'ACTIVE' || status === 'COMPLETED' || status === 'SETTLED';
}
