import { readFile } from 'node:fs/promises';
import { readModuleSources } from './lib/module-sources.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), 'utf8');
const [amountMath, downstreamContracts, downstreamFinance, ownerFinance, progressBills, partyTest, parties,
  auditLogs, reportData, reportXlsx, budgetXlsx, reportXlsxTest, budgetXlsxTest, ui, selectField,
  datePicker, projectsPage, ownerFinancePage, authStore, designer, authLib, systemManagement, assistantEvents] = await Promise.all([
  'apps/api/src/lib/contract-amount-math.ts','apps/api/src/routes/downstream-contracts.ts',
  'apps/api/src/routes/downstream-finance.ts','apps/api/src/routes/owner-finance.ts',
  'apps/api/src/routes/progress-bills.ts','apps/api/src/lib/business-party.test.ts',
  'apps/api/src/routes/business-parties.ts','apps/api/src/routes/audit-logs.ts',
  'apps/api/src/lib/report-data.ts','apps/api/src/lib/report-xlsx.ts','apps/api/src/lib/budget-xlsx.ts',
  'apps/api/src/lib/report-xlsx.test.ts','apps/api/src/lib/budget-xlsx.test.ts','apps/web/src/components/Ui.tsx',
  'apps/web/src/components/SelectField.tsx','apps/web/src/components/DatePicker.tsx',
  'apps/web/src/pages/ProjectsPage.tsx','apps/web/src/pages/OwnerFinancePage.tsx',
  'apps/web/src/auth-store.ts','apps/web/src/pages/ReportDesignerPage.tsx',
  'apps/api/src/lib/auth.ts','apps/api/src/routes/system-management.ts','apps/api/src/lib/assistant-run-events.ts',
].map((p) => (p === 'apps/api/src/routes/downstream-finance.ts' || p === 'apps/api/src/routes/system-management.ts') ? readModuleSources(root, p) : read(p)));
const checks = [];
const check = (name, condition) => checks.push({ name, passed: Boolean(condition) });
check('regex capture group access is explicitly guarded', amountMath.includes('const wholeText = match[2]') && amountMath.includes("if (wholeText === undefined)"));
check('missing effective contract amount import is present and array access is optional', downstreamContracts.includes('calculateEffectiveContractAmount') && downstreamContracts.includes('requestedAllocations[0]?.payableId'));
// 原断言靠基线里一条长 import 中 `ProjectRole, UserRole` 相邻的子串，那个相邻只是排版偶然。
// 拆分把两个枚举分到 schemas.ts / helpers.ts 后子串消失。改判为：两个枚举都必须从
// generated/prisma/client 导入（即角色类型来自 Prisma 枚举，而非本地字符串字面量联合）。
const prismaEnumImports = [...downstreamFinance.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*generated\/prisma\/client\.js'/g)].map((m) => m[1]);
check('project role is typed from Prisma enum',
  prismaEnumImports.some((names) => names.includes('ProjectRole')) &&
  prismaEnumImports.some((names) => names.includes('UserRole')) &&
  downstreamFinance.includes('userRole: UserRole'));
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
// 守卫不变：图标必须用 lucide-react 的库类型、小尺寸按钮必须真有对应样式类。
// 但原字面量钉的是旧写法：icon 现为可选的 `icon?: LucideIcon`（仍是库类型），
// Button 尺寸已抽成 `size?: ButtonSize` 结合类型别名（'xs'|'sm'|'md'|...），sm 仍映射 button-small。
check('Lucide icon prop uses library icon type and Button exposes small size',
  ui.includes('type LucideIcon') && ui.includes('icon?: LucideIcon') && ui.includes('size?: ButtonSize')
  && /export type ButtonSize = [^\n]*'sm'[^\n]*'md'/.test(ui) && ui.includes("size === 'sm' ? 'button-small'"));
check('React 19 refs that write current use explicit nullable generic', selectField.includes('useRef<HTMLSelectElement | null>(null)') && datePicker.includes('useRef<HTMLInputElement | null>(null)'));
check('required React hooks are imported and owner advance type includes notes', projectsPage.includes('useEffect, useMemo, useRef') && ownerFinancePage.includes('advanceMovements: {') && ownerFinancePage.includes('notes?: string | null'));
/* 断言意图：legacy 主题值（旧版的 'light' / 'dark'）不能被原样接受，
   必须显式收窄为 UiTheme；同时 ReportDesigner 在缺少预览数据时给出 ErrorBlock。

   2026-10-23 修正：原断言找 "theme?: UiTheme | 'light' | 'dark'"，
   但实现已改为「先当 string 读入、再逐个比对收窄」（auth-store.ts:81-83），
   那是更正确的写法（localStorage 里可能是任意脏值，不只是 'light'/'dark'）。
   断言跟着实现走，而不是让实现回退去迎合字符串匹配。 */
const authStoreNarrowsLegacyTheme = authStore.includes("{ theme?: string }") &&
  authStore.includes("const savedTheme = value.theme");
  // 旧值不能直接赋给 UiTheme：必须经过枚举比对
check('legacy theme mapping and missing preview path are type-narrowed',
  authStoreNarrowsLegacyTheme &&
  authStore.includes("savedTheme === 'plain-white' || savedTheme === 'midnight'") &&
  authStore.includes("const theme: UiTheme =") &&
  designer.includes('!preview ? <ErrorBlock'));
check('MFA decrypt hex inputs are narrowed before Buffer.from under noUncheckedIndexedAccess', authLib.includes('const ivHex = parts[1]') && authLib.includes("typeof ivHex !== 'string'") && authLib.includes("Buffer.from(ivHex, 'hex')") && authLib.includes("Buffer.from(authTagHex, 'hex')") && authLib.includes("Buffer.from(ciphertextHex, 'hex')"));
check('system-management registers authentication hook instead of invoking it as a normal function', systemManagement.includes("app.addHook('preHandler', authRequired)") && !systemManagement.includes('await authRequired(request, reply)'));
check('readonly as-const event payload arrays are accepted by AssistantEventJsonValue', assistantEvents.includes('readonly AssistantEventJsonValue[]') && assistantEvents.includes('readonly [key: string]: AssistantEventJsonValue'));
for (const item of checks) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`);
const failed = checks.filter((item) => !item.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} TypeScript-defect source contracts passed`);
if (failed.length) process.exit(1);
