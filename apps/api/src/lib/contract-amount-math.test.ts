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

test('large decimal values do not pass through floating-point arithmetic', () => {
  assert.equal(calculateEffectiveContractAmount('9999999999999998.99', [
    { direction: 'INCREASE', amount: '0.01' },
  ]), '9999999999999999.00');
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

test('the effective amount cannot exceed the DECIMAL(18,2) storage limit', () => {
  assert.throws(
    () => calculateEffectiveContractAmount('9999999999999999.99', [{ direction: 'INCREASE', amount: '0.01' }]),
    { message: 'CONTRACT_AMOUNT_EXCEEDS_MAX' },
  );
});
