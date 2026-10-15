const MAX_AMOUNT_CENTS = 999999999999999999n; // PostgreSQL DECIMAL(18,2)

export type ContractAdjustment = {
  direction: 'INCREASE' | 'DECREASE';
  amount: unknown;
};

export function moneyToCents(value: unknown): bigint {
  const raw = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new Error(`INVALID_MONEY_VALUE:${raw}`);
  const sign = match[1] === '-' ? -1n : 1n;
  const wholeText = match[2];
  if (wholeText === undefined) throw new Error('INVALID_MONEY_VALUE');
  const whole = BigInt(wholeText);
  const fraction = BigInt((match[3] ?? '').padEnd(2, '0'));
  return sign * (whole * 100n + fraction);
}

export function centsToMoney(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const value = cents < 0n ? -cents : cents;
  return `${sign}${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function signedAdjustmentCents(direction: 'INCREASE' | 'DECREASE', amount: unknown): bigint {
  const cents = moneyToCents(amount);
  return direction === 'DECREASE' ? -cents : cents;
}

export function calculateEffectiveContractAmount(originalAmount: unknown, adjustments: ContractAdjustment[]): string {
  let total = moneyToCents(originalAmount);
  for (const adjustment of adjustments) total += signedAdjustmentCents(adjustment.direction, adjustment.amount);
  if (total < 0n) throw new Error('CONTRACT_AMOUNT_WOULD_BE_NEGATIVE');
  if (total > MAX_AMOUNT_CENTS) throw new Error('CONTRACT_AMOUNT_EXCEEDS_MAX');
  return centsToMoney(total);
}
