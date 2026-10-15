import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), 'utf8');
const failures = [];
let passed = 0;
function check(label, condition) {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}`); }
}
const preview = await read('apps/web/src/pages/ReportPreviewPage.tsx');
const studio = await read('apps/web/src/pages/ReportStudioPage.tsx');
const launch = await read('apps/web/src/components/ReportLaunchButton.tsx');
const center = await read('apps/web/src/pages/ReportCenterPage.tsx');
const designer = await read('apps/web/src/pages/ReportDesignerPage.tsx');
const overview = await read('apps/web/src/pages/ProjectOverviewPage.tsx');
const workspace = await read('apps/web/src/components/ProjectWorkspaceLayout.tsx');
const styles = await read('apps/web/src/styles.css');
const xlsx = await read('apps/api/src/lib/report-studio-xlsx.ts');
const rootPackage = JSON.parse(await read('package.json'));
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const appInfo = await read('apps/api/src/platform/app-info.ts');

check('all package and runtime versions are v2.7.0-rc.1',
  rootPackage.version === '2.7.0-rc.1' && apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version && appInfo.includes("APP_VERSION = '2.7.0-rc.1'"));
check('preview back uses known router history only when explicitly marked and a safe internal fallback otherwise',
  preview.includes('routeState?.safeReportPreviewBack === true') && preview.includes('navigate(safeReturnTo, { replace: true })') && preview.includes("?? '/reports'") && preview.includes("!candidate.startsWith('//')"));
check('project summary auto-preview carries source route and replaces one-shot studio entry',
  launch.includes("autoPreview: '1', returnTo") && studio.includes('replace: automatic') && studio.includes('navigate(`/reports/preview?${params.toString()}`, { replace: true') && studio.includes("params.delete('autoPreview')"));
check('studio manual preview returns to a clean editor path with its saved template ID',
  studio.includes('cleanStudioPath(saved.id)') && studio.includes('params.set(\'templateId\', savedTemplateId)') && studio.includes('safeReportPreviewBack: canGoBackInHistory'));
check('standard report center, ledger entry points and legacy designer carry explicit return targets',
  launch.includes("state: { safeReportPreviewBack: true, returnTo }") && center.includes("state: { safeReportPreviewBack: true, returnTo }") && designer.includes("state: { safeReportPreviewBack: true, returnTo }") && center.includes("params.set('returnTo', returnTo)"));
check('no other route uses a raw history-back operation outside the centralized preview handler',
  (preview.match(/navigate\(-1\)/g) ?? []).length === 1 && !(launch + center + designer + studio).includes('navigate(-1)'));
check('project overview chart reserves Y-axis labels and uses ECharts containLabel',
  overview.includes('grid: { left: 68, right: 18, top: 22, bottom: 34, containLabel: true }') && overview.includes("axisLabel: { color: '#8792a4', margin: 10, hideOverlap: true") && styles.includes('.project-cost-trend-panel, .project-attention-panel'));
check('project workspace visually groups navigation without visible group-title captions',
  workspace.includes('workspace-nav-group workspace-nav-admin') && !workspace.includes('workspace-nav-admin-label') && !styles.includes('.workspace-nav-admin-label {'));
check('ExcelJS font builder correctly models incremental font-property assignment',
  xlsx.includes('const font: Partial<ExcelJS.Font> = {};'));
check('regression design and acceptance docs record safe return navigation, chart labels and font typing',
  (await read('docs/报表中心与报表工作室设计方案-v2.7.0-rc.1.md')).includes('autoPreview=1') && (await read('docs/WP12-报表预览返回导航图表与XLSX类型修复验收清单-v2.7.0-rc.1.md')).includes('Y 轴标签完整可读'));

console.log(`\n${passed}/${passed + failures.length} navigation/UI/XLSX regression checks passed.`);
if (failures.length) process.exitCode = 1;
