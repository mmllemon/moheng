import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decryptBackupFile, encryptBackupFile } from './backup-encryption.js';

const testEnv = { BACKUP_ENCRYPTION_KEYS: JSON.stringify({ testkey: 'ab'.repeat(32) }), BACKUP_ACTIVE_ENCRYPTION_KEY_ID: 'testkey' } as NodeJS.ProcessEnv;

test('encrypted backups round-trip and expose no plaintext prefix', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moheng-backup-crypto-'));
  try {
    const original = join(directory, 'source.dump'); const encrypted = join(directory, 'source.dump.enc'); const restored = join(directory, 'restored.dump');
    const content = Buffer.from('backup-data-not-plaintext-on-disk'); await writeFile(original, content);
    const metadata = await encryptBackupFile(original, encrypted, testEnv);
    assert.equal(metadata.keyId, 'testkey');
    const encryptedBytes = await readFile(encrypted);
    assert.notEqual(encryptedBytes.subarray(0, content.length).toString('utf8'), content.toString('utf8'));
    const decrypted = await decryptBackupFile(encrypted, restored, testEnv);
    assert.equal(decrypted.keyId, 'testkey');
    assert.deepEqual(await readFile(restored), content);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('tampered encrypted backup is rejected and removes partial plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moheng-backup-tamper-'));
  try {
    const source = join(directory, 'source'); const encrypted = join(directory, 'source.enc'); const restored = join(directory, 'restored');
    await writeFile(source, 'good-backup'); await encryptBackupFile(source, encrypted, testEnv);
    const value = await readFile(encrypted); value[value.length - 1] = value[value.length - 1]! ^ 0x01; await writeFile(encrypted, value);
    await assert.rejects(() => decryptBackupFile(encrypted, restored, testEnv), /BACKUP_DECRYPTION_FAILED/);
    await assert.rejects(() => readFile(restored));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
