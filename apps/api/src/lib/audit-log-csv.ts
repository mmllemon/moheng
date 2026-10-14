const SENSITIVE_AUDIT_KEY = /password|token|secret|authorization|cookie|private.?key|access.?key/i;

export function sanitizeAuditChanges(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditChanges);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key, SENSITIVE_AUDIT_KEY.test(key) ? '[已隐藏]' : sanitizeAuditChanges(item),
    ]));
  }
  return value;
}

export type AuditCsvRow = {
  createdAt: Date | string;
  actor: string;
  projectName: string;
  projectCode: string;
  entity: string;
  entityId: string;
  action: string;
  changes: unknown;
};

function safeCell(value: unknown): string {
  let text = value == null ? '' : typeof value === 'string' ? value : String(value);
  // Spreadsheet applications may evaluate cells beginning with formula markers.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildAuditLogCsv(rows: AuditCsvRow[]): string {
  const headers = ['操作时间', '操作人', '项目名称', '项目编号', '业务对象', '记录编号', '操作类型', '变更摘要(JSON)'];
  const lines = [headers.map(safeCell).join(',')];
  for (const row of rows) {
    let changes = '';
    try { changes = row.changes == null ? '' : JSON.stringify(row.changes); }
    catch { changes = '[无法序列化]'; }
    lines.push([
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      row.actor,
      row.projectName,
      row.projectCode,
      row.entity,
      row.entityId,
      row.action,
      changes,
    ].map(safeCell).join(','));
  }
  // UTF-8 BOM lets common desktop spreadsheet software recognize Chinese headers.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
