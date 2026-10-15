import { z } from 'zod';
import { REPORT_FIELD_LABELS, makeReportFields, reportCatalog, type ReportKey, type ReportField } from './report-data.js';

const cellSchema = z.string().max(240);
const columnSchema = z.object({
  id: z.string().min(1).max(100),
  fieldKey: z.string().max(160).nullable(),
  label: z.string().trim().min(1).max(80),
  width: z.number().int().min(8).max(60),
  visible: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  format: z.enum(['auto', 'text', 'number', 'money', 'date']),
  staticValue: z.string().max(160).default(''),
}).strict();
const rowSchema = z.object({ id: z.string().min(1).max(100), height: z.number().int().min(16).max(120), cells: z.array(cellSchema).max(40) }).strict();
const mergeSchema = z.object({ row: z.number().int().min(0).max(11), col: z.number().int().min(0).max(39), rowSpan: z.number().int().min(1).max(12), colSpan: z.number().int().min(1).max(40) }).strict();
const definitionSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().max(240),
  columns: z.array(columnSchema).min(1).max(40),
  customRows: z.array(rowSchema).max(12),
  merges: z.array(mergeSchema).max(80),
  rowHeights: z.object({ title: z.number().int().min(20).max(100), subtitle: z.number().int().min(16).max(80), header: z.number().int().min(18).max(80), body: z.number().int().min(15).max(60) }).strict(),
  page: z.object({ paper: z.enum(['A4', 'A3', 'Letter']), orientation: z.enum(['portrait', 'landscape']), fitToWidth: z.boolean(), repeatHeader: z.boolean(), includeDescription: z.boolean(), footerText: z.string().max(120), showPageNumber: z.boolean() }).strict(),
}).strict();

export type ReportTemplateColumn = z.infer<typeof columnSchema>;
export type ReportTemplateDefinition = z.infer<typeof definitionSchema>;
export type ReportTemplateScope = 'PERSONAL' | 'PROJECT' | 'SYSTEM';
export type ReportTemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export function createDefaultDefinition(reportKey: ReportKey): ReportTemplateDefinition {
  const report = reportCatalog.find((item) => item.key === reportKey)!;
  const fields: ReportField[] = makeReportFields(reportKey);
  return {
    schemaVersion: 1,
    title: report.label,
    subtitle: '项目：{project}　导出时间：{generatedAt}',
    columns: fields.map((field) => ({
      id: field.key, fieldKey: field.key, label: field.label, width: field.defaultWidth, visible: true,
      align: field.type === 'money' || field.type === 'number' ? 'right' : field.type === 'date' ? 'center' : 'left',
      format: field.type === 'money' ? 'money' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'auto',
      staticValue: '',
    })),
    customRows: [],
    merges: [],
    rowHeights: { title: 32, subtitle: 22, header: 28, body: 22 },
    page: { paper: 'A4', orientation: 'landscape', fitToWidth: true, repeatHeader: true, includeDescription: true, footerText: '墨衡工程经营管理系统', showPageNumber: true },
  };
}

export function validateReportTemplateDefinition(input: unknown, reportKey: ReportKey): { success: true; data: ReportTemplateDefinition } | { success: false; message: string; details?: unknown } {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: '报表模板结构不正确', details: parsed.error.flatten() };
  const definition = parsed.data;
  const allowedKeys = new Set(makeReportFields(reportKey).map((field) => field.key));
  const seenFields = new Set<string>();
  const seenIds = new Set<string>();
  if (!definition.columns.some((column) => column.visible)) return { success: false, message: '至少需要保留一列可见字段' };
  for (const column of definition.columns) {
    if (seenIds.has(column.id)) return { success: false, message: '模板列标识重复' };
    seenIds.add(column.id);
    if (column.fieldKey) {
      if (!allowedKeys.has(column.fieldKey)) return { success: false, message: '模板包含当前报表不允许的字段' };
      if (seenFields.has(column.fieldKey)) return { success: false, message: `字段“${REPORT_FIELD_LABELS[reportKey][Number(column.fieldKey.split(':field:')[1])] ?? column.fieldKey}”重复绑定` };
      seenFields.add(column.fieldKey);
    }
  }
  for (const row of definition.customRows) {
    if (row.cells.length !== definition.columns.length) return { success: false, message: '自定义行的单元格数量必须与模板列数一致' };
  }
  const cellGrid = new Set<string>();
  for (const merge of definition.merges) {
    if (merge.row + merge.rowSpan > definition.customRows.length || merge.col + merge.colSpan > definition.columns.length) {
      return { success: false, message: '合并区域超出自定义版式的行列范围' };
    }
    if (merge.rowSpan === 1 && merge.colSpan === 1) return { success: false, message: '合并区域至少需要包含两个单元格' };
    for (let r = merge.row; r < merge.row + merge.rowSpan; r += 1) {
      for (let c = merge.col; c < merge.col + merge.colSpan; c += 1) {
        const key = `${r}:${c}`;
        if (cellGrid.has(key)) return { success: false, message: '合并区域不能互相重叠' };
        cellGrid.add(key);
      }
    }
  }
  return { success: true, data: definition };
}

export function isTemplateDefinition(input: unknown): input is ReportTemplateDefinition {
  return definitionSchema.safeParse(input).success;
}
