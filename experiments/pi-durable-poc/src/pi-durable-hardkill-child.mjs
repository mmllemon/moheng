import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { defineDoc, createRegistry, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';

const storagePath = process.argv[2];
if (!storagePath) throw new Error('storage path required');
const ProbeDoc = defineDoc({
  kind: 'moheng.poc.hardkill-smoke',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ marker: '', committedAt: '' }),
});
const harness = await Harness.open(await openNodeSqliteStorage(storagePath), { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
const root = await harness.root(BACKGROUND_CONTEXT);
await root.commit(async (tx) => {
  const doc = await tx.doc(ProbeDoc, root.id);
  doc.marker = `hardkill-proof-${Date.now()}`;
  doc.committedAt = new Date().toISOString();
}, BACKGROUND_CONTEXT);
const response = { conversationId: root.id, marker: (await harness.snapshot(ProbeDoc, root.id, BACKGROUND_CONTEXT))?.marker };
await new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(response)}\n`, (error) => error ? reject(error) : resolve()));
// Parent terminates this process without Harness.close to test persistence after abrupt process exit.
await new Promise(() => {});
