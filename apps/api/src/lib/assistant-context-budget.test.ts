import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_CONTEXT_CHARACTER_BUDGET,
  buildAssistantHistoryWithinBudget,
} from './assistant-context-budget.js';

test('assistant context budget preserves the current prompt and newest contiguous history in order', () => {
  const result = buildAssistantHistoryWithinBudget([
    { role: 'user', content: 'a'.repeat(4) },
    { role: 'assistant', content: 'b'.repeat(3) },
    { role: 'user', content: 'c'.repeat(4) },
  ], 'x'.repeat(4), 12);
  assert.deepEqual(result.messages, [
    { role: 'assistant', content: 'b'.repeat(3) },
    { role: 'user', content: 'c'.repeat(4) },
    { role: 'user', content: 'x'.repeat(4) },
  ]);
  assert.equal(result.truncated, true);
  assert.equal(result.omittedPriorMessageCount, 1);
  assert.equal(result.totalCharacters, 11);
  assert.ok(result.totalCharacters <= 12);
});

test('assistant context budget never clips the current prompt or splits earlier messages', () => {
  assert.throws(
    () => buildAssistantHistoryWithinBudget([], '123456', 5),
    /ASSISTANT_PROMPT_EXCEEDS_CONTEXT_BUDGET/,
  );
  const result = buildAssistantHistoryWithinBudget([
    { role: 'assistant', content: 'old' },
    { role: 'user', content: 'z'.repeat(7) },
  ], 'p'.repeat(2), 5);
  assert.deepEqual(result.messages, [{ role: 'user', content: 'p'.repeat(2) }]);
  assert.equal(result.omittedPriorMessageCount, 2);
  assert.equal(result.totalCharacters, 2);
});

test('the default assistant context budget is explicit and bounded', () => {
  const result = buildAssistantHistoryWithinBudget([
    { role: 'user', content: '最近问题' },
    { role: 'assistant', content: '最近回答' },
  ], '当前问题');
  assert.equal(ASSISTANT_CONTEXT_CHARACTER_BUDGET, 24_000);
  assert.equal(result.truncated, false);
  assert.equal(result.totalCharacters, '最近问题'.length + '最近回答'.length + '当前问题'.length);
});
