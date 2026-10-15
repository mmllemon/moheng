import { resolve, sep } from 'node:path';

export function backgroundJobStorageRoot(): string {
  return resolve(process.env.BACKGROUND_JOB_STORAGE_DIR || resolve(process.cwd(), 'data/jobs'));
}

export function backgroundJobArtifactPath(fileName: string): string {
  if (!fileName || fileName !== fileName.split(/[\\/]/).at(-1) || !/^[A-Za-z0-9._-]+$/.test(fileName) || fileName === '.' || fileName === '..') {
    throw new Error('INVALID_BACKGROUND_JOB_ARTIFACT_NAME');
  }
  const root = backgroundJobStorageRoot();
  const path = resolve(root, fileName);
  if (!path.startsWith(`${root}${sep}`)) throw new Error('BACKGROUND_JOB_ARTIFACT_PATH_INVALID');
  return path;
}
