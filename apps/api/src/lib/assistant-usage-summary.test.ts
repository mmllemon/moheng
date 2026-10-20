import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssistantUsageSummary } from './assistant-usage-summary.js';

const periodStart = new Date('2026-09-20T00:00:00.000Z');
const periodEnd = new Date('2026-10-20T00:00:00.000Z');

test('assistant usage summary aggregates complete provider-reported tokens and counts unknown runs separately', () => {
  const summary = buildAssistantUsageSummary({
    projectId: 'project-1',
    periodStart,
    periodEnd,
    activeRuns: 2,
    groups: [
      { usageStatus: 'COMPLETE', _count: { _all: 3 }, _sum: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 } },
      { usageStatus: 'PARTIAL', _count: { _all: 2 }, _sum: { inputTokens: null, outputTokens: null, totalTokens: null } },
      { usageStatus: 'UNAVAILABLE', _count: { _all: 4 }, _sum: { inputTokens: null, outputTokens: null, totalTokens: null } },
    ],
  });

  assert.deepEqual(summary, {
    projectId: 'project-1',
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    windowDays: 30,
    terminalRuns: 9,
    completeRuns: 3,
    partialRuns: 2,
    unavailableRuns: 4,
    activeRuns: 2,
    tokens: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
  });
});

test('assistant usage summary leaves token totals unknown when no complete provider usage exists', () => {
  const summary = buildAssistantUsageSummary({
    projectId: 'project-1',
    periodStart,
    periodEnd,
    activeRuns: 1,
    groups: [
      { usageStatus: 'PARTIAL', _count: { _all: 1 }, _sum: { inputTokens: null, outputTokens: null, totalTokens: null } },
      { usageStatus: 'UNAVAILABLE', _count: { _all: 2 }, _sum: { inputTokens: null, outputTokens: null, totalTokens: null } },
    ],
  });

  assert.equal(summary.terminalRuns, 3);
  assert.equal(summary.tokens, null);
  assert.equal(summary.completeRuns, 0);
});

test('assistant usage summary treats reported zero tokens as a known value, not unknown', () => {
  const summary = buildAssistantUsageSummary({
    projectId: 'project-1',
    periodStart,
    periodEnd,
    activeRuns: 0,
    groups: [
      { usageStatus: 'COMPLETE', _count: { _all: 1 }, _sum: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    ],
  });

  assert.deepEqual(summary.tokens, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});

test('assistant usage summary rejects inconsistent aggregate token totals instead of displaying them', () => {
  const summary = buildAssistantUsageSummary({
    projectId: 'project-1',
    periodStart,
    periodEnd,
    activeRuns: 0,
    groups: [
      { usageStatus: 'COMPLETE', _count: { _all: 1 }, _sum: { inputTokens: 10, outputTokens: 5, totalTokens: 16 } },
    ],
  });

  assert.equal(summary.completeRuns, 1);
  assert.equal(summary.tokens, null);
});
