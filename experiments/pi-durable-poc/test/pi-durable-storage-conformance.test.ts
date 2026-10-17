import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerStorageConformance } from '@earendil-works/pi-durable/testing';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { describe, expect, it } from 'vitest';

registerStorageConformance({ describe, expect, it }, 'Pi Durable built-in Node SQLite', async (use) => {
  const directory = await mkdtemp(join(tmpdir(), 'moheng-pi-conformance-'));
  const storage = await openNodeSqliteStorage(join(directory, 'storage.sqlite'));
  try {
    await use(storage);
  } finally {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
