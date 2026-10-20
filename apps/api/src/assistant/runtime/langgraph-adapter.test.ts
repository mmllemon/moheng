import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSISTANT_MODEL_POLICY, runLangGraphAssistantTurn, type AssistantRuntimeTestDependencies, type LangGraphAssistantTurn } from './langgraph-adapter.js';
import { assertSafeAssistantEventPayload } from '../../lib/assistant-run-events.js';
import type { AuthUser } from '../../lib/auth.js';
import type { AssistantReadOnlyToolInput } from '../../lib/assistant-read-only-tools.js';
import { createFakeRuntimeDependencies, FAKE_PROVIDER_PRIVATE_MARKER } from '../../../test-support/fake-assistant-provider.js';

test('assistant model policy bounds response size, timeout and retries', () => {
  assert.deepEqual(ASSISTANT_MODEL_POLICY, { maxTokens: 1800, timeoutMs: 45_000, maxRetries: 1 });
});

const actor: AuthUser = { sub: 'test-user', email: 'test@example.invalid', role: 'ADMIN', sid: 'test-session' };

function turn(prompt: string, emitted: Array<{ type: string; payload: Record<string, unknown> }>, signal?: AbortSignal): LangGraphAssistantTurn {
  return {
    apiKey: 'test-only-not-a-real-api-key', modelId: 'fake-provider', baseURL: 'https://provider.example.invalid/v1',
    checkpointUrl: 'postgres://not-used-by-memory-checkpointer', conversationId: 'gate-conversation', runId: 'gate-run', projectId: 'project-乙', actor,
    messages: [{ role: 'user', content: prompt }], ...(signal ? { signal } : {}), isCancellationRequested: async () => false,
    emit: async (type, payload) => {
      assertSafeAssistantEventPayload(type, payload);
      emitted.push({ type, payload });
    },
  };
}

test('fake provider autonomously chooses cost_variance, invokes the server tool, and grounds the answer in its result', async () => {
  const toolCalls: AssistantReadOnlyToolInput[] = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const result = await runLangGraphAssistantTurn(turn('请分析乙项目成本差异。', emitted), createFakeRuntimeDependencies(toolCalls));
  const answer = result.text;
  assert.deepEqual(result.tokenUsage, { status: 'UNAVAILABLE', inputTokens: null, outputTokens: null, totalTokens: null });
  assert.deepEqual(toolCalls.map((call) => call.toolId), ['cost_variance']);
  assert.equal(toolCalls[0]?.projectId, 'project-乙');
  assert.match(answer, /100000\.00/);
  assert.match(answer, /999999\.00/);
  assert.match(answer, /\+899999\.00/);
  assert.match(answer, /900%/);
  assert.match(answer, /OVER_TARGET/);
  assert.doesNotMatch(answer, new RegExp(FAKE_PROVIDER_PRIVATE_MARKER));
  assert.deepEqual(emitted.map((event) => event.type), ['tool.started', 'tool.completed']);
  assert.doesNotMatch(JSON.stringify(emitted), new RegExp(FAKE_PROVIDER_PRIVATE_MARKER));
  assert.doesNotMatch(JSON.stringify(emitted), /999999\.00|100000\.00|899999\.00/);
});

test('fake provider autonomously chooses project_operating_overview for an overview question', async () => {
  const toolCalls: AssistantReadOnlyToolInput[] = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const result = await runLangGraphAssistantTurn(turn('请给我乙项目经营概览。', emitted), createFakeRuntimeDependencies(toolCalls));
  const answer = result.text;
  assert.equal(result.tokenUsage.status, 'UNAVAILABLE');
  assert.deepEqual(toolCalls.map((call) => call.toolId), ['project_operating_overview']);
  assert.match(answer, /有效合同额 1200000\.00/);
  assert.match(answer, /目标成本 100000\.00/);
  assert.doesNotMatch(JSON.stringify(emitted), new RegExp(FAKE_PROVIDER_PRIVATE_MARKER));
});


test('empty final model response is rejected instead of completing with a blank answer', async () => {
  const toolCalls: AssistantReadOnlyToolInput[] = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const dependencies = {
    ...createFakeRuntimeDependencies(toolCalls),
    createAgent: (() => ({
      invoke: async () => ({ messages: [{ type: 'ai', content: '  \n  ' }] }),
    })) as unknown as AssistantRuntimeTestDependencies['createAgent'],
  };
  await assert.rejects(
    runLangGraphAssistantTurn(turn('请分析当前项目。', emitted), dependencies),
    /ASSISTANT_EMPTY_RESPONSE/,
  );
  assert.deepEqual(toolCalls, []);
  assert.deepEqual(emitted, []);
});


test('the system prompt warns the model when older conversation context was omitted by the budget', async () => {
  const toolCalls: AssistantReadOnlyToolInput[] = [];
  let systemPrompt = '';
  const dependencies = {
    ...createFakeRuntimeDependencies(toolCalls),
    createAgent: ((config: { systemPrompt?: string }) => {
      systemPrompt = config.systemPrompt ?? '';
      return { invoke: async () => ({ messages: [{ type: 'ai', content: '已根据当前上下文回答。' }] }) };
    }) as unknown as AssistantRuntimeTestDependencies['createAgent'],
  };
  const input = { ...turn('请继续刚才的分析。', []), contextTruncated: true };
  assert.equal((await runLangGraphAssistantTurn(input, dependencies)).text, '已根据当前上下文回答。');
  assert.match(systemPrompt, /较早的会话历史已因输入长度预算而省略/);
});

test('LangGraph invocation receives the run cancellation signal and aborts in-flight work', async () => {
  const toolCalls: AssistantReadOnlyToolInput[] = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const dependencies = {
    ...createFakeRuntimeDependencies(toolCalls),
    createAgent: (() => ({
      invoke: async (_input: unknown, options?: { signal?: AbortSignal }) => {
        observedSignal = options?.signal;
        return new Promise((resolve, reject) => {
          const abort = () => reject(new Error('ASSISTANT_CANCEL_REQUESTED'));
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener('abort', abort, { once: true });
        });
      },
    })) as unknown as AssistantRuntimeTestDependencies['createAgent'],
  };
  const pending = runLangGraphAssistantTurn(turn('请分析当前项目。', emitted, controller.signal), dependencies);
  assert.equal(observedSignal, controller.signal);
  controller.abort(new Error('ASSISTANT_CANCEL_REQUESTED'));
  await assert.rejects(pending, /ASSISTANT_CANCEL_REQUESTED/);
  assert.deepEqual(toolCalls, []);
});


test('tool cancellation during a read-only query does not emit false completion or failure events', async () => {
  const toolCalls: AssistantReadOnlyToolInput[] = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let cancellationChecks = 0;
  const dependencies = {
    ...createFakeRuntimeDependencies(toolCalls),
    runReadOnlyTool: (async (input: AssistantReadOnlyToolInput) => {
      toolCalls.push(input);
      return (await import('../../../test-support/fake-assistant-provider.js')).fakeToolResult(input) as never;
    }) as unknown as AssistantRuntimeTestDependencies['runReadOnlyTool'],
    createAgent: ((config: { tools?: Array<{ invoke: (input: unknown) => Promise<unknown> }> }) => ({
      invoke: async () => {
        await config.tools?.[0]?.invoke({});
        return { messages: [{ type: 'ai', content: '这条答复不应产生。' }] };
      },
    })) as unknown as AssistantRuntimeTestDependencies['createAgent'],
  };
  const input = {
    ...turn('请分析当前项目。', emitted),
    isCancellationRequested: async () => {
      cancellationChecks += 1;
      return cancellationChecks > 1;
    },
  };
  await assert.rejects(runLangGraphAssistantTurn(input, dependencies), /ASSISTANT_CANCEL_REQUESTED/);
  assert.equal(toolCalls.length, 1);
  assert.deepEqual(emitted.map((event) => event.type), ['tool.started']);
});


test('provider token usage is summed across generated model messages and excludes conversation history', async () => {
  const toolCalls: AssistantReadOnlyToolInput[] = [];
  const dependencies = {
    ...createFakeRuntimeDependencies(toolCalls),
    createAgent: (() => ({
      invoke: async (state: { messages: unknown[] }) => ({
        messages: [
          ...state.messages,
          { type: 'ai', content: '', usage_metadata: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } },
          { type: 'tool', content: '{}' },
          { type: 'ai', content: '完成。', usage_metadata: { input_tokens: 80, output_tokens: 25, total_tokens: 105 } },
        ],
      }),
    })) as unknown as AssistantRuntimeTestDependencies['createAgent'],
  };
  const input = {
    ...turn('当前问题', []),
    messages: [
      { role: 'user' as const, content: '较早的问题' },
      { role: 'assistant' as const, content: '较早的回答' },
      { role: 'user' as const, content: '当前问题' },
    ],
  };
  const result = await runLangGraphAssistantTurn(input, dependencies);
  assert.equal(result.text, '完成。');
  assert.deepEqual(result.tokenUsage, { status: 'COMPLETE', inputTokens: 180, outputTokens: 35, totalTokens: 215 });
});

test('provider token usage is marked partial when any generated model message omits metrics', async () => {
  const toolCalls: AssistantReadOnlyToolInput[] = [];
  const dependencies = {
    ...createFakeRuntimeDependencies(toolCalls),
    createAgent: (() => ({
      invoke: async (state: { messages: unknown[] }) => ({
        messages: [
          ...state.messages,
          { type: 'ai', content: '', usage_metadata: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } },
          { type: 'ai', content: '完成。' },
        ],
      }),
    })) as unknown as AssistantRuntimeTestDependencies['createAgent'],
  };
  const result = await runLangGraphAssistantTurn(turn('当前问题', []), dependencies);
  assert.equal(result.text, '完成。');
  assert.deepEqual(result.tokenUsage, { status: 'PARTIAL', inputTokens: null, outputTokens: null, totalTokens: null });
});
