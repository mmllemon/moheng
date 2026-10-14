/** RFC-4180-style CSV output for desktop spreadsheet consumers. */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : String(value);
  // Numeric values (including Prisma Decimal objects) must remain numeric in Excel.
  // Text cells with formula markers are neutralized to prevent spreadsheet formula injection.
  const numericObject = value !== null && typeof value === 'object' && !(value instanceof Date) &&
    value.constructor?.name === 'Decimal' && /^-?\d+(?:\.\d+)?$/.test(text);
  const numericValue = typeof value === 'number' || typeof value === 'bigint' || numericObject;
  if (!numericValue && typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const body = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  return `\uFEFF${body}\r\n`;
}
