// zod4 表单页运行时冒烟检查（迁移 PR① 的补充验证，非视觉基线）
//
// 目的：zod3→4 迁移给 5 个表单页的 zodResolver 加了 `as never`（绕开 v4 里
//   coerce 字段 input≠output 与 react-hook-form Resolver 泛型的类型摩擦）。
//   类型层已由 tsc 保证，但"运行时会不会炸"没被 CI 覆盖。本脚本用 Playwright
//   在 zod4 前端上挂载这些路由，检查 useForm+zodResolver 构造、以及 React
//   渲染是否产生 console/page 运行时错误。
//
// 用法（zod4 前端在 5174，后端复用 3001）：
//   $env:WEB_BASE_URL='http://localhost:5174'; $env:API_BASE_URL='http://localhost:3001'
//   node scripts/zod4-form-smoke.mjs
// 依赖系统 Chrome（CHROME_PATH，默认路径）与 _targets.mjs 的登录约定。
import { launchTarget, assertApiUp } from './_targets.mjs';

// 触发 zodResolver(...) as never 的 5 个页面路由（见 as never 提交）
const ROUTES = [
  '/cost/contracts',     // ContractsPage
  '/cost/changes',       // ChangesPage (3 resolver)
  '/cost/downstream',    // DownstreamContractsPage (4 resolver)
  '/cost/progress-bills',// ProgressBillsPage (2 resolver)
  '/projects',           // ProjectsPage
];

await assertApiUp();
const target = await launchTarget('web');
const { page, pageErrors } = target;

let exitCode = 0;
try {
  await target.open('/');
  if (page.url().includes('/login')) {
    console.error('LOGIN FAILED：登录态无效，页面停在登录页，后续检查无意义。');
    process.exit(2);
  }
  console.log(`logged in → ${page.url()}`);

  const results = [];
  for (const route of ROUTES) {
    const before = pageErrors.length;
    await page.evaluate((next) => {
      window.history.pushState(null, '', next);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForTimeout(900);
    const newErrors = pageErrors.slice(before);
    const mounted = await page.evaluate(() => Boolean(document.querySelector('#root')?.children.length));
    results.push({ route, jsErrors: newErrors.length, texts: newErrors.map((e) => `${e.type}: ${String(e.text).slice(0, 160)}`), mounted });
  }

  let failed = 0;
  for (const r of results) {
    const bad = r.jsErrors > 0 || !r.mounted;
    if (bad) failed++;
    console.log(`[${bad ? 'FAIL' : 'PASS'}] ${r.route}  mounted=${r.mounted}  jsErrors=${r.jsErrors}`);
    for (const t of r.texts) console.log(`        - ${t}`);
  }
  console.log(`\nzod4 form-smoke: ${results.length} routes checked, ${failed} failed.`);
  exitCode = failed ? 1 : 0;
} finally {
  await target.close();
}
process.exit(exitCode);
