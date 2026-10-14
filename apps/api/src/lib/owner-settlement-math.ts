export type OwnerSettlementKind = 'FINAL' | 'ADJUSTMENT';
export type OwnerReceivableState = 'OPEN' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'VOID';

/** Final settlement carries the final cumulative amount; an adjustment carries a signed delta. */
export function calculateOwnerSettlementDelta(type: OwnerSettlementKind, confirmedCents: bigint, previousCumulativeCents: bigint): bigint {
  return type === 'FINAL' ? confirmedCents - previousCumulativeCents : confirmedCents;
}

/** A contract's effective open position is signed: positive means owner still owes us; negative means credit/return due. */
export function calculateContractNetOpenCents(entries: Array<{ netCents: bigint; allocationCents: bigint }>): bigint {
  return entries.reduce((sum, entry) => sum + entry.netCents - entry.allocationCents, 0n);
}

export function calculateReceivableOpenCents(netCents: bigint, allocatedCents: bigint): bigint {
  return netCents - allocatedCents;
}

export function capReceiptCents(requestedCents: bigint, receivableOpenCents: bigint, contractNetOpenCents: bigint): bigint {
  if (requestedCents <= 0n || receivableOpenCents <= 0n || contractNetOpenCents <= 0n) return 0n;
  return [requestedCents, receivableOpenCents, contractNetOpenCents].reduce((min, value) => value < min ? value : min);
}

export function calculateOwnerReceivableStatus(netCents: bigint, allocatedCents: bigint): OwnerReceivableState {
  const open = calculateReceivableOpenCents(netCents, allocatedCents);
  if (netCents >= 0n && open <= 0n) return 'RECEIVED';
  if (allocatedCents > 0n) return 'PARTIALLY_RECEIVED';
  return 'OPEN';
}
