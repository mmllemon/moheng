import 'dotenv/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const connectionString = process.env.ASSISTANT_CHECKPOINT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('ASSISTANT_CHECKPOINT_DATABASE_URL or DATABASE_URL is required');
if (process.env.ASSISTANT_CHECKPOINT_SETUP_ALLOW !== 'true' && process.env.NODE_ENV !== 'test') {
  throw new Error('Checkpoint DDL requires ASSISTANT_CHECKPOINT_SETUP_ALLOW=true or NODE_ENV=test');
}

const saver = PostgresSaver.fromConnString(connectionString, { schema: 'moheng_assistant' });
try {
  await saver.setup();
  // Do not print the connection string, credentials, schema DDL, or provider keys.
  console.log(JSON.stringify({ result: 'READY', schema: 'moheng_assistant', checkpointStore: 'PostgreSQL' }, null, 2));
} finally {
  await saver.end().catch(() => undefined);
}
