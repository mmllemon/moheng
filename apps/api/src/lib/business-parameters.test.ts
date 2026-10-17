import test from 'node:test';
import assert from 'node:assert/strict';
import { businessNumberParameter, type BusinessNumberParameterValues } from './business-parameters.js';

test('business-readable parameter resolution uses project override, then global, then fallback', () => {
  const values: BusinessNumberParameterValues = new Map([
    ['CONTRACT_EXPIRY_WARNING_DAYS', new Map([['*', 30], ['project-2', 14]])],
  ]);
  const definition = { defaultValue: 30, min: 1, max: 365 };
  assert.equal(businessNumberParameter(values, 'CONTRACT_EXPIRY_WARNING_DAYS', 'project-2', definition), 14);
  assert.equal(businessNumberParameter(values, 'CONTRACT_EXPIRY_WARNING_DAYS', 'project-1', definition), 30);
  assert.equal(businessNumberParameter(new Map(), 'CONTRACT_EXPIRY_WARNING_DAYS', 'project-1', definition), 30);
});

test('warning thresholds can be clamped by the loading policy without changing financial arithmetic', () => {
  const definition = { defaultValue: 0, min: 0, max: 100 };
  const values: BusinessNumberParameterValues = new Map([['TARGET_COST_OVERRUN_DANGER_PERCENT', new Map([['*', 10]])]]);
  assert.equal(businessNumberParameter(values, 'TARGET_COST_OVERRUN_DANGER_PERCENT', 'project-1', definition), 10);
});
