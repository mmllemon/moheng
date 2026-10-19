export interface StandardReportPrintFilters {
  projectId?: string;
  from?: string;
  to?: string;
  templateId?: string;
}

/** Print requests must explicitly ask the server for the full, bounded snapshot. */
export function buildStandardReportPrintUrl(reportKey: string, filters: StandardReportPrintFilters): string {
  const params = new URLSearchParams();
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.templateId) params.set('templateId', filters.templateId);
  params.set('printAll', 'true');
  return `/reports/${encodeURIComponent(reportKey)}/preview?${params.toString()}`;
}

/** Describe the actual bounded print response, never the older screen preview. */
export function describeStandardPrintResult(rowCount: number, truncated: boolean): string {
  const count = rowCount.toLocaleString('zh-CN');
  return truncated
    ? `已准备 ${count} 行打印数据；已达到服务端导出上限，内容可能不完整，请缩小筛选范围后分批打印。`
    : `已准备 ${count} 行完整打印数据。`;
}

export type StudioPrintDomain = 'PROJECT' | 'COMPANY' | 'PARTY';

export interface StudioReportPrintContext {
  templateId: string;
  domain: StudioPrintDomain;
  projectId?: string;
  businessPartyId?: string;
}

/** Build the strict preview API body without carrying stale, unrelated scope IDs. */
export function buildStudioReportPrintRequest(input: StudioReportPrintContext) {
  return {
    templateId: input.templateId,
    ...(input.domain === 'PROJECT' && input.projectId ? { projectId: input.projectId } : {}),
    ...(input.domain === 'PARTY' && input.businessPartyId ? { businessPartyId: input.businessPartyId } : {}),
    printAll: true as const,
  };
}
