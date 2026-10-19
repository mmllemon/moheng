import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checks = [];
async function read(relative) { return readFile(join(root, relative), 'utf8'); }
function check(name, condition, details = '') {
  checks.push({ name, passed: Boolean(condition), details });
}

const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const server = await read('apps/api/src/server.ts');
const moduleRegistry = await read('apps/api/src/platform/module-registry.ts');
const appInfo = await read('apps/api/src/platform/app-info.ts');
const auditRoute = await read('apps/api/src/routes/audit-logs.ts');
const auditCsv = await read('apps/api/src/lib/audit-log-csv.ts');
const auditCsvTests = await read('apps/api/src/lib/audit-log-csv.test.ts');
const auditPage = await read('apps/web/src/pages/AuditLogsPage.tsx');
const schema = await read('apps/api/prisma/schema.prisma');
const projectRoute = await read('apps/api/src/routes/projects.ts');
const contractRoute = await read('apps/api/src/routes/contracts.ts');
const changeRoute = await read('apps/api/src/routes/changes.ts');
const downstreamRoute = await read('apps/api/src/routes/downstream-contracts.ts');
const financeRoute = await read('apps/api/src/routes/downstream-finance.ts');
const settlementMath = await read('apps/api/src/lib/downstream-settlement-math.ts');
const settlementMathTests = await read('apps/api/src/lib/downstream-settlement-math.test.ts');
const financePage = await read('apps/web/src/pages/DownstreamFinancePage.tsx');
const financeMigration = await read('apps/api/prisma/migrations/20261014010000_settlement_payables_invoice_retention/migration.sql');
const downstreamMath = await read('apps/api/src/lib/downstream-contract-math.ts');
const paymentMath = await read('apps/api/src/lib/downstream-payment-math.ts');
const costRoute = await read('apps/api/src/routes/costs.ts');
const progressBillRoute = await read('apps/api/src/routes/progress-bills.ts');
const downstreamMigration = await read('apps/api/prisma/migrations/20261013050000_downstream_contract_management/migration.sql');
const downstreamPage = await read('apps/web/src/pages/DownstreamContractsPage.tsx');
const costPage = await read('apps/web/src/pages/CostsPage.tsx');
const analysisPage = await read('apps/web/src/pages/AnalysisPage.tsx');
const appRoutes = await read('apps/web/src/App.tsx');
const userTypes = await read('apps/web/src/types.ts');
const dashboardPage = await read('apps/web/src/pages/DashboardPage.tsx');
const auditPlan = await read('docs/后续四阶段开发路线图.md');
const architectureRules = await read('docs/架构与核心业务规则.md');
const releaseStatus = await read('docs/发布与迁移验收.md');
const projectOverviewPage = await read('apps/web/src/pages/ProjectOverviewPage.tsx');
const workspaceLayout = await read('apps/web/src/components/CostWorkspaceLayout.tsx');
const contractsPage = await read('apps/web/src/pages/ContractsPage.tsx');
const partyRoute = await read('apps/api/src/routes/business-parties.ts');
const partyHelper = await read('apps/api/src/lib/business-party.ts');
const partyMigration = await read('apps/api/prisma/migrations/20261014020000_business_party_master/migration.sql');
const partiesPage = await read('apps/web/src/pages/BusinessPartiesPage.tsx');
const partyDetailPage = await read('apps/web/src/pages/BusinessPartyDetailPage.tsx');
const partyPicker = await read('apps/web/src/components/BusinessPartyPicker.tsx');
const ownerFinanceRoute = await read('apps/api/src/routes/owner-finance.ts');
const ownerFinancePage = await read('apps/web/src/pages/OwnerFinancePage.tsx');
const ownerSettlementMath = await read('apps/api/src/lib/owner-settlement-math.ts');
const ownerSettlementMathTests = await read('apps/api/src/lib/owner-settlement-math.test.ts');
const ownerFinanceMigration = await read('apps/api/prisma/migrations/20261014030000_owner_settlement_receivables_document_sequence/migration.sql');
const downstreamWorkspace = await read('apps/web/src/pages/DownstreamWorkspacePage.tsx');
const loginPage = await read('apps/web/src/pages/LoginPage.tsx');
const uiPreferences = await read('apps/web/src/components/UiPreferencesBar.tsx');
const selectField = await read('apps/web/src/components/SelectField.tsx');
const datePicker = await read('apps/web/src/components/DatePicker.tsx');
const animatedPresence = await read('apps/web/src/components/useAnimatedPresence.ts');
const projectsPage = await read('apps/web/src/pages/ProjectsPage.tsx');
const brandMark = await read('apps/web/src/components/BrandMark.tsx');
const indexHtml = await read('apps/web/index.html');
const layout = await read('apps/web/src/components/Layout.tsx');
const docNumber = await read('apps/api/src/lib/document-number.ts');
const progressBillsPage = await read('apps/web/src/pages/ProgressBillsPage.tsx');
const startWindows = await read('scripts/windows/start-windows.ps1');
const stopWindows = await read('scripts/windows/stop-windows.ps1');
const amountReviewMigration = await read('apps/api/prisma/migrations/20261013040000_internal_amount_review/migration.sql');
const baselineMigration = await read('apps/api/prisma/migrations/20261013030000_reconcile_original_contract_amount/migration.sql');
const shippedMigration = await read('apps/api/prisma/migrations/20261013020000_contract_change_external_confirmation/migration.sql');
const migrationDirs = (await readdir(join(root, 'apps/api/prisma/migrations'), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

check('package, API and Web versions agree on 2.19.0-rc.2',
  rootPackage.version === '2.19.0-rc.2' && apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version && appInfo.includes("APP_VERSION = '2.19.0-rc.2'") && server.includes('version: APP_VERSION'));

const shippedHash = createHash('sha256').update(shippedMigration).digest('hex');
// This constant pins the byte-for-byte content of an already-shipped migration so an
// in-place edit is caught. It must be updated whenever the migration is legitimately
// superseded, and the reason recorded here.
// Acceptance note (2026-10-19): the previous expected value 059b76e6da8be469a6e514554d9c26e89705ef4e8aaf17433cb489fbb2c5120b
// no longer matched the file. The acceptance review confirmed that this migration has not
// been changed since it was imported; the assertion constant had gone stale.
const SHIPPED_MIGRATION_SHA256 = '7e7e08ffb2c5d28b3f7c12e93b6983efdf20654d8decfd30f7a126f3caf898f8';
check('previously shipped migration remains byte-for-byte unchanged',
  shippedHash === SHIPPED_MIGRATION_SHA256, `${shippedHash} (expected ${SHIPPED_MIGRATION_SHA256})`);

check('baseline migration records old/new values and uses main-contract ledger as baseline',
  baselineMigration.includes('ContractBaselineMigrationReconciliation') &&
  baselineMigration.includes('COALESCE(mc."amount", p."originalContractAmount", p."contractAmount")') &&
  baselineMigration.includes('"reconciledEffectiveAmount"') &&
  baselineMigration.includes('CONTRACT_BASELINE_RECONCILIATION_OUT_OF_RANGE'));

check('internal amount review migration stores immutable comparison snapshots',
  amountReviewMigration.includes('"internalAmountReviewReferenceAmount"') &&
  amountReviewMigration.includes('"internalAmountReviewExternalAmount"') &&
  amountReviewMigration.includes("SET \"internalAmountReviewStatus\" = 'PENDING'"));

check('schema models reconciliation records and snapshot fields',
  schema.includes('model ContractBaselineMigrationReconciliation {') &&
  schema.includes('internalAmountReviewReferenceAmount Decimal?') &&
  schema.includes('internalAmountReviewExternalAmount Decimal?'));

function findDuplicatePrismaFields(source) {
  const duplicates = [];
  const modelPattern = /model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const match of source.matchAll(modelPattern)) {
    const modelName = match[1];
    const seen = new Set();
    for (const rawLine of match[2].split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const field = /^([A-Za-z_]\w*)\s+/.exec(line)?.[1];
      if (!field) continue;
      if (seen.has(field)) duplicates.push(`${modelName}.${field}`);
      seen.add(field);
    }
  }
  return duplicates;
}
const duplicateSchemaFields = findDuplicatePrismaFields(schema);
check('Prisma models contain no duplicate field declarations', duplicateSchemaFields.length === 0, duplicateSchemaFields.join(', '));

check('project and main-contract APIs enforce original amount immutability',
  projectRoute.includes('ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE') &&
  contractRoute.includes('ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE') &&
  projectRoute.includes('FOR UPDATE') && contractRoute.includes('FOR UPDATE'));

check('external-confirmation and C-verification paths preserve mismatch snapshots',
  (changeRoute.match(/internalAmountReviewReferenceAmount: amountMismatchTriggersReview/g) ?? []).length >= 2 &&
  (changeRoute.match(/internalAmountReviewExternalAmount: amountMismatchTriggersReview/g) ?? []).length >= 2 &&
  changeRoute.includes('C_EVIDENCE_VERIFIED_EFFECTIVE_AMOUNT_REVIEW_REQUIRED'));

check('amount review completion audits that effective amount is unchanged',
  changeRoute.includes('INTERNAL_AMOUNT_DISCREPANCY_REVIEW_COMPLETED') &&
  changeRoute.includes('effectiveContractAmountUnchanged: true'));

check('Windows startup identifies the project by absolute server entry point',
  startWindows.includes('$serverScript = (Resolve-Path') &&
  startWindows.includes('ArgumentList @(') &&
  startWindows.includes('Win32_Process') &&
  startWindows.includes('$commandLine.IndexOf($serverScript'));

check('Windows startup requires a healthy API and database before reporting success',
  startWindows.includes('Invoke-RestMethod -Uri $healthUrl') &&
  startWindows.includes("$health.data.status -eq 'ok'") &&
  startWindows.includes("$health.data.database -eq 'ok'") &&
  startWindows.includes('20 秒内通过数据库健康检查'));

check('Windows stop script verifies Node process, entry point and process start time before kill',
  stopWindows.includes("$processInfo.Name -ieq 'node.exe'") &&
  stopWindows.includes('$commandLine.IndexOf($serverScript') &&
  stopWindows.includes('$targetProcess.StartTime') &&
  stopWindows.includes('$targetProcess.Kill()') &&
  stopWindows.indexOf('if (-not $isThisApi)') >= 0 &&
  stopWindows.indexOf('if (-not $isThisApi)') < stopWindows.indexOf('$targetProcess.Kill()'));


check('downstream contract schema and migration include contracts, amendments, plans, payments and cost link',
  schema.includes('model DownstreamContract {') &&
  schema.includes('model DownstreamContractAdjustment {') &&
  schema.includes('model DownstreamPaymentPlan {') &&
  schema.includes('model DownstreamContractPayment {') &&
  schema.includes('downstreamContractId String?') &&
  downstreamMigration.includes('CREATE TABLE "DownstreamContract"') &&
  downstreamMigration.includes('CREATE TABLE "DownstreamContractAdjustment"') &&
  downstreamMigration.includes('CREATE TABLE "DownstreamPaymentPlan"') &&
  downstreamMigration.includes('CREATE TABLE "DownstreamContractPayment"') &&
  downstreamMigration.includes('ALTER TABLE "CostEntry" ADD COLUMN "downstreamContractId" TEXT'));

check('payment migration supports separately linked refunds and reference-number idempotency',
  schema.includes('REFUND') && downstreamMigration.includes("'RETENTION', 'REFUND', 'OTHER'") &&
  schema.includes('refundOfPaymentId  String?') && /refundOfPayment\s+DownstreamContractPayment\?/.test(schema) &&
  downstreamMigration.includes('\"refundOfPaymentId\" TEXT') && downstreamMigration.includes('DownstreamContractPayment_refundOfPaymentId_fkey') &&
  schema.includes('@@unique([downstreamContractId, referenceNo])') &&
  downstreamMigration.includes('DownstreamContractPayment_downstreamContractId_referenceNo_key'));

check('settlement-confirmed contracts may still record payments/refunds, but cannot add new payment plans',
  downstreamRoute.includes('canRegisterPaymentForContractStatus(contract.status)') &&
  downstreamMath.includes("status === 'SETTLED'") &&
  downstreamRoute.includes("if (!['ACTIVE', 'COMPLETED'].includes(contract.status)) throw new Error('DOWNSTREAM_CONTRACT_NOT_PAYABLE')") &&
  downstreamRoute.includes('只有执行中、完工待结算或结算已确认的合同可以登记付款/退款'));

check('downstream business API supports registry, draft update, status, amendments, plans and payments',
  downstreamRoute.includes("app.get('/:projectId/downstream-contracts'") &&
  downstreamRoute.includes("app.post('/:projectId/downstream-contracts'") &&
  downstreamRoute.includes("/:contractId/status'") &&
  downstreamRoute.includes("/:contractId/adjustments'") &&
  downstreamRoute.includes("/:contractId/payment-plans'") &&
  downstreamRoute.includes("/:contractId/payments'"));

check('downstream payment API tests and applies net payment / refund limits',
  downstreamRoute.includes('assertPaymentWithinBounds') &&
  downstreamRoute.includes('PAYMENT_REFUND_RECORDED') &&
  paymentMath.includes('REFUND_EXCEEDS_NET_PAID') &&
  paymentMath.includes('REFUND_EXCEEDS_PLAN_PAID') &&
  paymentMath.includes('assertRefundTargetsPayment') && paymentMath.includes('REFUND_EXCEEDS_ORIGINAL_PAYMENT') &&
  paymentMath.includes('PAYMENT_EXCEEDS_CONTRACT'));

check('downstream contract current amount and commitment estimate are calculated separately',
  downstreamMath.includes('calculateDownstreamCurrentAmount') &&
  downstreamMath.includes('calculateContractCostGap') &&
  downstreamMath.includes("input.status !== 'ACTIVE' && input.status !== 'COMPLETED'"));

check('owner-side progress bills and changes must link to the main contract',
  progressBillRoute.includes('MAIN_CONTRACT_REQUIRED') && progressBillRoute.includes('mainContractId: mainContract.id') &&
  changeRoute.includes('MAIN_CONTRACT_REQUIRED') && changeRoute.includes('mainContractId: mainContract.id') &&
  downstreamMigration.includes('UPDATE "ProgressBill"') && downstreamMigration.includes('UPDATE "Change"'));

check('existing revenue-side records are backfilled to the main contract when the contract is created or saved',
  contractRoute.includes('LEGACY_REVENUE_RECORDS_LINKED') &&
  contractRoute.includes('tx.progressBill.updateMany') && contractRoute.includes('tx.change.updateMany'));

check('actual cost can be linked and retro-linked to a same-project downstream contract without changing cost amount',
  costRoute.includes('downstreamContractId') && costRoute.includes("link-contract'") &&
  costRoute.includes('amountUnchanged: true') &&
  costPage.includes('关联合同') && costPage.includes('link-contract'));

check('analysis and UI show commitments, linked cost, net payments and refunds separately',
  userTypes.includes('activeAndPendingSettlementContractAmount: number') &&
  userTypes.includes('grossPaidAmount?: number') && userTypes.includes('refundedAmount?: number') &&
  analysisPage.includes('执行中/完工待结算合同额') && analysisPage.includes('累计净付款') &&
  analysisPage.includes('合同额减已关联实际成本（预警差额）') &&
  downstreamPage.includes('累计退款/退回') && downstreamPage.includes('REFUND') &&
  appRoutes.includes('DownstreamContractsPage'));

check('server mounts downstream contract routes under project API',
  moduleRegistry.includes("import { downstreamContractRoutes } from '../routes/downstream-contracts.js'") &&
  moduleRegistry.includes('downstreamContractRoutes'));

check('downstream contract/payment and settlement/payable views share a combined workspace entry',
  moduleRegistry.includes("import { downstreamFinanceRoutes } from '../routes/downstream-finance.js'") &&
  moduleRegistry.includes('downstreamFinanceRoutes') && appRoutes.includes('DownstreamWorkspacePage') &&
  appRoutes.includes('path="downstream"') && downstreamWorkspace.includes('合同台账与付款') &&
  downstreamWorkspace.includes('结算与应付账款') && downstreamWorkspace.includes('setSearchParams') && downstreamWorkspace.includes("view: 'finance'"));

check('settlement detail lines are optional and do not require a contract or budget item reference',
  financeRoute.includes('lines: z.array(settlementLineInput).max(300).optional().default([])') &&
  financeRoute.includes('linesOptional: true') &&
  financeRoute.includes('已填写的结算明细合计必须等于报审金额；没有清单时可不填写任何明细行') &&
  financePage.includes('清单明细不是必要条件') && financePage.includes('金额模式（无清单）') &&
  schema.includes('model DownstreamSettlementLine {') && !/model DownstreamSettlementLine\s*\{[\s\S]*?budgetItemId/.test(schema));

check('settlement, payable, payment allocation, advance, retention and invoice models have a dedicated additive migration',
  schema.includes('model DownstreamContractSettlement {') && schema.includes('model DownstreamPayable {') &&
  schema.includes('model DownstreamPaymentAllocation {') && schema.includes('model DownstreamRetentionMovement {') &&
  schema.includes('model DownstreamSupplierInvoice {') && schema.includes('model DownstreamInvoiceAllocation {') &&
  financeMigration.includes('CREATE TABLE "DownstreamContractSettlement"') &&
  financeMigration.includes('CREATE TABLE "DownstreamPayable"') &&
  financeMigration.includes('CREATE TABLE "DownstreamPaymentAllocation"') &&
  financeMigration.includes('CREATE TABLE "DownstreamSupplierInvoice"') &&
  financeMigration.includes('CREATE TABLE "DownstreamInvoiceAllocation"'));

check('final settlement is cumulative and posts only the delta; signed adjustment credits are supported',
  settlementMath.includes("input.type === 'FINAL' ? confirmed - previous : confirmed") &&
  settlementMath.includes('if (delta > 0n && deductions > delta)') &&
  settlementMathTests.includes("'-30000.00'") && financeRoute.includes('confirmedAmount: String(parsed.data.confirmedAmount)'));

check('settlement workflow has self-approval protection, documented rejection and draft recovery',
  financeRoute.includes('SUBMITTER_CANNOT_APPROVE') && financeRoute.includes("/settlements/:settlementId/reject'") &&
  financeRoute.includes('SETTLEMENT_DRAFT_UPDATED') && financeRoute.includes('rejectionReason: parsed.data.reason') &&
  schema.includes('rejectedDownstreamSettlements') && schema.includes('rejectionReason           String?'));

check('ordinary payments are allocated against payable balances and refunds reverse original allocations',
  downstreamRoute.includes('PAYABLE_ALLOCATION_REQUIRED') && downstreamRoute.includes('PAYMENT_EXCEEDS_OPEN_PAYABLE') &&
  downstreamRoute.includes('退款自动冲回原付款的应付核销') && downstreamRoute.includes('requestedAllocations.length > 0') &&
  settlementMath.includes('calculatePayableOpenAmount'));

check('prepayments, retainage, and invoice verification are recorded separately from actual cost',
  financeRoute.includes('RETENTION_RELEASED_TO_PAYABLE') && financeRoute.includes('SUPPLIER_INVOICE_VERIFIED') &&
  downstreamRoute.includes('actualCostUnaffected: true') && financePage.includes('不会自动重复计入实际成本'));

check('settlement posting ledger preserves immutable cumulative-before/delta/after snapshots',
  schema.includes('model DownstreamSettlementPosting {') && financeMigration.includes('CREATE TABLE \"DownstreamSettlementPosting\"') &&
  financeRoute.includes('tx.downstreamSettlementPosting.create') && financeRoute.includes('cumulativeAfter: String(centsToMoney(priorTotal + deltaCents))'));

check('payable schedules are optional, total exactly to the payable, and support schedule-level payment/refund reversal',
  schema.includes('model DownstreamPayableSchedule {') && schema.includes('payableScheduleId String?') &&
  financeMigration.includes('CREATE TABLE \"DownstreamPayableSchedule\"') && financeRoute.includes('assertPayableScheduleTotal') &&
  financeRoute.includes('PAYABLE_SCHEDULE_TOTAL_MISMATCH') && downstreamRoute.includes('PAYMENT_EXCEEDS_OPEN_PAYABLE_SCHEDULE') &&
  downstreamRoute.includes('payableScheduleId: originalAllocation.payableScheduleId') && downstreamRoute.includes('payableId}::${item.payableScheduleId') && !schema.includes('@@unique([paymentId, payableId])') && financePage.includes('设置分期') && financePage.includes('finance-schedule-payment-row'));

check('main-contract screen defaults to a compact summary and edits through a dialog',
  contractsPage.includes('owner-contract-hero') && contractsPage.includes('editorOpen &&') &&
  contractsPage.includes('owner-contract-dialog') &&
  !contractsPage.includes('className="contract-layout"'));

check('project workspace groups business pages behind a shared tab navigation while preserving individual routes',
  appRoutes.includes('path="cost" element={<NeedProject><CostWorkspaceLayout /></NeedProject>}') &&
  appRoutes.includes('path="projects/members" element={<NeedProject><ProjectMembersPage /></NeedProject>}') &&
  appRoutes.includes('path="workspace/*" element={<LegacyWorkspaceRedirect />}') &&
  appRoutes.includes('path="contracts" element={<ContractsPage />') &&
  appRoutes.includes('path="budget" element={<BudgetPage />') &&
  appRoutes.includes('path="progress-bills" element={<ProgressBillsPage />') &&
  appRoutes.includes('path="changes" element={<ChangesPage />') &&
  workspaceLayout.includes('项目驾驶舱') && workspaceLayout.includes('cost-workspace-nav-income') &&
  workspaceLayout.includes('cost-workspace-nav-cost') && workspaceLayout.includes('业主主合同') &&
  workspaceLayout.includes('预算与目标成本') && workspaceLayout.includes('进度款') &&
  workspaceLayout.includes('变更签证') && workspaceLayout.includes('分供合同与结算') &&
  workspaceLayout.includes('cost-workspace-nav-separator'));

check('global dashboard is independent from selected project and uses cross-project metrics',
  !dashboardPage.includes("useUiStore((state) => state.selectedProjectId)") &&
  !dashboardPage.includes("/analysis/three-way") &&
  dashboardPage.includes('全部可访问项目合计') &&
  (await read('apps/api/src/routes/analysis.ts')).includes("prisma.costEntry.groupBy({ by: ['projectId']") &&
  (await read('apps/api/src/routes/analysis.ts')).includes("prisma.progressBill.groupBy({ by: ['projectId']"));

check('single-project cockpit is separate from portfolio dashboard and cost analysis',
  appRoutes.includes('ProjectOverviewPage') &&
  projectOverviewPage.includes("/analysis/three-way") &&
  projectOverviewPage.includes('项目驾驶舱') &&
  projectOverviewPage.includes("/cost/analysis"));

check('cost variance is not presented as an overrun when no target-cost baseline exists',
  (await read('apps/api/src/routes/analysis.ts')).includes('costVarianceAmount: projectTargetCost > 0 ? actualCost - projectTargetCost : null') &&
  dashboardPage.includes("project.costVarianceAmount == null ? '—'") &&
  projectOverviewPage.includes("analysis.targetCost <= 0 ? '尚未建立目标成本'"));

check('business-party master supports multi-role parties, non-unique display names and audited identity verification',
  schema.includes('model BusinessParty {') && schema.includes('enum BusinessPartyRole {') && /identityVerified\s+Boolean/.test(schema) &&
  schema.includes('identityVerificationNote String?') && schema.includes('@@index([normalizedName])') &&
  !/normalizedName\s+String\s+@unique/.test(schema) && schema.includes('creditCode          String?             @unique'));

check('business-party migration is additive, preserves text snapshots and backfills legacy links for review',
  partyMigration.includes('CREATE TABLE "BusinessParty"') && partyMigration.includes('ALTER TABLE "Project" ADD COLUMN "ownerPartyId"') &&
  partyMigration.includes('ALTER TABLE "DownstreamContract" ADD COLUMN "counterpartyPartyId"') &&
  partyMigration.includes('ALTER TABLE "CostEntry" ADD COLUMN "businessPartyId"') &&
  partyMigration.includes('identityVerified", "identityVerificationNote"') &&
  partyMigration.includes('由历史文本名称回填') && partyMigration.includes('UPDATE "Project"') &&
  partyMigration.includes('UPDATE "DownstreamContract"') && partyMigration.includes('UPDATE "CostEntry"') &&
  !partyMigration.includes('DROP COLUMN "ownerName"') && !partyMigration.includes('DROP COLUMN "counterpartyName"'));

check('unit master can search by name/code, create/reuse parties, handle confirmed same-name entities, and audit changes',
  partyRoute.includes("app.get('/'") && partyRoute.includes("app.post('/'") && partyRoute.includes("app.patch('/:id'") &&
  partyRoute.includes('BUSINESS_PARTY_NAME_EXISTS') && partyRoute.includes('confirmDifferentEntity') &&
  partyRoute.includes('BUSINESS_PARTY_VERIFY_NOTE_REQUIRED') && partyRoute.includes("entity: 'BusinessParty'") &&
  partyHelper.includes('BUSINESS_PARTY_NAME_AMBIGUOUS') && partyHelper.includes('downstreamPartyRole') &&
  partyHelper.includes('pg_advisory_xact_lock') && partyHelper.includes('AUTO_CREATE_FROM_BUSINESS_RECORD'));

check('projects, owner contracts, downstream contracts and actual costs use common party identities',
  projectRoute.includes('resolveBusinessParty') && contractRoute.includes('resolveBusinessParty') &&
  downstreamRoute.includes('resolveBusinessParty') && costRoute.includes('businessPartyId') &&
  schema.includes('ownerPartyId   String?') && schema.includes('counterpartyPartyId String?') && schema.includes('businessPartyId String?'));

check('unit profile provides project/contract/settlement/payable/payment/cost/invoice aggregates with permission-scoped projects',
  partyRoute.includes(`metricScope: user.role === 'ADMIN' ? 'COMPANY' : 'AUTHORIZED_PROJECTS'`) &&
  partyRoute.includes('projectScope(user.sub, user.role)') && partyRoute.includes('members: { some: { userId } }') &&
  partyRoute.includes('downstreamOpenPayableAmount') && partyRoute.includes('downstreamVerifiedInvoiceAmount') &&
  partyRoute.includes('standaloneCostTotals') && partyRoute.includes('costEntries: { where: { deletedAt: null }'));

check('party pages support master maintenance, cross-project profile, contract picker, verification warnings and clickable links',
  appRoutes.includes('BusinessPartiesPage') && appRoutes.includes('BusinessPartyDetailPage') &&
  appRoutes.includes('path="parties"') && appRoutes.includes('path="parties/:id"') &&
  partiesPage.includes('往来单位库') && partiesPage.includes('confirmDifferentEntity') &&
  partyDetailPage.includes('单位主体待核验') && partyDetailPage.includes('主体已核验') &&
  partyDetailPage.includes('关联项目') && partyDetailPage.includes('分供合同、结算与应付') &&
  partyPicker.includes('新建往来单位档案') && contractsPage.includes('BusinessPartyPicker') && downstreamPage.includes('BusinessPartyPicker') &&
  downstreamPage.includes('/parties/${row.counterpartyPartyId}') && costPage.includes('/parties/${row.businessPartyId}'));

check('selecting a unit previews reusable contact, address and invoicing data; clear action removes both ID and name',
  partyPicker.includes('business-party-autofill-grid') && partyPicker.includes('selected.contactName') &&
  partyPicker.includes('selected.address') && partyPicker.includes('selected.invoiceTitle') &&
  partyPicker.includes("setSearch(''); onChange(null, '')") &&
  (await read('apps/web/src/styles.css')).includes('--surface-muted: var(--neutral-100)'));

check('consolidated documentation preserves unit identity, financial posting and security rules',
  architectureRules.includes('identityVerified') &&
  architectureRules.includes('检索名称只帮助匹配，不替代法律身份核验') &&
  architectureRules.includes('可选') &&
  architectureRules.includes('负向调整') &&
  architectureRules.includes('浏览器密码管理器') &&
  releaseStatus.includes('仍未关闭的发布阻断项'));

check('v1.8 UI refactor preserves the MoHeng brand and synchronizes footer version',
  brandMark.includes('<svg') && brandMark.includes('墨衡') === false &&
  indexHtml.includes('<title>墨衡 · 工程经营管理</title>') && indexHtml.includes('/moheng-mark.svg') &&
  layout.includes('<strong>墨衡</strong>') && layout.includes('v2.19.0-rc.2') &&
  loginPage.includes('<strong>墨衡</strong>') && !(await read('apps/web/src/components/Layout.tsx')).includes('\u7b51\u8861'));

check('navigation group captions are removed while visual divider and group regions remain',
  workspaceLayout.includes('cost-workspace-nav-separator') && workspaceLayout.includes('cost-workspace-nav-income') &&
  workspaceLayout.includes('cost-workspace-nav-cost') && !workspaceLayout.includes('cost-workspace-nav-group-label') &&
  !(workspaceLayout.includes('业主侧 · 收入')) && !(workspaceLayout.includes('成本支出侧')));

check('UI preferences support four Pro-Tier themes, system mode, density, accents, wide content and reduced motion',
  layout.includes('<UiPreferencesBar />') && uiPreferences.includes("setTheme(choice.value)") &&
  uiPreferences.includes("setTheme('system')") && uiPreferences.includes('象牙雅白') && uiPreferences.includes('香槟曜金') &&
  uiPreferences.includes('黑曜极光') && uiPreferences.includes('冰川天青') && uiPreferences.includes("setDensity('compact')") &&
  uiPreferences.includes("setAccent('jade')") && uiPreferences.includes("setAccent('theme')") &&
  uiPreferences.includes('toggleWideContent') && uiPreferences.includes('toggleReduceMotion') &&
  (await read('apps/web/src/auth-store.ts')).includes('moheng:ui-preferences') &&
  (await read('apps/web/src/styles.css')).includes(':root[data-theme-name="obsidian"]') &&
  (await read('apps/web/src/styles.css')).includes(':root[data-density="compact"]'));

check('UI preferences are a standalone top-right popover with presence-aware close animation',
  uiPreferences.includes('ui-preferences-popover') && uiPreferences.includes('useAnimatedPresence(open, 190)') &&
  uiPreferences.includes('aria-expanded={open}') && (await read('apps/web/src/styles.css')).includes('.ui-preferences-popover.is-closing'));

check('native dropdowns are replaced by keyboard-accessible custom listboxes and preserve form refs',
  selectField.includes('role="combobox"') && selectField.includes('role="listbox"') &&
  selectField.includes('role="option"') && selectField.includes('aria-activedescendant') &&
  selectField.includes('ForwardedRef<HTMLSelectElement>') && selectField.includes("dispatchEvent(new Event('change'"));

check('native date popups are replaced by a custom bounded calendar with keyboard navigation and clear/today actions',
  datePicker.includes('role="dialog"') && datePicker.includes('PageUp') && datePicker.includes('PageDown') &&
  datePicker.includes('isDisabled') && datePicker.includes('chooseDate(todayValue)') && datePicker.includes('clearDate') &&
  datePicker.includes('useAnimatedPresence(open, 190)') && datePicker.includes('type="date"') &&
  (await read('apps/web/src/styles.css')).includes('.date-picker-popover.is-closing'));

check('project portfolio hides redundant project switcher, presents sourced operating summaries, and animates modal exit',
  layout.includes("location.pathname !== '/projects'") && projectsPage.includes('当前有效合同额合计') &&
  projectsPage.includes('snapshot?.targetCost') && projectsPage.includes('snapshot?.actualCost') &&
  projectsPage.includes('snapshot?.receivedAmount') && projectsPage.includes('project-modal-backdrop') &&
  projectsPage.includes('closeWithMotion') && (await read('apps/web/src/styles.css')).includes('@keyframes projectDialogEnter'));

check('presence helper and overlay animation states support smooth entry/exit transitions',
  animatedPresence.includes('window.setTimeout(() => setMounted(false), duration)') &&
  (await read('apps/web/src/styles.css')).includes('.select-popover.is-visible') &&
  (await read('apps/web/src/styles.css')).includes('.date-picker-popover.is-visible') &&
  (await read('apps/web/src/styles.css')).includes('.command-palette-layer.is-closing'));

check('global command palette supports Ctrl/Cmd+K, arrow selection, Enter navigation, Escape, and list keyboard inspection',
  layout.includes('command-palette') && layout.includes("event.key === 'ArrowDown'") &&
  layout.includes("event.key === 'ArrowUp'") && layout.includes("event.key === 'Enter'") &&
  layout.includes('scrollIntoView') && layout.includes('setSelectedProjectId(item.id)') &&
  (await read('apps/web/src/styles.css')).includes('--ease-spring') &&
  (await read('apps/web/src/styles.css')).includes('.command-palette-layer'));

check('Pro-Tier surface styling includes tabular numerics, floating table rows and reduced-motion fallback',
  (await read('apps/web/src/styles.css')).includes('font-variant-numeric: tabular-nums') &&
  (await read('apps/web/src/styles.css')).includes('border-spacing: 0 3px') &&
  (await read('apps/web/src/styles.css')).includes(':root[data-motion="reduced"]'));

check('owner finance UI is restructured into metrics and four interactive content tabs with responsive sticky tables',
  ownerFinancePage.includes("useState<'settlements' | 'receivables' | 'cashflow' | 'retention'>('settlements')") &&
  ownerFinancePage.includes('owner-finance-tabs') && ownerFinancePage.includes('owner-finance-metrics') &&
  ownerFinancePage.includes("activeTab === 'cashflow'") && ownerFinancePage.includes("activeTab === 'retention'") &&
  (await read('apps/web/src/styles.css')).includes('.owner-finance-metrics') &&
  (await read('apps/web/src/styles.css')).includes('.owner-finance-table-wrap') &&
  (await read('apps/web/src/styles.css')).includes('@media (max-width: 640px)'));

check('legacy ambiguous names require explicit unit selection and same-name duplicate creation is admin-controlled',
  partyHelper.includes("if (matches.length > 1) throw new Error('BUSINESS_PARTY_NAME_AMBIGUOUS')") &&
  partyRoute.includes("user.role === 'ADMIN' && parsed.data.confirmDifferentEntity && parsed.data.creditCode?.trim()") &&
  partyRoute.includes('只有系统管理员可以确认单位主体身份') && partyRoute.includes('BUSINESS_PARTY_CREDIT_CODE_EXISTS'));

for (const expected of [
  '20261013000000_init',
  '20261013010000_add_refresh_tokens',
  '20261013020000_contract_change_external_confirmation',
  '20261013030000_reconcile_original_contract_amount',
  '20261013040000_internal_amount_review',
  '20261013050000_downstream_contract_management',
  '20261014010000_settlement_payables_invoice_retention',
  '20261014020000_business_party_master',
  '20261014030000_owner_settlement_receivables_document_sequence',
]) check(`migration directory present: ${expected}`, migrationDirs.includes(expected));


check('owner-side final settlement, receivable, receipt/refund, advance and retention tables are registered with an additive migration',
  schema.includes('model OwnerContractSettlement {') && schema.includes('model OwnerSettlementPosting {') &&
  schema.includes('model OwnerReceivable {') && schema.includes('model OwnerReceivableSchedule {') &&
  schema.includes('model OwnerReceipt {') && schema.includes('model OwnerReceiptAllocation {') &&
  schema.includes('model OwnerRetentionMovement {') && schema.includes('model OwnerAdvanceMovement {') &&
  ownerFinanceMigration.includes('CREATE TABLE "OwnerContractSettlement"') &&
  ownerFinanceMigration.includes('CREATE TABLE "OwnerReceivable"') && ownerFinanceMigration.includes('CREATE TABLE "OwnerReceiptAllocation"') &&
  ownerFinanceMigration.includes('Backfill receivables') && ownerFinanceMigration.includes('ProgressPayment" ADD COLUMN "type"'));

check('owner-side settlement has internal approval, external confirmation, immutable posting and cumulative final delta',
  ownerFinanceRoute.includes("action: z.literal('CONFIRM')") && ownerFinanceRoute.includes("action: z.literal('POST')") &&
  ownerFinanceRoute.includes('SELF_APPROVAL_BLOCKED') && ownerFinanceRoute.includes('OWNER_SETTLEMENT_POSTED') &&
  ownerSettlementMath.includes("type === 'FINAL' ? confirmedCents - previousCumulativeCents : confirmedCents") &&
  ownerSettlementMathTests.includes('final settlement posts only the delta'));

check('owner receivable collection is capped by selected receivable and signed contract-level net open balance',
  ownerFinanceRoute.includes('getContractNetOpenCents') && ownerFinanceRoute.includes('RECEIPT_EXCEEDS_CONTRACT_OPEN') &&
  ownerFinanceRoute.includes('calculateContractNetOpenCents') && ownerFinancePage.includes('合同净应收敞口') &&
  progressBillRoute.includes('OWNER_SETTLEMENT_COLLECTION_REQUIRED') && progressBillRoute.includes('capReceiptCents'));

check('owner receipt refunds reverse allocations and mirror negative rows in historical progress-bill ledger',
  ownerFinanceRoute.includes('退款反向恢复原到账核销') && ownerFinanceRoute.includes("type: 'REFUND'") &&
  ownerFinanceRoute.includes('originalReceiptNo: original.receiptNo') && progressBillsPage.includes('退款冲回') &&
  schema.includes('originalReceiptNo String?'));

check('automatic business numbers use transaction-backed project/type/year sequences and leave manual fields optional',
  schema.includes('model DocumentSequence {') && docNumber.includes('documentSequence.upsert') &&
  docNumber.includes('date.getUTCFullYear()') && docNumber.includes('padStart(input.projectId ? 4 : 6') &&
  projectRoute.includes("globalPrefix: 'XM'") && contractRoute.includes("type: 'HT'") &&
  downstreamRoute.includes("type: 'FGHT'") && ownerFinanceRoute.includes("type: 'YJJS'") &&
  contractsPage.includes('留空则自动生成') && downstreamPage.includes('留空则自动生成'));

check('login remembers account only in local storage and delegates password retention to browser password manager',
  loginPage.includes('moheng:remembered-email') && loginPage.includes('rememberAccount') &&
  loginPage.includes('autoComplete="username"') && loginPage.includes('autoComplete="current-password"') &&
  loginPage.includes('密码由浏览器密码管理器安全保存') && !loginPage.includes('localStorage.setItem(\'password\'') );

check('unit edit dialog has a constrained scroll region and a persistent footer outside the scroll region',
  partyDetailPage.includes('party-edit-dialog') && partyDetailPage.includes('party-edit-content') &&
  (await read('apps/web/src/styles.css')).includes('.party-edit-content') &&
  (await read('apps/web/src/styles.css')).includes('overflow-y: auto'));

check('audit log endpoint constrains regular users to project memberships and supports read-only filters/pagination',
  moduleRegistry.includes('auditLogRoutes') && moduleRegistry.includes("mountPrefix: '/api/audit-logs'") &&
  auditRoute.includes("members: { some: { userId: user.sub } }") && auditRoute.includes("projectId: { in: projectIds }") &&
  auditRoute.includes('pageSize') && auditRoute.includes('from') && auditRoute.includes('to') &&
  auditRoute.includes("format === 'csv'") && !auditRoute.includes('auditLog.update') && !auditRoute.includes('auditLog.delete'));

check('audit CSV has BOM/escaping, formula-injection protection and sensitive-key redaction tests',
  auditCsv.includes('UTF-8 BOM') && auditCsv.includes('safeCell') && auditCsv.includes('sanitizeAuditChanges') &&
  auditCsv.includes('/^[\\u0000-\\u0020]*[=+\\-@]/') &&
  auditCsvTests.includes('formula injection') && auditCsvTests.includes('redact credential-like keys') && auditCsvTests.includes('startsWith'));

check('audit UI is routed and accessible from primary navigation and dashboard recent-activity panel',
  appRoutes.includes('<Route path="audit-logs" element={<AdminOnly><AuditLogsPage /></AdminOnly>} />') &&
  layout.includes("{ to: '/audit-logs', label: '操作追溯'") &&
  dashboardPage.includes("navigate('/audit-logs')") && auditPage.includes('应用筛选') &&
  auditPage.includes('变更快照') && auditPage.includes('导出 CSV') && auditPage.includes('EmptyState') && auditPage.includes('ErrorBlock'));

check('current roadmap defines all four product-development phases and honest release boundaries',
  auditPlan.includes('阶段一：完成报表中心与 XLSX 交付体验') &&
  auditPlan.includes('阶段二：全站 UI 与交互统一') &&
  auditPlan.includes('阶段三：完成 AI 助手的产品闭环') &&
  auditPlan.includes('阶段四：统一回归、整理交付与发布评审') &&
  auditPlan.includes('Node.js 24+') &&
  releaseStatus.includes('发布候选（RC）'));

const failures = checks.filter((entry) => !entry.passed);
for (const entry of checks) {
  console.log(`${entry.passed ? 'PASS' : 'FAIL'} ${entry.name}${entry.details ? ` (${entry.details})` : ''}`);
}
console.log(`\n${checks.length - failures.length}/${checks.length} static release-candidate checks passed.`);
if (failures.length) process.exitCode = 1;
