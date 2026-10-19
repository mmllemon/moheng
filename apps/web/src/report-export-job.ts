export type ReportExportJobDisposition = 'pending' | 'failed' | 'downloadable' | 'completed-unavailable';

export interface ReportExportJobSnapshot {
  status: string;
  resultAvailable?: boolean;
  downloadUrl?: string | null;
}

/**
 * A successful background job is not downloadable until the server confirms
 * that the artifact still exists and exposes an authorized download URL.
 */
export function classifyReportExportJob(job: ReportExportJobSnapshot): ReportExportJobDisposition {
  if (job.status === 'FAILED' || job.status === 'CANCELLED') return 'failed';
  if (job.status !== 'SUCCEEDED') return 'pending';
  return job.resultAvailable === true && typeof job.downloadUrl === 'string' && job.downloadUrl.length > 0
    ? 'downloadable'
    : 'completed-unavailable';
}
