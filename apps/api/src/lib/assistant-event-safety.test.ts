import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '../generated/prisma/client.js';
import { appendAssistantRunEvent, assertSafeAssistantEventPayload } from './assistant-run-events.js';
import { ASSISTANT_LIMITATION_COPY as LIMITATION } from './assistant-safe-copy.js';

const safeToolEvent = {
  toolId: 'cost_variance', durationMs: 3, sourceCount: 2, generatedAt: '2026-10-17T00:00:00.000Z',
  limitations: [LIMITATION.leafCostAggregation],
  sources: [
    { entity: 'BudgetItem', fields: ['totalPrice', 'children'], rowCount: 1, scope: 'deletedAt = null; leaf items only' },
    { entity: 'CostEntry', fields: ['amount'], rowCount: 1, scope: 'deletedAt = null; projectId = requested project' },
  ],
} as const;

test('safe tool event accepts only field-level source metadata', () => {
  assert.doesNotThrow(() => assertSafeAssistantEventPayload('tool.completed', safeToolEvent));
});

test('tool event rejects assistant text, prompt, amount values and unknown fields', () => {
  for (const unsafe of [
    { ...safeToolEvent, prompt: 'SECRET-PROMPT-TEST-ONLY' },
    { ...safeToolEvent, answer: 'SECRET-BUSINESS-TEST-ONLY' },
    { ...safeToolEvent, amount: '999999.00' },
    { ...safeToolEvent, limitations: ['SECRET-ANSWER-TEST-ONLY'] },
  ]) {
    assert.throws(() => assertSafeAssistantEventPayload('tool.completed', unsafe), /ASSISTANT_EVENT_(?:PAYLOAD_FIELD_NOT_ALLOWED|LIMITATION_NOT_ALLOWED)/);
  }
});

test('unsafe event payload is rejected before allocating a sequence or writing', async () => {
  let sequenceAllocated = false;
  let rowCreated = false;
  const tx = {
    assistantRun: { update: async () => { sequenceAllocated = true; return { conversationId: 'conversation-1', lastEventSequence: 1 }; } },
    assistantRunEvent: { create: async () => { rowCreated = true; return {}; } },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(() => appendAssistantRunEvent(tx, {
    conversationId: 'conversation-1', runId: 'run-1', type: 'run.completed',
    payload: { runId: 'run-1', messageId: 'message-1', answer: 'SECRET-ANSWER-TEST-ONLY' },
  }), /ASSISTANT_EVENT_PAYLOAD_FIELD_NOT_ALLOWED/);
  assert.equal(sequenceAllocated, false);
  assert.equal(rowCreated, false);
});

test('tool event rejects field values masquerading as source metadata', () => {
  assert.throws(() => assertSafeAssistantEventPayload('tool.completed', {
    ...safeToolEvent,
    sources: [{ entity: 'Project', fields: ['contractAmount'], rowCount: 1, scope: 'projectId = SECRET-BUSINESS-TEST-ONLY' }],
    sourceCount: 1,
  }), /ASSISTANT_EVENT_SOURCE_SCOPE_INVALID/);
});
