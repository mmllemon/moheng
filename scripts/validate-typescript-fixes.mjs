import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), 'utf8');
const [amountMath, downstreamContracts, downstreamFinance, ownerFinance, progressBills, partyTest, parties,
  auditLogs, reportData, reportXlsx, budgetXlsx, reportXlsxTest, budgetXlsxTest, ui, selectField,
  datePicker, projectsPage, ownerFinancePage, authStore, designer] = await Promise.all([
  'apps/api/src/lib/contract-amount-math.ts','apps/api/src/routes/downstream-contracts.ts',
  'apps/api/src/routes/downstream-finance.ts','apps/api/src/routes/owner-finance.ts',
  'apps/api/src/routes/progress-bills.ts','apps/api/src/lib/business-party.test.ts',
  'apps/api/src/routes/business-parties.ts','apps/api/src/routes/audit-logs.ts',
  'apps/api/src/lib/report-data.ts','apps/api/src/lib/report-xlsx.ts','apps/api/src/lib/budget-xlsx.ts',
  'apps/api/src/lib/report-xlsx.test.ts','apps/api/src/lib/budget-xlsx.test.ts','apps/web/src/components/Ui.tsx',
  'apps/web/src/components/SelectField.tsx','apps/web/src/components/DatePicker.tsx',
  'apps/web/src/pages/ProjectsPage.tsx','apps/web/src/pages/OwnerFinancePage.tsx',
  'apps/web/src/auth-store.ts','apps/web/src/pages/ReportDesignerPage.tsx',
].map(read));
const checks = [];
const check = (name, condition) => checks.push({ name, passed: Boolean(condition) });
check('regex capture group access is explicitly guarded', amountMath.includes('const wholeText = match[2]') && amountMath.includes("if (wholeText === undefined)"));
check('missing effective contract amount import is present and array access is optional', downstreamContracts.includes('calculateEffectiveContractAmount') && downstreamContracts.includes('requestedAllocations[0]?.payableId'));
check('project role is typed from Prisma enum', downstreamFinance.includes('ProjectRole, UserRole') && downstreamFinance.includes('userRole: UserRole'));
check('bigint cent accumulators avoid Math.max number mixing', downstreamFinance.includes('open > 0n ? open : 0n') && downstreamFinance.includes('open < 0n ? -open : 0n'));
check('error-map results are checked before tuple destructuring', (downstreamFinance.match(/const mappedError = error instanceof Error \? map\[error\.message\] : undefined;/g) ?? []).length >= 2);
check('money formatter string is not called with toFixed', ownerFinance.includes('const amountString = (cents: bigint) => centsToMoney(cents)') && !ownerFinance.includes('centsToMoney(cents).toFixed'));
check('Prisma audit JSON is serialized and narrowed at persistence boundary', ownerFinance.includes('const safeChanges = JSON.parse(JSON.stringify(changes) ??') && ownerFinance.includes('changes: safeChanges'));
check('Prisma Decimal comparison uses exact bigint cents', ownerFinance.includes('moneyToCents(ar.netAmount) <= 0n'));
check('progress-bill calculations use a single bigint money conversion path', progressBills.includes('sumAllocations(values: unknown[]): bigint') && progressBills.includes('moneyToCents(parsed.data.amount)') && !progressBills.includes('toCents(') && !progressBills.includes('fromCents(') && !progressBills.includes('paid.toFixed'));
check('business party tests guard array index under noUncheckedIndexedAccess', partyTest.includes('auditRows[0]!.data.entity'));
check('business party sum reducer has an explicit numeric accumulator', parties.includes('values.reduce<number>((total, v) => total + toNumber(v), 0)'));
check('union error result verifies defined value', parties.includes("'error' in outcome && outcome.error !== undefined"));
check('audit and report date parsing validates split components', auditLogs.includes('const parts = value.split(\'-\')') && auditLogs.includes('if (![year, month, day].every(Number.isFinite))') && reportData.includes('if (![y, m, d].every(Number.isFinite))'));
check('conditional pagination options no longer infer take as literal 5000', auditLogs.includes('take: exportMode ? 5000 : filter.pageSize'));
check('ExcelJS paper code compatibility cast is isolated', reportXlsx.includes('as unknown as ExcelJS.PaperSize'));
check('ExcelJS Buffer compatibility is cast at method parameter boundary', [budgetXlsx, reportXlsxTest, budgetXlsxTest].every((source) => source.includes('Parameters<typeof workbook.xlsx.load>[0]')));
check('Lucide icon prop uses library icon type and Button exposes small size', ui.includes('type LucideIcon') && ui.includes('icon: LucideIcon') && ui.includes("size?: 'sm' | 'md'") && ui.includes('button-small'));
check('React 19 refs that write current use explicit nullable generic', selectField.includes('useRef<HTMLSelectElement | null>(null)') && datePicker.includes('useRef<HTMLInputElement | null>(null)'));
check('required React hooks are imported and owner advance type includes notes', projectsPage.includes('useEffect, useMemo, useRef') && ownerFinancePage.includes('advanceMovements: {') && ownerFinancePage.includes('notes?: string | null'));
check('legacy theme mapping and missing preview path are type-narrowed', authStore.includes("theme?: UiTheme | 'light' | 'dark'") && designer.includes('!preview ? <ErrorBlock'));
for (const item of checks) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`);
const failed = checks.filter((item) => !item.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} TypeScript-defect source contracts passed`);
if (failed.length) process.exit(1);
