/**
 * 金额上限有两档，取决于这条路径上金额以什么形式承载。
 *
 * - `MAX_AMOUNT_CENTS`：PostgreSQL DECIMAL(18,2) 的分数上限，也是**字符串路径**（报表、
 *   XLSX、助手工具）用的上限。这条链路上金额是十进制字符串，不经 JS 浮点，所以能保留
 *   到库里能存的极限。
 * - `MAX_TRANSPORT_SAFE_CENTS`：接口与前端按 JSON number 传输，实际天花板是 2^53-1 分。
 *
 * 2026-11-04 实测：接口把 DECIMAL 上限 9999999999999999.99 元交给前端时，`Number(centsToMoney(...))`
 * 得到 10000000000000000，静默丢 1 分；`9007199254740993.01` 这类入参也能通过两位小数校验
 * 并落库成 9007199254740994.00 元。所以写入校验必须用 2^53-1 这一档，而报表这类字符串
 * 路径不能跟着收紧（`report-studio-data` 的集成回归就是拿 90071992547410.00 断言精度的）。
 */
export const MAX_AMOUNT_CENTS = 999999999999999999n; // DECIMAL(18,2)
export const MAX_TRANSPORT_SAFE_CENTS = 9007199254740991n; // Number.MAX_SAFE_INTEGER

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

/** 解析并校验：金额必须能被 JSON number 精确承载。接口写入路径统一走这个入口。 */
export function transportSafeCents(value: unknown): bigint {
  const cents = moneyToCents(value);
  if (cents > MAX_TRANSPORT_SAFE_CENTS || cents < -MAX_TRANSPORT_SAFE_CENTS) {
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
  const cents = moneyToCents(amount);
  return direction === 'DECREASE' ? -cents : cents;
}

/** 有效合同额：结果是十进制字符串，按 DECIMAL(18,2) 的界限校验（不是 JSON number 的界限）。 */
export function calculateEffectiveContractAmount(originalAmount: unknown, adjustments: ContractAdjustment[]): string {
  let total = moneyToCents(originalAmount);
  for (const adjustment of adjustments) total += signedAdjustmentCents(adjustment.direction, adjustment.amount);
  if (total < 0n) throw new Error('CONTRACT_AMOUNT_WOULD_BE_NEGATIVE');
  if (total > MAX_AMOUNT_CENTS) throw new Error('CONTRACT_AMOUNT_EXCEEDS_MAX');
  return centsToMoney(total);
}
