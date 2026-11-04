import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { Prisma } from '../generated/prisma/client.js';
import { appendAssistantRunEvent, assertSafeAssistantEventPayload } from './assistant-run-events.js';
import { ASSISTANT_LIMITATION_COPY as LIMITATION, ASSISTANT_SAFE_SOURCE_SCOPES } from './assistant-safe-copy.js';

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

// 2026-11-04：真供应商 E2E 暴露出 project_operating_overview 每次调用都失败 —— 它的
// 分供付款/退款来源用了一句白名单里没有的 scope，写 tool.completed 事件时抛
// ASSISTANT_EVENT_SOURCE_SCOPE_INVALID。白名单与工具实现分居两个文件，谁都没发现。
// 这里把两边的字符串对齐钉住，新增来源范围必须先补进白名单。
test('every source scope emitted by the read-only tools is on the safe allowlist', async () => {
  const source = await readFile(new URL('./assistant-read-only-tools.ts', import.meta.url), 'utf8');
  const used = [...new Set([...source.matchAll(/scope:\s*'([^']+)'/g)].map((match) => match[1]))].filter((scope): scope is string => typeof scope === 'string');
  assert.ok(used.length >= 5, 'expected the tools to declare their fixed query scopes');
  const missing = used.filter((scope) => !ASSISTANT_SAFE_SOURCE_SCOPES.includes(scope));
  assert.deepEqual(missing, [], `safe scope allowlist is missing: ${missing.join(' | ')}`);
});
