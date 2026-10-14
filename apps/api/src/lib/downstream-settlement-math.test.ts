import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOptionalLineTotal,
  assertPayableScheduleTotal,
  calculatePayableScheduleOpenAmount,
  calculateAdvanceBalance,
  calculateNetPayable,
  calculatePayableOpenAmount,
  calculatePostedSettlementDelta,
  calculateRetentionBalance,
} from './downstream-settlement-math.js';

test('final settlement posts only the difference from previously posted progress settlements', () => {
  const progress1 = calculatePostedSettlementDelta({ type: 'PROGRESS', confirmedAmount: '300000.00', previousCumulativeAmount: '0.00' });
  const progress2 = calculatePostedSettlementDelta({ type: 'PROGRESS', confirmedAmount: '200000.00', previousCumulativeAmount: '300000.00' });
  assert.equal(progress1, '300000.00');
  assert.equal(progress2, '200000.00');
  assert.equal(calculatePostedSettlementDelta({ type: 'FINAL', confirmedAmount: '470000.00', previousCumulativeAmount: '500000.00' }), '-30000.00');
});

test('final settlement equal to previous cumulative amount posts zero delta', () => {
  assert.equal(calculatePostedSettlementDelta({ type: 'FINAL', confirmedAmount: '500.00', previousCumulativeAmount: '500.00' }), '0.00');
});

test('adjustments permit negative deltas but may not drive cumulative settlement below zero', () => {
  assert.equal(calculatePostedSettlementDelta({ type: 'ADJUSTMENT', confirmedAmount: '-25.25', previousCumulativeAmount: '100.00' }), '-25.25');
  assert.throws(() => calculatePostedSettlementDelta({ type: 'ADJUSTMENT', confirmedAmount: '-101.00', previousCumulativeAmount: '100.00' }), /SETTLEMENT_TOTAL_BELOW_ZERO/);
});

test('settlement deductions and advance recovery obey the confirmed delta and prepayment balance', () => {
  assert.equal(calculateNetPayable({ postedDeltaAmount: '900000.00', advanceRecoveryAmount: '20000.00', retentionAmount: '30000.00', otherDeductionAmount: '10000.00', availableAdvanceAmount: '25000.00' }), '840000.00');
  assert.throws(() => calculateNetPayable({ postedDeltaAmount: '100.00', advanceRecoveryAmount: '20.00', retentionAmount: '50.00', otherDeductionAmount: '40.00', availableAdvanceAmount: '100.00' }), /SETTLEMENT_DEDUCTIONS_EXCEED_AMOUNT/);
  assert.throws(() => calculateNetPayable({ postedDeltaAmount: '100.00', advanceRecoveryAmount: '20.00', availableAdvanceAmount: '10.00' }), /ADVANCE_RECOVERY_EXCEEDS_BALANCE/);
  assert.throws(() => calculateNetPayable({ postedDeltaAmount: '-10.00', retentionAmount: '1.00', availableAdvanceAmount: '10.00' }), /NEGATIVE_SETTLEMENT_CANNOT_HAVE_DEDUCTIONS/);
});

test('advance balance subtracts refunds of advance payments and settlement deductions', () => {
  assert.equal(calculateAdvanceBalance({ payments: [
    { id: 'a1', type: 'ADVANCE', amount: '100.00' },
    { id: 'a2', type: 'ADVANCE', amount: '50.00' },
    { id: 'r1', type: 'REFUND', amount: '10.00', refundOfPaymentId: 'a1' },
    { id: 'r2', type: 'REFUND', amount: '20.00', refundOfPaymentId: 'non-advance' },
  ], recoveredAmount: '60.00' }), '80.00');
});

test('retention balance decreases on release and forfeiture without going below zero', () => {
  assert.equal(calculateRetentionBalance([{ type: 'RETAIN', amount: '50.00' }, { type: 'RETAIN', amount: '25.00' }, { type: 'RELEASE', amount: '10.00' }, { type: 'FORFEIT', amount: '5.00' }]), '60.00');
  assert.equal(calculateRetentionBalance([{ type: 'RELEASE', amount: '10.00' }]), '0.00');
});

test('payable open amount accounts for positive payment allocations and negative refund reversals', () => {
  assert.equal(calculatePayableOpenAmount('100.00', ['60.00', '-10.00']), '50.00');
  assert.equal(calculatePayableOpenAmount('-30.00', []), '-30.00');
});

test('settlement detail lines are optional but must reconcile when supplied', () => {
  assert.doesNotThrow(() => assertOptionalLineTotal({ submittedAmount: '100.00', lineAmounts: [] }));
  assert.doesNotThrow(() => assertOptionalLineTotal({ submittedAmount: '100.00', lineAmounts: ['30.00', '70.00'] }));
  assert.throws(() => assertOptionalLineTotal({ submittedAmount: '100.00', lineAmounts: ['99.99'] }), /SETTLEMENT_LINES_TOTAL_MISMATCH/);
});

test('negative final settlement difference is a credit and does not require ordinary deductions', () => {
  assert.equal(calculateNetPayable({ postedDeltaAmount: '-30000.00' }), '-30000.00');
});

test('payable schedules are optional but when configured must exactly equal the positive payable', () => {
  assert.doesNotThrow(() => assertPayableScheduleTotal({ payableAmount: '100.00', scheduleAmounts: ['25.00', '75.00'] }));
  assert.throws(() => assertPayableScheduleTotal({ payableAmount: '100.00', scheduleAmounts: ['30.00', '60.00'] }), /PAYABLE_SCHEDULE_TOTAL_MISMATCH/);
  assert.throws(() => assertPayableScheduleTotal({ payableAmount: '100.00', scheduleAmounts: ['100.00', '0.00'] }), /PAYABLE_SCHEDULE_AMOUNT_MUST_BE_POSITIVE/);
  assert.throws(() => assertPayableScheduleTotal({ payableAmount: '-10.00', scheduleAmounts: ['10.00'] }), /PAYABLE_SCHEDULE_REQUIRES_POSITIVE_PAYABLE/);
});

test('payable schedule balances account for refund reversals', () => {
  assert.equal(calculatePayableScheduleOpenAmount('60.00', ['30.00', '20.00', '-10.00']), '20.00');
});
