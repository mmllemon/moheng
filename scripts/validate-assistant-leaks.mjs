import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scanAssistantLeakArtifacts } from './lib/assistant-leak-guard.mjs';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const logPath = arg('--logs');
const eventPath = arg('--events');
const markersPath = arg('--markers');
if (!logPath || !eventPath) {
  console.error('Usage: node scripts/validate-assistant-leaks.mjs --logs <runtime-log.txt> --events <assistant-events.jsonl> [--markers <forbidden-values.txt>]');
  process.exit(2);
}
const [logs, events, markers] = await Promise.all([
  readFile(resolve(logPath), 'utf8'),
  readFile(resolve(eventPath), 'utf8'),
  markersPath ? readFile(resolve(markersPath), 'utf8').catch(() => '') : Promise.resolve(''),
]);
const result = scanAssistantLeakArtifacts({ logs, events, forbiddenValues: markers.split(/\r?\n/) });
for (const finding of result.findings) console.error(`FAIL ${finding}`);
if (!result.ok) process.exit(1);
console.log('PASS assistant runtime log + persisted event leak gate');
console.log(`Events inspected: ${events.trim() ? events.trim().split(/\r?\n/).length : 0}`);
console.log('Checks: credential patterns, explicit markers, event type/payload allowlist, source metadata schema.');
