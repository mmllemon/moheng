import assert from 'node:assert/strict';
import test from 'node:test';
import { dueAtFromPaymentTermDays, dueAtIso } from './payment-term.js';

const base = new Date('2026-11-02T03:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

test('未约定付款期限时不推算日期', () => {
  assert.equal(dueAtFromPaymentTermDays(null, base), null);
  assert.equal(dueAtFromPaymentTermDays(undefined, base), null);
});

test('约定 30 天：到期日为审批时刻加 30 天', () => {
  assert.equal(dueAtFromPaymentTermDays(30, base)?.toISOString(), new Date(base.getTime() + 30 * DAY).toISOString());
});

test('约定 0 天：到期日就是审批时刻本身，不落空', () => {
  assert.equal(dueAtFromPaymentTermDays(0, base)?.toISOString(), base.toISOString());
});

test('负数与非有限值一律视为未约定，不产生回溯日期', () => {
  assert.equal(dueAtFromPaymentTermDays(-1, base), null);
  assert.equal(dueAtFromPaymentTermDays(Number.NaN, base), null);
  assert.equal(dueAtFromPaymentTermDays(Number.POSITIVE_INFINITY, base), null);
});

test('小数天数按整日截断，不出现半天到期', () => {
  assert.equal(dueAtFromPaymentTermDays(2.9, base)?.toISOString(), new Date(base.getTime() + 2 * DAY).toISOString());
});

test('跨年跨月的长账期按绝对天数推进', () => {
  assert.equal(dueAtFromPaymentTermDays(90, base)?.toISOString(), '2027-01-31T03:00:00.000Z');
});

test('ISO 输出与日期对象一致，无到期日时给 null', () => {
  assert.equal(dueAtIso(30, base), dueAtFromPaymentTermDays(30, base)?.toISOString());
  assert.equal(dueAtIso(null, base), null);
});
