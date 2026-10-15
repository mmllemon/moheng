import { z } from 'zod';
import { reportStudioSources, type ReportStudioDomain, type ReportStudioSource } from './report-studio-data.js';

export const STUDIO_REPORT_KEYS = {
  PROJECT: 'studio.project',
  COMPANY: 'studio.company',
} as const;
export type StudioReportKey = typeof STUDIO_REPORT_KEYS[keyof typeof STUDIO_REPORT_KEYS];

const bindingSchema = z.object({
  id: z.string().min(1).max(100),
  sheetId: z.string().min(1).max(100),
  cell: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,3}$/),
  sourceId: z.string().min(1).max(100),
  fieldId: z.string().min(1).max(100),
  format: z.enum(['AUTO', 'TEXT', 'NUMBER', 'MONEY', 'DATE']).default('AUTO'),
}).strict();

const regionSchema = z.object({
  id: z.string().min(1).max(100),
  sheetId: z.string().min(1).max(100),
  sourceId: z.string().min(1).max(100),
  templateRow: z.number().int().min(0).max(399),
  startColumn: z.number().int().min(0).max(39),
  endColumn: z.number().int().min(0).max(39),
  maxRows: z.number().int().min(1).max(10000).default(10000),
}).strict();

const pageSchema = z.object({
  paper: z.enum(['A4', 'A3', 'Letter']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('landscape'),
  fitToWidth: z.boolean().default(true),
  includeMetadata: z.boolean().default(true),
  footerText: z.string().max(180).default('墨衡工程经营管理系统'),
}).strict();

const definitionSchema = z.object({
  schemaVersion: z.literal(2),
  domain: z.enum(['PROJECT', 'COMPANY']),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(500).default(''),
  workbook: z.record(z.string(), z.unknown()),
  bindings: z.array(bindingSchema).max(500),
  regions: z.array(regionSchema).max(30),
  page: pageSchema,
}).strict();

export type ReportStudioBinding = z.infer<typeof bindingSchema>;
export type ReportStudioRegion = z.infer<typeof regionSchema>;
export type ReportStudioDefinition = z.infer<typeof definitionSchema>;
export type ReportStudioValidation = { success: true; data: ReportStudioDefinition } | { success: false; message: string; details?: unknown };

export interface StudioCellData {
  v?: unknown;
  s?: unknown;
  f?: unknown;
  [key: string]: unknown;
}
export interface StudioSheetData {
  id?: string;
  name?: string;
  rowCount?: number;
  columnCount?: number;
  cellData?: Record<string, Record<string, StudioCellData>>;
  mergeData?: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }>;
  rowData?: Record<string, { h?: number; [key: string]: unknown }>;
  columnData?: Record<string, { w?: number; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface StudioWorkbookData {
  id?: string;
  name?: string;
  appVersion?: string;
  locale?: string;
  sheetOrder: string[];
  sheets: Record<string, StudioSheetData>;
  styles?: Record<string, Record<string, unknown>> | unknown[];
  [key: string]: unknown;
}

function parseA1(cell: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9]\d{0,3})$/.exec(cell);
  if (!match) throw new Error('REPORT_STUDIO_CELL_INVALID');
  const letters = match[1]!;
  let column = 0;
  for (const char of letters) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function getSources(domain: ReportStudioDomain): Readonly<ReportStudioSource[]> {
  return reportStudioSources.filter((source) => source.domains.includes(domain));
}

/** Validate editor snapshots as inert workbook data: formulas and executable/external resources are not accepted. */
function validateWorkbook(workbookInput: Record<string, unknown>): { success: true; workbook: StudioWorkbookData } | { success: false; message: string } {
  if (JSON.stringify(workbookInput).length > 1_500_000) return { success: false, message: '工作簿模板超过 1.5 MB 限制' };
  const workbook = workbookInput as unknown as StudioWorkbookData;
  if (!Array.isArray(workbook.sheetOrder) || !workbook.sheetOrder.length || workbook.sheetOrder.length > 8) {
    return { success: false, message: '工作簿必须包含 1–8 张工作表' };
  }
  if (!workbook.sheets || typeof workbook.sheets !== 'object' || Array.isArray(workbook.sheets)) {
    return { success: false, message: '工作表结构无效' };
  }
  const seenSheetIds = new Set<string>();
  let cellCount = 0;
  for (const sheetId of workbook.sheetOrder) {
    if (seenSheetIds.has(sheetId) || !Object.hasOwn(workbook.sheets, sheetId)) return { success: false, message: '工作表目录存在重复或丢失的工作表' };
    seenSheetIds.add(sheetId);
    const sheet = workbook.sheets[sheetId];
    if (!sheet || typeof sheet !== 'object') return { success: false, message: '工作表定义无效' };
    const rowCount = Number(sheet.rowCount ?? 200);
    const columnCount = Number(sheet.columnCount ?? 20);
    if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 400 || !Number.isInteger(columnCount) || columnCount < 1 || columnCount > 40) {
      return { success: false, message: '每张工作表最多 400 行、40 列' };
    }
    if (sheet.mergeData && (!Array.isArray(sheet.mergeData) || sheet.mergeData.length > 200)) return { success: false, message: '每张工作表最多 200 个合并区域' };
    for (const [rowKey, cells] of Object.entries(sheet.cellData ?? {})) {
      const row = Number(rowKey);
      if (!Number.isInteger(row) || row < 0 || row >= rowCount || !cells || typeof cells !== 'object') return { success: false, message: '单元格行坐标超出范围' };
      for (const [colKey, cell] of Object.entries(cells)) {
        const column = Number(colKey);
        if (!Number.isInteger(column) || column < 0 || column >= columnCount || !cell || typeof cell !== 'object') return { success: false, message: '单元格列坐标超出范围' };
        cellCount += 1;
        if (cellCount > 8000) return { success: false, message: '整个工作簿最多保存 8,000 个非空单元格' };
        if (Object.hasOwn(cell, 'f') && cell.f != null && cell.f !== '') return { success: false, message: '第一阶段不允许保存公式，请使用受控业务指标绑定' };
        if (Object.hasOwn(cell, 'v')) {
          const value = cell.v;
          if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return { success: false, message: '单元格只允许静态文本、数字或布尔值' };
          if (typeof value === 'string' && value.length > 4000) return { success: false, message: '单元格文本不能超过 4,000 个字符' };
          if (typeof value === 'number' && !Number.isFinite(value)) return { success: false, message: '单元格数字必须是有限值' };
        }
      }
    }
    for (const merge of sheet.mergeData ?? []) {
      if (![merge.startRow, merge.startColumn, merge.endRow, merge.endColumn].every(Number.isInteger) || merge.startRow < 0 || merge.startColumn < 0 || merge.endRow < merge.startRow || merge.endColumn < merge.startColumn || merge.endRow >= rowCount || merge.endColumn >= columnCount) {
        return { success: false, message: '合并区域坐标超出工作表范围' };
      }
    }
  }
  return { success: true, workbook };
}

export function validateReportStudioDefinition(input: unknown): ReportStudioValidation {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: '报表设计定义格式不正确', details: parsed.error.flatten() };
  const definition = parsed.data;
  const workbookResult = validateWorkbook(definition.workbook);
  if (!workbookResult.success) return { success: false, message: workbookResult.message };
  const workbook = workbookResult.workbook;
  const sourceMap = new Map(getSources(definition.domain).map((source) => [source.id, source] as const));
  const bindingKeys = new Set<string>();
  for (const binding of definition.bindings) {
    const sheet = workbook.sheets[binding.sheetId];
    if (!sheet || !workbook.sheetOrder.includes(binding.sheetId)) return { success: false, message: `绑定 ${binding.cell} 指向不存在的工作表` };
    let coordinate: { row: number; column: number };
    try { coordinate = parseA1(binding.cell); } catch { return { success: false, message: `单元格地址无效：${binding.cell}` }; }
    if (coordinate.row >= Number(sheet.rowCount ?? 200) || coordinate.column >= Number(sheet.columnCount ?? 20)) return { success: false, message: `绑定单元格 ${binding.cell} 超出工作表范围` };
    const key = `${binding.sheetId}:${binding.cell}`;
    if (bindingKeys.has(key)) return { success: false, message: `单元格 ${binding.cell} 存在重复绑定` };
    bindingKeys.add(key);
    const source = sourceMap.get(binding.sourceId);
    if (!source) return { success: false, message: `数据源 ${binding.sourceId} 不属于当前报表范围` };
    if (!source.fields.some((field) => field.id === binding.fieldId)) return { success: false, message: `字段 ${binding.fieldId} 不存在于数据源 ${binding.sourceId}` };
    if (source.cardinality === 'MANY' && !definition.regions.some((region) => region.sheetId === binding.sheetId && region.sourceId === binding.sourceId && region.templateRow === coordinate.row && coordinate.column >= region.startColumn && coordinate.column <= region.endColumn)) {
      return { success: false, message: `集合字段 ${binding.sourceId}.${binding.fieldId} 必须位于对应的重复区域样板行` };
    }
    if (source.cardinality === 'ONE' && definition.regions.some((region) => region.sheetId === binding.sheetId && region.templateRow === coordinate.row)) {
      return { success: false, message: '单条记录绑定不能放在重复区域样板行中' };
    }
  }
  const regionKeys = new Set<string>();
  for (const region of definition.regions) {
    const sheet = workbook.sheets[region.sheetId];
    if (!sheet || !workbook.sheetOrder.includes(region.sheetId)) return { success: false, message: `重复区域 ${region.id} 指向不存在的工作表` };
    if (region.startColumn > region.endColumn || region.endColumn >= Number(sheet.columnCount ?? 20) || region.templateRow >= Number(sheet.rowCount ?? 200)) return { success: false, message: `重复区域 ${region.id} 超出工作表范围` };
    const source = sourceMap.get(region.sourceId);
    if (!source || source.cardinality !== 'MANY') return { success: false, message: `重复区域 ${region.id} 必须使用集合数据源` };
    const key = `${region.sheetId}:${region.templateRow}`;
    if (regionKeys.has(key)) return { success: false, message: '第一阶段每张工作表的同一模板行只能配置一个重复区域' };
    regionKeys.add(key);
    for (const merge of sheet.mergeData ?? []) {
      if (merge.startRow <= region.templateRow && merge.endRow >= region.templateRow && merge.endColumn >= region.startColumn && merge.startColumn <= region.endColumn) {
        return { success: false, message: '重复区域样板行不能与跨行合并单元格相交' };
      }
    }
  }
  // Workbook can contain styles only; reject oversized style catalogs as an abuse control.
  const styles = workbook.styles;
  if (styles && (Array.isArray(styles) ? styles.length : Object.keys(styles).length) > 600) return { success: false, message: '工作簿最多包含 600 个样式定义' };
  return { success: true, data: { ...definition, workbook } };
}

export function studioReportKey(domain: ReportStudioDomain): StudioReportKey {
  return domain === 'PROJECT' ? STUDIO_REPORT_KEYS.PROJECT : STUDIO_REPORT_KEYS.COMPANY;
}

export function domainFromStudioReportKey(key: string): ReportStudioDomain | null {
  if (key === STUDIO_REPORT_KEYS.PROJECT) return 'PROJECT';
  if (key === STUDIO_REPORT_KEYS.COMPANY) return 'COMPANY';
  return null;
}

export const reportStudioDefinitionSchema = definitionSchema;
