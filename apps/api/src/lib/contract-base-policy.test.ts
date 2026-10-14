import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOriginalAmountUpdate } from './contract-base-policy.js';

test('allows an unchanged original amount after formal contract registration', () => {
  assert.equal(classifyOriginalAmountUpdate({
    currentAmount: '12580000.00', requestedAmount: 12580000,
    hasMainContract: true, hasExternalConfirmation: true,
  }), 'UNCHANGED');
});

test('locks the original amount once the formal main contract exists', () => {
  assert.equal(classifyOriginalAmountUpdate({
    currentAmount: '12580000.00', requestedAmount: 13000000,
    hasMainContract: true, hasExternalConfirmation: false,
  }), 'IMMUTABLE');
});

test('locks the original amount once any external confirmation record exists', () => {
  assert.equal(classifyOriginalAmountUpdate({
    currentAmount: '12580000.00', requestedAmount: 13000000,
    hasMainContract: false, hasExternalConfirmation: true,
  }), 'IMMUTABLE');
});

test('allows initial baseline correction before formal contract and external confirmation', () => {
  assert.equal(classifyOriginalAmountUpdate({
    currentAmount: '0.00', requestedAmount: 12580000,
    hasMainContract: false, hasExternalConfirmation: false,
  }), 'INITIAL_BASE_UPDATE');
});

test('compares monetary values by cents instead of floating-point string form', () => {
  assert.equal(classifyOriginalAmountUpdate({
    currentAmount: '12580000.00', requestedAmount: 12580000.0,
    hasMainContract: true, hasExternalConfirmation: true,
  }), 'UNCHANGED');
});


test('flags a one-cent internal/external amount difference for separate review', async () => {
  const { hasInternalExternalAmountMismatch } = await import('./contract-base-policy.js');
  assert.equal(hasInternalExternalAmountMismatch('100.00', '100.01'), true);
});

test('does not flag equal amounts with different decimal formatting', async () => {
  const { hasInternalExternalAmountMismatch } = await import('./contract-base-policy.js');
  assert.equal(hasInternalExternalAmountMismatch('100.00', 100), false);
});
