import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
// Loads only local environment files to detect/reject the main business DATABASE_URL.
// Explicit shell variables always win; the file is never printed to logs.
dotenv.config({ path: resolve(repoRoot, '.env'), quiet: true });
dotenv.config({ path: resolve(repoRoot, 'apps/api/.env'), override: false, quiet: true });
