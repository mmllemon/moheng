import type { ReportStudioDefinition, StudioCellData, StudioSheetData, StudioWorkbookData } from './report-studio-definition.js';
import type { ReportStudioDataset } from './report-studio-data.js';

export interface ReportStudioRenderedCell {
  value: unknown;
  style?: Record<string, unknown>;
  format?: string;
}
export interface ReportStudioRenderedMerge { startRow: number; startColumn: number; endRow: number; endColumn: number }
export interface ReportStudioRenderedSheet {
  id: string;
  name: string;
  rows: ReportStudioRenderedCell[][];
  rowHeights: Record<number, number>;
  columnWidths: Record<number, number>;
  merges: ReportStudioRenderedMerge[];
  frozenRows: number;
  frozenColumns: number;
  rowCount: number;
  truncated: boolean;
}
export interface ReportStudioRenderResult {
  title: string;
  domain: 'PROJECT' | 'COMPANY' | 'PARTY';
  generatedAt: string;
  projectId: string | null;
  sheets: ReportStudioRenderedSheet[];
  warnings: string[];
  truncated: boolean;
}

const MAX_RENDERED_ROWS_PER_SHEET = 10000;
const MAX_RENDERED_CELLS = 1_000_000;

function parseCell(cell: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9]\d{0,3})$/.exec(cell);
  if (!match) throw new Error(`REPORT_STUDIO_CELL_INVALID:${cell}`);
  let column = 0;
  for (const char of match[1]!) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}
function workbookStyle(workbook: StudioWorkbookData, cell: StudioCellData): Record<string, unknown> | undefined {
  const style = cell.s;
  if (style && typeof style === 'object' && !Array.isArray(style)) return style as Record<string, unknown>;
  if (typeof style === 'string' || typeof style === 'number') {
    const styles = workbook.styles;
    if (styles && !Array.isArray(styles) && typeof styles === 'object') {
      const found = (styles as Record<string, unknown>)[String(style)];
      if (found && typeof found === 'object' && !Array.isArray(found)) return found as Record<string, unknown>;
    }
    if (Array.isArray(styles) && typeof style === 'number') {
      const found = styles[style];
      if (found && typeof found === 'object' && !Array.isArray(found)) return found as Record<string, unknown>;
    }
  }
  return undefined;
}
function primitive(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}
function formatValue(value: unknown, format: string | undefined): unknown {
  if (value == null) return null;
  if (format === 'DATE' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (format === 'MONEY' && typeof value === 'string') {
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (match) {
      const sign = match[1] === '-' ? -1n : 1n;
      const whole = BigInt(match[2]!);
      const fraction = BigInt((match[3] ?? '').padEnd(2, '0'));
      const cents = sign * (whole * 100n + fraction);
      // Excel stores numeric cells as floating-point and only preserves about 15 significant digits.
      // Keep larger amounts as exact decimal text rather than silently rounding financial values.
      const maxExcelExactCents = 999_999_999_999_999n; // Excel reliably retains at most 15 significant decimal digits.
      if (cents <= maxExcelExactCents && cents >= -maxExcelExactCents) return Number(value);
      const absolute = cents < 0n ? -cents : cents;
      return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
    }
  }
  if (format === 'NUMBER' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return primitive(value);
}

/** Pure deterministic renderer shared by the preview and XLSX adapters. */
export function renderReportStudio(definition: ReportStudioDefinition, dataset: ReportStudioDataset): ReportStudioRenderResult {
  const workbook = definition.workbook as unknown as StudioWorkbookData;
  const usedSourceIds = new Set([
    ...definition.bindings.map((binding) => binding.sourceId),
    ...definition.regions.map((region) => region.sourceId),
  ]);
  const usedBindingKeys = new Set(definition.bindings.map((binding) => `${binding.sourceId}:${binding.fieldId}`));
  const truncationNotices = dataset.truncationNotices ?? [];
  const knownTruncationMessages = new Set(truncationNotices.map((notice) => notice.message));
  const noticeIsRelevant = (notice: (typeof truncationNotices)[number]) =>
    notice.sourceIds.some((sourceId) => usedSourceIds.has(sourceId))
    || (notice.fields ?? []).some(({ sourceId, fieldIds }) => fieldIds.some((fieldId) => usedBindingKeys.has(`${sourceId}:${fieldId}`)));
  const warnings = [
    ...dataset.warnings.filter((warning) => !knownTruncationMessages.has(warning)),
    ...truncationNotices.filter(noticeIsRelevant).map((notice) => notice.message),
  ];
  const renderedSheets: ReportStudioRenderedSheet[] = [];
  const truncatedSourceIds = new Set(dataset.truncatedSources ?? []);
  const truncatedFieldKeys = new Set((dataset.truncatedFields ?? []).flatMap(({ sourceId, fieldIds }) => fieldIds.map((fieldId) => `${sourceId}:${fieldId}`)));
  // Prefer source/field-scoped truncation when the loader identifies affected outputs.
  // Keep the legacy global fallback for older datasets without a usable dependency map.
  const hasScopedTruncation = dataset.truncated === true && (truncatedSourceIds.size > 0 || truncatedFieldKeys.size > 0);
  let allTruncated = dataset.truncated === true && !hasScopedTruncation;
  let totalRenderedCells = 0;
  for (const sheetId of workbook.sheetOrder) {
    const sourceSheet = workbook.sheets[sheetId];
    if (!sourceSheet) continue;
    const sheetBindings = definition.bindings.filter((binding) => binding.sheetId === sheetId);
    const bindingByCoordinate = new Map(sheetBindings.map((binding) => {
      const coordinate = parseCell(binding.cell);
      return [`${coordinate.row}:${coordinate.column}`, binding] as const;
    }));
    const bindingColumnsByRow = new Map<number, string[]>();
    for (const binding of sheetBindings) {
      const coordinate = parseCell(binding.cell);
      const columns = bindingColumnsByRow.get(coordinate.row) ?? [];
      columns.push(String(coordinate.column));
      bindingColumnsByRow.set(coordinate.row, columns);
    }
    const sheetRegions = definition.regions.filter((region) => region.sheetId === sheetId).sort((a, b) => a.templateRow - b.templateRow);
    const regionByRow = new Map(sheetRegions.map((region) => [region.templateRow, region] as const));
    const sourceRows = sourceSheet.cellData ?? {};
    const declaredColumnCount = Number(sourceSheet.columnCount ?? 40);
    const renderColumnLimit = Number.isFinite(declaredColumnCount) && declaredColumnCount > 0
      ? Math.min(40, Math.floor(declaredColumnCount))
      : 40;
    const rowKeys = Object.keys(sourceRows).map(Number).filter(Number.isInteger);
    const rowStyleKeys = Object.keys(sourceSheet.rowData ?? {}).map(Number).filter(Number.isInteger);
    const mergeEndRow = Math.max(-1, ...(sourceSheet.mergeData ?? []).map((merge) => merge.endRow));
    const regionMaxRow = Math.max(-1, ...sheetRegions.map((region) => region.templateRow));
    const bindingMaxRow = Math.max(-1, ...sheetBindings.map((binding) => parseCell(binding.cell).row));
    const lastSourceRow = Math.max(-1, ...rowKeys, ...rowStyleKeys, mergeEndRow, regionMaxRow, bindingMaxRow);
    let sheetTruncated = dataset.truncated === true && !hasScopedTruncation;
    if (hasScopedTruncation) {
      // A capped collection affects any binding/region that consumes it; a partial summary
      // affects only cells whose specific source field depends on the capped collection.
      sheetTruncated = sheetBindings.some((binding) => truncatedSourceIds.has(binding.sourceId) || truncatedFieldKeys.has(`${binding.sourceId}:${binding.fieldId}`))
        || sheetRegions.some((region) => truncatedSourceIds.has(region.sourceId));
    }
    if (sheetTruncated) allTruncated = true;
    const regionExpansions = new Map<number, unknown[]>();
    for (const region of sheetRegions) {
      const collection = dataset.sources[region.sourceId];
      const records = Array.isArray(collection) ? collection : [];
      if (records.length > region.maxRows) {
        warnings.push(`工作表“${sourceSheet.name ?? sheetId}”的区域 ${region.id} 超出 ${region.maxRows} 行上限，已截断。`);
        allTruncated = true;
        sheetTruncated = true;
      }
      regionExpansions.set(region.templateRow, records.slice(0, region.maxRows));
    }

    const rowOutputStart = new Map<number, number>();
    const renderedRows: ReportStudioRenderedCell[][] = [];
    const rowHeights: Record<number, number> = {};
    let outputIndex = 0;
    for (let sourceRow = 0; sourceRow <= lastSourceRow; sourceRow += 1) {
      if (outputIndex >= MAX_RENDERED_ROWS_PER_SHEET) {
        allTruncated = true;
        sheetTruncated = true;
        warnings.push(`工作表“${sourceSheet.name ?? sheetId}”已达到 ${MAX_RENDERED_ROWS_PER_SHEET} 行渲染上限，后续行已省略。`);
        break;
      }
      rowOutputStart.set(sourceRow, outputIndex);
      const rowCells = sourceRows[String(sourceRow)] ?? {};
      const rowStyles = sourceSheet.rowData?.[String(sourceRow)];
      const region = regionByRow.get(sourceRow);
      const regionRecords = region ? regionExpansions.get(sourceRow) ?? [] : null;
      const repetitions = region ? Math.max(regionRecords?.length ?? 0, 1) : 1;
      const allowedRepetitions = Math.min(repetitions, MAX_RENDERED_ROWS_PER_SHEET - outputIndex);
      if (region && repetitions > allowedRepetitions) { allTruncated = true; sheetTruncated = true; warnings.push(`工作表“${sourceSheet.name ?? sheetId}”已达到 ${MAX_RENDERED_ROWS_PER_SHEET} 行上限。`); }
      for (let repeat = 0; repeat < allowedRepetitions; repeat += 1) {
        const outputRow: ReportStudioRenderedCell[] = [];
        // A binding is authoritative even if the spreadsheet adapter omitted an otherwise-empty cell from cellData.
        // Render the union so a valid binding never silently disappears from preview/export.
        const boundColumns = bindingColumnsByRow.get(sourceRow) ?? [];
        const columnsToRender = new Set([...Object.keys(rowCells), ...boundColumns]);
        for (const columnKey of columnsToRender) {
          const column = Number(columnKey);
          if (!Number.isInteger(column) || column < 0 || column >= renderColumnLimit) continue;
          const rawCell = rowCells[columnKey] ?? {};
          const binding = bindingByCoordinate.get(`${sourceRow}:${column}`);
          let value = primitive((rawCell as StudioCellData).v);
          let format: string | undefined;
          if (binding) {
            format = binding.format;
            const source = dataset.sources[binding.sourceId];
            // Row identity invariant: every cell in a repeated row resolves from the same source record index. Cross-source bindings are rejected by the definition validator; never pair independent collections by visual row number.
            const record = region ? (region.sourceId === binding.sourceId ? (regionRecords?.[repeat] ?? null) : null) : source && typeof source === 'object' && !Array.isArray(source) ? source : null;
            value = record && typeof record === 'object' ? (record as Record<string, unknown>)[binding.fieldId] ?? null : null;
          }
          while (outputRow.length <= column) outputRow.push({ value: null });
          outputRow[column] = { value: formatValue(value, format), style: workbookStyle(workbook, rawCell as StudioCellData), ...(format ? { format } : {}) };
        }
        if (totalRenderedCells + outputRow.length > MAX_RENDERED_CELLS) throw new Error('REPORT_STUDIO_RENDERED_CELL_LIMIT_EXCEEDED');
        totalRenderedCells += outputRow.length;
        renderedRows.push(outputRow);
        if (typeof rowStyles?.h === 'number' && Number.isFinite(rowStyles.h)) rowHeights[outputIndex] = Math.min(400, Math.max(8, rowStyles.h));
        outputIndex += 1;
      }
    }
    const merges: ReportStudioRenderedMerge[] = [];
    for (const merge of sourceSheet.mergeData ?? []) {
      let startShift = 0;
      let endShift = 0;
      for (const region of sheetRegions) {
        const count = regionExpansions.get(region.templateRow)?.length ?? 0;
        const expansion = Math.max(count, 1) - 1;
        if (region.templateRow < merge.startRow) startShift += expansion;
        // A vertical merge that spans a repeated row must extend over the expanded rows,
        // even when the merge is in columns outside the repeated region.
        if (region.templateRow <= merge.endRow) endShift += expansion;
      }
      const startRow = merge.startRow + startShift;
      const endRow = merge.endRow + endShift;
      if (startRow < MAX_RENDERED_ROWS_PER_SHEET && endRow < MAX_RENDERED_ROWS_PER_SHEET) merges.push({ startRow, startColumn: merge.startColumn, endRow, endColumn: merge.endColumn });
    }
    const columnWidths: Record<number, number> = {};
    for (const [columnKey, column] of Object.entries(sourceSheet.columnData ?? {})) {
      const index = Number(columnKey);
      if (Number.isInteger(index) && typeof column?.w === 'number' && Number.isFinite(column.w)) columnWidths[index] = Math.min(600, Math.max(16, column.w));
    }
    const freeze = sourceSheet.freeze && typeof sourceSheet.freeze === 'object' ? sourceSheet.freeze as Record<string, unknown> : {};
    const frozenRows = Math.max(0, Number(freeze.ySplit ?? 0) || 0);
    const frozenColumns = Math.max(0, Number(freeze.xSplit ?? 0) || 0);
    renderedSheets.push({ id: sheetId, name: String(sourceSheet.name ?? sheetId), rows: renderedRows, rowHeights, columnWidths, merges, frozenRows, frozenColumns, rowCount: renderedRows.length, truncated: sheetTruncated });
  }
  return { title: definition.title, domain: definition.domain, generatedAt: dataset.generatedAt, projectId: dataset.projectId, sheets: renderedSheets, warnings: [...new Set(warnings)], truncated: allTruncated };
}

export function previewReportStudio(result: ReportStudioRenderResult, maxRowsPerSheet = 200) {
  return {
    title: result.title, domain: result.domain, generatedAt: result.generatedAt, projectId: result.projectId,
    warnings: result.warnings, truncated: result.truncated,
    sheets: result.sheets.map((sheet) => ({
      id: sheet.id, name: sheet.name, rowCount: sheet.rowCount, previewRowCount: Math.min(maxRowsPerSheet, sheet.rows.length),
      truncated: sheet.truncated || sheet.rows.length > maxRowsPerSheet,
      rows: sheet.rows.slice(0, maxRowsPerSheet).map((row) => row.map((cell) => ({ value: cell.value, style: cell.style ?? null, format: cell.format ?? null }))),
      rowHeights: sheet.rowHeights, columnWidths: sheet.columnWidths, merges: sheet.merges.filter((merge) => merge.startRow < maxRowsPerSheet && merge.endRow < maxRowsPerSheet),
    })),
  };
}
