export interface CustomRowMergeDefinition {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}
export interface PreviewMergeSpan {
  rowSpan: number;
  colSpan: number;
}
export interface CustomRowMergeLayout {
  mergeByStart: Map<string, PreviewMergeSpan>;
  covered: Set<string>;
}

/**
 * Translate source-column merge coordinates to the visible preview grid.
 * The XLSX renderer applies the same rule after filtering hidden columns.
 */
export function buildCustomRowMergeLayout(
  merges: CustomRowMergeDefinition[],
  visibleSourceIndexes: number[],
  rowCount: number,
): CustomRowMergeLayout {
  const mergeByStart = new Map<string, PreviewMergeSpan>();
  const covered = new Set<string>();
  for (const merge of merges) {
    if (!Number.isInteger(merge.row) || !Number.isInteger(merge.col) ||
        !Number.isInteger(merge.rowSpan) || !Number.isInteger(merge.colSpan) ||
        merge.row < 0 || merge.col < 0 || merge.rowSpan < 1 || merge.colSpan < 1 ||
        merge.row + merge.rowSpan > rowCount) continue;

    const visibleWithin = visibleSourceIndexes
      .map((sourceCol, outputIndex) => ({ sourceCol, outputIndex }))
      .filter(({ sourceCol }) => sourceCol >= merge.col && sourceCol < merge.col + merge.colSpan);
    if (visibleWithin.length === 0) continue;

    const startColumn = visibleWithin[0]!.outputIndex;
    const colSpan = visibleWithin.length;
    if (merge.rowSpan > 1 || colSpan > 1) {
      mergeByStart.set(`${merge.row}:${startColumn}`, { rowSpan: merge.rowSpan, colSpan });
    }
    for (let row = merge.row; row < merge.row + merge.rowSpan; row += 1) {
      for (let column = startColumn; column < startColumn + colSpan; column += 1) {
        if (row !== merge.row || column !== startColumn) covered.add(`${row}:${column}`);
      }
    }
  }
  return { mergeByStart, covered };
}
