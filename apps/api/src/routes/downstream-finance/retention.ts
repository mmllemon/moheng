import type { FastifyInstance } from 'fastify';
import { retentionMovement } from './helpers.js';
import { authRequired } from '../../lib/auth.js';

export async function registerRetentionRoutes(app: FastifyInstance) {
  app.post('/:projectId/downstream-contracts/:contractId/retention/release', { preHandler: authRequired }, async (request, reply) => {
    return retentionMovement(request, reply, 'RELEASE');
  });
  app.post('/:projectId/downstream-contracts/:contractId/retention/forfeit', { preHandler: authRequired }, async (request, reply) => {
    return retentionMovement(request, reply, 'FORFEIT');
  });
  /** 质保金专项扣回：缺陷维修、第三方代修等从留置余额里扣减，不生成应付；负数即红字冲回。 */
  app.post('/:projectId/downstream-contracts/:contractId/retention/deduct', { preHandler: authRequired }, async (request, reply) => {
    return retentionMovement(request, reply, 'DEDUCT');
  });
}
