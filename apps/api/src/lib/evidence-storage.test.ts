import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { readEvidenceFile, storeEvidenceFiles } from './evidence-storage.js';

let testRoot = '';
const previousEvidenceDir = process.env.EVIDENCE_STORAGE_DIR;
before(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'cms-evidence-storage-'));
  process.env.EVIDENCE_STORAGE_DIR = testRoot;
});
after(async () => {
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  if (previousEvidenceDir === undefined) delete process.env.EVIDENCE_STORAGE_DIR;
  else process.env.EVIDENCE_STORAGE_DIR = previousEvidenceDir;
});

const pdfBase64 = () => Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n').toString('base64');

test('stores the original evidence and verifies its SHA-256 on read', async () => {
  const files = await storeEvidenceFiles('project-1', 'change-1', [
    { fileName: 'owner-confirmation.pdf', mimeType: 'application/pdf', contentBase64: pdfBase64() },
  ], 'user-1');
  const file = files[0];
  assert.ok(file);
  const bytes = await readEvidenceFile(file);
  assert.equal(bytes.toString('ascii'), Buffer.from(pdfBase64(), 'base64').toString('ascii'));
  assert.equal(file.sha256.length, 64);
});

test('refuses to return an evidence file if stored bytes change', async () => {
  const files = await storeEvidenceFiles('project-1', 'change-2', [
    { fileName: 'confirmation.pdf', mimeType: 'application/pdf', contentBase64: pdfBase64() },
  ], 'user-1');
  const file = files[0];
  assert.ok(file);
  await writeFile(resolve(testRoot, file.storageKey), Buffer.from('tampered'));
  await assert.rejects(() => readEvidenceFile(file), { message: 'EVIDENCE_FILE_INTEGRITY_FAILED' });
});

test('rejects a PDF extension whose content does not have a PDF signature', async () => {
  await assert.rejects(() => storeEvidenceFiles('project-1', 'change-3', [
    { fileName: 'not-a-pdf.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('plain text').toString('base64') },
  ], 'user-1'), /EVIDENCE_FILE_SIGNATURE_INVALID/);
});

test('rejects MIME types that do not match the filename extension', async () => {
  await assert.rejects(() => storeEvidenceFiles('project-1', 'change-4', [
    { fileName: 'evidence.pdf', mimeType: 'text/plain', contentBase64: pdfBase64() },
  ], 'user-1'), /EVIDENCE_FILE_TYPE_NOT_ALLOWED/);
});


test('rejects a supported MIME type paired with an unsupported executable-looking extension', async () => {
  await assert.rejects(() => storeEvidenceFiles('project-1', 'change-5', [
    { fileName: 'owner-confirmation.exe', mimeType: 'application/pdf', contentBase64: pdfBase64() },
  ], 'user-1'), /EVIDENCE_FILE_TYPE_NOT_ALLOWED/);
});
