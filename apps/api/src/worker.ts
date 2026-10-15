import 'dotenv/config';
import Fastify from 'fastify';
import { prisma } from './lib/prisma.js';
import { startBackgroundWorker } from './lib/background-job-worker.js';

const host = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
let stopWorker: (() => Promise<void>) | null = null;
let shutdownStarted = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  host.log.info({ signal }, 'Stopping standalone background worker');
  try {
    await stopWorker?.();
    await host.close();
    await prisma.$disconnect();
    process.exitCode = 0;
  } catch (error) {
    host.log.error({ err: error }, 'Standalone worker shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

try {
  await prisma.$connect();
  stopWorker = startBackgroundWorker(host.log, {
    pollIntervalMs: Math.max(250, Math.min(60_000, Number(process.env.BACKGROUND_JOB_POLL_MS) || 1000)),
  });
  host.log.info('Standalone PostgreSQL background worker is ready');
} catch (error) {
  host.log.error({ err: error }, 'Standalone background worker failed to start');
  await prisma.$disconnect();
  process.exitCode = 1;
}
