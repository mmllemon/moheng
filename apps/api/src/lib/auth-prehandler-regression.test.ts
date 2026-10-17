import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { authRequired } from './auth.js';
import { assistantPocRoutes } from '../routes/assistant-poc.js';

test('unauthenticated preHandler sends a 401 and never enters the protected handler', async () => {
  const app = Fastify();
  await app.register(jwt, { secret: 'test-only-jwt-secret-that-is-not-a-credential' });
  let handlerCalls = 0;
  app.get('/protected', { preHandler: [authRequired] }, async () => {
    handlerCalls += 1;
    return { success: true, privateMarker: 'MUST_NOT_BE_RETURNED' };
  });
  try {
    const response = await app.inject({ method: 'GET', url: '/protected' });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().success, false);
    assert.equal(response.json().error.code, 'UNAUTHENTICATED');
    assert.doesNotMatch(response.body, /MUST_NOT_BE_RETURNED/);
    assert.equal(handlerCalls, 0);
  } finally {
    await app.close();
  }
});

test('ASSISTANT_POC_ENABLED=false sends ROUTE_NOT_FOUND before any POC handler runs', async () => {
  const previous = process.env.ASSISTANT_POC_ENABLED;
  process.env.ASSISTANT_POC_ENABLED = 'false';
  const app = Fastify();
  await app.register(assistantPocRoutes, { prefix: '/api/assistant-poc' });
  try {
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/assistant-poc/tools' });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().success, false);
    assert.equal(response.json().error.code, 'ROUTE_NOT_FOUND');
    assert.doesNotMatch(response.body, /READ_ONLY_POC|project_operating_overview|cost_variance/);
    const conversationsResponse = await app.inject({ method: 'GET', url: '/api/assistant-poc/conversations' });
    assert.equal(conversationsResponse.statusCode, 404);
    assert.equal(conversationsResponse.json().success, false);
    assert.equal(conversationsResponse.json().error.code, 'ROUTE_NOT_FOUND');
    assert.doesNotMatch(conversationsResponse.body, /conversation|runId|projectId|assistantMessages/);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ASSISTANT_POC_ENABLED;
    else process.env.ASSISTANT_POC_ENABLED = previous;
  }
});
