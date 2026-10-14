import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, resolve, sep } from 'node:path';

export type EvidenceUploadInput = { fileName: string; mimeType: string; contentBase64: string };
export type EvidenceFileMetadata = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  uploadedById: string;
  uploadedAt: string;
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const mimeToExtension: Record<string, { extension: string; mimeType: string }> = {
  'application/pdf': { extension: '.pdf', mimeType: 'application/pdf' },
  'image/png': { extension: '.png', mimeType: 'image/png' },
  'image/jpeg': { extension: '.jpg', mimeType: 'image/jpeg' },
  'image/webp': { extension: '.webp', mimeType: 'image/webp' },
  'text/plain': { extension: '.txt', mimeType: 'text/plain' },
  'message/rfc822': { extension: '.eml', mimeType: 'message/rfc822' },
};
const extensionToMime: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.txt': 'text/plain', '.eml': 'message/rfc822',
};

function storageRoot(): string {
  const configured = process.env.EVIDENCE_STORAGE_DIR?.trim();
  return resolve(configured || resolve(process.cwd(), 'data', 'evidence'));
}

function safeFileName(value: string): string {
  const leaf = basename(value.replace(/[\\/]/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (leaf || 'evidence-file').slice(0, 180);
}

function decodeUpload(upload: EvidenceUploadInput): { bytes: Buffer; fileName: string; mimeType: string; extension: string } {
  const fileName = safeFileName(upload.fileName);
  const ext = extname(fileName).toLowerCase();
  const providedType = upload.mimeType.trim().toLowerCase().split(';')[0];
  const inferredType = extensionToMime[ext];
  if (providedType && !mimeToExtension[providedType] && providedType !== 'application/octet-stream') {
    throw new Error(`EVIDENCE_FILE_TYPE_NOT_ALLOWED:${fileName}`);
  }
  // If a filename includes an extension, it must be one of the explicitly
  // supported evidence extensions and agree with the declared MIME family.
  // Otherwise a PDF uploaded as "something.exe" would be stored as .pdf but
  // downloaded under the misleading .exe name.
  if (ext && (!inferredType || (providedType && mimeToExtension[providedType] && inferredType !== mimeToExtension[providedType].mimeType))) {
    throw new Error(`EVIDENCE_FILE_TYPE_NOT_ALLOWED:${fileName}`);
  }
  const canonical = providedType && mimeToExtension[providedType]
    ? mimeToExtension[providedType]
    : inferredType ? { extension: ext === '.jpeg' ? '.jpg' : ext, mimeType: inferredType } : null;
  if (!canonical) throw new Error(`EVIDENCE_FILE_TYPE_NOT_ALLOWED:${fileName}`);
  if (inferredType && inferredType !== canonical.mimeType) throw new Error(`EVIDENCE_FILE_TYPE_NOT_ALLOWED:${fileName}`);
  // Keep the file extension consistent with the allowed MIME family. A browser may
  // report an empty or generic MIME type for .eml, so extension inference is allowed.
  const bytes = Buffer.from(upload.contentBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error(`EVIDENCE_FILE_SIZE_INVALID:${fileName}`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(upload.contentBase64) || bytes.toString('base64').replace(/=+$/, '') !== upload.contentBase64.replace(/=+$/, '')) {
    throw new Error(`EVIDENCE_FILE_BASE64_INVALID:${fileName}`);
  }
  const startsWith = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const validSignature = canonical.mimeType === 'application/pdf' ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    : canonical.mimeType === 'image/png' ? startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : canonical.mimeType === 'image/jpeg' ? startsWith(0xff, 0xd8, 0xff)
    : canonical.mimeType === 'image/webp' ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    : true;
  if (!validSignature) throw new Error(`EVIDENCE_FILE_SIGNATURE_INVALID:${fileName}`);
  return { bytes, fileName, mimeType: canonical.mimeType, extension: canonical.extension };
}

export async function storeEvidenceFiles(
  projectId: string,
  changeId: string,
  uploads: EvidenceUploadInput[],
  uploadedById: string,
): Promise<EvidenceFileMetadata[]> {
  if (!uploads.length || uploads.length > 8) throw new Error('EVIDENCE_FILE_COUNT_INVALID');
  const decoded = uploads.map(decodeUpload);
  const total = decoded.reduce((sum, item) => sum + item.bytes.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error('EVIDENCE_TOTAL_SIZE_EXCEEDED');

  const root = storageRoot();
  const directory = resolve(root, projectId, changeId);
  if (!directory.startsWith(`${root}${sep}`)) throw new Error('EVIDENCE_STORAGE_PATH_INVALID');
  await mkdir(directory, { recursive: true });
  const stored: EvidenceFileMetadata[] = [];
  try {
    for (const item of decoded) {
      const id = randomUUID();
      const storageKey = `${projectId}/${changeId}/${id}${item.extension}`;
      const fullPath = resolve(root, storageKey);
      if (!fullPath.startsWith(`${root}${sep}`) || isAbsolute(storageKey)) throw new Error('EVIDENCE_STORAGE_PATH_INVALID');
      await writeFile(fullPath, item.bytes, { flag: 'wx', mode: 0o600 });
      stored.push({
        id,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: item.bytes.length,
        sha256: createHash('sha256').update(item.bytes).digest('hex'),
        storageKey,
        uploadedById,
        uploadedAt: new Date().toISOString(),
      });
    }
    return stored;
  } catch (error) {
    await removeEvidenceFiles(stored);
    throw error;
  }
}

export async function removeEvidenceFiles(files: EvidenceFileMetadata[]): Promise<void> {
  const root = storageRoot();
  await Promise.all(files.map(async (file) => {
    const fullPath = resolve(root, file.storageKey);
    if (!fullPath.startsWith(`${root}${sep}`)) return;
    try { await unlink(fullPath); } catch { /* best effort cleanup after a failed transaction */ }
  }));
}

export async function readEvidenceFile(file: EvidenceFileMetadata): Promise<Buffer> {
  const root = storageRoot();
  const fullPath = resolve(root, file.storageKey);
  if (!fullPath.startsWith(`${root}${sep}`)) throw new Error('EVIDENCE_STORAGE_PATH_INVALID');
  const bytes = await readFile(fullPath);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== file.sha256 || bytes.length !== file.sizeBytes) throw new Error('EVIDENCE_FILE_INTEGRITY_FAILED');
  return bytes;
}

export function publicEvidenceFile(file: EvidenceFileMetadata) {
  return { id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256, uploadedById: file.uploadedById, uploadedAt: file.uploadedAt };
}
