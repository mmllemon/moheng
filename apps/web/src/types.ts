export type User = { id: string; name: string; email: string; role: 'ADMIN' | 'USER' };
export type ProjectStatus = 'CONSTRUCTION' | 'SETTLEMENT_PENDING' | 'SETTLED' | 'PAUSED';
export type Project = {
  id: string; name: string; code: string; type: string; ownerName: string; ownerPartyId?: string | null; contractAmount: number; originalContractAmount?: number;
  startDate: string; plannedEndDate?: string | null; status: ProjectStatus; address?: string | null;
  managerName?: string | null; hasMainContract?: boolean; hasExternalConfirmation?: boolean; budgetItemCount?: number; costEntryCount?: number;
};
export type BudgetItem = {
  id: string; projectId: string; parentId?: string | null; code: string; name: string; unit?: string | null;
  quantity?: number | null; unitPrice?: number | null; totalPrice: number; level: number; sortOrder: number;
};
export type CostType = 'LABOR' | 'MATERIAL' | 'MACHINE' | 'SUBCONTRACT' | 'INDIRECT';
export type CostEntry = { id: string; type: CostType; date: string; amount: number; description: string; downstreamContractId?: string | null; businessPartyId?: string | null; businessParty?: { id: string; name: string } | null; vendorName?: string | null; teamName?: string | null; downstreamContract?: { id: string; contractNo: string; name: string; counterpartyName: string } | null; budgetItem?: { code: string; name: string } | null; createdBy?: { name: string } };
export type ProgressBillStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'PAID' | 'REJECTED';
export type ProgressBill = { id: string; periodNo: number; applyDate: string; mainContract?: { id: string; contractNo: string; name: string } | null; amount: number; approvedAmount?: number | null; paidAmount: number; status: ProgressBillStatus; notes?: string | null; payments?: { id: string; amount: number; paidAt: string; referenceNo?: string | null; type?: string; originalReceiptNo?: string | null; notes?: string | null }[] };
export type ChangeStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CONFIRMED' | 'REJECTED';
export type ChangeDirection = 'INCREASE' | 'DECREASE';
export type EvidenceClass = 'A' | 'B' | 'C';
export type ExternalConfirmationStatus = 'NOT_CONFIRMED' | 'PENDING_SUPPLEMENT' | 'PENDING_VERIFICATION' | 'EFFECTIVE' | 'REJECTED' | 'DISPUTED';
export type InternalAmountReviewStatus = 'NOT_REQUIRED' | 'PENDING' | 'COMPLETED';
export type EvidenceFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; sha256: string; uploadedById?: string; uploadedAt: string };
export type ChangeRecord = {
  id: string; code: string; name: string; type: string; direction: ChangeDirection; occurredAt: string;
  submittedAmount: number; approvedAmount?: number | null; status: ChangeStatus; description?: string | null; decisionNote?: string | null;
  createdById?: string | null; submittedById?: string | null; internalApprovedById?: string | null; internalApprovedAt?: string | null;
  evidenceClass?: EvidenceClass | null; externalConfirmerName?: string | null; externalConfirmerAuthority?: string | null;
  externalConfirmedAt?: string | null; externalConfirmedAmount?: number | null; externalConfirmationScope?: string | null;
  evidenceReference?: string | null; evidenceContext?: string | null; externalConfirmationStatus: ExternalConfirmationStatus;
  externalRecordedById?: string | null; evidenceVerifiedById?: string | null; evidenceVerifiedAt?: string | null;
  evidenceVerificationNote?: string | null; effectiveAt?: string | null; mainContract?: { id: string; contractNo: string; name: string } | null; internalAmountReviewStatus: InternalAmountReviewStatus;
  internalAmountReviewTriggeredAt?: string | null; internalAmountReviewReferenceAmount?: number | string | null; internalAmountReviewExternalAmount?: number | string | null; internalAmountReviewCompletedAt?: string | null; internalAmountReviewCompletedById?: string | null; internalAmountReviewNote?: string | null; evidenceFiles: EvidenceFile[];
};
export type Analysis = {
  project: { id: string; name: string; code: string }; contractAmount: number; targetCost: number; actualCost: number;
  forecastCost: number; forecastBasis: string; downstreamContractSummary?: { contractCount: number; activeContractCount: number; activeAndPendingSettlementContractCount?: number; currentContractAmount: number; activeAndPendingSettlementContractAmount: number; paidAmount: number; grossPaidAmount?: number; refundedAmount?: number; linkedActualCost: number; contractValueMinusLinkedActualCost: number; linkedActualCostOverContractValue: number }; targetProfit: number; targetProfitMargin: number | null;
  forecastProfit: number; forecastProfitMargin: number | null; confirmedChangeAmount: number;
  billSummary: { totalSubmitted: number; approvedAmount: number; paidAmount: number };
  costByType: Record<CostType, number>; byBudget: { id: string; code: string; name: string; targetCost: number; actualCost: number }[];
  monthlyActualCost: { month: string; amount: number }[];
};
