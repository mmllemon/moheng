import { z } from 'zod';

/** Currency inputs are stored at DECIMAL(18,2); reject extra fractional digits instead of silently rounding them in PostgreSQL. */
const hasAtMostTwoDecimals = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value - Math.round(value * 100) / 100) < 1e-8;

export const nonNegativeMoney = z.number().refine(
  (value) => value >= 0 && hasAtMostTwoDecimals(value),
  '金额必须为非负数，且最多保留两位小数',
);

export const positiveMoney = nonNegativeMoney.refine(
  (value) => value > 0,
  '金额必须大于 0',
);

export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const toCents = (value: number): number => Math.round((value + Number.EPSILON) * 100);

export const fromCents = (value: number): number => value / 100;
