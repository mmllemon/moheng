import type { BackgroundJobHandler } from '../lib/background-job-types.js';
import { reportXlsxExportJobHandler } from '../lib/report-export-job.js';
import { reportStudioXlsxExportJobHandler } from '../lib/report-studio-export-job.js';
import { integrationDispatchJobHandler } from '../lib/integration-dispatch-job.js';
import { assistantAgentRunJobHandler } from '../lib/assistant-agent-run-job.js';

/** Stable task type registry. Add handlers/adapters here without changing queue storage or domain rules. */
export const backgroundJobHandlers: ReadonlyMap<string, BackgroundJobHandler> = new Map([
  ['report.xlsx.export', reportXlsxExportJobHandler],
  ['report.studio.xlsx.export', reportStudioXlsxExportJobHandler],
  ['integration.json.dispatch', integrationDispatchJobHandler],
  ['assistant.agent.run', assistantAgentRunJobHandler],
]);
