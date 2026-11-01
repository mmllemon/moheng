/**
 * 成本税额口径：库里所有成本金额都是**含税金额**（amount = 价税合计）。
 *
 * 因此税率与税额的关系是：税额 = 含税 − 含税 ÷ (1 + 税率)。
 * 反过来拿税额除以含税金额得到的不是税率，这种口径差异最容易在审核时被算错，
 * 所以这里把推导和校验都收在一处，录入、更新、导入三条路径共用。
 */

export const TAX_RATE_MAX = 100;
/** 允许的偏差：1 分。金额按分位存储，四舍五入后不应超过半分，留 1 分余量。 */
export const TAX_TOLERANCE = 0.011;

export type CostTaxInput = { amount: number; taxAmount?: number | null; taxRate?: number | null };
export type CostTaxResolution = { taxAmount: number | null; taxRate: number | null };
export type CostTaxResult = { ok: true; value: CostTaxResolution } | { ok: false; message: string };

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 由含税金额与税率反算税额，保留 2 位。 */
export function taxFromGross(amount: number, ratePercent: number): number {
  if (ratePercent === 0) return 0;
  return round2(amount - amount / (1 + ratePercent / 100));
}

/** 由含税金额与税额反推税率（仅用于提示与展示，不作为写入依据）。 */
export function rateFromGross(amount: number, taxAmount: number): number | null {
  const net = amount - taxAmount;
  if (net <= 0) return null;
  return round2((taxAmount / net) * 100);
}

export function resolveCostTax(input: CostTaxInput): CostTaxResult {
  const { amount } = input;
  const taxAmount = input.taxAmount ?? null;
  const taxRate = input.taxRate ?? null;

  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: '含税金额必须大于 0' };

  if (taxRate == null && taxAmount == null) return { ok: true, value: { taxAmount: null, taxRate: null } };

  if (taxAmount != null) {
    if (!Number.isFinite(taxAmount)) return { ok: false, message: '税额不是有效数字' };
    if (taxAmount < 0) return { ok: false, message: '税额不能为负数' };
    if (taxAmount > amount) return { ok: false, message: `税额不能大于含税金额（含税 ${amount.toFixed(2)} 元）` };
  }

  if (taxRate == null) return { ok: true, value: { taxAmount, taxRate: null } };

  if (!Number.isFinite(taxRate)) return { ok: false, message: '税率不是有效数字' };
  if (taxRate < 0 || taxRate > TAX_RATE_MAX) return { ok: false, message: `税率需在 0 到 ${TAX_RATE_MAX} 之间` };
  if (Math.round(taxRate * 100) !== taxRate * 100) return { ok: false, message: '税率最多保留两位小数' };

  const expected = taxFromGross(amount, taxRate);
  if (taxAmount == null) return { ok: true, value: { taxAmount: expected, taxRate } };

  if (Math.abs(taxAmount - expected) > TAX_TOLERANCE) {
    return {
      ok: false,
      message: `税额与税率对不上：含税 ${amount.toFixed(2)} 元按 ${taxRate}% 应为 ${expected.toFixed(2)} 元，填写的是 ${taxAmount.toFixed(2)} 元`,
    };
  }
  return { ok: true, value: { taxAmount: expected, taxRate } };
}
