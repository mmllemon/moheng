/**
 * 合同约定付款期限 → 应收到期日。
 *
 * 进度款应收在审批通过时生成，此前没有到期日，资金计划就只能把它挂在
 * 「未设到期日」里，进不了任何月份。这里按主合同约定的天数推算：
 * 到期日 = 基准时间（审批时刻）+ 天数。
 *
 * 合同没约定天数时返回 null。系统不替业务编日期：编出来的日期会直接
 * 影响资金计划曲线，比留空更危险。
 */
export function dueAtFromPaymentTermDays(paymentTermDays: number | null | undefined, base: Date = new Date()): Date | null {
  if (paymentTermDays == null) return null;
  if (!Number.isFinite(paymentTermDays) || paymentTermDays < 0) return null;
  return new Date(base.getTime() + Math.trunc(paymentTermDays) * 24 * 60 * 60 * 1000);
}

/** 展示与审计用的 ISO 日期；无到期日时返回 null。 */
export function dueAtIso(paymentTermDays: number | null | undefined, base: Date = new Date()): string | null {
  return dueAtFromPaymentTermDays(paymentTermDays, base)?.toISOString() ?? null;
}
