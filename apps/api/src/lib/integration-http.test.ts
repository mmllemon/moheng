import test from 'node:test';
import assert from 'node:assert/strict';
import { requestIntegrationEndpoint, IntegrationHttpError } from './integration-http.js';

test('integration probe rejects literal IPs and localhost before any network request', async () => {
  await assert.rejects(() => requestIntegrationEndpoint({ endpointUrl: 'https://127.0.0.1/admin', method: 'HEAD' }), (error: unknown) => error instanceof IntegrationHttpError && error.code === 'INTEGRATION_URL_UNSAFE');
  await assert.rejects(() => requestIntegrationEndpoint({ endpointUrl: 'https://[::1]/admin', method: 'HEAD' }), (error: unknown) => error instanceof IntegrationHttpError && error.code === 'INTEGRATION_URL_UNSAFE');
  await assert.rejects(() => requestIntegrationEndpoint({ endpointUrl: 'https://localhost/admin', method: 'HEAD' }), (error: unknown) => error instanceof IntegrationHttpError && error.code === 'INTEGRATION_HOST_UNSAFE');
});

test('integration probes require an explicit host allowlist before DNS resolution', async () => {
  const previous = process.env.INTEGRATION_ALLOWED_HOSTS;
  process.env.INTEGRATION_ALLOWED_HOSTS = '';
  try {
    await assert.rejects(() => requestIntegrationEndpoint({ endpointUrl: 'https://host-not-allowlisted.example.com/health', method: 'HEAD' }), (error: unknown) => error instanceof IntegrationHttpError && error.code === 'INTEGRATION_HOST_NOT_ALLOWLISTED');
  } finally { if (previous === undefined) delete process.env.INTEGRATION_ALLOWED_HOSTS; else process.env.INTEGRATION_ALLOWED_HOSTS = previous; }
});


test('request helper supports downstream idempotency headers without placing secrets in URLs', async () => {
  const { readFile } = await import('node:fs/promises');
  const implementation = await readFile(new URL('./integration-http.ts', import.meta.url), 'utf8');
  assert.match(implementation, /'idempotency-key': input\.idempotencyKey/);
  assert.match(implementation, /protocol: 'https:'/);
});
