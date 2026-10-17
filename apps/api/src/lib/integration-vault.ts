import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedSecret = { ciphertext: string; iv: string; authTag: string };

function readEncryptionKey(keyHex = process.env.INTEGRATION_ENCRYPTION_KEY): Buffer {
  if (!keyHex || !/^[a-fA-F0-9]{64}$/.test(keyHex)) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY_MISSING_OR_INVALID');
  }
  return Buffer.from(keyHex, 'hex');
}

function aadFor(integrationCode: string, secretVersion: number): Buffer {
  return Buffer.from(`moheng-integration:${integrationCode}:secret-v${secretVersion}`, 'utf8');
}

export function encryptIntegrationSecret(secret: string, integrationCode: string, secretVersion: number, keyHex?: string): EncryptedSecret {
  if (!secret || secret.length > 4096) throw new Error('INTEGRATION_SECRET_INVALID');
  const key = readEncryptionKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(integrationCode, secretVersion));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}

/** For adapter implementations only; management endpoints intentionally never return decrypted secrets. */
export function decryptIntegrationSecret(value: EncryptedSecret, integrationCode: string, secretVersion: number, keyHex?: string): string {
  const key = readEncryptionKey(keyHex);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'hex'));
  decipher.setAAD(aadFor(integrationCode, secretVersion));
  decipher.setAuthTag(Buffer.from(value.authTag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
