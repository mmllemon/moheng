import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateContractNetOpenCents, calculateOwnerReceivableStatus, calculateOwnerSettlementDelta, capReceiptCents, ownerSettlementDeductionError } from './owner-settlement-math.js';

test('final settlement posts only the delta from prior cumulative gross', () => {
  assert.equal(calculateOwnerSettlementDelta('FINAL', 18_000_000n, 20_000_000n), -2_000_000n);
  assert.equal(calculateOwnerSettlementDelta('FINAL', 22_000_000n, 20_000_000n), 2_000_000n);
  assert.equal(calculateOwnerSettlementDelta('FINAL', 20_000_000n, 20_000_000n), 0n);
});

test('adjustment remains a signed delta rather than a cumulative total', () => {
  assert.equal(calculateOwnerSettlementDelta('ADJUSTMENT', -300_000n, 20_000_000n), -300_000n);
  assert.equal(calculateOwnerSettlementDelta('ADJUSTMENT', 125_000n, 20_000_000n), 125_000n);
});

test('contract-level receivable open position nets approved credits against open receivables without hiding entries', () => {
  assert.equal(calculateContractNetOpenCents([
    { netCents: 20_000_000n, allocationCents: 15_000_000n },
    { netCents: -2_000_000n, allocationCents: 0n },
  ]), 3_000_000n);
  assert.equal(calculateContractNetOpenCents([
    { netCents: 1_000_000n, allocationCents: 0n },
    { netCents: -2_000_000n, allocationCents: 0n },
  ]), -1_000_000n);
});

test('receipt request is capped by both selected receivable and signed contract-level open position', () => {
  assert.equal(capReceiptCents(5_000_000n, 4_000_000n, 3_000_000n), 3_000_000n);
  assert.equal(capReceiptCents(5_000_000n, 4_000_000n, -100n), 0n);
  assert.equal(capReceiptCents(500n, 400n, 300n), 300n);
});

test('receivable state handles a fully received positive receivable and a negative adjustment credit', () => {
  assert.equal(calculateOwnerReceivableStatus(10_000n, 10_000n), 'RECEIVED');
  assert.equal(calculateOwnerReceivableStatus(10_000n, 3_000n), 'PARTIALLY_RECEIVED');
  assert.equal(calculateOwnerReceivableStatus(-2_000n, 0n), 'OPEN');
});

test('negative final-settlement delta posts as a credit when ordinary deductions are zero', () => {
  const delta = calculateOwnerSettlementDelta('FINAL', 4_700_000n, 5_000_000n);
  assert.equal(delta, -300_000n);
  assert.equal(ownerSettlementDeductionError(delta, 0n, 0n, 0n), null);
});

test('negative or zero settlement deltas reject duplicated ordinary deductions', () => {
  assert.equal(ownerSettlementDeductionError(-300_000n, 1n, 0n, 0n), 'NEGATIVE_DELTA_DEDUCTIONS');
  assert.equal(ownerSettlementDeductionError(0n, 0n, 1n, 0n), 'NEGATIVE_DELTA_DEDUCTIONS');
  assert.equal(ownerSettlementDeductionError(0n, 0n, 0n, 0n), null);
});

test('positive owner settlement deductions must not exceed this period delta', () => {
  assert.equal(ownerSettlementDeductionError(100_000n, 20_000n, 30_000n, 10_000n), null);
  assert.equal(ownerSettlementDeductionError(100_000n, 20_000n, 30_000n, 50_001n), 'DEDUCTIONS_EXCEED_DELTA');
});
