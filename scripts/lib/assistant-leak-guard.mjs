import assert from 'node:assert/strict';

const EVENT_FIELDS = Object.freeze({
  'run.queued': ['runId', 'messageId'],
  'run.started': ['runId'],
  'run.cancel_requested': ['runId'],
  'run.cancelled': ['runId'],
  'run.completed': ['runId', 'messageId'],
  'run.failed': ['runId', 'code'],
  'tool.started': ['toolId'],
  'tool.completed': ['toolId', 'durationMs', 'sourceCount', 'generatedAt', 'sources', 'limitations'],
  'tool.failed': ['toolId', 'durationMs', 'code'],
});
const SOURCE_FIELDS = ['entity', 'fields', 'rowCount', 'scope'];
const SAFE_LIMITATIONS = new Set([
  '目标成本按叶子预算项汇总，避免将父级汇总行与子项重复累计。',
  '“已收/已支付”仅采用进度款上记录的 paidAmount 汇总，不替代收款核销/银行流水对账。',
  '预算项超过 10000 行，目标成本结果被截断，不应用于结论性财务判断。',
  '有效外部调整超过 10000 条，有效合同额重算被截断；请使用正式合同台账。',
  '项目合同额字段与依据有效外部确认调整重算的金额不一致，请核对合同台账；助手不自动修正。',
  '差异 = 实际成本记录 - 叶子预算项目标成本；正值表示已记录实际成本超过目标成本。它不等于预计完工成本或会计利润。',
  '未单独校验预算版本、暂估成本、未入账承诺及成本发生期间的完整性。',
  '叶子预算项目标成本合计不大于零，差异百分比不计算。',
  '这是字段完整性清单，不是审批结论、法律效力意见或付款依据；内部审批与外部业主确认仍是不同状态。',
  '不读取/回显凭证内容和备注正文，避免将不可信业务文本直接放进模型上下文。',
  '当前项目变更记录超过 200 条，结果被截断。',
]);
const TOOL_IDS = new Set(['project_operating_overview', 'cost_variance', 'change_evidence_completeness']);
const SAFE_SOURCE_SCOPES = new Set([
  'projectId = requested authorized project',
  'deletedAt = null; externalConfirmationStatus = EFFECTIVE; externalConfirmedAmount != null',
  'deletedAt = null; leaf items only',
  'deletedAt = null; projectId = requested project',
  'deletedAt = null; current project; most recently updated first; max 200 rows',
]);

function checkSafeEvent(event, index, findings) {
  const prefix = `event[${index}]`;
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    findings.push(`${prefix}: record must be an object`);
    return;
  }
  if (Object.keys(event).some((key) => !['type', 'payload'].includes(key))) findings.push(`${prefix}: unexpected wrapper field`);
  const type = event.type;
  const payload = event.payload;
  const allowed = EVENT_FIELDS[type];
  if (!allowed) {
    findings.push(`${prefix}: unsupported event type`);
    return;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    findings.push(`${prefix}: payload must be an object`);
    return;
  }
  if (Object.keys(payload).some((key) => !allowed.includes(key))) findings.push(`${prefix}: payload contains unapproved fields`);
  if ('toolId' in payload && !TOOL_IDS.has(payload.toolId)) findings.push(`${prefix}: tool id outside allowlist`);
  if ('code' in payload && (typeof payload.code !== 'string' || !/^[A-Z0-9_]{3,80}$/.test(payload.code))) findings.push(`${prefix}: unsafe error code`);
  if ('durationMs' in payload && (!Number.isInteger(payload.durationMs) || payload.durationMs < 0)) findings.push(`${prefix}: unsafe duration`);
  if ('sourceCount' in payload && (!Number.isInteger(payload.sourceCount) || payload.sourceCount < 0 || payload.sourceCount > 10)) findings.push(`${prefix}: unsafe source count`);
  if ('generatedAt' in payload && (typeof payload.generatedAt !== 'string' || Number.isNaN(Date.parse(payload.generatedAt)))) findings.push(`${prefix}: invalid generatedAt`);
  if ('limitations' in payload && (!Array.isArray(payload.limitations) || payload.limitations.length > 12 || payload.limitations.some((item) => typeof item !== 'string' || !SAFE_LIMITATIONS.has(item)))) findings.push(`${prefix}: limitation copy outside allowlist`);
  if ('sources' in payload && 'sourceCount' in payload && Array.isArray(payload.sources) && payload.sourceCount !== payload.sources.length) findings.push(`${prefix}: sourceCount does not match source metadata`);
  if ('sources' in payload) {
    if (!Array.isArray(payload.sources) || payload.sources.length > 10) {
      findings.push(`${prefix}: sources must be a bounded array`);
    } else payload.sources.forEach((source, sourceIndex) => {
      const sourcePrefix = `${prefix}.sources[${sourceIndex}]`;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        findings.push(`${sourcePrefix}: source must be an object`);
        return;
      }
      if (Object.keys(source).some((key) => !SOURCE_FIELDS.includes(key))) findings.push(`${sourcePrefix}: unapproved source field`);
      if (typeof source.entity !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(source.entity)) findings.push(`${sourcePrefix}: invalid entity`);
      if (!Array.isArray(source.fields) || source.fields.length > 50 || source.fields.some((field) => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(field))) findings.push(`${sourcePrefix}: invalid field names`);
      if (!Number.isInteger(source.rowCount) || source.rowCount < 0 || source.rowCount > 1_000_000) findings.push(`${sourcePrefix}: invalid rowCount`);
      if (typeof source.scope !== 'string' || !SAFE_SOURCE_SCOPES.has(source.scope)) findings.push(`${sourcePrefix}: scope outside fixed allowlist`);
    });
  }
}

export function scanAssistantLeakArtifacts({ logs = '', events = '', forbiddenValues = [] }) {
  const findings = [];
  const checks = [
    ['provider credential token', /\bsk-[A-Za-z0-9_-]{12,}\b/g],
    ['credential assignment', /\b(?:OPENAI_API_KEY|apiKey|authorization|secret)\s*[=:]\s*["']?(?!\[REDACTED\])[^\s,"'}]{6,}/gi],
  ];
  for (const [label, pattern] of checks) {
    for (const match of String(logs).matchAll(pattern)) findings.push(`log: ${label} pattern detected at offset ${match.index}`);
    for (const match of String(events).matchAll(pattern)) findings.push(`event artifact: ${label} pattern detected at offset ${match.index}`);
  }
  for (const rawValue of forbiddenValues) {
    const value = String(rawValue ?? '').trim();
    if (value.length < 6) continue;
    if (String(logs).includes(value)) findings.push('log: explicit forbidden marker detected');
    if (String(events).includes(value)) findings.push('event artifact: explicit forbidden marker detected');
  }
  const eventText = String(events).trim();
  if (eventText) {
    const lines = eventText.split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      let event;
      try { event = JSON.parse(line); }
      catch { findings.push(`event[${index}]: invalid JSON line`); return; }
      checkSafeEvent(event, index, findings);
    });
  }
  return { ok: findings.length === 0, findings };
}

export function assertAssistantLeakArtifactsClean(input) {
  const result = scanAssistantLeakArtifacts(input);
  assert.equal(result.ok, true, `Assistant leak guard failed:\n${result.findings.join('\n')}`);
  return result;
}
