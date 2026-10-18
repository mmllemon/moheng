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

test('assistant readiness does not treat a model credential as a ready network connection', () => {
  const result = getAssistantRuntimeConfigurationStatus({
    OPENAI_API_KEY: 'test',
    ASSISTANT_POC_MODEL_ID: 'test',
    DATABASE_URL: 'postgresql://test/db',
  });
  assert.equal(result.configurationReady, true);
  assert.equal(Object.keys(result).includes('providerReachable'), false);
});
