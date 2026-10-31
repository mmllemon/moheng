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
}
