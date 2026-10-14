import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPaymentWithinBounds, assertRefundTargetsPayment, netPaymentCents, paymentTotals } from './downstream-payment-math.js';

test('refund is recorded as a separate positive cash flow but reduces net paid', () => {
  const totals = paymentTotals([
    { type: 'ADVANCE', amount: '1000.00' },
    { type: 'PROGRESS', amount: '250.25' },
    { type: 'REFUND', amount: '200.00' },
  ]);
  assert.deepEqual(totals, { grossPaidAmount: '1250.25', refundedAmount: '200.00', netPaidAmount: '1050.25' });
});

test('refund cannot exceed current net paid even if gross payments were larger', () => {
  const existing = [
    { type: 'ADVANCE' as const, amount: '100.00' },
    { type: 'REFUND' as const, amount: '70.00' },
  ];
  assert.equal(netPaymentCents(existing), 3000n);
  assert.throws(() => assertPaymentWithinBounds({ existingPayments: existing, requestedType: 'REFUND', requestedAmount: '30.01', currentContractAmount: '100.00' }), { message: 'REFUND_EXCEEDS_NET_PAID' });
});

test('normal payment after refund is bounded by current net paid and signed contract amount', () => {
  const existing = [
    { type: 'PROGRESS' as const, amount: '100.00' },
    { type: 'REFUND' as const, amount: '20.00' },
  ];
  assert.doesNotThrow(() => assertPaymentWithinBounds({ existingPayments: existing, requestedType: 'PROGRESS', requestedAmount: '20.00', currentContractAmount: '100.00' }));
  assert.throws(() => assertPaymentWithinBounds({ existingPayments: existing, requestedType: 'PROGRESS', requestedAmount: '20.01', currentContractAmount: '100.00' }), { message: 'PAYMENT_EXCEEDS_CONTRACT' });
});

test('plan refund cannot exceed net amounts paid against that plan', () => {
  assert.throws(() => assertPaymentWithinBounds({
    existingPayments: [{ type: 'ADVANCE', amount: '100.00' }],
    requestedType: 'REFUND', requestedAmount: '50.00', currentContractAmount: '500.00',
    plan: { plannedAmount: '100.00', payments: [{ type: 'PROGRESS', amount: '30.00' }] },
  }), { message: 'REFUND_EXCEEDS_PLAN_PAID' });
});

test('plan payment is bounded by plan total after netting refunds', () => {
  const input = {
    existingPayments: [{ type: 'PROGRESS' as const, amount: '100.00' }],
    requestedType: 'PROGRESS' as const, currentContractAmount: '500.00',
    plan: { plannedAmount: '100.00', payments: [{ type: 'PROGRESS' as const, amount: '100.00' }, { type: 'REFUND' as const, amount: '20.00' }] },
  };
  assert.doesNotThrow(() => assertPaymentWithinBounds({ ...input, requestedAmount: '20.00' }));
  assert.throws(() => assertPaymentWithinBounds({ ...input, requestedAmount: '20.01' }), { message: 'PAYMENT_EXCEEDS_PLAN' });
});


test('refund must point to an original outgoing payment and inherits its payment plan', () => {
  const existing = [
    { id: 'payment-1', type: 'PROGRESS' as const, amount: '100.00', paymentPlanId: 'plan-1' },
  ];
  const original = assertRefundTargetsPayment({ existingPayments: existing, refundOfPaymentId: 'payment-1', requestedAmount: '30.00' });
  assert.equal(original.id, 'payment-1');
  assert.equal(original.paymentPlanId, 'plan-1');
});

test('refund cannot point to another refund or an unknown payment', () => {
  const existing = [
    { id: 'payment-1', type: 'PROGRESS' as const, amount: '100.00' },
    { id: 'refund-1', type: 'REFUND' as const, amount: '10.00', refundOfPaymentId: 'payment-1' },
  ];
  assert.throws(() => assertRefundTargetsPayment({ existingPayments: existing, refundOfPaymentId: 'refund-1', requestedAmount: '1.00' }), { message: 'REFUND_ORIGINAL_PAYMENT_INVALID' });
  assert.throws(() => assertRefundTargetsPayment({ existingPayments: existing, refundOfPaymentId: 'missing', requestedAmount: '1.00' }), { message: 'REFUND_ORIGINAL_PAYMENT_INVALID' });
});

test('refunds cannot cumulatively exceed the referenced original payment', () => {
  const existing = [
    { id: 'payment-1', type: 'PROGRESS' as const, amount: '100.00' },
    { id: 'refund-1', type: 'REFUND' as const, amount: '60.00', refundOfPaymentId: 'payment-1' },
  ];
  assert.doesNotThrow(() => assertRefundTargetsPayment({ existingPayments: existing, refundOfPaymentId: 'payment-1', requestedAmount: '40.00' }));
  assert.throws(() => assertRefundTargetsPayment({ existingPayments: existing, refundOfPaymentId: 'payment-1', requestedAmount: '40.01' }), { message: 'REFUND_EXCEEDS_ORIGINAL_PAYMENT' });
});

test('refund cannot be assigned to a payment plan different from the original payment', () => {
  assert.throws(() => assertRefundTargetsPayment({
    existingPayments: [{ id: 'payment-1', type: 'PROGRESS', amount: '100.00', paymentPlanId: 'plan-a' }],
    refundOfPaymentId: 'payment-1', requestedAmount: '20.00', requestedPlanId: 'plan-b',
  }), { message: 'REFUND_PAYMENT_PLAN_MISMATCH' });
});


test('payment based on a posted payable is bounded by payable balance, not a second contract-total ceiling', () => {
  assert.doesNotThrow(() => assertPaymentWithinBounds({
    existingPayments: [{ type: 'ADVANCE', amount: '100.00' }],
    requestedType: 'SETTLEMENT', requestedAmount: '800.00', currentContractAmount: '850.00',
    paymentIsAllocatedToPayable: true,
  }));
  assert.throws(() => assertPaymentWithinBounds({
    existingPayments: [{ type: 'ADVANCE', amount: '100.00' }],
    requestedType: 'SETTLEMENT', requestedAmount: '800.00', currentContractAmount: '850.00',
  }), { message: 'PAYMENT_EXCEEDS_CONTRACT' });
});
