import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptMfaSecret, encryptMfaSecret, generateRecoveryCodes, hashRecoveryCode, loginKeyHash, newTotpSecret, sessionConfig, verifyTotp } from './auth.js';

test('TOTP verifier accepts the RFC 6238 SHA-1 six-digit vector and rejects invalid codes', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII: 12345678901234567890
  assert.equal(verifyTotp(secret, '287082', 59_000), 1n);
  assert.equal(verifyTotp(secret, '287082', 60_000), 1n); // one-step drift is tolerated
  assert.equal(verifyTotp(secret, '000000', 59_000), null);
  assert.equal(verifyTotp(secret, '12345', 59_000), null);
});

test('TOTP secrets are cryptographically random base32 strings', () => {
  const a = newTotpSecret();
  const b = newTotpSecret();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.notEqual(a, b);
});

test('MFA secret encryption is authenticated and decrypts only with the configured key', () => {
  const previous = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    const secret = 'MZXW6YTBOI======';
    const encrypted = encryptMfaSecret(secret);
    assert.notEqual(encrypted, secret);
    assert.equal(decryptMfaSecret(encrypted), secret);
    const last = encrypted.at(-1)!;
    const tampered = `${encrypted.slice(0, -1)}${last === '0' ? '1' : '0'}`;
    assert.throws(() => decryptMfaSecret(tampered));
  } finally {
    if (previous === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = previous;
  }
});

test('recovery codes are one-time high-entropy values and hashes normalize separators', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.ok(codes.every((code) => /^[A-F0-9]{16}$/.test(code)));
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(hashRecoveryCode('abcd-1234'), hashRecoveryCode('ABCD 1234'));
  assert.match(hashRecoveryCode(codes[0]!), /^[a-f0-9]{64}$/);
});


test('recovery-code hashes remain stable if the JWT signing key is rotated', () => {
  const oldMfaKey = process.env.MFA_ENCRYPTION_KEY;
  const oldJwtSecret = process.env.JWT_SECRET;
  process.env.MFA_ENCRYPTION_KEY = '12'.repeat(32);
  process.env.JWT_SECRET = 'jwt-signing-key-before-rotation-0123456789';
  try {
    const before = hashRecoveryCode('ABCD-1234');
    process.env.JWT_SECRET = 'jwt-signing-key-after-rotation-9876543210';
    assert.equal(hashRecoveryCode('ABCD 1234'), before);
  } finally {
    if (oldMfaKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = oldMfaKey;
    if (oldJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldJwtSecret;
  }
});


test('public web sessions have bounded absolute and idle expiry', () => {
  assert.equal(sessionConfig.sessionMaxAgeMs, 7 * 24 * 60 * 60 * 1000);
  assert.equal(sessionConfig.sessionIdleTimeoutMs, 12 * 60 * 60 * 1000);
  assert.equal(sessionConfig.refreshMaxAgeMs, 7 * 24 * 60 * 60 * 1000);
});


test('login rate-limit hashes remain stable when the JWT signing secret rotates', () => {
  const oldPublicUrl = process.env.PUBLIC_BASE_URL;
  const oldDedicatedKey = process.env.LOGIN_ATTEMPT_HMAC_KEY;
  const oldJwtSecret = process.env.JWT_SECRET;
  delete process.env.PUBLIC_BASE_URL;
  process.env.LOGIN_ATTEMPT_HMAC_KEY = 'a1'.repeat(32);
  process.env.JWT_SECRET = 'jwt-secret-before-rotation-123456789012';
  try {
    const before = loginKeyHash('email', 'admin@example.test');
    process.env.JWT_SECRET = 'jwt-secret-after-rotation-1234567890123';
    assert.equal(loginKeyHash('email', 'admin@example.test'), before);
    process.env.LOGIN_ATTEMPT_HMAC_KEY = 'b2'.repeat(32);
    assert.notEqual(loginKeyHash('email', 'admin@example.test'), before);
  } finally {
    if (oldPublicUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicUrl;
    if (oldDedicatedKey === undefined) delete process.env.LOGIN_ATTEMPT_HMAC_KEY;
    else process.env.LOGIN_ATTEMPT_HMAC_KEY = oldDedicatedKey;
    if (oldJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldJwtSecret;
  }
});

test('malformed encrypted MFA secret segments fail with a format error before AES-GCM processing', () => {
  const previous = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = 'cd'.repeat(32);
  try {
    assert.throws(() => decryptMfaSecret('v1::::'), /unsupported format/i);
    assert.throws(() => decryptMfaSecret('v1:00:00000000000000000000000000000000:abcd'), /unsupported format/i);
  } finally {
    if (previous === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = previous;
  }
});
