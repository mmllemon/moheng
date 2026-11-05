/**
 * 金额上限：JSON 里金额以 number 传输，所以真正的天花板是 2^53 - 1 分
 * （90071992547409.91 元），不是 PostgreSQL DECIMAL(18,2) 的 10^18 - 1 分。
 *
 * 2026-11-04 实测：DECIMAL 上限 9999999999999999.99 元经 `Number(centsToMoney(...))`
 * 变成 10000000000000000，静默丢 1 分；`9007199254740993.01` 这类输入还能通过
 * 两位小数校验并落库成 9007199254740994.00 元。也就是说存储层允许的值大于传输层
 * 能精确承载的值，中间那段会无声丢分。上限收到 2^53 - 1 分后，任何被接受的金额
 * 都能在 BigInt 分、DECIMAL 与 JSON number 之间逐分往返。
 */
export const MAX_AMOUNT_CENTS = 9007199254740991n; // Number.MAX_SAFE_INTEGER

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

/** 解析并校验：金额必须在可精确往返 JSON 的范围内。写入路径统一走这个入口。 */
export function transportSafeCents(value: unknown): bigint {
  const cents = moneyToCents(value);
  if (cents > MAX_AMOUNT_CENTS || cents < -MAX_AMOUNT_CENTS) {
    throw new Error(`MONEY_VALUE_EXCEEDS_TRANSPORT_SAFE_RANGE:${String(value)}`);
  }
  return cents;
}

export function centsToMoney(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const value = cents < 0n ? -cents : cents;
  return `${sign}${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function signedAdjustmentCents(direction: 'INCREASE' | 'DECREASE', amount: unknown): bigint {
  const cents = transportSafeCents(amount);
  return direction === 'DECREASE' ? -cents : cents;
}

export function calculateEffectiveContractAmount(originalAmount: unknown, adjustments: ContractAdjustment[]): string {
  let total = transportSafeCents(originalAmount);
  for (const adjustment of adjustments) total += signedAdjustmentCents(adjustment.direction, adjustment.amount);
  if (total < 0n) throw new Error('CONTRACT_AMOUNT_WOULD_BE_NEGATIVE');
  if (total > MAX_AMOUNT_CENTS) throw new Error('CONTRACT_AMOUNT_EXCEEDS_MAX');
  return centsToMoney(total);
}
