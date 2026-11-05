import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEffectiveContractAmount, moneyToCents, signedAdjustmentCents } from './contract-amount-math.js';

test('effective amount adds increases and subtracts decreases using exact cents', () => {
  assert.equal(calculateEffectiveContractAmount('1000.00', [
    { direction: 'INCREASE', amount: '20.75' },
    { direction: 'DECREASE', amount: '4.50' },
  ]), '1016.25');
});

test('no effective external adjustments leaves the original amount unchanged', () => {
  assert.equal(calculateEffectiveContractAmount('12580000.00', []), '12580000.00');
});

test('大额小数不经过浮点运算', () => {
  // 2026-11-04：金额上限改为 2^53-1 分（JSON number 能精确承载的范围），
  // 所以“大额”用例从上界附近取样，而不是从 DECIMAL(18,2) 的上界取样。
  assert.equal(calculateEffectiveContractAmount('90071992547409.00', [
    { direction: 'INCREASE', amount: '0.89' },
  ]), '90071992547409.89');
  assert.equal(moneyToCents('9999999999999998.99'), 999999999999999899n);
});

test('a decrease that would make the effective amount negative is rejected', () => {
  assert.throws(
    () => calculateEffectiveContractAmount('100.00', [{ direction: 'DECREASE', amount: '100.01' }]),
    { message: 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE' },
  );
});

test('invalid sub-cent values are rejected instead of rounded silently', () => {
  assert.throws(() => moneyToCents('1.005'), /INVALID_MONEY_VALUE/);
  assert.equal(signedAdjustmentCents('DECREASE', '0.01'), -1n);
});

test('有效合同额不能超过可精确传输的上限', () => {
  assert.throws(
    () => calculateEffectiveContractAmount('90071992547409.91', [{ direction: 'INCREASE', amount: '0.01' }]),
    { message: 'CONTRACT_AMOUNT_EXCEEDS_MAX' },
  );
  // 超出上限的入参在解析阶段就被拒，而不是等到相加溢出
  assert.throws(
    () => calculateEffectiveContractAmount('9999999999999999.99', []),
    /MONEY_VALUE_EXCEEDS_TRANSPORT_SAFE_RANGE/,
  );
});
