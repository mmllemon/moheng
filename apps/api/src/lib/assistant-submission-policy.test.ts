import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ACTIVE_ASSISTANT_RUNS_PER_USER,
  MAX_ASSISTANT_SUBMISSIONS_PER_USER_PER_MINUTE,
  isAssistantUserRunLimitReached,
  isAssistantUserSubmissionRateLimitReached,
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

test('assistant user sliding-window submission limit admits six and rejects the seventh', () => {
  assert.equal(MAX_ASSISTANT_SUBMISSIONS_PER_USER_PER_MINUTE, 6);
  for (let count = 0; count < 6; count += 1) assert.equal(isAssistantUserSubmissionRateLimitReached(count), false);
  assert.equal(isAssistantUserSubmissionRateLimitReached(6), true);
  assert.equal(isAssistantUserSubmissionRateLimitReached(7), true);
});

test('assistant user submission rate limit rejects invalid counters', () => {
  for (const count of [-1, 0.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => isAssistantUserSubmissionRateLimitReached(count), /ASSISTANT_RECENT_SUBMISSION_COUNT_INVALID/);
  }
});
