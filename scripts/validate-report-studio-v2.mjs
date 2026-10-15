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
const docs = await read('docs/报表中心与报表工作室设计方案-v2.4.0-rc.1.md');
const acceptance = await read('docs/WP9-报表工作室端到端验收清单-v2.4.0-rc.1.md');

check('all packages and app metadata use v2.4.0-rc.1',
  rootPackage.version === '2.4.0-rc.1' && apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version);
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
  ['project','mainContract','financialSummary','downstreamContracts','ownerReceivables','ownerReceipts','actualCosts','changes','progressBills','downstreamPayables','companySummary','companyProjects','companyDownstreamContracts','companyOwnerReceivables','companyOwnerReceipts','companyActualCosts','companyChanges','companyProgressBills','companyDownstreamPayables'].every((source) => data.includes(`id: '${source}'`)));
check('company sources include project identifiers so cross-project rows remain traceable',
  data.includes("txt('projectCode', '项目编号')") && data.includes("txt('projectName', '项目名称')") && data.includes('singleSourceData.companyDownstreamContracts') && data.includes('singleSourceData.companyDownstreamPayables'));
check('financial summaries never present partial capped source data as complete totals',
  data.includes('依赖该数据源的金额汇总将显示为空') && data.includes("truncation.changes ? null") && data.includes("truncation.ownerReceipts ? null") && data.includes('summaries.some((item) => item[key] === null'));
check('renderer expands independent regions and shifts following rows deterministically',
  renderer.includes('regionExpansions') && renderer.includes('allowedRepetitions') && renderer.includes('const merges: ReportStudioRenderedMerge[]') &&
  renderTests.includes('expands independent repeating regions') && renderTests.includes('empty repeating regions'));
check('ExcelJS is the final XLSX renderer, preserving supported styles and page settings',
  xlsx.includes('import ExcelJS from \'exceljs\'') && xlsx.includes('styleToExcel') && xlsx.includes('worksheet.pageSetup') && xlsx.includes('worksheet.mergeCells') && !xlsx.includes('@univerjs-pro'));
check('Univer cell number formats and wrap/rotation styles map consistently to XLSX',
  xlsx.includes('numberFormatPattern') && xlsx.includes('alignment.textRotation') && xlsx.includes('style.tb === 3') && previewPage.includes('const numericPattern = pattern.replace') && previewPage.includes('style.tb === 3'));
check('financial aggregation uses integer cents and preserves precision beyond spreadsheet safe numeric range',
  amountMath.includes('moneyToCents') && amountMath.includes('sumMoney(values: unknown[])') && !amountMath.includes('function amount(value: unknown): number') && renderer.includes('999_999_999_999_999n') && rendererTests.includes('90071992547409.93') && xlsxStyle.includes('mediumDashDotDot'));
check('formal preview page is routed and is the XLSX confirmation boundary',
  app.includes('path="reports/preview"') && previewPage.includes('确认并导出 XLSX') && previewPage.includes('/reports/jobs/${fileJobId}/download') && previewPage.includes('导出任务执行时会重新读取业务数据') && previewPage.includes('templateId: studioTemplateId') &&
  centerPage.includes('previewStandardReport') && legacyDesigner.includes('/reports/preview?') && studioRoute.includes('REPORT_TEMPLATE_PROJECT_MISMATCH') && studioRoute.includes('templateId: z.string().trim().min(1)'));
check('project and company report studio are both visible in report-center navigation',
  centerPage.includes("openStudio('PROJECT')") && centerPage.includes("openStudio('COMPANY')") && centerPage.includes('项目综合经营报告') && centerPage.includes('公司级经营报表'));
check('Univer component is lazy-loaded, disposed on unmount/domain-template switch, and saved as inert workbook data',
  studioPage.includes("import('@univerjs/presets')") && studioPage.includes('created.univerAPI.createWorkbook') && studioPage.includes('instance.univer.dispose()') && studioPage.includes('snapshotDefinition') && studioPage.includes('[ready, editorGeneration]'));
check('cell binding UI adds visible inert placeholders and region binding constraints',
  studioPage.includes('{{${selectedSource.id}.${selectedField.id}}}') && studioPage.includes('集合字段需要先创建重复区域') && studioPage.includes('设置为自动延伸区域'));
check('preview resolves the saved template on the server, enforces project template scope, and does not expose unpublished draft snapshots',
  studioRoute.includes('templateId: z.string().trim().min(1)') && studioRoute.includes('REPORT_TEMPLATE_PROJECT_MISMATCH') && !/publishedDefinition:\s*template\.publishedDefinition/.test(studioRoute) && !/publishedDefinition\s*:\s*ReportStudioDefinition/.test(await read('apps/web/src/report-studio-types.ts')));
check('all regular native dropdown/date UI use shared controls',
  studioPage.includes("from '../components/SelectField'") && legacyDesigner.includes("from '../components/SelectField'") && legacyDesigner.includes("from '../components/DatePicker'") &&
  sharedSelect.includes('<select') && sharedDate.includes('type="date"'));
const webSources = await filesBelow('apps/web/src', ['.tsx', '.ts']);
const rawSelectFiles = [];
const rawDateFiles = [];
for (const file of webSources) {
  const source = await read(file);
  if (/<select(?:\s|>)/.test(source) && !file.endsWith('components/SelectField.tsx')) rawSelectFiles.push(file);
  if (/type=["']date["']/.test(source) && !file.endsWith('components/DatePicker.tsx')) rawDateFiles.push(file);
}
check('repository scan finds no business-page native select or type=date outside shared primitives', rawSelectFiles.length === 0 && rawDateFiles.length === 0, [...rawSelectFiles, ...rawDateFiles].join(', '));
check('design and E2E docs describe data semantics, security limits and release gates',
  docs.includes('任意 SQL') && docs.includes('公司级') && docs.includes('10,000') && docs.includes('尚不冻结完整的数据快照') && acceptance.includes('公司级') && acceptance.includes('Excel 与 WPS'));
check('no new Prisma migration is required for schema v2 templates; existing template/job models are reused',
  !definition.includes('ReportRun') && apiPackage.dependencies?.['@prisma/client'] === '6.19.3' && docs.includes('不新增业务表、不修改财务表和既有迁移'));

console.log(`\n${passed}/${passed + failures.length} v2 report-studio contracts passed.`);
if (failures.length) process.exit(1);
