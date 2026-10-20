import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { authRequired, authUser } from '../lib/auth.js';
import { getAssistantRuntimeStatus, loadAssistantRuntimeConfig } from '../lib/assistant-provider-config.js';
import { failure, success } from '../lib/http.js';
import { ASSISTANT_READ_ONLY_TOOL_IDS, AssistantReadOnlyToolError, runAssistantReadOnlyTool } from '../lib/assistant-read-only-tools.js';
import { assistantConversationRoutes } from './assistant-conversations.js';

const featureGate: preHandlerHookHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
  const runtime = await loadAssistantRuntimeConfig();
  if (!runtime.enabled) {
    return reply.code(404).send(failure(reply, 404, 'ROUTE_NOT_FOUND', '接口不存在'));
  }
};

const runSchema = z.object({
  toolId: z.enum(ASSISTANT_READ_ONLY_TOOL_IDS),
  projectId: z.string().trim().min(1).max(100),
}).strict();

function asToolFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof AssistantReadOnlyToolError) return failure(reply, error.statusCode, error.code, error.message);
  throw error;
}

/**
 * Development-only tool harness. It is feature-flagged off by default and deliberately
 * exposes no arbitrary SQL, shell, filesystem, HTTP, financial write, or approval tool.
 * Production AgentRuntime integration should call the same service only after binding a
 * server-verified conversation owner and project scope.
 */
export async function assistantPocRoutes(app: FastifyInstance) {
  // Availability is intentionally distinct from the gated tool/run APIs so the UI can hide the entry point when disabled.
  // This reports the feature switch and configuration-presence booleans only; it never returns secrets, raw model IDs, URLs, or database connection strings. It does not probe provider reachability.
  app.get('/status', { preHandler: [authRequired], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () =>
    success(await getAssistantRuntimeStatus()),
  );

  app.get('/tools', {
    preHandler: [featureGate, authRequired],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async () => success({
    mode: 'READ_ONLY_POC',
    enabled: true,
    tools: ASSISTANT_READ_ONLY_TOOL_IDS,
    warning: '仅用于受控 PoC。工具结果可读取业务台账，用户权限会在服务端逐次复核。',
  }));

  app.post('/run', {
    preHandler: [featureGate, authRequired],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = runSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'ASSISTANT_TOOL_INPUT_INVALID', '工具输入无效', parsed.error.flatten());
    try {
      const result = await runAssistantReadOnlyTool(parsed.data, authUser(request));
      return success(result);
    } catch (error) {
      return asToolFailure(reply, error);
    }
  });

  // Conversation/session routes inherit this module's same hidden prefix and feature gate.
  await assistantConversationRoutes(app);
}
