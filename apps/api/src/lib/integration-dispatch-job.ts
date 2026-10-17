import { Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import type { BackgroundJobHandler } from './background-job-types.js';
import { PermanentBackgroundJobError } from './background-jobs.js';
import { prisma } from './prisma.js';
import { decryptIntegrationSecret } from './integration-vault.js';
import { IntegrationHttpError, requestIntegrationEndpoint } from './integration-http.js';

const payloadSchema = z.object({
  integrationId: z.string().min(1).max(100),
  requestBody: z.unknown(),
});

/** Generic JSON delivery for allowlisted REST/Webhook endpoints. ERP-specific mapping remains an adapter concern. */
export const integrationDispatchJobHandler: BackgroundJobHandler = async (job) => {
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new PermanentBackgroundJobError('INTEGRATION_JOB_PAYLOAD_INVALID');
  const integration = await prisma.integrationCredential.findUnique({ where: { id: parsed.data.integrationId } });
  if (!integration || integration.status !== 'ACTIVE') throw new PermanentBackgroundJobError('INTEGRATION_NOT_ACTIVE');
  if (!integration.endpointUrl || !integration.secretCiphertext || !integration.secretIv || !integration.secretAuthTag) throw new PermanentBackgroundJobError('INTEGRATION_ENDPOINT_OR_SECRET_MISSING');
  if (!['WEBHOOK', 'REST_API'].includes(integration.adapterType)) throw new PermanentBackgroundJobError('INTEGRATION_ADAPTER_UNSUPPORTED_FOR_GENERIC_DELIVERY');
  let secret: string;
  try {
    secret = decryptIntegrationSecret({ ciphertext: integration.secretCiphertext, iv: integration.secretIv, authTag: integration.secretAuthTag }, integration.code, integration.keyVersion);
  } catch { throw new PermanentBackgroundJobError('INTEGRATION_SECRET_DECRYPT_FAILED'); }
  try {
    const result = await requestIntegrationEndpoint({ endpointUrl: integration.endpointUrl, method: 'POST', bearerSecret: secret, payload: parsed.data.requestBody, idempotencyKey: job.id, timeoutMs: 15_000 });
    return { resultMetadata: {
      integrationId: integration.id, integrationCode: integration.code, httpStatus: result.statusCode,
      durationMs: result.durationMs, deliveredAt: new Date().toISOString(), payloadVersion: job.payloadVersion,
    } as Prisma.InputJsonObject };
  } catch (error) {
    if (error instanceof IntegrationHttpError && !error.retryable) throw new PermanentBackgroundJobError(error.code);
    if (error instanceof IntegrationHttpError) throw new Error(error.code);
    throw new Error('INTEGRATION_DELIVERY_FAILED');
  }
};
