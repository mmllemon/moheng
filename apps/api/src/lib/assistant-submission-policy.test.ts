import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ACTIVE_ASSISTANT_RUNS_PER_USER,
  isAssistantUserRunLimitReached,
} from './assistant-submission-policy.js';

test('assistant user run limit admits fewer than two active runs and rejects the third', () => {
  assert.equal(MAX_ACTIVE_ASSISTANT_RUNS_PER_USER, 2);
  assert.equal(isAssistantUserRunLimitReached(0), false);
  assert.equal(isAssistantUserRunLimitReached(1), false);
  assert.equal(isAssistantUserRunLimitReached(2), true);
  assert.equal(isAssistantUserRunLimitReached(3), true);
});

test('assistant user run limit rejects invalid counters instead of silently admitting work', () => {
  for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => isAssistantUserRunLimitReached(count), /ASSISTANT_ACTIVE_RUN_COUNT_INVALID/);
  }
});
