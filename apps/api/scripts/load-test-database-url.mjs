import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
let envText = '';
try {
  envText = await readFile(envPath, 'utf8');
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    // Shell-provided DATABASE_URL remains valid when no local env file exists.
  } else {
    throw error;
  }
}

// Only import the database URL needed to initialize the Prisma adapter during
// unit/static tests. Do not load production NODE_ENV, JWT keys, or other secrets.
if (!process.env.DATABASE_URL?.trim() && envText) {
  const configuredDatabaseUrl = dotenv.parse(envText).DATABASE_URL?.trim();
  if (configuredDatabaseUrl) process.env.DATABASE_URL = configuredDatabaseUrl;
}
