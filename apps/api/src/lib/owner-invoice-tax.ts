/**
 * 业主销项发票的税额口径。
 *
 * 建筑业增值税：一般计税 9%，简易计税 3%，小规模减按 1%。
 * 票面是含税金额，税额要反算：不含税 = 含税 / (1 + 税率)，税额 = 含税 − 不含税。
 *
 * 这里只算两个数：不含税金额和税额。它们决定两件事：
 *   1. 开票那个月要缴多少增值税（先开票则纳税义务在开票当天发生）
 *   2. 一张应收还能开多少票（已开票含税合计不得超过应收净额）
 */

const cents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);

export type InvoiceTaxBreakdown = {
  /** 票面含税金额 */
  grossAmount: number;
  /** 不含税金额 */
  netAmount: number;
  /** 销项税额 */
  taxAmount: number;
};

/**
 * 按含税票面金额与税率拆分。税额四舍五入到分，不含税金额取差额，
 * 保证 netAmount + taxAmount 严格等于票面金额，不因取整多出或少掉一分。
 */
export function computeInvoiceTax(grossAmount: number, taxRate: number): InvoiceTaxBreakdown {
  const grossCents = cents(grossAmount);
  const rate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  if (grossCents <= 0) return { grossAmount: 0, netAmount: 0, taxAmount: 0 };
  if (rate === 0) return { grossAmount: grossCents / 100, netAmount: grossCents / 100, taxAmount: 0 };
  const netCents = Math.round(grossCents / (1 + rate));
  return { grossAmount: grossCents / 100, netAmount: netCents / 100, taxAmount: (grossCents - netCents) / 100 };
}

/**
 * 一张应收还能开多少票（含税口径）。已开票额达到或超过应收净额时返回 0。
 * 净额可能因调整变成负数，此时不允许正向开票。
 */
export function invoiceableRemainingCents(receivableNetCents: number, invoicedCents: number): number {
  if (receivableNetCents <= 0) return 0;
  return Math.max(0, receivableNetCents - Math.max(0, invoicedCents));
}

/** 常用税率，按业务场景给出默认值；不属于这里的税率仍允许手工填写。 */
export const OWNER_INVOICE_RATES = [0.09, 0.03, 0.01, 0] as const;
