import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMoney, isZeroMoney, moneySign, sumMoney, toCents } from './money.js';

test('浮点尾差不会被当成非零金额', () => {
  // 实测 0.3 - 0.1 - 0.2 === -2.7755575615628914e-17
  assert.equal(0.3 - 0.1 - 0.2 === 0, false);
  assert.equal(isZeroMoney(0.3 - 0.1 - 0.2), true);
  assert.equal(compareMoney(0.3 - 0.1 - 0.2, 0), 0);
  assert.equal(moneySign(0.3 - 0.1 - 0.2), 0);
});

test('逐项浮点累加与按分累加在两位小数上一致', () => {
  const rows = Array.from({ length: 5000 }, () => 0.01);
  const floatSum = rows.reduce((sum, value) => sum + value, 0);
  assert.notEqual(floatSum, 50);
  assert.equal(sumMoney(rows), 50);
  assert.equal(isZeroMoney(sumMoney([0.1, 0.2, -0.3])), true);
});

test('负数与零的符号判定按分进行', () => {
  assert.equal(moneySign(-0.0001), 0);
  assert.equal(moneySign(-0.01), -1);
  assert.equal(moneySign(0.01), 1);
  assert.equal(compareMoney(1234.56, 1234.56), 0);
  assert.equal(compareMoney(1234.56, 1234.57), -1);
});

test('非有限值按 0 处理，不产生 NaN 传播', () => {
  assert.equal(toCents(Number.NaN), 0);
  assert.equal(toCents(null), 0);
  assert.equal(toCents(undefined), 0);
  assert.equal(toCents(Number.POSITIVE_INFINITY), 0);
  assert.equal(sumMoney([1.5, Number.NaN, 2.5]), 4);
});
