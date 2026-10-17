import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, open, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { ReadStream } from 'node:fs';

const MAGIC = Buffer.from('MOHENG-BACKUP-ENC-V1\n', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_KEY_ID_BYTES = 32;

export type BackupKeyRing = { activeKeyId: string; keys: Record<string, Buffer> };

export function parseBackupKeyRing(env: NodeJS.ProcessEnv = process.env): BackupKeyRing {
  const raw = env.BACKUP_ENCRYPTION_KEYS;
  const activeKeyId = env.BACKUP_ACTIVE_ENCRYPTION_KEY_ID?.trim() ?? '';
  if (!raw || !activeKeyId) throw new Error('BACKUP_ENCRYPTION_NOT_CONFIGURED');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('BACKUP_ENCRYPTION_KEYRING_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('BACKUP_ENCRYPTION_KEYRING_INVALID');
  const keys: Record<string, Buffer> = {};
  for (const [keyId, hex] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId) || typeof hex !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(hex)) throw new Error('BACKUP_ENCRYPTION_KEYRING_INVALID');
    keys[keyId] = Buffer.from(hex, 'hex');
  }
  if (Object.keys(keys).length < 1 || Object.keys(keys).length > 16 || !keys[activeKeyId]) throw new Error('BACKUP_ENCRYPTION_ACTIVE_KEY_MISSING');
  return { activeKeyId, keys };
}

function encodeHeader(keyId: string, iv: Buffer): Buffer {
  const id = Buffer.from(keyId, 'utf8');
  if (id.length < 1 || id.length > MAX_KEY_ID_BYTES) throw new Error('BACKUP_ENCRYPTION_KEY_ID_INVALID');
  return Buffer.concat([MAGIC, Buffer.from([id.length]), id, iv]);
}

async function readHeader(path: string): Promise<{ headerLength: number; keyId: string; iv: Buffer }> {
  const handle = await open(path, 'r');
  try {
    const maximum = MAGIC.length + 1 + MAX_KEY_ID_BYTES + IV_BYTES;
    const head = Buffer.alloc(maximum);
    const { bytesRead } = await handle.read(head, 0, maximum, 0);
    if (bytesRead < MAGIC.length + 1 || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('BACKUP_ENCRYPTED_FORMAT_INVALID');
    const idLength = head[MAGIC.length]!;
    if (idLength < 1 || idLength > MAX_KEY_ID_BYTES) throw new Error('BACKUP_ENCRYPTED_FORMAT_INVALID');
    const ivStart = MAGIC.length + 1 + idLength;
    const headerLength = ivStart + IV_BYTES;
    if (bytesRead < headerLength) throw new Error('BACKUP_ENCRYPTED_FORMAT_INVALID');
    const keyId = head.subarray(MAGIC.length + 1, ivStart).toString('utf8');
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error('BACKUP_ENCRYPTED_FORMAT_INVALID');
    return { headerLength, keyId, iv: Buffer.from(head.subarray(ivStart, headerLength)) };
  } finally { await handle.close(); }
}

export async function encryptBackupFile(plainPath: string, encryptedPath: string, env: NodeJS.ProcessEnv = process.env): Promise<{ size: number; keyId: string }> {
  const ring = parseBackupKeyRing(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', ring.keys[ring.activeKeyId]!, iv);
  const header = encodeHeader(ring.activeKeyId, iv);
  let created = false;
  try {
    const handle = await open(encryptedPath, 'wx', 0o600);
    created = true;
    try { await handle.writeFile(header); } finally { await handle.close(); }
    await pipeline(createReadStream(plainPath), cipher, createWriteStream(encryptedPath, { flags: 'a', mode: 0o600 }));
    const tagFile = await open(encryptedPath, 'a', 0o600);
    try { await tagFile.writeFile(cipher.getAuthTag()); } finally { await tagFile.close(); }
    if (process.platform !== 'win32') await chmod(encryptedPath, 0o600);
    const result = await stat(encryptedPath);
    if (!result.isFile() || result.size <= header.length + TAG_BYTES) throw new Error('BACKUP_ENCRYPTION_EMPTY');
    return { size: result.size, keyId: ring.activeKeyId };
  } catch (error) {
    if (created) await rm(encryptedPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function decryptBackupFile(encryptedPath: string, plainPath: string, env: NodeJS.ProcessEnv = process.env): Promise<{ keyId: string; size: number }> {
  const ring = parseBackupKeyRing(env);
  let created = false;
  try {
    const file = await stat(encryptedPath);
    if (!file.isFile()) throw new Error('BACKUP_ENCRYPTED_FORMAT_INVALID');
    const { headerLength, keyId, iv } = await readHeader(encryptedPath);
    const key = ring.keys[keyId];
    if (!key) throw new Error('BACKUP_ENCRYPTION_KEY_VERSION_UNAVAILABLE');
    if (file.size <= headerLength + TAG_BYTES) throw new Error('BACKUP_ENCRYPTED_FORMAT_INVALID');
    const handle = await open(encryptedPath, 'r');
    const tag = Buffer.alloc(TAG_BYTES);
    try {
      const { bytesRead } = await handle.read(tag, 0, TAG_BYTES, file.size - TAG_BYTES);
      if (bytesRead !== TAG_BYTES) throw new Error('BACKUP_ENCRYPTED_FORMAT_INVALID');
    } finally { await handle.close(); }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const output = await open(plainPath, 'wx', 0o600);
    await output.close();
    created = true;
    const cipherBytes = file.size - headerLength - TAG_BYTES;
    const input = createReadStream(encryptedPath, { start: headerLength, end: headerLength + cipherBytes - 1 });
    await pipeline(input as ReadStream, decipher, createWriteStream(plainPath, { flags: 'w', mode: 0o600 }));
    if (process.platform !== 'win32') await chmod(plainPath, 0o600);
    const result = await stat(plainPath);
    if (!result.isFile() || result.size <= 0) throw new Error('BACKUP_DECRYPTION_EMPTY');
    return { keyId, size: result.size };
  } catch (error) {
    if (created) await rm(plainPath, { force: true }).catch(() => undefined);
    if (error instanceof Error && ['BACKUP_ENCRYPTION_NOT_CONFIGURED','BACKUP_ENCRYPTION_KEYRING_INVALID','BACKUP_ENCRYPTION_ACTIVE_KEY_MISSING','BACKUP_ENCRYPTION_KEY_VERSION_UNAVAILABLE','BACKUP_ENCRYPTED_FORMAT_INVALID'].includes(error.message)) throw error;
    throw new Error('BACKUP_DECRYPTION_FAILED');
  }
}

