import { isAbsolute, relative, resolve, sep, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const POC_REPO_ROOT = resolve(moduleDirectory, '../../..');

export function resolvePocRepoPath(pathValue) {
  return resolve(POC_REPO_ROOT, pathValue);
}

function isWithin(childPath, rootPath) {
  const child = resolve(childPath);
  const root = resolve(rootPath);
  const rel = relative(root, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Confine experiment SQLite files to the PoC data folder or the OS temp folder.
 * Relative input paths are resolved from the repository root, irrespective of npm --prefix cwd.
 */
export function assertSafePocSqlitePath(pathValue) {
  const filePath = resolve(POC_REPO_ROOT, pathValue);
  const allowedRoots = [resolve(POC_REPO_ROOT, 'experiments/pi-durable-poc/.data'), resolve(tmpdir())];
  if (!allowedRoots.some((root) => isWithin(filePath, root))) {
    throw new Error('PoC SQLite path must stay under experiments/pi-durable-poc/.data or the OS temp folder');
  }
  if (!/\.sqlite(?:3)?$/i.test(basename(filePath))) {
    throw new Error('PoC SQLite filename must end with .sqlite or .sqlite3');
  }
  const webDist = resolve(POC_REPO_ROOT, 'apps/web/dist');
  if (isWithin(filePath, webDist)) throw new Error('Refusing to store agent data inside the Web static directory');
  return filePath;
}
