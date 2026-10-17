import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '../generated/prisma/client.js';
import { appendAssistantRunEvent } from './assistant-run-events.js';

test('assistant run events allocate a monotonic sequence and persist the event in the transaction', async () => {
  let currentSequence = 3;
  let created: Record<string, unknown> | undefined;
  const tx = {
    assistantRun: {
      update: async (args: { where: { id: string }; data: { lastEventSequence: { increment: number } } }) => {
        assert.equal(args.where.id, 'run-1');
        assert.equal(args.data.lastEventSequence.increment, 1);
        currentSequence += 1;
        return { conversationId: 'conversation-1', lastEventSequence: currentSequence };
      },
    },
    assistantRunEvent: { create: async (args: { data: Record<string, unknown> }) => { created = args.data; return args.data; } },
  } as unknown as Prisma.TransactionClient;

  const event = await appendAssistantRunEvent(tx, {
    conversationId: 'conversation-1', runId: 'run-1', type: 'run.started', payload: { runId: 'run-1' },
  });
  assert.equal(event.sequence, 4);
  assert.equal(event.type, 'run.started');
  assert.equal((created as Record<string, unknown>).sequence, 4);
  assert.equal((created as Record<string, unknown>).conversationId, 'conversation-1');
});

test('assistant run events reject cross-conversation scope mismatches', async () => {
  let eventCreated = false;
  const tx = {
    assistantRun: { update: async () => ({ conversationId: 'actual-conversation', lastEventSequence: 1 }) },
    assistantRunEvent: { create: async () => { eventCreated = true; return {}; } },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(() => appendAssistantRunEvent(tx, {
    conversationId: 'forged-conversation', runId: 'run-1', type: 'run.started', payload: { runId: 'run-1' },
  }), /ASSISTANT_EVENT_SCOPE_MISMATCH/);
  assert.equal(eventCreated, false);
});

test('assistant run event names are validated before insert', async () => {
  let eventCreated = false;
  const tx = {
    assistantRun: { update: async () => ({ conversationId: 'conversation-1', lastEventSequence: 1 }) },
    assistantRunEvent: { create: async () => { eventCreated = true; return {}; } },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(() => appendAssistantRunEvent(tx, {
    conversationId: 'conversation-1', runId: 'run-1', type: 'run.started\nforged', payload: { runId: 'run-1' },
  }), /ASSISTANT_EVENT_TYPE_INVALID/);
  assert.equal(eventCreated, false);
});
