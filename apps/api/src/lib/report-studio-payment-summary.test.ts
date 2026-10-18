import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDownstreamPaymentTotals } from './report-studio-payment-summary.js';

test('downstream net payments subtract refunds once and keep cash separate from payables', () => {
  assert.deepEqual(summarizeDownstreamPaymentTotals([
    { type: 'ADVANCE', amount: '1000.20' },
    { type: 'PROGRESS', amount: '2000.10' },
    { type: 'REFUND', amount: '300.25' },
    { type: 'SETTLEMENT', amount: '150.00' },
  ]), {
    downstreamPaymentTotal: '3150.30',
    downstreamRefundTotal: '300.25',
    downstreamNetPaymentTotal: '2850.05',
  });
});

test('downstream totals use decimal cents without floating-point drift', () => {
  assert.deepEqual(summarizeDownstreamPaymentTotals([
    { type: 'PROGRESS', amount: '0.10' },
    { type: 'PROGRESS', amount: '0.20' },
    { type: 'REFUND', amount: '0.10' },
  ]), {
    downstreamPaymentTotal: '0.30',
    downstreamRefundTotal: '0.10',
    downstreamNetPaymentTotal: '0.20',
  });
});

test('downstream totals become null when the underlying payment rows were truncated', () => {
  assert.deepEqual(summarizeDownstreamPaymentTotals([
    { type: 'PROGRESS', amount: '500.00' },
  ], true), {
    downstreamPaymentTotal: null,
    downstreamRefundTotal: null,
    downstreamNetPaymentTotal: null,
  });
});

test('downstream totals for no cash movements are exact zero amounts', () => {
  assert.deepEqual(summarizeDownstreamPaymentTotals([]), {
    downstreamPaymentTotal: '0.00',
    downstreamRefundTotal: '0.00',
    downstreamNetPaymentTotal: '0.00',
  });
});
