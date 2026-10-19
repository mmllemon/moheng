export type ReportStudioDomain = 'PROJECT' | 'COMPANY' | 'PARTY';
export type ReportStudioScope = 'PERSONAL' | 'PROJECT' | 'SYSTEM';
export type ReportStudioFieldType = 'TEXT' | 'NUMBER' | 'MONEY' | 'DATE' | 'BOOLEAN';
export interface ReportStudioField { id: string; label: string; type: ReportStudioFieldType; description?: string }
export interface ReportStudioSource { id: string; label: string; cardinality: 'ONE' | 'MANY'; domains: ReportStudioDomain[]; description: string; fields: ReportStudioField[] }
export interface ReportStudioBinding { id: string; sheetId: string; cell: string; sourceId: string; fieldId: string; format: 'AUTO' | 'TEXT' | 'NUMBER' | 'MONEY' | 'DATE' }
export interface ReportStudioRegion { id: string; sheetId: string; sourceId: string; templateRow: number; startColumn: number; endColumn: number; maxRows: number }
export interface ReportStudioDefinition {
  schemaVersion: 2;
  domain: ReportStudioDomain;
  title: string;
  description: string;
  workbook: Record<string, unknown>;
  bindings: ReportStudioBinding[];
  regions: ReportStudioRegion[];
  page: { paper: 'A4' | 'A3' | 'Letter'; orientation: 'portrait' | 'landscape'; fitToWidth: boolean; includeMetadata: boolean; footerText: string };
}
export interface ReportStudioTemplate {
  id: string; reportKey: string; domain: ReportStudioDomain | null; name: string; description: string; scope: ReportStudioScope;
  projectId: string | null; businessPartyId?: string | null; ownerUserId: string | null; version: number; publishedVersion: number | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; definition: ReportStudioDefinition;
  editable?: boolean; createdAt: string; updatedAt: string;
}
export interface ReportStudioPreviewSheet {
  id: string; name: string; rowCount: number; previewRowCount: number; truncated: boolean; frozenRows?: number; frozenColumns?: number;
  rows: Array<Array<{ value: unknown; style: Record<string, unknown> | null; format: string | null }>>;
  rowHeights: Record<number, number>; columnWidths: Record<number, number>;
  merges: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }>;
}
export interface ReportStudioPreview {
  title: string; domain: ReportStudioDomain; generatedAt: string; projectId: string | null; warnings: string[]; truncated: boolean; sheets: ReportStudioPreviewSheet[];
}
