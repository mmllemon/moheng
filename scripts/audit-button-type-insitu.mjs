// 精确诊断：22 种字号组合中，哪些是真问题，哪些是不同控件的合理差异
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

// 逐个页面、逐个容器检查：同一容器内字号是否一致
const ROUTES = [
  '/', '/projects', '/cost/contracts', '/cost/budget', '/cost/progress-bills',
  '/cost/changes', '/cost/downstream', '/cost/owner-finance', '/cost/costs',
  '/cost/analysis', '/reports', '/notifications', '/parties', '/audit-logs',
  '/system', '/system/security', '/system/governance', '/system/dictionaries',
  '/system/accounts', '/system/assistant', '/settings/appearance',
];

const problems = [];
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(880);

  const found = await page.evaluate(() => {
    const out = [];
    // 找所有「操作容器」，检查内部按钮字号
    const containers = document.querySelectorAll(
      '.page-actions, .table-heading-actions, .ds-section-actions, .dialog-actions,'
      + '.row-actions, .ldg-tools, .toolbar-view-toggle, .settings-section-actions,'
      + '.panel-head, .card-actions, .ldg-section-head'
    );
    for (const box of containers) {
      const btns = [...box.querySelectorAll('button, .button, [role=button]')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none') return false;
          const r = el.getBoundingClientRect();
          return r.height >= 8 && (el.textContent || '').trim().length > 0;
        });
      if (btns.length < 2) continue;
      const specs = btns.map((el) => {
        const cs = getComputedStyle(el);
        return {
          fs: cs.fontSize,
          fw: cs.fontWeight,
          h: Math.round(el.getBoundingClientRect().height),
          txt: (el.textContent || '').trim().slice(0, 8),
        };
      });
      const fsSet = new Set(specs.map((s) => `${s.fs}/${s.fw}`));
      if (fsSet.size > 1) {
        out.push({
          container: (box.className || '').toString().split(' ')[0],
          variants: [...fsSet],
          items: specs,
        });
      }
    }
    return out;
  });

  for (const f of found) problems.push({ route, ...f });
}

console.log(`=== 同容器内按钮字号不一致：${problems.length} 处 ===\n`);
const seen = new Set();
for (const p of problems) {
  const key = `${p.container} ${p.variants.join('|')}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`${p.route}  .${p.container}`);
  console.log(`   字号: ${p.variants.join('  vs  ')}`);
  for (const it of p.items) console.log(`     ${it.fs}/${it.fw}  h=${it.h}  "${it.txt}"`);
  console.log('');
}

await browser.close();
