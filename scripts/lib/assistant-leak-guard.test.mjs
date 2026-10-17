import test from 'node:test';
import assert from 'node:assert/strict';
import { scanAssistantLeakArtifacts } from './assistant-leak-guard.mjs';

const event = JSON.stringify({ type: 'tool.completed', payload: {
  toolId: 'cost_variance', durationMs: 5, sourceCount: 1, generatedAt: '2026-10-17T00:00:00.000Z',
  sources: [{ entity: 'BudgetItem', fields: ['totalPrice', 'children'], rowCount: 1, scope: 'deletedAt = null; leaf items only' }],
  limitations: ['目标成本按叶子预算项汇总，避免将父级汇总行与子项重复累计。'],
} });

test('leak gate accepts metadata-only events and clean runtime logs', () => {
  const result = scanAssistantLeakArtifacts({ logs: 'INFO Assistant run completed code=ASSISTANT_RUNTIME_OK', events: event, forbiddenValues: ['SECRET-TEST-MARKER'] });
  assert.equal(result.ok, true, result.findings.join('\n'));
});

test('leak gate detects explicit business markers in logs and events', () => {
  for (const input of [
    { logs: 'response=SECRET-TEST-BUSINESS-123456', events: event },
    { logs: 'clean', events: `${event}\n${JSON.stringify({ type: 'run.completed', payload: { runId: 'run-1', messageId: 'message-1', debug: 'SECRET-TEST-BUSINESS-123456' } })}` },
  ]) {
    const result = scanAssistantLeakArtifacts({ ...input, forbiddenValues: ['SECRET-TEST-BUSINESS-123456'] });
    assert.equal(result.ok, false);
  }
});

test('leak gate rejects raw answer/prompt/value fields even without a known marker', () => {
  const bad = JSON.stringify({ type: 'run.completed', payload: { runId: 'run-1', messageId: 'message-1', answer: 'this is raw output' } });
  const result = scanAssistantLeakArtifacts({ logs: '', events: bad });
  assert.equal(result.ok, false);
  assert.match(result.findings.join(' '), /unapproved fields/);
});


test('leak gate accepts only the known fixed limitation copy, not arbitrary text', () => {
  const unsafe = JSON.stringify({ type: 'tool.completed', payload: {
    toolId: 'cost_variance', durationMs: 1, sourceCount: 1, generatedAt: '2026-10-17T00:00:00.000Z',
    sources: [{ entity: 'BudgetItem', fields: ['totalPrice'], rowCount: 1, scope: 'deletedAt = null; leaf items only' }],
    limitations: ['raw user-specific detail SECRET-TEST-123456'],
  } });
  const result = scanAssistantLeakArtifacts({ logs: '', events: unsafe, forbiddenValues: ['SECRET-TEST-123456'] });
  assert.equal(result.ok, false);
});

test('leak gate detects provider-style credential patterns', () => {
  const result = scanAssistantLeakArtifacts({ logs: 'apiKey=sk-12345678901234567890', events: event });
  assert.equal(result.ok, false);
});
