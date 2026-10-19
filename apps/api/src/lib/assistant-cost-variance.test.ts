import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAssistantCostVarianceSummary } from './assistant-cost-variance.js';

test('assistant cost variance preserves cent precision for complete target-cost scans', () => {
  assert.deepEqual(calculateAssistantCostVarianceSummary({
    targetAmount: '100.00',
    actualAmount: '125.50',
    targetTruncated: false,
  }), {
    targetCostByLeafBudgetItems: '100.00',
    actualCostRecorded: '125.50',
    varianceActualMinusTarget: '25.50',
    variancePercent: 25.5,
    direction: 'OVER_TARGET',
  });
});

test('assistant cost variance becomes indeterminate when target-cost scan is truncated', () => {
  assert.deepEqual(calculateAssistantCostVarianceSummary({
    targetAmount: null,
    actualAmount: '125.50',
    targetTruncated: true,
  }), {
    targetCostByLeafBudgetItems: null,
    actualCostRecorded: '125.50',
    varianceActualMinusTarget: null,
    variancePercent: null,
    direction: 'INDETERMINATE',
  });
});

test('assistant cost variance does not divide by a zero target', () => {
  assert.deepEqual(calculateAssistantCostVarianceSummary({
    targetAmount: '0.00',
    actualAmount: '12.00',
    targetTruncated: false,
  }), {
    targetCostByLeafBudgetItems: '0.00',
    actualCostRecorded: '12.00',
    varianceActualMinusTarget: '12.00',
    variancePercent: null,
    direction: 'OVER_TARGET',
  });
});

test('assistant cost variance handles under-target and exactly-on-target values', () => {
  assert.equal(calculateAssistantCostVarianceSummary({targetAmount:'200.00',actualAmount:'199.00',targetTruncated:false}).direction,'UNDER_TARGET');
  assert.equal(calculateAssistantCostVarianceSummary({targetAmount:'200.00',actualAmount:'200.00',targetTruncated:false}).direction,'ON_TARGET');
});
