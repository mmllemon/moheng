// 按钮字号/字重全量采集：按角色分组，看真实分布
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/reports/studio',
  '/notifications', '/parties', '/audit-logs', '/settings/appearance',
  '/system', '/system/security', '/system/authorization', '/system/policies',
  '/system/governance', '/system/operations', '/system/dictionaries',
  '/system/parameters', '/system/accounts', '/system/assistant', '/account/security',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

const rows = [];
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(880);

  const items = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role=button], a.button, .button')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8 || r.width < 8) continue;
      const txt = (el.textContent || '').trim();
      // 图标按钮无文字，字号无意义，排除
      if (!txt) continue;

      const cls = (el.className || '').toString();
      let role = '普通';
      if (/button-primary/.test(cls)) role = '主按钮';
      else if (/button-danger/.test(cls)) role = '危险';
      else if (/button-ghost/.test(cls)) role = '幽灵';
      else if (/button-secondary/.test(cls)) role = '次按钮';
      else if (el.closest('.row-actions, td, tr')) role = '行内';
      else if (el.closest('.page-actions, .table-heading-actions, .ds-section-actions')) role = '页头';

      out.push({
        role,
        txt: txt.slice(0, 10),
        fs: cs.fontSize,
        fw: cs.fontWeight,
        lh: cs.lineHeight,
        cls: cls.slice(0, 40),
        h: Math.round(r.height),
      });
    }
    return out;
  });
  for (const it of items) rows.push({ route, ...it });
}

console.log(`=== ${rows.length} 个带文字的按钮 ===\n`);

// 组合分布
const combos = new Map();
for (const r of rows) {
  const k = `${r.fs} / ${r.fw}`;
  combos.set(k, (combos.get(k) || 0) + 1);
}
console.log('=== 字号 / 字重 组合 ===');
for (const [k, n] of [...combos.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}×  ${k}`);
}
console.log(`\n共 ${combos.size} 种组合\n`);

// 追溯每条组合的真实来源：是 .button 体系、还是别的选择器在覆盖
console.log('=== 每种组合的来源选择器 ===');
for (const [k, n] of [...combos.entries()].sort((a, b) => b[1] - a[1])) {
  const sample = rows.find((r) => `${r.fs} / ${r.fw}` === k);
  console.log(`\n${String(n).padStart(4)}×  ${k}`);
  // 同组合下出现的不同 class
  const clsSet = new Map();
  for (const r of rows) {
    if (`${r.fs} / ${r.fw}` !== k) continue;
    clsSet.set(r.cls, (clsSet.get(r.cls) || 0) + 1);
  }
  for (const [c, cn] of [...clsSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`      ${String(cn).padStart(3)}×  .${c || '(无 class)'}`);
  }
}

// 按角色看
const roleMap = new Map();
for (const r of rows) {
  if (!roleMap.has(r.role)) roleMap.set(r.role, new Map());
  const m = roleMap.get(r.role);
  const k = `${r.fs}/${r.fw}`;
  m.set(k, (m.get(k) || 0) + 1);
}
console.log('=== 按角色 ===');
for (const [role, m] of roleMap) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const list = [...m.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n${role}  (${total} 个，${m.size} 种)`);
  for (const [k, n] of list) console.log(`    ${String(n).padStart(4)}×  ${k}`);
}

// 找出偏离主流的具体实例
console.log('\n=== 偏离主流的具体例子 ===');
const main = [...combos.entries()].sort((a, b) => b[1] - a[1])[0][0];
const minority = rows.filter((r) => `${r.fs} / ${r.fw}` !== main);
const seen = new Set();
for (const r of minority) {
  const k = `${r.fs}/${r.fw}  ${r.cls}`;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`  ${r.fs}/${r.fw}  ${r.route.padEnd(22)} "${r.txt}"  .${r.cls}`);
}

await browser.close();
