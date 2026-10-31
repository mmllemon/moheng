// 门禁运行器 —— 把 package.json 里 validate:release-candidate 那根 35 段 `&&` 长串，
// 拆成可命名、可单跑、逐项报告、失败不中断的门禁清单。
//
// 用法：
//   node scripts/run-gates.mjs                     # 跑全部（串行）
//   node scripts/run-gates.mjs --list              # 列出所有 gate
//   node scripts/run-gates.mjs --only architecture,ui-polish,gate-integrity   # 只跑指定
//   node scripts/run-gates.mjs --skip "assistant-" # 跳过 name 含该子串的 gate
//
// 每项按退出码判定：0=PASS，非 0=FAIL。子进程输出直接透传（脚本自身会打印明细）。
import { spawn } from 'node:child_process';

const GATES = [
  { name: 'source-bundle',        cmd: 'node scripts/validate-source-bundle-completeness.mjs' },
  { name: 'document-links',       cmd: 'node scripts/validate-document-links.mjs' },
  { name: 'dependency-security',  cmd: 'node scripts/validate-dependency-security.mjs' },
  { name: 'release-candidate',    cmd: 'node scripts/validate-release-candidate.mjs' },
  { name: 'r7-security',          cmd: 'node scripts/validate-r7-security-remediation.mjs' },
  { name: 'build-prisma-flow',    cmd: 'node scripts/validate-build-prisma-flow.mjs' },
  { name: 'prisma7-migration',    cmd: 'node scripts/validate-prisma7-migration.mjs' },
  { name: 'assistant-poc',        cmd: 'node scripts/validate-assistant-poc.mjs' },
  { name: 'assistant-runtime-decision', cmd: 'node scripts/validate-assistant-runtime-decision.mjs' },
  { name: 'assistant-conversations',    cmd: 'node scripts/validate-assistant-conversations.mjs' },
  { name: 'assistant-ui',         cmd: 'node scripts/validate-assistant-ui.mjs' },
  { name: 'assistant-orphan-runs',cmd: 'node scripts/validate-assistant-orphan-runs.mjs' },
  { name: 'assistant-sse-parser', cmd: 'node --test apps/web/src/assistant-sse-parser.test.mjs' },
  { name: 'system-config-v2',     cmd: 'node scripts/validate-system-config-v2.mjs' },
  { name: 'report-studio',        cmd: 'node scripts/validate-report-studio.mjs' },
  { name: 'report-studio-v2',     cmd: 'node scripts/validate-report-studio-v2.mjs' },
  { name: 'report-studio-defaults', cmd: 'node --import=./apps/api/scripts/load-test-database-url.mjs --import=tsx --test scripts/tests/report-studio-defaults.test.ts' },
  { name: 'v2-work-packages',     cmd: 'node scripts/validate-v2-work-packages.mjs' },
  { name: 'audit-coverage',       cmd: 'node scripts/check-audit-coverage.mjs' },
  { name: 'architecture',         cmd: 'node scripts/validate-architecture.mjs' },
  { name: 'background-jobs',      cmd: 'node scripts/validate-background-jobs.mjs' },
  { name: 'typescript-fixes',     cmd: 'node scripts/validate-typescript-fixes.mjs' },
  { name: 'ui-polish',            cmd: 'node scripts/validate-ui-polish.mjs' },
  { name: 'gate-ui-parity',       cmd: 'node scripts/gate-ui-parity.mjs' },
  { name: 'gate-integrity',       cmd: 'node scripts/validate-gate-integrity.mjs' },
  { name: 'web-report-tests',     cmd: 'npx tsx --test apps/web/src/components/date-picker-utils.test.ts apps/web/src/report-export-job.test.ts apps/web/src/report-preview-format.test.ts apps/web/src/report-print.test.ts apps/web/src/report-preview-layout.test.ts apps/web/src/report-preview-data.test.ts' },
  { name: 'navigation-regressions', cmd: 'node scripts/validate-navigation-regressions.mjs' },
  { name: 'public-access-security', cmd: 'node scripts/validate-public-access-security.mjs' },
  { name: 'system-management-v2', cmd: 'node scripts/validate-system-management-v2.mjs' },
  { name: 'system-expansion-v2',  cmd: 'node scripts/validate-system-expansion-v2.mjs' },
  { name: 'defect-audit-v2',      cmd: 'node scripts/validate-defect-audit-v2.mjs' },
  { name: 'system-completion-v2', cmd: 'node scripts/validate-system-completion-v2.mjs' },
  { name: 'system-workbench-v2',  cmd: 'node scripts/validate-system-workbench-v2.mjs' },
  { name: 'assistant-safety-contract', cmd: 'node scripts/validate-assistant-safety-contract.mjs' },
  { name: 'assistant-runtime-contracts', cmd: 'npm run test:assistant-runtime-contracts' },
];

function parseArgs(argv) {
  const opts = { list: false, only: null, skip: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--only') opts.only = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip') opts.skip = argv[++i] || '';
  }
  return opts;
}

function selectGates(opts) {
  let sel = GATES;
  if (opts.only) sel = sel.filter((g) => opts.only.includes(g.name));
  if (opts.skip) sel = sel.filter((g) => !g.name.includes(opts.skip));
  return sel;
}

function runOne(cmd) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, { shell: true, stdio: 'inherit', cwd: process.cwd() });
    child.on('exit', (code) => resolve({ code: code ?? 1, ms: Date.now() - started }));
    child.on('error', () => resolve({ code: 1, ms: Date.now() - started }));
  });
}

const opts = parseArgs(process.argv.slice(2));
if (opts.list) {
  GATES.forEach((g, i) => console.log(`${String(i).padStart(2)}  ${g.name}`));
  process.exit(0);
}

const chosen = selectGates(opts);
const results = [];
console.log(`\n▶ running ${chosen.length} gate(s)\n`);
for (const g of chosen) {
  console.log(`\n===== [${g.name}] $ ${g.cmd} =====`);
  const { code, ms } = await runOne(g.cmd);
  const status = code === 0 ? 'PASS' : `FAIL(exit ${code})`;
  results.push({ name: g.name, code, ms, status });
  console.log(`----- [${g.name}] ${status} in ${ms}ms -----\n`);
}

const failed = results.filter((r) => r.code !== 0);
console.log('\n================ GATE SUMMARY ================');
for (const r of results) console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms}ms)`);
console.log(`\n${results.length - failed.length}/${results.length} passed` + (failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(', ')}` : ''));
process.exit(failed.length ? 1 : 0);
