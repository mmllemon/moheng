export interface StandardPreviewField {
  key: string;
  type: string;
}
export interface StandardPreviewColumn {
  fieldKey: string | null;
  staticValue: string;
}
export interface ResolvedStandardPreviewCell {
  value: unknown;
  field: StandardPreviewField | undefined;
}

/** Resolve by stable field key, matching the server-side XLSX adapter rather than column position. */
export function resolveStandardPreviewCell(
  column: StandardPreviewColumn,
  fields: StandardPreviewField[],
  row: unknown[],
): ResolvedStandardPreviewCell {
  const fieldIndex = column.fieldKey === null ? -1 : fields.findIndex((field) => field.key === column.fieldKey);
  return {
    value: fieldIndex >= 0 ? row[fieldIndex] : column.staticValue,
    field: fieldIndex >= 0 ? fields[fieldIndex] : undefined,
  };
}
