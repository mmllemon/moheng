import { centsToMoney, moneyToCents } from '../../lib/contract-amount-math.js';
import { positiveMoney } from '../../lib/validation.js';
import { z } from 'zod';
import { DownstreamSettlementType, ProjectRole } from '../../generated/prisma/client.js';

export const writeRoles = [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR];
export const money = (value: unknown) => Number(value ?? 0);
export const hasAtMostTwoDecimals = (value: number) => Number.isFinite(value) && Math.abs(value - Math.round(value * 100) / 100) < 1e-8;
export const nonNegativeMoneyInput = z.coerce.number().refine((value) => value >= 0 && hasAtMostTwoDecimals(value), '金额必须为非负数且最多保留两位小数');
export const signedMoneyInput = z.coerce.number().refine((value) => value !== 0 && hasAtMostTwoDecimals(value), '金额必须非零且最多保留两位小数');
export const sumCents = (values: unknown[]) => values.reduce<bigint>((sum, value) => sum + moneyToCents(value), 0n);
export const amountFromCents = (value: bigint) => Number(centsToMoney(value));
export const hasAtMostDecimals = (value: number, places: number) => Number.isFinite(value) && Math.abs(value - Math.round(value * (10 ** places)) / (10 ** places)) < 1e-8;
export const settlementLineInput = z.object({
  description: z.string().trim().min(1).max(240),
  quantity: z.coerce.number().positive().refine((value) => hasAtMostDecimals(value, 3), '数量最多保留三位小数').optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  unitPrice: z.coerce.number().nonnegative().refine((value) => hasAtMostDecimals(value, 4), '单价最多保留四位小数').optional().nullable(),
  amount: positiveMoney,
});
export const settlementInput = z.object({
  settlementNo: z.string().trim().max(80).optional().or(z.literal('')),
  type: z.nativeEnum(DownstreamSettlementType),
  submittedAmount: positiveMoney,
  advanceRecoveryAmount: nonNegativeMoneyInput.default(0),
  retentionAmount: nonNegativeMoneyInput.default(0),
  otherDeductionAmount: nonNegativeMoneyInput.default(0),
  dueAt: z.iso.datetime().optional().nullable(),
  notes: z.string().max(3000).optional().nullable(),
  lines: z.array(settlementLineInput).max(300).optional().default([]),
});
export const rejectInput = z.object({ reason: z.string().trim().min(3).max(2000) });
export const confirmInput = z.object({
  confirmedAmount: signedMoneyInput,
  confirmationReference: z.string().trim().min(1).max(240),
  confirmationDate: z.iso.datetime(),
  notes: z.string().max(3000).optional().nullable(),
});
export const invoiceInput = z.object({
  invoiceNo: z.string().trim().min(1).max(120),
  invoiceDate: z.iso.datetime(),
  amount: positiveMoney,
  taxAmount: nonNegativeMoneyInput.default(0),
  taxIncluded: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.taxAmount > value.amount) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taxAmount'], message: '税额不能大于发票价税合计金额' });
});
export const invoiceVerifyInput = z.object({ status: z.enum(['VERIFIED', 'REJECTED']), verificationNote: z.string().trim().max(2000).optional().nullable() });
export const allocationInput = z.object({ payableId: z.string().min(1), amount: positiveMoney, notes: z.string().max(1000).optional().nullable() });
export const retentionInput = z.object({ amount: positiveMoney, effectiveAt: z.iso.datetime(), reference: z.string().trim().min(1).max(160), notes: z.string().max(2000).optional().nullable() });
export const payableScheduleInput = z.object({ schedules: z.array(z.object({ scheduleNo: z.string().trim().min(1).max(30), dueAt: z.iso.datetime(), amount: positiveMoney, notes: z.string().max(1000).optional().nullable() })).min(1).max(50) }).superRefine((value, ctx) => { if (new Set(value.schedules.map((item) => item.scheduleNo)).size !== value.schedules.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schedules'], message: '应付分期编号不能重复' }); });

