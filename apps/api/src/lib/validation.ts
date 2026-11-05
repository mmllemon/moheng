import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from './contract-amount-math.js';

/** Currency inputs are stored at DECIMAL(18,2); reject extra fractional digits instead of silently rounding them in PostgreSQL. */
const hasAtMostTwoDecimals = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value - Math.round(value * 100) / 100) < 1e-8;

/**
 * 2026-11-04：金额还要能被 JSON number 精确承载。
 *
 * 存储是 DECIMAL(18,2)（上限 9999999999999999.99 元），但接口与前端都按 number 走，
 * 实际天花板是 2^53-1 分（90071992547409.91 元）。两者之间那段值落库再取出来会丢分：
 * 实测 `9007199254740993.01` 能通过两位小数校验，写入后变成 9007199254740994.00 元。
 * 所以校验在这里就把超出安全范围的值拒掉，而不是让它静默取整。
 */
const withinTransportSafeRange = (value: number): boolean =>
  Math.abs(Math.round(value * 100)) <= Number(MAX_AMOUNT_CENTS);

export const nonNegativeMoney = z.number().refine(
  (value) => value >= 0 && hasAtMostTwoDecimals(value) && withinTransportSafeRange(value),
  '金额必须为非负数、最多两位小数，且不超过 90071992547409.91',
);

export const positiveMoney = nonNegativeMoney.refine(
  (value) => value > 0,
  '金额必须大于 0',
);

export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const toCents = (value: number): number => Math.round((value + Number.EPSILON) * 100);

export const fromCents = (value: number): number => value / 100;
