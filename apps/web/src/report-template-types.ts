export type ReportFieldType = 'text' | 'number' | 'money' | 'date';
export interface ReportField { key: string; label: string; type: ReportFieldType; defaultWidth: number }
export interface ReportCatalogEntry { key: string; label: string; description: string; dateField: string; rowLimit: number; fields: ReportField[] }
export interface ReportTemplateColumn {
  id: string;
  fieldKey: string | null;
  label: string;
  width: number;
  visible: boolean;
  align: 'left' | 'center' | 'right';
  format: 'auto' | 'text' | 'number' | 'money' | 'date';
  staticValue: string;
}
export interface ReportTemplateRow { id: string; height: number; cells: string[] }
export interface ReportTemplateMerge { row: number; col: number; rowSpan: number; colSpan: number }
export interface ReportTemplateDefinition {
  schemaVersion: 1;
  title: string;
  subtitle: string;
  columns: ReportTemplateColumn[];
  customRows: ReportTemplateRow[];
  merges: ReportTemplateMerge[];
  rowHeights: { title: number; subtitle: number; header: number; body: number };
  page: { paper: 'A4' | 'A3' | 'Letter'; orientation: 'portrait' | 'landscape'; fitToWidth: boolean; repeatHeader: boolean; includeDescription: boolean; footerText: string; showPageNumber: boolean };
}
export type ReportTemplateScope = 'PERSONAL' | 'PROJECT' | 'SYSTEM';
export type ReportTemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export interface ReportTemplateSummary {
  id: string; reportKey: string; name: string; description: string; scope: ReportTemplateScope; projectId: string | null;
  version: number; publishedVersion: number | null; status: ReportTemplateStatus; updatedAt: string; createdById: string;
  ownerUserId: string | null; editable: boolean;
}
export interface ReportTemplateDetail extends ReportTemplateSummary {
  definition: ReportTemplateDefinition;
  publishedDefinition: ReportTemplateDefinition | null;
  editable: boolean;
}
export interface ReportPreview {
  report: Omit<ReportCatalogEntry, 'fields'>;
  fields: ReportField[];
  rows: unknown[][];
  rowCount: number;
  previewRowCount: number;
  truncated: boolean;
  generatedAt: string;
  projectScope: string;
  filters: { projectId?: string; from?: string; to?: string };
  template: { id: string | null; name: string; version: number; scope: string; status: string; definition: ReportTemplateDefinition };
}
export interface TemplateRevision { id: string; version: number; action: string; createdById: string; createdAt: string }
