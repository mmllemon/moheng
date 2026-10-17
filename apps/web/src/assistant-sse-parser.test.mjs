import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAssistantSseBlock } from './assistant-sse-parser.mjs';

test('parses the persisted MoHeng event envelope and numeric sequence', () => {
  const event = parseAssistantSseBlock([
    'id: 7',
    'event: tool.completed',
    'data: {"sequence":7,"type":"tool.completed","payload":{"toolId":"cost_variance","sourceCount":2},"createdAt":"2026-10-16T10:00:00.000Z"}',
  ].join('\n'));
  assert.deepEqual(event, {
    sequence: 7,
    type: 'tool.completed',
    payload: { toolId: 'cost_variance', sourceCount: 2 },
    createdAt: '2026-10-16T10:00:00.000Z',
  });
});

test('supports CRLF and multi-line data fields', () => {
  const event = parseAssistantSseBlock([
    'event: run.completed',
    'id: 11',
    'data: {"sequence":11,',
    'data: "type":"run.completed","payload":{"ok":true}}',
  ].join('\r\n'));
  assert.equal(event?.sequence, 11);
  assert.equal(event?.type, 'run.completed');
  assert.deepEqual(event?.payload, { ok: true });
});

test('returns null for heartbeats with no data', () => {
  assert.equal(parseAssistantSseBlock(': heartbeat\nretry: 3000'), null);
});

test('keeps the named event and safe error code for malformed JSON', () => {
  const event = parseAssistantSseBlock(['id: 4', 'event: run.failed', 'data: {broken'].join('\n'));
  assert.equal(event?.sequence, 4);
  assert.equal(event?.type, 'run.failed');
  assert.equal(event?.payload.code, 'ASSISTANT_EVENT_INVALID');
});

test('normalizes invalid event cursors to zero instead of propagating NaN', () => {
  const event = parseAssistantSseBlock(['id: nope', 'event: run.failed', 'data: null'].join('\n'));
  assert.equal(event?.sequence, 0);
  assert.equal(Number.isSafeInteger(event?.sequence), true);
});

test('does not treat array payloads as event envelopes', () => {
  const event = parseAssistantSseBlock(['id: 5', 'event: custom', 'data: []'].join('\n'));
  assert.equal(event?.sequence, 5);
  assert.equal(event?.type, 'custom');
  assert.deepEqual(event?.payload, {});
});
