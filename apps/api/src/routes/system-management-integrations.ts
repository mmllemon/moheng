import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { success, failure } from '../lib/http.js';
import { authUser } from '../lib/auth.js';
import { integrationCreate, assistantProviderPatch, assistantProviderLookup, integrationPatch, secretRotation } from './system-management.schemas.js';
import { publicIntegration, writeAudit } from './system-management.helpers.js';
import { decryptIntegrationSecret, encryptIntegrationSecret } from '../lib/integration-vault.js';
import { decryptAssistantProviderKey, encryptAssistantProviderKey, isCheckpointSchemaReady, publicAssistantProviderConfig } from '../lib/assistant-provider-config.js';
import { AssistantProviderError, fetchAssistantProviderModels, normalizeProviderBaseUrl } from '../lib/assistant-provider-client.js';
import { requestIntegrationEndpoint, IntegrationHttpError } from '../lib/integration-http.js';
import { enqueueBackgroundJob, hashJobRequest } from '../lib/background-jobs.js';

export async function registerIntegrationsRoutes(app: FastifyInstance) {
  app.get('/integrations', async () => {
    const rows = await prisma.integrationCredential.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
    return success(rows.map(publicIntegration));
  });

  app.get('/assistant-provider', async () => {
    const [row, checkpointSchemaReady] = await Promise.all([prisma.assistantProviderConfig.findUnique({ where: { id: 'default' } }), isCheckpointSchemaReady()]);
    return success(publicAssistantProviderConfig(row, checkpointSchemaReady));
  });

  app.put('/assistant-provider', async (request, reply) => {
    const actor = authUser(request);
    const parsed = assistantProviderPatch.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'ASSISTANT_PROVIDER_INPUT_INVALID', 'AI 助手配置参数有误', parsed.error.flatten());
    if (parsed.data.baseUrl) {
      try { normalizeProviderBaseUrl(parsed.data.baseUrl); }
      catch (error) {
        if (error instanceof AssistantProviderError) return failure(reply, error.statusCode, error.code, error.message);
        throw error;
      }
    }
    const current = await prisma.assistantProviderConfig.findUnique({ where: { id: 'default' } });
    const nextVersion = parsed.data.apiKey ? (current?.keyVersion ?? 0) + 1 : (current?.keyVersion ?? 1);
    let encrypted: ReturnType<typeof encryptAssistantProviderKey> | null = null;
    if (parsed.data.apiKey) {
      try { encrypted = encryptAssistantProviderKey(parsed.data.apiKey, nextVersion); }
      catch (error) {
        if (error instanceof Error && error.message === 'ASSISTANT_VAULT_NOT_CONFIGURED') return failure(reply, 503, 'ASSISTANT_VAULT_NOT_CONFIGURED', '服务端未配置 ASSISTANT_ENCRYPTION_KEY，无法安全保存模型密钥');
        throw error;
      }
    }
    const name = parsed.data.name ?? current?.name ?? 'OpenAI 兼容供应商';
    const baseUrl = parsed.data.baseUrl !== undefined ? (parsed.data.baseUrl || null) : (current?.baseUrl ?? null);
    const modelId = parsed.data.modelId !== undefined ? (parsed.data.modelId || null) : (current?.modelId ?? null);
    const enabled = parsed.data.enabled ?? current?.enabled ?? false;
    const row = await prisma.$transaction(async (tx) => {
      const saved = await tx.assistantProviderConfig.upsert({
        where: { id: 'default' },
        create: {
          id: 'default', name, baseUrl, modelId, enabled, updatedById: actor.sub, keyVersion: encrypted ? nextVersion : 1,
          ...(encrypted ? { apiKeyCiphertext: encrypted.ciphertext, apiKeyIv: encrypted.iv, apiKeyAuthTag: encrypted.authTag } : {}),
        },
        update: {
          name, baseUrl, modelId, enabled, updatedById: actor.sub,
          ...(encrypted ? { keyVersion: nextVersion, apiKeyCiphertext: encrypted.ciphertext, apiKeyIv: encrypted.iv, apiKeyAuthTag: encrypted.authTag } : {}),
        },
      });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'AssistantProviderConfig', entityId: saved.id, action: 'ASSISTANT_PROVIDER_CONFIG_UPDATED', changes: { name, baseUrl, modelId, enabled, apiKeyConfigured: Boolean(encrypted) || Boolean(current?.apiKeyCiphertext), keyVersion: saved.keyVersion } } });
      return saved;
    });
    return success(publicAssistantProviderConfig(row, await isCheckpointSchemaReady()));
  });

  app.post('/assistant-provider/models', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const actor = authUser(request);
    const parsed = assistantProviderLookup.safeParse(request.body ?? {});
    if (!parsed.success) return failure(reply, 400, 'ASSISTANT_PROVIDER_INPUT_INVALID', '模型拉取参数有误', parsed.error.flatten());
    const row = await prisma.assistantProviderConfig.findUnique({ where: { id: 'default' } });
    const baseUrl = parsed.data.baseUrl?.trim() || row?.baseUrl?.trim() || '';
    let apiKey = parsed.data.apiKey?.trim();
    if (!apiKey && row?.apiKeyCiphertext && row.apiKeyIv && row.apiKeyAuthTag) {
      try { apiKey = decryptAssistantProviderKey({ ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, authTag: row.apiKeyAuthTag }, row.keyVersion); }
      catch { apiKey = undefined; }
    }
    if (!apiKey) return failure(reply, 409, 'ASSISTANT_PROVIDER_KEY_MISSING', '请先填写模型服务密钥，或在保存配置后再拉取模型');
    try {
      const result = await fetchAssistantProviderModels({ baseUrl, apiKey });
      if (row) await prisma.assistantProviderConfig.update({ where: { id: row.id }, data: { lastModelsFetchedAt: new Date(), lastModelCount: result.models.length } });
      await prisma.auditLog.create({ data: { userId: actor.sub, entity: 'AssistantProviderConfig', entityId: 'default', action: 'ASSISTANT_PROVIDER_MODELS_FETCHED', changes: { baseUrl, modelCount: result.models.length, apiKeyStored: false } } });
      return success({ models: result.models, latencyMs: result.latencyMs });
    } catch (error) {
      if (error instanceof AssistantProviderError) return failure(reply, error.statusCode, error.code, error.message);
      throw error;
    }
  });

  app.post('/assistant-provider/test', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const actor = authUser(request);
    const row = await prisma.assistantProviderConfig.findUnique({ where: { id: 'default' } });
    if (!row?.baseUrl) return failure(reply, 409, 'ASSISTANT_PROVIDER_URL_MISSING', '请先保存供应商地址');
    let apiKey: string | undefined;
    if (row.apiKeyCiphertext && row.apiKeyIv && row.apiKeyAuthTag) {
      try { apiKey = decryptAssistantProviderKey({ ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, authTag: row.apiKeyAuthTag }, row.keyVersion); }
      catch { apiKey = undefined; }
    }
    if (!apiKey) return failure(reply, 409, 'ASSISTANT_PROVIDER_KEY_MISSING', '请先保存模型服务密钥');
    try {
      const result = await fetchAssistantProviderModels({ baseUrl: row.baseUrl, apiKey });
      const updated = await prisma.assistantProviderConfig.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestStatus: 'SUCCEEDED', lastTestSummary: 'MODELS_OK_' + result.models.length, lastModelsFetchedAt: new Date(), lastModelCount: result.models.length } });
      await prisma.auditLog.create({ data: { userId: actor.sub, entity: 'AssistantProviderConfig', entityId: row.id, action: 'ASSISTANT_PROVIDER_TEST_SUCCEEDED', changes: { baseUrl: row.baseUrl, modelId: row.modelId, modelCount: result.models.length, latencyMs: result.latencyMs, apiKeyStored: false } } });
      return success({ provider: publicAssistantProviderConfig(updated, await isCheckpointSchemaReady()), models: result.models, latencyMs: result.latencyMs, message: '供应商连接成功；这只验证模型列表可达，不代表具体模型已通过工具调用验收' });
    } catch (error) {
      const code = error instanceof AssistantProviderError ? error.code : 'ASSISTANT_PROVIDER_TEST_FAILED';
      const message = error instanceof AssistantProviderError ? error.message : '供应商连接测试失败';
      await prisma.assistantProviderConfig.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestStatus: 'FAILED', lastTestSummary: code } }).catch(() => undefined);
      await prisma.auditLog.create({ data: { userId: actor.sub, entity: 'AssistantProviderConfig', entityId: row.id, action: 'ASSISTANT_PROVIDER_TEST_FAILED', changes: { baseUrl: row.baseUrl, code, apiKeyStored: false } } }).catch(() => undefined);
      return failure(reply, error instanceof AssistantProviderError ? error.statusCode : 502, code, message);
    }
  });

  app.post('/integrations', async (request, reply) => {
    const actor = authUser(request);
    const parsed = integrationCreate.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '集成配置有误', parsed.error.flatten());
    let encrypted: ReturnType<typeof encryptIntegrationSecret>;
    try { encrypted = encryptIntegrationSecret(parsed.data.secret, parsed.data.code, 1); }
    catch (error) {
      if (error instanceof Error && error.message === 'INTEGRATION_ENCRYPTION_KEY_MISSING_OR_INVALID') return failure(reply, 503, 'INTEGRATION_VAULT_NOT_CONFIGURED', '集成凭据保险库未配置有效的 INTEGRATION_ENCRYPTION_KEY');
      throw error;
    }
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.integrationCredential.create({ data: {
          code: parsed.data.code, name: parsed.data.name, adapterType: parsed.data.adapterType,
          endpointUrl: parsed.data.endpointUrl || null, description: parsed.data.description ?? null,
          status: 'ACTIVE', secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretAuthTag: encrypted.authTag,
          keyVersion: 1, lastRotatedAt: new Date(), createdById: actor.sub, updatedById: actor.sub,
        } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'IntegrationCredential', entityId: created.id, action: 'INTEGRATION_CREDENTIAL_CREATED', changes: { code: created.code, adapterType: created.adapterType, secretConfigured: true, secretVersion: 1 } } });
        return created;
      });
      return reply.code(201).send(success(publicIntegration(row)));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'INTEGRATION_CODE_EXISTS', '集成编码已存在');
      throw error;
    }
  });

  app.patch('/integrations/:id', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = integrationPatch.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '集成修改参数有误');
    const old = await prisma.integrationCredential.findUnique({ where: { id: params.data.id } });
    if (!old) return failure(reply, 404, 'INTEGRATION_NOT_FOUND', '集成配置不存在');
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.integrationCredential.update({ where: { id: old.id }, data: { ...parsed.data, updatedById: actor.sub } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'IntegrationCredential', entityId: old.id, action: 'INTEGRATION_METADATA_UPDATED', changes: { before: { name: old.name, endpointUrl: old.endpointUrl, description: old.description, status: old.status }, after: { name: updated.name, endpointUrl: updated.endpointUrl, description: updated.description, status: updated.status } } } });
      return updated;
    });
    return success(publicIntegration(row));
  });

  app.post('/integrations/:id/rotate-secret', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = secretRotation.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '新凭据参数有误');
    const old = await prisma.integrationCredential.findUnique({ where: { id: params.data.id } });
    if (!old) return failure(reply, 404, 'INTEGRATION_NOT_FOUND', '集成配置不存在');
    const nextVersion = old.keyVersion + 1;
    let encrypted: ReturnType<typeof encryptIntegrationSecret>;
    try { encrypted = encryptIntegrationSecret(parsed.data.secret, old.code, nextVersion); }
    catch (error) {
      if (error instanceof Error && error.message === 'INTEGRATION_ENCRYPTION_KEY_MISSING_OR_INVALID') return failure(reply, 503, 'INTEGRATION_VAULT_NOT_CONFIGURED', '集成凭据保险库未配置有效的 INTEGRATION_ENCRYPTION_KEY');
      throw error;
    }
    const row = await prisma.$transaction(async (tx) => {
      // Optimistic version guard prevents concurrent rotations from silently overwriting each other.
      const changed = await tx.integrationCredential.updateMany({ where: { id: old.id, keyVersion: old.keyVersion }, data: { secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretAuthTag: encrypted.authTag, keyVersion: nextVersion, lastRotatedAt: new Date(), updatedById: actor.sub } });
      if (changed.count !== 1) throw new Error('INTEGRATION_SECRET_ROTATION_RACE');
      const updated = await tx.integrationCredential.findUniqueOrThrow({ where: { id: old.id } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'IntegrationCredential', entityId: old.id, action: 'INTEGRATION_SECRET_ROTATED', changes: { code: old.code, previousVersion: old.keyVersion, secretVersion: nextVersion, note: parsed.data.changeNote ?? null, secretValueStored: false } } });
      return updated;
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'INTEGRATION_SECRET_ROTATION_RACE') return null;
      throw error;
    });
    if (!row) return failure(reply, 409, 'INTEGRATION_SECRET_ROTATION_RACE', '凭据已被其他管理员轮换，请刷新后重试');
    return success(publicIntegration(row));
  });

  app.post('/integrations/:id/test-connection', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '集成编号有误');
    const row = await prisma.integrationCredential.findUnique({ where: { id: params.data.id } });
    if (!row) return failure(reply, 404, 'INTEGRATION_NOT_FOUND', '集成配置不存在');
    if (!row.endpointUrl || !row.secretCiphertext || !row.secretIv || !row.secretAuthTag) return failure(reply, 409, 'INTEGRATION_ENDPOINT_OR_SECRET_MISSING', '请先配置 HTTPS 端点与有效凭据');
    let status = 'FAILED';
    let summary = 'INTEGRATION_TEST_FAILED';
    let httpStatus: number | null = null;
    let durationMs: number | null = null;
    try {
      const secret = decryptIntegrationSecret({ ciphertext: row.secretCiphertext, iv: row.secretIv, authTag: row.secretAuthTag }, row.code, row.keyVersion);
      const result = await requestIntegrationEndpoint({ endpointUrl: row.endpointUrl, method: 'HEAD', bearerSecret: secret, timeoutMs: 8_000 });
      status = 'SUCCEEDED'; summary = `HTTP_${result.statusCode}`; httpStatus = result.statusCode; durationMs = result.durationMs;
    } catch (error) {
      summary = error instanceof IntegrationHttpError ? error.code : error instanceof Error && error.message === 'INTEGRATION_ENCRYPTION_KEY_MISSING_OR_INVALID' ? 'INTEGRATION_VAULT_NOT_CONFIGURED' : 'INTEGRATION_TEST_FAILED';
    }
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.integrationCredential.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestStatus: status, lastTestSummary: summary, updatedById: actor.sub } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'IntegrationCredential', entityId: row.id, action: status === 'SUCCEEDED' ? 'INTEGRATION_CONNECTION_TEST_SUCCEEDED' : 'INTEGRATION_CONNECTION_TEST_FAILED', changes: { code: row.code, host: (() => { try { return new URL(row.endpointUrl!).hostname; } catch { return null; } })(), status, summary, httpStatus, durationMs } } });
      return saved;
    });
    return status === 'SUCCEEDED' ? success({ integration: publicIntegration(updated), httpStatus, durationMs, message: 'HTTPS 端点已响应；这只验证网络与 HTTP 可达性，不代表 ERP 业务映射或同步正确' })
      : failure(reply, 502, summary, '连接测试未通过。检查 HTTPS 端点、允许主机列表、DNS 解析、Bearer 凭据与目标端点日志');
  });

  app.post('/integrations/:id/dispatch', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = z.object({ idempotencyKey: z.string().trim().min(8).max(200), payload: z.record(z.string(), z.unknown()) }).safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '投递参数有误；需要至少 8 位幂等键与 JSON 对象载荷');
    let payloadText = '';
    try { payloadText = JSON.stringify(parsed.data.payload); } catch { return failure(reply, 400, 'INTEGRATION_PAYLOAD_INVALID', '投递载荷不是有效 JSON'); }
    if (payloadText.length > 256 * 1024) return failure(reply, 413, 'INTEGRATION_PAYLOAD_TOO_LARGE', 'Webhook JSON 载荷不得超过 256 KB');
    const credentialLikeKey = /(?:password|secret|token|private.?key|api.?key|credential)/i;
    const inspectKeys = (value: unknown, depth = 0): boolean => {
      if (depth > 12) return true;
      if (value === null || typeof value !== 'object') return false;
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (credentialLikeKey.test(key) || inspectKeys(item, depth + 1)) return true;
      return false;
    };
    if (inspectKeys(parsed.data.payload)) return failure(reply, 400, 'INTEGRATION_PAYLOAD_CONTAINS_SECRET', '投递载荷包含疑似凭据字段；凭据只能由保险库自动附加，不能写进 JSON 载荷');
    const integration = await prisma.integrationCredential.findUnique({ where: { id: params.data.id } });
    if (!integration || integration.status !== 'ACTIVE') return failure(reply, 409, 'INTEGRATION_NOT_ACTIVE', '集成不存在或已停用');
    if (!['WEBHOOK', 'REST_API'].includes(integration.adapterType)) return failure(reply, 409, 'INTEGRATION_ADAPTER_UNSUPPORTED', '当前仅开放 WEBHOOK 与 REST_API 的通用 JSON 投递；ERP 等专用适配器需要独立映射实现');
    if (!integration.endpointUrl || !integration.secretCiphertext) return failure(reply, 409, 'INTEGRATION_ENDPOINT_OR_SECRET_MISSING', '请先配置 HTTPS 端点与加密凭据');
    const requestHash = hashJobRequest({ integrationId: integration.id, payload: parsed.data.payload });
    const existing = await prisma.backgroundJob.findFirst({ where: { ownerUserId: actor.sub, idempotencyKey: parsed.data.idempotencyKey }, select: { id: true, type: true, requestHash: true, status: true } });
    if (existing) {
      if (existing.type !== 'integration.json.dispatch' || existing.requestHash !== requestHash) return failure(reply, 409, 'IDEMPOTENCY_KEY_REUSED', '该幂等键已用于不同请求，请使用新的幂等键');
      return success({ id: existing.id, status: existing.status, idempotentReplay: true });
    }
    try {
      const job = await prisma.$transaction((tx) => enqueueBackgroundJob(tx, {
        type: 'integration.json.dispatch', payloadVersion: 1,
        payload: { integrationId: integration.id, requestBody: parsed.data.payload } as Prisma.InputJsonObject,
        ownerUserId: actor.sub, idempotencyKey: parsed.data.idempotencyKey, requestHash, maxAttempts: 5,
      }));
      await writeAudit({ userId: actor.sub, entity: 'BackgroundJob', entityId: job.id, action: 'INTEGRATION_DISPATCH_QUEUED', changes: { integrationId: integration.id, code: integration.code, adapterType: integration.adapterType, requestHash, maxAttempts: job.maxAttempts, bodyBytes: Buffer.byteLength(payloadText) } });
      return reply.code(202).send(success({ id: job.id, status: job.status, attempts: job.attempts, maxAttempts: job.maxAttempts, message: '已加入后台投递队列；网络失败及 HTTP 429/5xx 将按退避策略重试，幂等键用于阻止重复入队' }));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const raced = await prisma.backgroundJob.findFirst({ where: { ownerUserId: actor.sub, idempotencyKey: parsed.data.idempotencyKey }, select: { id: true, type: true, requestHash: true, status: true } });
        if (raced?.type === 'integration.json.dispatch' && raced.requestHash === requestHash) return success({ id: raced.id, status: raced.status, idempotentReplay: true });
        return failure(reply, 409, 'IDEMPOTENCY_KEY_REUSED', '该幂等键已被其他并发请求占用');
      }
      throw error;
    }
  });

  app.get('/integrations/:id/deliveries', async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '集成编号有误');
    const integration = await prisma.integrationCredential.findUnique({ where: { id: params.data.id }, select: { id: true } });
    if (!integration) return failure(reply, 404, 'INTEGRATION_NOT_FOUND', '集成配置不存在');
    const rows = await prisma.backgroundJob.findMany({
      where: { type: 'integration.json.dispatch', payload: { path: ['integrationId'], equals: integration.id } },
      take: 100, orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, attempts: true, maxAttempts: true, availableAt: true, createdAt: true, startedAt: true, finishedAt: true, resultMetadata: true, lastError: true, idempotencyKey: true },
    });
    return success(rows.map((row) => ({ ...row, lastError: row.lastError ? '投递失败；已按队列策略重试或进入终态，请查看受控服务日志与目标端点记录' : null })));
  });

}
