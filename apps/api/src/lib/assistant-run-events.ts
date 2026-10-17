import type { Prisma } from '../generated/prisma/client.js';
import { ASSISTANT_SAFE_LIMITATIONS, ASSISTANT_SAFE_SOURCE_SCOPES } from './assistant-safe-copy.js';

export type AssistantEventJsonValue = string | number | boolean | null | readonly AssistantEventJsonValue[] | { readonly [key: string]: AssistantEventJsonValue };

export type AssistantRunEventInput = {
  conversationId: string;
  runId: string;
  type: string;
  payload: Record<string, AssistantEventJsonValue>;
};

const EVENT_FIELDS: Record<string, readonly string[]> = {
  'run.queued': ['runId', 'messageId'],
  'run.started': ['runId'],
  'run.cancel_requested': ['runId'],
  'run.cancelled': ['runId'],
  'run.completed': ['runId', 'messageId'],
  'run.failed': ['runId', 'code'],
  'tool.started': ['toolId'],
  'tool.completed': ['toolId', 'durationMs', 'sourceCount', 'generatedAt', 'sources', 'limitations'],
  'tool.failed': ['toolId', 'durationMs', 'code'],
};
const TOOL_IDS = new Set(['project_operating_overview', 'cost_variance', 'change_evidence_completeness']);
const SIMPLE_ID = /^[A-Za-z0-9_-]{1,150}$/;
const SAFE_CODE = /^[A-Z0-9_]{3,80}$/;

/** Runtime allowlist: event payloads are metadata, never prompts, answers, amounts or source result bodies. */
export function assertSafeAssistantEventPayload(type: string, payload: Record<string, AssistantEventJsonValue>): void {
  const allowedFields = EVENT_FIELDS[type];
  if (!allowedFields) throw new Error('ASSISTANT_EVENT_TYPE_NOT_ALLOWED');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('ASSISTANT_EVENT_PAYLOAD_INVALID');
  if (Object.keys(payload).some((key) => !allowedFields.includes(key))) throw new Error('ASSISTANT_EVENT_PAYLOAD_FIELD_NOT_ALLOWED');

  for (const key of ['runId', 'messageId']) {
    if (key in payload && (typeof payload[key] !== 'string' || !SIMPLE_ID.test(payload[key] as string))) {
      throw new Error('ASSISTANT_EVENT_ID_INVALID');
    }
  }
  if ('code' in payload && (typeof payload.code !== 'string' || !SAFE_CODE.test(payload.code))) throw new Error('ASSISTANT_EVENT_CODE_INVALID');
  if ('toolId' in payload && (typeof payload.toolId !== 'string' || !TOOL_IDS.has(payload.toolId))) throw new Error('ASSISTANT_EVENT_TOOL_ID_INVALID');
  if ('durationMs' in payload && (typeof payload.durationMs !== 'number' || !Number.isInteger(payload.durationMs) || payload.durationMs < 0)) throw new Error('ASSISTANT_EVENT_DURATION_INVALID');
  if ('sourceCount' in payload && (typeof payload.sourceCount !== 'number' || !Number.isInteger(payload.sourceCount) || payload.sourceCount < 0 || payload.sourceCount > 10)) throw new Error('ASSISTANT_EVENT_SOURCE_COUNT_INVALID');
  if ('generatedAt' in payload && (typeof payload.generatedAt !== 'string' || Number.isNaN(Date.parse(payload.generatedAt)))) throw new Error('ASSISTANT_EVENT_TIMESTAMP_INVALID');
  if ('limitations' in payload && (!Array.isArray(payload.limitations) || payload.limitations.length > 12 || payload.limitations.some((item) => typeof item !== 'string' || !ASSISTANT_SAFE_LIMITATIONS.includes(item)))) throw new Error('ASSISTANT_EVENT_LIMITATION_NOT_ALLOWED');
  if ('sources' in payload && 'sourceCount' in payload && Array.isArray(payload.sources) && payload.sourceCount !== payload.sources.length) throw new Error('ASSISTANT_EVENT_SOURCE_COUNT_MISMATCH');

  if ('sources' in payload) {
    const sources = payload.sources;
    if (!Array.isArray(sources) || sources.length > 10) throw new Error('ASSISTANT_EVENT_SOURCES_INVALID');
    for (const source of sources) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('ASSISTANT_EVENT_SOURCE_INVALID');
      const item = source as Record<string, AssistantEventJsonValue>;
      if (Object.keys(item).some((key) => !['entity', 'fields', 'rowCount', 'scope'].includes(key))) throw new Error('ASSISTANT_EVENT_SOURCE_FIELD_NOT_ALLOWED');
      if (typeof item.entity !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(item.entity)) throw new Error('ASSISTANT_EVENT_SOURCE_ENTITY_INVALID');
      if (!Array.isArray(item.fields) || item.fields.length > 50 || item.fields.some((field) => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(field))) throw new Error('ASSISTANT_EVENT_SOURCE_FIELDS_INVALID');
      if (typeof item.rowCount !== 'number' || !Number.isInteger(item.rowCount) || item.rowCount < 0 || item.rowCount > 1000000) throw new Error('ASSISTANT_EVENT_SOURCE_ROW_COUNT_INVALID');
      if (typeof item.scope !== 'string' || !ASSISTANT_SAFE_SOURCE_SCOPES.includes(item.scope)) throw new Error('ASSISTANT_EVENT_SOURCE_SCOPE_INVALID');
    }
  }
}

/** Allocate a monotonically increasing per-run sequence and persist the event atomically. */
export async function appendAssistantRunEvent(tx: Prisma.TransactionClient, input: AssistantRunEventInput) {
  if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(input.type)) throw new Error('ASSISTANT_EVENT_TYPE_INVALID');
  assertSafeAssistantEventPayload(input.type, input.payload);
  const run = await tx.assistantRun.update({
    where: { id: input.runId },
    data: { lastEventSequence: { increment: 1 } },
    select: { conversationId: true, lastEventSequence: true },
  });
  if (run.conversationId !== input.conversationId) throw new Error('ASSISTANT_EVENT_SCOPE_MISMATCH');
  return tx.assistantRunEvent.create({
    data: {
      conversationId: input.conversationId,
      runId: input.runId,
      sequence: run.lastEventSequence,
      type: input.type,
      payload: input.payload as Prisma.InputJsonObject,
    },
  });
}
