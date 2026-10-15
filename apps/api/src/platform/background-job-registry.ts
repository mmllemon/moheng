import type { BackgroundJobHandler } from '../lib/background-job-types.js';
import { reportXlsxExportJobHandler } from '../lib/report-export-job.js';

/** Stable task type registry. Add handlers/adapters here without changing queue storage or domain rules. */
export const backgroundJobHandlers: ReadonlyMap<string, BackgroundJobHandler> = new Map([
  ['report.xlsx.export', reportXlsxExportJobHandler],
]);
