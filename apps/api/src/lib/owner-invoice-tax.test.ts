import assert from 'node:assert/strict';
import test from 'node:test';
import { computeInvoiceTax, invoiceableRemainingCents, OWNER_INVOICE_RATES } from './owner-invoice-tax.js';

test('9% 一般计税：含税 300 万拆出税额 247,706.42', () => {
  const result = computeInvoiceTax(3_000_000, 0.09);
  assert.equal(result.netAmount, 2_752_293.58);
  assert.equal(result.taxAmount, 247_706.42);
  assert.equal(result.grossAmount, 3_000_000);
});

test('3% 简易计税与 1% 小规模征收率', () => {
  assert.equal(computeInvoiceTax(1_000_000, 0.03).taxAmount, 29_126.21);
  assert.equal(computeInvoiceTax(1_000_000, 0.01).taxAmount, 9_900.99);
});

test('零税率不产生税额，金额原样保留', () => {
  const result = computeInvoiceTax(880_000, 0);
  assert.equal(result.taxAmount, 0);
  assert.equal(result.netAmount, 880_000);
});

test('不含税金额加税额严格等于票面金额，不因取整丢分', () => {
  for (const [gross, rate] of [[1_234_567.89, 0.09], [99.99, 0.09], [0.03, 0.03], [7_654_321.01, 0.13]] as const) {
    const result = computeInvoiceTax(gross, rate);
    assert.equal(Math.round((result.netAmount + result.taxAmount) * 100), Math.round(gross * 100), `${gross} @ ${rate}`);
  }
});

test('非正金额与非法税率一律归零，不产生税额', () => {
  assert.deepEqual(computeInvoiceTax(0, 0.09), { grossAmount: 0, netAmount: 0, taxAmount: 0 });
  assert.deepEqual(computeInvoiceTax(-100, 0.09), { grossAmount: 0, netAmount: 0, taxAmount: 0 });
  assert.equal(computeInvoiceTax(100_000, Number.NaN).taxAmount, 0);
  assert.equal(computeInvoiceTax(100_000, -0.09).taxAmount, 0);
});

test('可开票余额：扣掉已开票，不足时归零', () => {
  assert.equal(invoiceableRemainingCents(5_300_000_00, 3_000_000_00), 2_300_000_00);
  assert.equal(invoiceableRemainingCents(5_300_000_00, 5_300_000_00), 0);
  assert.equal(invoiceableRemainingCents(5_300_000_00, 6_000_000_00), 0);
  assert.equal(invoiceableRemainingCents(0, 0), 0);
  assert.equal(invoiceableRemainingCents(-100, 0), 0);
});

test('默认税率列表覆盖一般计税、简易计税、小规模与零税率', () => {
  assert.deepEqual([...OWNER_INVOICE_RATES], [0.09, 0.03, 0.01, 0]);
});
