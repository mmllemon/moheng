/**
 * 金额比较与累加。
 *
 * 后端用 BigInt 分算账，但金额到前端是 JSON number。单个数值的两位小数在 JSON 里
 * 能精确往返，**比较**却不行：实测 `0.3 - 0.1 - 0.2 === -2.7755575615628914e-17`，
 * 直接拿 `=== 0` 判断“净额为 0”会漏判，页面就会出现 `-0.00万` 或把零差额标成负数。
 *
 * 这里统一先归一到整数分再比较；显示的舍入由 formatMoney 负责。
 * 上限与后端一致：2^53-1 分（90071992547409.91 元）。
 */

export const MAX_SAFE_MONEY_CENTS = Number.MAX_SAFE_INTEGER;

/** 元 → 整数分。非有限值按 0 处理（与后端 money() 的容错口径一致）。 */
export function toCents(value: number | null | undefined): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.round(numeric * 100);
}

/** 分 → 元。用于把整数分求和结果带回显示层。 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** 金额是否为 0：按分比较，避免浮点尾差把 0 读成非 0。 */
export function isZeroMoney(value: number | null | undefined): boolean {
  return toCents(value) === 0;
}

/** 三态比较：返回 -1 / 0 / 1，按分比较。 */
export function compareMoney(a: number | null | undefined, b: number | null | undefined): -1 | 0 | 1 {
  const left = toCents(a);
  const right = toCents(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** 按分累加，返回元。用于在前端做合计，避免逐项浮点相加。 */
export function sumMoney(values: Array<number | null | undefined>): number {
  const cents = values.reduce<number>((total, value) => total + toCents(value), 0);
  return fromCents(cents);
}

/** 金额符号：用于“+” / “−” / 空串的展示判定。 */
export function moneySign(value: number | null | undefined): -1 | 0 | 1 {
  return compareMoney(value, 0);
}
