/** Fixed, non-business-value limitation copy permitted in persisted assistant events. */
export const ASSISTANT_LIMITATION_COPY = {
  leafCostAggregation: '目标成本按叶子预算项汇总，避免将父级汇总行与子项重复累计。',
  recordedPaidOnly: '“已收/已支付”仅采用进度款上记录的 paidAmount 汇总，不替代收款核销/银行流水对账。',
  targetCostTruncated: '预算项超过 10000 行，目标成本结果被截断，不应用于结论性财务判断。',
  effectiveAdjustmentsTruncated: '有效外部调整超过 10000 条，有效合同额重算被截断；请使用正式合同台账。',
  contractAmountMismatch: '项目合同额字段与依据有效外部确认调整重算的金额不一致，请核对合同台账；助手不自动修正。',
  varianceBasis: '差异 = 实际成本记录 - 叶子预算项目标成本；正值表示已记录实际成本超过目标成本。它不等于预计完工成本或会计利润。',
  varianceCompleteness: '未单独校验预算版本、暂估成本、未入账承诺及成本发生期间的完整性。',
  nonPositiveTarget: '叶子预算项目标成本合计不大于零，差异百分比不计算。',
  changeEvidenceOnly: '这是字段完整性清单，不是审批结论、法律效力意见或付款依据；内部审批与外部业主确认仍是不同状态。',
  evidenceTextExcluded: '不读取/回显凭证内容和备注正文，避免将不可信业务文本直接放进模型上下文。',
  changeRowsTruncated: '当前项目变更记录超过 200 条，结果被截断。',
} as const;

export const ASSISTANT_SAFE_LIMITATIONS: readonly string[] = Object.values(ASSISTANT_LIMITATION_COPY);


/** Exact fixed query-scope descriptions allowed in persisted source metadata. */
export const ASSISTANT_SAFE_SOURCE_SCOPES: readonly string[] = [
  'projectId = requested authorized project',
  'deletedAt = null; externalConfirmationStatus = EFFECTIVE; externalConfirmedAmount != null',
  'deletedAt = null; leaf items only',
  'deletedAt = null; projectId = requested project',
  'deletedAt = null; current project; most recently updated first; max 200 rows',
];
