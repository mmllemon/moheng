import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(root, path), 'utf8');
const failures = [];
let passed = 0;
function check(label, condition) {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}`); }
}

const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const reportRoute = await read('apps/api/src/routes/reports.ts');
const reportData = await read('apps/api/src/lib/report-data.ts');
const template = await read('apps/api/src/lib/report-template.ts');
const xlsx = await read('apps/api/src/lib/report-xlsx.ts');
const templateTests = await read('apps/api/src/lib/report-template.test.ts');
const xlsxTests = await read('apps/api/src/lib/report-xlsx.test.ts');
const budgetXlsx = await read('apps/api/src/lib/budget-xlsx.ts');
const budgetXlsxTests = await read('apps/api/src/lib/budget-xlsx.test.ts');
const schema = await read('apps/api/prisma/schema.prisma');
const migration = await read('apps/api/prisma/migrations/20261015010000_report_template_designer/migration.sql');
const designer = await read('apps/web/src/pages/ReportDesignerPage.tsx');
const types = await read('apps/web/src/report-template-types.ts');
const reportCenter = await read('apps/web/src/pages/ReportCenterPage.tsx');
const styles = await read('apps/web/src/styles.css');
const app = await read('apps/web/src/App.tsx');
const designDoc = await read('docs/原生XLSX与报表模板设计器-v2.1.0-rc.1.md');

check('all application packages use the same candidate version',
  apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version);
check('ExcelJS is pinned to a specific version and API test command includes XLSX tests',
  apiPackage.dependencies.exceljs === 'npm:exceljs-hardened@5.1.0' && apiPackage.scripts.test.includes('report-template.test.ts') && apiPackage.scripts.test.includes('report-xlsx.test.ts') && apiPackage.scripts.test.includes('budget-xlsx.test.ts'));
check('eight report types share a central server-side data registry',
  ['target-cost','actual-cost','progress-bills','changes','owner-receivables','owner-receipts','downstream-contracts','downstream-payables'].every((key) => reportData.includes(`key: '${key}'`)) && reportRoute.includes('loadReportSnapshot'));
check('XLSX exports produce typed styled data, freeze panes, filters, page settings, and optional explanation sheet',
  xlsx.includes("addWorksheet('数据'") && xlsx.includes("addWorksheet('导出说明'") && xlsx.includes('numFmt') && xlsx.includes('autoFilter') && xlsx.includes("state: 'frozen'") && xlsx.includes('printTitlesRow') && xlsx.includes('safeCellValue'));
check('template schema bounds grid dimensions and validates field allowlists, duplicate bindings and merge overlap',
  template.includes('.max(40)') && template.includes('allowedKeys') && template.includes('seenFields') && template.includes('cellGrid') && template.includes('至少需要保留一列可见字段'));
check('template APIs support scopes, publishing, archive, optimistic concurrency, revision restore and audit logging',
  ['PERSONAL','PROJECT','SYSTEM'].every((scope) => reportRoute.includes(`'${scope}'`)) && reportRoute.includes('expectedVersion') && reportRoute.includes('REPORT_TEMPLATE_VERSION_CONFLICT') && reportRoute.includes('/publish') && reportRoute.includes('/archive') && reportRoute.includes('/revisions/:revisionId/restore') && reportRoute.includes('REPORT_TEMPLATE_PUBLISHED') && reportRoute.includes('REPORT_TEMPLATE_UPDATED'));
check('project template list checks actual read permission and edit permission separately',
  reportRoute.includes('canReadTemplate(template, user)') && reportRoute.includes('canEditTemplate(template, user)') && reportRoute.includes('REPORT_TEMPLATE_ACCESS_DENIED'));
check('preview has bounded normal mode and separate complete-print data mode',
  reportRoute.includes("printAll: z.enum(['true']).optional()") && reportRoute.includes("parsed.data.printAll === 'true' ? snapshot.rows : snapshot.rows.slice(0, 80)"));
check('designer supports live preview, columns, static columns, row/column insert-delete, merge-split, page setup, print and history',
  designer.includes('LIVE PREVIEW') && designer.includes('addBoundColumn') && designer.includes('addStaticColumn') && designer.includes('addCustomRow') && designer.includes('removeCustomRow') && designer.includes('mergeSelected') && designer.includes('splitSelected') && designer.includes('outputPrint') && designer.includes('restoreRevision') && designer.includes('model.page.paper') && designer.includes('archiveTemplate') && designer.includes('归档模板'));
check('browser print fetches full capped dataset rather than printing the 80-row screen preview',
  designer.includes("params.set('printAll', 'true')") && designer.includes('printRows.map') && designer.includes('window.print()') && styles.includes('.report-print-all'));
check('template data and revisions are schema-backed and migration creates matching tables and foreign keys',
  schema.includes('model ReportTemplate {') && schema.includes('model ReportTemplateRevision {') && migration.includes('CREATE TABLE "ReportTemplate"') && migration.includes('CREATE TABLE "ReportTemplateRevision"') && migration.includes('ReportTemplate_projectId_fkey'));
check('budget XLSX import creates a native template, bounds ZIP expansion, and rejects formulas and non-XLSX content',
  budgetXlsx.includes('MAX_ZIP_ENTRIES = 128') && budgetXlsx.includes('MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024') && budgetXlsx.includes('XLSX_FORMULAS_NOT_ALLOWED') && budgetXlsxTests.includes('oversized uncompressed entry') && budgetXlsxTests.includes('rejects formula cells'));
check('legacy designer is routed and XLSX export now passes through formal preview',
  app.includes('path="reports/designer"') && app.includes('path="reports/preview"') && reportCenter.includes('previewStandardReport') && reportCenter.includes('设计报表模板') && designer.includes('/reports/preview?'));
check('template validation has unit tests for unknown fields, visibility, duplicates and merges',
  templateTests.includes('unknown field keys') && templateTests.includes('cannot hide every column') && templateTests.includes('duplicate field bindings') && templateTests.includes('cannot overlap'));
check('XLSX tests check formulas-as-strings, leading zero IDs, merge, frozen view and metadata sheet',
  xlsxTests.includes("'=1+1'") && xlsxTests.includes("'000123'") && xlsxTests.includes('isMerged') && xlsxTests.includes("state, 'frozen'") && xlsxTests.includes("'导出说明'"));
check('product documentation describes design boundary, scopes, APIs, security, acceptance and open release gates',
  designDoc.includes('PERSONAL') && designDoc.includes('PROJECT') && designDoc.includes('SYSTEM') && designDoc.includes('ExcelJS') && designDoc.includes('XLSX') && designDoc.includes('Node.js 24+'));
check('responsive and print styles exist for the report designer and print surfaces',
  styles.includes('.report-designer-workspace') && styles.includes('.report-print-all') && styles.includes('@media print') && styles.includes('@media (max-width: 980px)'));
check('template DTOs include editability and version metadata',
  types.includes('publishedVersion: number | null') && types.includes('editable: boolean') && types.includes('ReportTemplateDefinition'));

console.log(`\n${passed}/${passed + failures.length} report-studio static contracts passed.`);
if (failures.length) process.exitCode = 1;
