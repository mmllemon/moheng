import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssistantRuntimeConfigurationStatus } from './assistant-config.js';

test('assistant readiness is false when the feature is disabled or required values are missing', () => {
  const result = getAssistantRuntimeConfigurationStatus({
    ASSISTANT_POC_ENABLED: 'false',
    OPENAI_API_KEY: '   ',
    ASSISTANT_POC_MODEL_ID: '',
    DATABASE_URL: '',
  });
  assert.equal(result.enabled, false);
  assert.equal(result.configurationReady, false);
  assert.deepEqual(result.configuration, {
    providerConfigured: false,
    modelConfigured: false,
    checkpointConfigured: false,
    endpointValid: true,
  });
});

test('assistant readiness becomes true only when provider, model and checkpoint settings exist', () => {
  const result = getAssistantRuntimeConfigurationStatus({
    ASSISTANT_POC_ENABLED: 'true',
    OPENAI_API_KEY: 'test-api-key-do-not-return',
    ASSISTANT_POC_MODEL_ID: 'model-test-id-do-not-return',
    ASSISTANT_CHECKPOINT_DATABASE_URL: 'postgresql://user:password@host/db',
  });
  assert.equal(result.enabled, true);
  assert.equal(result.configurationReady, true);
  assert.deepEqual(result.configuration, {
    providerConfigured: true,
    modelConfigured: true,
    checkpointConfigured: true,
    endpointValid: true,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('test-api-key-do-not-return'), false);
  assert.equal(serialized.includes('model-test-id-do-not-return'), false);
  assert.equal(serialized.includes('postgresql://'), false);
});

test('assistant checkpoint readiness falls back to the business DATABASE_URL', () => {
  const result = getAssistantRuntimeConfigurationStatus({
    OPENAI_API_KEY: 'test',
    ASSISTANT_POC_MODEL_ID: 'test',
    ASSISTANT_CHECKPOINT_DATABASE_URL: '  ',
    DATABASE_URL: 'postgresql://test/db',
  });
  assert.equal(result.configurationReady, true);
  assert.equal(result.configuration.checkpointConfigured, true);
});

test('assistant readiness reports configuration presence without claiming network reachability', () => {
  const result = getAssistantRuntimeConfigurationStatus({
    OPENAI_API_KEY: 'test',
    ASSISTANT_POC_MODEL_ID: 'test',
    DATABASE_URL: 'postgresql://test/db',
  });
  assert.equal(result.configurationReady, true);
  assert.equal(result.configuration.endpointValid, true);
  assert.equal(Object.keys(result).includes('providerReachable'), false);
});


test('assistant readiness rejects malformed, non-HTTP, credential-bearing, query-bearing and fragment-bearing custom endpoints', () => {
  const base = {
    ASSISTANT_POC_ENABLED: 'true',
    OPENAI_API_KEY: 'api-key-that-must-never-be-returned',
    ASSISTANT_POC_MODEL_ID: 'safe-model-id',
    ASSISTANT_CHECKPOINT_DATABASE_URL: 'postgresql://user:pass@db.example/assistant',
  };
  const invalidEndpoints = [
    'not-a-url',
    'ftp://provider.example/v1',
    'https://user:password@provider.example/v1',
    'https://provider.example/v1?api_key=secret-query-marker',
    'https://provider.example/v1#secret-fragment-marker',
  ];
  for (const endpoint of invalidEndpoints) {
    const result = getAssistantRuntimeConfigurationStatus({ ...base, OPENAI_BASE_URL: endpoint });
    assert.equal(result.configuration.endpointValid, false, endpoint);
    assert.equal(result.configurationReady, false, endpoint);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(endpoint), false);
    assert.equal(serialized.includes('api-key-that-must-never-be-returned'), false);
    assert.equal(serialized.includes('postgresql://'), false);
  }
});

test('assistant readiness accepts omitted endpoint and custom HTTP(S) base URLs without exposing the endpoint', () => {
  const base = {
    ASSISTANT_POC_ENABLED: 'true',
    OPENAI_API_KEY: 'test',
    ASSISTANT_POC_MODEL_ID: 'test-model',
    DATABASE_URL: 'postgresql://test/db',
  };
  for (const endpoint of [undefined, '   ', 'https://provider.example/v1', 'http://localhost:1234/v1']) {
    const result = getAssistantRuntimeConfigurationStatus({ ...base, OPENAI_BASE_URL: endpoint });
    assert.equal(result.configuration.endpointValid, true, String(endpoint));
    assert.equal(result.configurationReady, true, String(endpoint));
    const serialized = JSON.stringify(result);
    if (endpoint?.trim()) assert.equal(serialized.includes(endpoint.trim()), false);
    assert.equal(serialized.includes('postgresql://'), false);
  }
});
