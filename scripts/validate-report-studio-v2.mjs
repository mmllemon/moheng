import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];
let passed = 0;
const read = (path) => readFile(join(root, path), 'utf8');
function check(label, condition) {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}`); }
}
async function filesBelow(relative, suffixes) {
  const results = [];
  async function walk(path) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (suffixes.some((suffix) => child.endsWith(suffix))) results.push(child);
    }
  }
  await walk(relative);
  return results;
}

const rootPackage = JSON.parse(await read('package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const registry = await read('apps/api/src/platform/module-registry.ts');
const reportsRoute = await read('apps/api/src/routes/reports.ts');
const studioRoute = await read('apps/api/src/routes/report-studio.ts');
const definition = await read('apps/api/src/lib/report-studio-definition.ts');
const data = await read('apps/api/src/lib/report-studio-data.ts');
const renderer = await read('apps/api/src/lib/report-studio-render.ts');
const rendererTests = await read('apps/api/src/lib/report-studio-render.test.ts');
const definitionTests = await read('apps/api/src/lib/report-studio-definition.test.ts');
const launchButtons = await read('apps/web/src/components/ReportLaunchButton.tsx');
const amountMath = await read('apps/api/src/lib/report-studio-data.ts');
const xlsxStyle = await read('apps/api/src/lib/report-studio-xlsx.ts');
const xlsx = await read('apps/api/src/lib/report-studio-xlsx.ts');
const renderTests = await read('apps/api/src/lib/report-studio-render.test.ts');
const studioPage = await read('apps/web/src/pages/ReportStudioPage.tsx');
const previewPage = await read('apps/web/src/pages/ReportPreviewPage.tsx');
const centerPage = await read('apps/web/src/pages/ReportCenterPage.tsx');
const legacyDesigner = await read('apps/web/src/pages/ReportDesignerPage.tsx');
const app = await read('apps/web/src/App.tsx');
const sharedSelect = await read('apps/web/src/components/SelectField.tsx');
const sharedDate = await read('apps/web/src/components/DatePicker.tsx');
const docs = await read('docs/报表中心规格与验收.md');
const acceptance = await read('docs/后续四阶段开发路线图.md');
const reportData = await read('apps/api/src/lib/report-studio-data.ts');
const defaultStudio = await read('apps/web/src/report-studio-default.ts');
const currentDocs = docs;
const currentAcceptance = acceptance;

check('all packages and app metadata use the same candidate version',
  apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version);
check('Univer editor direct dependencies are exactly pinned and no Pro package is required',
  webPackage.dependencies?.['@univerjs/presets'] === '1.0.4' && webPackage.dependencies?.['@univerjs/preset-sheets-core'] === '1.0.4' &&
  !Object.keys(webPackage.dependencies ?? {}).some((name) => name.startsWith('@univerjs-pro/')) &&
  !studioPage.includes('@univerjs-pro/'));
check('report studio is independently registered at the stable reports/studio API boundary',
  registry.includes("import { reportStudioRoutes } from '../routes/report-studio.js'") &&
  registry.includes("mountPrefix: '/api/reports/studio', plugin: reportStudioRoutes") && !reportsRoute.includes('reportStudioRoutes'));
check('schema v2 allows stable cell bindings, typed formats, and bounded independent repeat regions',
  definition.includes('schemaVersion: z.literal(2)') && definition.includes('sourceId') && definition.includes('fieldId') &&
  definition.includes('templateRow') && definition.includes('maxRows') && definition.includes('8,000 个非空单元格'));
check('template validator rejects formulas, non-whitelisted fields, duplicate cell bindings and unsafe region/merge overlap',
  definition.includes("Object.hasOwn(cell, 'f')") && definition.includes('bindingKeys.has(key)') && definition.includes('sourceMap.get(binding.sourceId)') && definition.includes('跨行合并单元格相交'));
check('project and company source registry includes multiple independent business domains',
  ['project','mainContract','financialSummary','downstreamContracts','ownerReceivables','ownerReceipts','actualCosts','changes','progressBills','downstreamPayables','companySummary','companyProjects','companyDownstreamContracts','companyOwnerReceivables','companyOwnerReceipts','companyActualCosts','companyChanges','companyProgressBills','companyDownstreamPayables','businessParty','partySummary','partyProjects','partyMainContracts','partyDownstreamContracts','partyStandaloneCosts'].every((source) => data.includes(`id: '${source}'`)));
check('company sources include project identifiers so cross-project rows remain traceable',
  data.includes("txt('projectCode', '项目编号')") && data.includes("txt('projectName', '项目名称')") && data.includes('singleSourceData.companyDownstreamContracts') && data.includes('singleSourceData.companyDownstreamPayables'));
check('party contract finance metrics aggregate child histories in PostgreSQL while capping contract detail rows',
  data.includes('prisma.downstreamContractAdjustment.groupBy') &&
  data.includes('prisma.downstreamSettlementPosting.groupBy') &&
  data.includes('prisma.downstreamContractPayment.groupBy') &&
  data.includes('prisma.costEntry.groupBy') &&
  data.includes('prisma.downstreamSupplierInvoice.groupBy') &&
  data.includes('FROM "DownstreamPaymentAllocation"') &&
  data.includes('scoped_payable."downstreamContractId" IN (${Prisma.join(downstreamContractIds)})') &&
  !data.includes('supplierInvoices: { select: { amount: true, taxAmount: true, status: true } }') &&
  data.includes('take: MAX_ROWS_PER_SOURCE + 1') &&
  data.includes('invoiceCount: invoices.count'));
check('party report owner metrics aggregate progress bills, signed payments, and changes in PostgreSQL instead of loading nested histories',
  data.includes('prisma.progressBill.groupBy') &&
  data.includes('prisma.change.groupBy') &&
  data.includes('prisma.$queryRaw<Array<{ projectId: string; paidAmount: string }>>') &&
  data.includes('COALESCE(SUM(pp."amount"), 0)::text') &&
  !data.includes('include: { mainContract: true, progressBills:') &&
  data.includes('const progressPaidByProject = new Map') &&
  (await read('apps/api/src/routes/owner-finance.ts')).includes('amount: amountString(-allocation.amount)'));
check('party report collection outputs enforce row caps and source-specific completeness',
  data.includes('partyProjects: projectRows.slice(0, MAX_ROWS_PER_SOURCE)') &&
  data.includes('partyMainContracts: mainContractRows.slice(0, MAX_ROWS_PER_SOURCE)') &&
  data.includes("sourceIds: ['partyProjects']") &&
  data.includes("sourceIds: ['partyMainContracts']") &&
  data.includes('projectCount: downstreamContractsTruncated ? null : projectRows.length'));
check('financial summaries never present partial capped source data as complete totals',
  data.includes('依赖该数据源的相关汇总字段将显示为空') && data.includes("truncation.changes ? null") && data.includes("truncation.ownerReceipts ? null") && data.includes('summaries.some((item) => item[key] === null'));
check('report truncation flags and warnings follow bound collections and exact summary fields',
  data.includes('truncationNotices') &&
  data.includes("sourceIds: ['partyDownstreamContracts', 'partyProjects']") &&
  data.includes("sourceId: 'financialSummary', fieldIds: ['actualCostTotal']") &&
  renderer.includes('notice.sourceIds.some((sourceId) => usedSourceIds.has(sourceId))') &&
  renderer.includes('(notice.fields ?? [])') &&
  renderer.includes('truncatedFieldKeys.has(`${binding.sourceId}:${binding.fieldId}`)') &&
  rendererTests.includes('unbound field in a used summary source') &&
  rendererTests.includes('bound summary fields must remain visible'));
check('renderer binds every repeated-row cell from the same source record and keeps independent regions separate',
  renderer.includes('region.sourceId === binding.sourceId ? (regionRecords?.[repeat] ?? null) : null') && renderer.includes('regionExpansions') && renderer.includes('allowedRepetitions') && renderer.includes('const merges: ReportStudioRenderedMerge[]') &&
  renderTests.includes('expands independent repeating regions') && renderTests.includes('empty repeating regions') && renderTests.includes('rows[2]![1]!.value, 100') && renderTests.includes('rows[6]![1]!.value, 20'));
check('template validation rejects cross-source bindings inside a repeated row',
  definition.includes('集合字段') && definitionTests.includes('rejects a cell bound to another collection') && apiPackage.scripts.test.includes('report-studio-definition.test.ts'));
check('collection queries include stable tie-breakers and party financial sums use integer cents',
  data.includes("{ id: 'asc' }") && data.includes('sumPartyMoney') && data.includes('moneyToCents') && data.includes('downstreamTotalCostAmount: downstreamContractsTruncated ? null : plusPartyMoney('));
check('party downstream-contract caps are detected and dependent financial totals are disabled on truncation',
  data.includes('downstreamContractsFetched.length > MAX_ROWS_PER_SOURCE') && data.includes('take: MAX_ROWS_PER_SOURCE + 1') && data.includes('if (downstreamContractsTruncated)') && data.includes('downstreamTotalCostAmount: downstreamContractsTruncated ? null'));
check('ExcelJS is the final XLSX renderer, preserving supported styles and page settings',
  xlsx.includes('import ExcelJS from \'exceljs\'') && xlsx.includes('styleToExcel') && xlsx.includes('worksheet.pageSetup') && xlsx.includes('worksheet.mergeCells') && !xlsx.includes('@univerjs-pro'));
check('Univer cell number formats and wrap/rotation styles map consistently to XLSX',
  xlsx.includes('numberFormatPattern') && xlsx.includes('alignment.textRotation') && xlsx.includes('style.tb === 3') && previewPage.includes('const numericPattern = pattern.replace') && previewPage.includes('style.tb === 3'));
check('financial aggregation uses integer cents and preserves precision beyond spreadsheet safe numeric range',
  amountMath.includes('moneyToCents') && amountMath.includes('sumMoney(values: unknown[])') && !amountMath.includes('function amount(value: unknown): number') && renderer.includes('999_999_999_999_999n') && rendererTests.includes('90071992547409.93') && xlsxStyle.includes('mediumDashDotDot'));
check('formal preview page is routed and is the XLSX confirmation boundary',
  app.includes('path="reports/preview"') && previewPage.includes('确认并导出 XLSX') && previewPage.includes('/reports/jobs/${fileJobId}/download') && previewPage.includes('导出任务执行时会重新读取业务数据') && previewPage.includes('templateId: studioTemplateId') &&
  centerPage.includes('previewStandardReport') && legacyDesigner.includes('/reports/preview?') && studioRoute.includes('REPORT_TEMPLATE_PROJECT_MISMATCH') && studioRoute.includes('templateId: z.string().trim().min(1)'));
check('project, company and party report scopes are supported with a built-in party operating-profile template',
  centerPage.includes("openStudio('PROJECT')") && centerPage.includes("openStudio('COMPANY')") && centerPage.includes('项目综合经营报告') && centerPage.includes('公司级经营报表') &&
  data.includes("id: 'partySummary'") && studioPage.includes("domain === 'PARTY' ? '往来单位经营档案报告'") && studioPage.includes('businessPartyId'));
check('Univer component is lazy-loaded, disposed on unmount/domain-template switch, and saved as inert workbook data',
  studioPage.includes("import('@univerjs/presets')") && studioPage.includes('created.univerAPI.createWorkbook') && studioPage.includes('instance.univer.dispose()') && studioPage.includes('snapshotDefinition') && studioPage.includes('[ready, editorGeneration]'));
check('cell binding UI adds visible inert placeholders and region binding constraints',
  studioPage.includes('{{${selectedSource.id}.${selectedField.id}}}') && studioPage.includes('集合字段需要先创建重复区域') && studioPage.includes('设置为自动延伸区域'));
check('report binding removal clears only generated placeholders and region edits preserve validator cardinality rules',
  studioPage.includes('function clearBindingPlaceholder') &&
  studioPage.includes('range.getValue() === expectedPlaceholder') &&
  studioPage.includes('UI cleanup is best-effort') &&
  studioPage.includes('clearBindingPlaceholder(instanceRef.current?.api, removed)') &&
  studioPage.includes('单条记录字段不能放在重复区域样板行中') &&
  studioPage.includes('bindings: current.bindings.filter((binding) => !removedBindingIds.has(binding.id))'));
check('preview resolves the saved template on the server, enforces project template scope, and does not expose unpublished draft snapshots',
  studioRoute.includes('templateId: z.string().trim().min(1)') && studioRoute.includes('REPORT_TEMPLATE_PROJECT_MISMATCH') && !/publishedDefinition:\s*template\.publishedDefinition/.test(studioRoute) && !/publishedDefinition\s*:\s*ReportStudioDefinition/.test(await read('apps/web/src/report-studio-types.ts')));
check('all regular native dropdown/date UI use shared controls',
  studioPage.includes("from '../components/SelectField'") && legacyDesigner.includes("from '../components/SelectField'") && legacyDesigner.includes("from '../components/DatePicker'") &&
  sharedSelect.includes('<select') && sharedDate.includes('type="date"'));
const webSources = await filesBelow('apps/web/src', ['.tsx', '.ts']);
const rawSelectFiles = [];
const rawDateFiles = [];
const isSharedControlPath = (file, name) => new RegExp(`components[\\\\/]${name}\\.tsx$`).test(file);
check('shared control path matcher accepts POSIX and Windows separators', isSharedControlPath('apps/web/src/components/SelectField.tsx', 'SelectField') && isSharedControlPath('apps\\web\\src\\components\\SelectField.tsx', 'SelectField') && isSharedControlPath('apps/web/src/components/DatePicker.tsx', 'DatePicker') && isSharedControlPath('apps\\web\\src\\components\\DatePicker.tsx', 'DatePicker'));
for (const file of webSources) {
  const source = await read(file);
  if (/<select(?:\s|>)/.test(source) && !isSharedControlPath(file, 'SelectField')) rawSelectFiles.push(file);
  if (/type=["']date["']/.test(source) && !isSharedControlPath(file, 'DatePicker')) rawDateFiles.push(file);
}
check('repository scan finds no business-page native select or type=date outside shared primitives', rawSelectFiles.length === 0 && rawDateFiles.length === 0, [...rawSelectFiles, ...rawDateFiles].join(', '));
check('consolidated report docs preserve access restrictions and explicit bounded-row policy',
  docs.includes('任意 SQL') === false && docs.includes('公司级') && docs.includes('10,000') && docs.includes('当前用户权限') && acceptance.includes('公司级') && acceptance.includes('XLSX'));
check('current report specs define stable row identity/order, cell styles, project/company/party scopes and workspace entry points',
  currentDocs.includes('同一条记录') && currentDocs.includes('稳定主键') && currentDocs.includes('公司级') && currentDocs.includes('往来单位') && currentDocs.includes('列宽') && currentAcceptance.includes('重复区域') && currentAcceptance.includes('项目驾驶舱') && currentDocs.includes('往来单位经营档案'));
check('company template exposes project, downstream contracts, owner receipts/refunds, and downstream payment/refund regions',
  reportData.includes("id: 'downstreamPayments'") &&
  reportData.includes("id: 'companyDownstreamPayments'") &&
  reportData.includes("id: 'companyDownstreamContracts'") &&
  reportData.includes("id: 'companyOwnerReceipts'") &&
  reportData.includes("txt('originalReceiptNo', '原始收款编号')") &&
  reportData.includes('prisma.downstreamContractPayment.findMany') &&
  defaultStudio.includes("id:'company-downstream-contracts'") &&
  defaultStudio.includes("sourceId:'companyDownstreamContracts'") &&
  defaultStudio.includes("const contractFields = ['projectCode','projectName','contractNo','name','type','counterpartyName','status','signedAt','originalAmount','effectiveAmount']") &&
  defaultStudio.includes("sourceId:'companyOwnerReceipts'") &&
  defaultStudio.includes("const ownerReceiptFields = ['projectCode','projectName','receiptNo','type','amount','receivedAt','referenceNo','originalReceiptNo']") &&
  defaultStudio.includes("sourceId:'companyDownstreamPayments'") &&
  defaultStudio.includes("cell:`${String.fromCharCode(65+c)}20`") &&
  docs.includes('公司级业主收款/退款流水') &&
  docs.includes('不得与应付台账或实际成本混算'));
check('party template context is isolated by businessPartyId through an append-only migration',
  studioRoute.includes('REPORT_TEMPLATE_PARTY_MISMATCH') && studioRoute.includes('hasBusinessParty') && studioRoute.includes('businessPartyId') &&
  (await read('apps/api/prisma/schema.prisma')).includes('businessPartyId String?') && (await read('apps/api/prisma/migrations/20261015030000_party_report_template_context/migration.sql')).includes('FOREIGN KEY'));

check('standard and studio preview grids use fixed natural-width columns to avoid stretching the last column',
  previewPage.includes("width: 'max-content'") && previewPage.includes('<colgroup>') && previewPage.includes('Math.min(72, column.width)') &&
  (await read('apps/web/src/styles.css')).includes('.report-studio-preview-grid { width:max-content; min-width:0; table-layout:fixed;'));
check('report center uses a compact scenario-led hierarchy with a filtered ledger picker and no duplicated hero',
  !centerPage.includes('report-center-hero') && !centerPage.includes('report-intro-grid') && centerPage.includes('report-category-tabs') && centerPage.includes('visibleCatalog') && centerPage.includes('报告') && centerPage.includes('DOWNSTREAM'));
check('workspace and ledger pages expose common preview/export buttons and unit templates have an edit entry',
  launchButtons.includes('ProjectLedgerReportButton') && launchButtons.includes('ProjectSummaryReportButton') && launchButtons.includes('BusinessPartyReportButton') && launchButtons.includes('BusinessPartyTemplateButton') &&
  (await Promise.all(['BudgetPage.tsx','CostsPage.tsx','ProgressBillsPage.tsx','ChangesPage.tsx','DownstreamContractsPage.tsx','DownstreamFinancePage.tsx','OwnerFinancePage.tsx','ProjectOverviewPage.tsx','BusinessPartyDetailPage.tsx'].map((name) => read(`apps/web/src/pages/${name}`)))).every((pageSource) => pageSource.includes('ReportLaunchButton')) && (await read('apps/web/src/pages/BusinessPartyDetailPage.tsx')).includes('BusinessPartyTemplateButton') && (await read('apps/web/src/pages/ReportStudioPage.tsx')).includes('openSavedTemplateRequested'));

console.log(`\n${passed}/${passed + failures.length} v2 report-studio contracts passed.`);
if (failures.length) process.exit(1);
