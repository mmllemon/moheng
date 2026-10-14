import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateContractCostGap, calculateDownstreamCurrentAmount, canRegisterPaymentForContractStatus } from './downstream-contract-math.js';

test('current downstream contract amount uses the original signed amount plus effective amendments', () => {
  assert.equal(calculateDownstreamCurrentAmount('200000.00', [
    { direction: 'INCREASE', amount: '15000.00' },
    { direction: 'DECREASE', amount: '5000.00' },
  ]), '210000.00');
});

test('an effective decrease cannot make the downstream contract amount negative', () => {
  assert.throws(() => calculateDownstreamCurrentAmount('100.00', [
    { direction: 'DECREASE', amount: '100.01' },
  ]), { message: 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE' });
});

test('active-contract-value minus linked cost is only an arithmetic gap and does not use payments', () => {
  assert.deepEqual(calculateContractCostGap({ status: 'ACTIVE', currentAmount: '200000.00', linkedActualCost: '60000.00' }), {
    contractValueMinusLinkedActualCost: '140000.00', linkedActualCostOverContractValue: '0.00',
  });
});

test('linked actual cost above current contract amount is reported as an overrun', () => {
  assert.deepEqual(calculateContractCostGap({ status: 'ACTIVE', currentAmount: '100000.00', linkedActualCost: '105000.50' }), {
    contractValueMinusLinkedActualCost: '0.00', linkedActualCostOverContractValue: '5000.50',
  });
});

test('completed-but-not-settled contracts remain in the active/pending-settlement contract-value summary', () => {
  assert.deepEqual(calculateContractCostGap({ status: 'COMPLETED', currentAmount: '100000.00', linkedActualCost: '25000.00' }), {
    contractValueMinusLinkedActualCost: '75000.00', linkedActualCostOverContractValue: '0.00',
  });
});

test('draft, settled and terminated contracts do not contribute to active/pending-settlement contract-value summary', () => {
  for (const status of ['DRAFT', 'SETTLED', 'TERMINATED'] as const) {
    assert.deepEqual(calculateContractCostGap({ status, currentAmount: '100000.00', linkedActualCost: '25000.00' }), {
      contractValueMinusLinkedActualCost: '0.00', linkedActualCostOverContractValue: '0.00',
    });
  }
});


test('settlement confirmation does not block recording outstanding payments or refunds', () => {
  assert.equal(canRegisterPaymentForContractStatus('SETTLED'), true);
  assert.equal(canRegisterPaymentForContractStatus('ACTIVE'), true);
  assert.equal(canRegisterPaymentForContractStatus('COMPLETED'), true);
  assert.equal(canRegisterPaymentForContractStatus('DRAFT'), false);
  assert.equal(canRegisterPaymentForContractStatus('TERMINATED'), false);
});
