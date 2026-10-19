import { centsToMoney, moneyToCents } from './contract-amount-math.js';

export type AssistantCostVarianceDirection = 'OVER_TARGET' | 'UNDER_TARGET' | 'ON_TARGET' | 'INDETERMINATE';

export interface AssistantCostVarianceSummary {
  targetCostByLeafBudgetItems: string | null;
  actualCostRecorded: string;
  varianceActualMinusTarget: string | null;
  variancePercent: number | null;
  direction: AssistantCostVarianceDirection;
}

/**
 * A truncated target-cost scan must not be treated as a complete target.
 * Actual cost remains exact (from PostgreSQL aggregate), while comparison metrics
 * become unavailable until the entire target ledger can be scanned.
 */
export function calculateAssistantCostVarianceSummary(input: {
  targetAmount: string | null;
  actualAmount: unknown;
  targetTruncated: boolean;
}): AssistantCostVarianceSummary {
  const actualCents = moneyToCents(input.actualAmount ?? 0);
  const targetCents = input.targetTruncated || input.targetAmount === null
    ? null
    : moneyToCents(input.targetAmount);
  const varianceCents = targetCents === null ? null : actualCents - targetCents;
  const scaledPercent = targetCents === null || targetCents <= 0n || varianceCents === null
    ? null
    : (varianceCents >= 0n
      ? (varianceCents * 10000n + targetCents / 2n) / targetCents
      : (varianceCents * 10000n - targetCents / 2n) / targetCents);
  return {
    targetCostByLeafBudgetItems: targetCents === null ? null : centsToMoney(targetCents),
    actualCostRecorded: centsToMoney(actualCents),
    varianceActualMinusTarget: varianceCents === null ? null : centsToMoney(varianceCents),
    variancePercent: scaledPercent === null ? null : Number((Number(scaledPercent) / 100).toFixed(2)),
    direction: varianceCents === null
      ? 'INDETERMINATE'
      : varianceCents > 0n
        ? 'OVER_TARGET'
        : varianceCents < 0n
          ? 'UNDER_TARGET'
          : 'ON_TARGET',
  };
}
