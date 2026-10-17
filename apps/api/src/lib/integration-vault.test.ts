import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptIntegrationSecret, encryptIntegrationSecret } from './integration-vault.js';

test('integration secrets encrypt and decrypt with context-bound AES-256-GCM', () => {
  const key = 'a'.repeat(64);
  const encrypted = encryptIntegrationSecret('not-a-real-key', 'ERP_SYNC', 3, key);
  assert.equal(decryptIntegrationSecret(encrypted, 'ERP_SYNC', 3, key), 'not-a-real-key');
  assert.throws(() => decryptIntegrationSecret(encrypted, 'OTHER_SYNC', 3, key));
  assert.throws(() => decryptIntegrationSecret(encrypted, 'ERP_SYNC', 4, key));
});

test('integration secrets reject absent master key and empty plaintext', () => {
  assert.throws(() => encryptIntegrationSecret('', 'ERP_SYNC', 1, 'a'.repeat(64)));
  const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
  try {
    assert.throws(() => encryptIntegrationSecret('x', 'ERP_SYNC', 1));
  } finally {
    if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
  }
});
