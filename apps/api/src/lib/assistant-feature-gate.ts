import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { loadAssistantRuntimeConfig, type AssistantRuntimeConfig } from './assistant-provider-config.js';
import { failure } from './http.js';

export type AssistantConfigLoader = () => Promise<AssistantRuntimeConfig>;

/**
 * 助手所有路由模块共用的功能开关。
 *
 * 2026-11-04：原先是两个模块各自写死一个 `loadAssistantRuntimeConfig()` 调用。运行配置
 * 以数据库行为优先（环境变量只是回退），所以本机一旦在 `/system/assistant` 里配过启用的
 * 供应商，`ASSISTANT_POC_ENABLED=false` 也拦不住请求：`auth-prehandler-regression` 里
 * 「开关关闭时返回 404」的用例会变成 401。抽出工厂 + 可注入的配置读取之后，那条用例
 * 不再依赖本机数据库状态，两个模块也不会再各写一份判定。
 */
export function createAssistantFeatureGate(loadConfig: AssistantConfigLoader = loadAssistantRuntimeConfig): preHandlerHookHandler {
  return async (_request: FastifyRequest, reply: FastifyReply) => {
    const runtime = await loadConfig();
    if (!runtime.enabled) {
      return reply.code(404).send(failure(reply, 404, 'ROUTE_NOT_FOUND', '接口不存在'));
    }
  };
}
