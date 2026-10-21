import { chromium } from 'playwright-core';
import axe from 'axe-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const routes = (process.env.AXE_ROUTES ?? '/,/projects,/notifications,/settings/appearance,/account/security,/cost/contracts,/cost/changes,/cost/budget,/system,/system/accounts,/system/assistant,/system/security,/system/authorization,/system/policies,/system/governance,/system/dictionaries,/system/parameters,/system/operations,/audit-logs,/reports').split(',');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
// 复用已登录的 storageState，避免每次运行都触发登录限流（12 次 / 15 分钟）
const STATE = process.env.AUTH_STATE ?? 'D:/WorkSpace/hana/moheng/.auth/state.json';
let ctx;
try {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', storageState: STATE });
} catch {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
}
const page = await ctx.newPage();
await page.goto(BASE + '/');
if (page.url().includes('/login')) {
  await page.locator('input[type=email], #email').first().fill('admin@local.test');
  await page.locator('input[type=password], #password').first().fill('ChangeMe123!');
  await page.locator('button[type=submit]').first().click();
  await page.waitForTimeout(2200);
}

const results = [];
for (const route of routes) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.addScriptTag({ content: axe.source });
  const report = await page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.length,
      targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    }));
  });
  results.push({ route, violations: report });
  console.log(route, report.map((v) => v.id + ':' + v.impact + ':' + v.nodes).join(', ') || 'PASS');
}

const totals = new Map();
for (const pageResult of results) for (const violation of pageResult.violations) {
  const key = violation.id;
  const current = totals.get(key) ?? { id: key, impact: violation.impact, pages: new Set(), nodes: 0, help: violation.help };
  current.pages.add(pageResult.route);
  current.nodes += violation.nodes;
  totals.set(key, current);
}
console.log('\nSUMMARY');
for (const item of [...totals.values()].sort((a, b) => b.nodes - a.nodes)) {
  console.log(item.id, item.impact, 'pages=' + item.pages.size, 'nodes=' + item.nodes, item.help);
}

await browser.close();
process.exitCode = [...totals.values()].some((item) => item.impact === 'critical' || item.impact === 'serious') ? 1 : 0;
