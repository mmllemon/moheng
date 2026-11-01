import assert from 'node:assert/strict';
import test from 'node:test';
import { TAX_TOLERANCE, rateFromGross, resolveCostTax, taxFromGross } from './cost-tax.js';

test('含税口径：税额 = 含税 − 含税/(1+税率)', () => {
  assert.equal(taxFromGross(1130, 13), 130);
  assert.equal(taxFromGross(1090, 9), 90);
  assert.equal(taxFromGross(1030, 3), 30);
  assert.equal(taxFromGross(1000, 0), 0);
  assert.equal(taxFromGross(1234.56, 13), 142.03);
});

test('只填税率：自动反算税额并保留两位', () => {
  const result = resolveCostTax({ amount: 1130, taxRate: 13 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, { taxAmount: 130, taxRate: 13 });
});

test('只填税额：保留原值，不反推税率硬写', () => {
  const result = resolveCostTax({ amount: 1130, taxAmount: 128.5 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, { taxAmount: 128.5, taxRate: null });
});

test('两者都填且一致：通过，税额归一到推导值', () => {
  const result = resolveCostTax({ amount: 1130, taxRate: 13, taxAmount: 130 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, { taxAmount: 130, taxRate: 13 });
});

test('两者都填但不一致：报错并给出应有值', () => {
  const result = resolveCostTax({ amount: 1130, taxRate: 13, taxAmount: 100 });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : '', /按 13% 应为 130\.00 元，填写的是 100\.00 元/);
});

test('分位舍入内的偏差被容忍', () => {
  const result = resolveCostTax({ amount: 1000, taxRate: 13, taxAmount: taxFromGross(1000, 13) + TAX_TOLERANCE - 0.001 });
  assert.equal(result.ok, true);
});

test('税率越界与超过两位小数被拒', () => {
  assert.equal(resolveCostTax({ amount: 100, taxRate: 101 }).ok, false);
  assert.equal(resolveCostTax({ amount: 100, taxRate: -1 }).ok, false);
  assert.equal(resolveCostTax({ amount: 100, taxRate: 13.456 }).ok, false);
});

test('税额不能为负，也不能超过含税金额', () => {
  assert.equal(resolveCostTax({ amount: 100, taxAmount: -1 }).ok, false);
  const over = resolveCostTax({ amount: 100, taxAmount: 120 });
  assert.equal(over.ok, false);
  assert.match(over.ok === false ? over.message : '', /不能大于含税金额/);
});

test('两者都不填：保持未税处理，不影响金额', () => {
  const result = resolveCostTax({ amount: 500 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, { taxAmount: null, taxRate: null });
});

test('反推税率只用于展示，按不含税基数计算', () => {
  assert.equal(rateFromGross(1130, 130), 13);
  assert.equal(rateFromGross(100, 100), null);
});
