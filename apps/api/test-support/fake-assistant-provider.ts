import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatResult } from '@langchain/core/outputs';
import { MemorySaver } from '@langchain/langgraph';
import type { AssistantReadOnlyToolInput } from '../src/lib/assistant-read-only-tools.js';
import type { AssistantRuntimeTestDependencies } from '../src/assistant/runtime/langgraph-adapter.js';
import { ASSISTANT_LIMITATION_COPY as LIMITATION } from '../src/lib/assistant-safe-copy.js';

export const FAKE_PROVIDER_PRIVATE_MARKER = 'SECRET-乙项目成本-999999';

export function fakeToolResult(input: AssistantReadOnlyToolInput) {
  if (input.toolId === 'cost_variance') return {
    toolId: input.toolId, generatedAt: '2026-10-17T00:00:00.000Z',
    project: { id: input.projectId, code: 'GATE-乙', name: '乙项目' },
    metric: { targetCostByLeafBudgetItems: '100000.00', actualCostRecorded: '999999.00', varianceActualMinusTarget: '899999.00', variancePercent: 900, direction: 'OVER_TARGET', targetCostLeafItemCount: 1, actualCostRecordCount: 1, targetCostScanTruncated: false },
    trustBoundaryNote: '仅使用来源字段统计口径。',
    sources: [{ entity: 'BudgetItem', fields: ['totalPrice', 'children'], rowCount: 1, scope: 'deletedAt = null; leaf items only' }],
    limitations: [LIMITATION.leafCostAggregation, LIMITATION.varianceBasis], privateTestOnly: FAKE_PROVIDER_PRIVATE_MARKER,
  };
  return {
    toolId: input.toolId, generatedAt: '2026-10-17T00:00:00.000Z',
    project: { id: input.projectId, code: 'GATE-乙', name: '乙项目' },
    contract: { storedEffectiveContractAmount: '1200000.00' },
    cost: { targetCostByLeafBudgetItems: '100000.00', actualCostRecorded: '999999.00' },
    trustBoundaryNote: '仅使用来源字段统计口径。',
    sources: [{ entity: 'Project', fields: ['contractAmount', 'originalContractAmount'], rowCount: 1, scope: 'projectId = requested authorized project' }],
    limitations: [LIMITATION.changeEvidenceOnly], privateTestOnly: FAKE_PROVIDER_PRIVATE_MARKER,
  };
}

export class DeterministicToolCallingModel extends BaseChatModel {
  _llmType() { return 'moheng-deterministic-test-provider'; }
  bindTools() { return this; }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const toolMessage = [...messages].reverse().find((message) => message.getType() === 'tool');
    if (!toolMessage) {
      const userPrompt = messages.filter((message) => message.getType() === 'human').map((message) => String(message.content)).join('\n');
      const name = userPrompt.includes('概览') ? 'project_operating_overview' : 'cost_variance';
      return { generations: [{ text: '', message: new AIMessage({ content: '', tool_calls: [{ id: 'gate-tool-call-1', name, args: {}, type: 'tool_call' }] }) }] };
    }
    const result = typeof toolMessage.content === 'string' ? JSON.parse(toolMessage.content) as Record<string, unknown> : {};
    if (result.toolId === 'cost_variance') {
      const metric = result.metric as Record<string, unknown>;
      const answer = `目标成本 ${metric.targetCostByLeafBudgetItems}，实际成本 ${metric.actualCostRecorded}，差异 +${metric.varianceActualMinusTarget}，差异比例 ${metric.variancePercent}%，${metric.direction}。`;
      return { generations: [{ text: answer, message: new AIMessage({ content: answer }) }] };
    }
    const contract = result.contract as Record<string, unknown>;
    const cost = result.cost as Record<string, unknown>;
    const answer = `项目经营概览：有效合同额 ${contract.storedEffectiveContractAmount}，目标成本 ${cost.targetCostByLeafBudgetItems}，实际成本 ${cost.actualCostRecorded}。`;
    return { generations: [{ text: answer, message: new AIMessage({ content: answer }) }] };
  }
}

export function createFakeRuntimeDependencies(toolCalls: AssistantReadOnlyToolInput[]): Partial<AssistantRuntimeTestDependencies> {
  return {
    createModel: (_config: { apiKey: string; modelId: string; baseURL?: string }) => new DeterministicToolCallingModel({}) as unknown as ReturnType<AssistantRuntimeTestDependencies['createModel']>,
    createSaver: (_checkpointUrl: string, _options: { schema: string }) => new MemorySaver() as unknown as ReturnType<AssistantRuntimeTestDependencies['createSaver']>,
    runReadOnlyTool: (async (input: AssistantReadOnlyToolInput) => {
      toolCalls.push(input);
      return fakeToolResult(input) as never;
    }) as unknown as AssistantRuntimeTestDependencies['runReadOnlyTool'],
  };
}
