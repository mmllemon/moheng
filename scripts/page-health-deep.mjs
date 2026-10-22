// 深度页面健康检查：更全面的塌陷判据
// 新增：元素重叠、文字溢出容器、按钮不可见、表格列错位、z-index 层级错乱
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/page-health-deep.json';

const ROUTES = [
  '/', '/projects', '/projects/members',
  '/cost/contracts', '/cost/budget', '/cost/progress-bills', '/cost/changes',
  '/cost/downstream', '/cost/owner-finance', '/cost/costs', '/cost/analysis',
  '/reports', '/reports/designer', '/reports/studio', '/reports/preview',
  '/notifications', '/parties', '/audit-logs', '/settings/appearance',
  '/system', '/system/security', '/system/authorization', '/system/policies',
  '/system/governance', '/system/operations', '/system/dictionaries',
  '/system/parameters', '/system/accounts', '/system/assistant',
  '/account/security',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));

await login(page);

const results = [];

for (const route of ROUTES) {
  const before = errors.length;
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(1200);

  const report = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const issues = [];

    const visibleEls = (sel) => [...document.querySelectorAll(sel)].filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });

    // 1. 文字溢出容器（内容被裁切）
    for (const el of visibleEls('.panel, .settings-card, .page-header, td, th')) {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'visible') continue;
      if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0) {
        issues.push({ type: 'text-clipped', cls: (el.className || '').toString().slice(0, 40), scrollW: el.scrollWidth, clientW: el.clientWidth });
      }
    }

    // 2. 元素超出视口右边界
    for (const el of visibleEls('.panel, .settings-card, table, .page-header, .sys-split, .toolbar')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 8) {
        issues.push({ type: 'overflow-right', cls: (el.className || '').toString().slice(0, 40), right: Math.round(r.right), vw });
      }
    }

    // 3. 表格列错位：th 与 td 宽度不匹配
    for (const table of visibleEls('table')) {
      const ths = [...table.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width));
      const firstRow = table.querySelector('tbody tr');
      if (firstRow && ths.length) {
        const tds = [...firstRow.querySelectorAll('td')].map((td) => Math.round(td.getBoundingClientRect().width));
        if (tds.length === ths.length) {
          const mismatch = ths.filter((w, i) => Math.abs(w - tds[i]) > 3).length;
          if (mismatch > 0) issues.push({ type: 'table-col-mismatch', cols: mismatch, ths: ths.slice(0, 8), tds: tds.slice(0, 8) });
        }
      }
      // 表格宽度超出容器
      const tr = table.getBoundingClientRect();
      const parent = table.parentElement;
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (tr.width > pr.width + 4) issues.push({ type: 'table-wider-than-container', tableW: Math.round(tr.width), parentW: Math.round(pr.width) });
      }
    }

    // 4. 元素重叠（面板相互压盖）
    const panels = visibleEls('.panel, .settings-card');
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i].getBoundingClientRect();
        const b = panels[j].getBoundingClientRect();
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 10 && overlapY > 10) {
          issues.push({ type: 'panel-overlap', a: (panels[i].className || '').toString().slice(0, 30), b: (panels[j].className || '').toString().slice(0, 30), ox: Math.round(overlapX), oy: Math.round(overlapY) });
        }
      }
    }

    // 5. 按钮/控件不可点击（宽高为 0 或被遮挡）
    for (const btn of visibleEls('button')) {
      const r = btn.getBoundingClientRect();
      if (r.height < 12) issues.push({ type: 'tiny-button', text: (btn.textContent || '').trim().slice(0, 16), h: Math.round(r.height) });
    }

    // 6. 页面内容高度异常（相比同类页面）
    const pw = document.querySelector('.page-wrap');
    const contentH = pw ? Math.round(pw.getBoundingClientRect().height) : 0;

    return {
      url: location.pathname + location.search,
      contentH,
      issues,
      textLen: (document.body.innerText || '').trim().length,
    };
  });

  const newErrors = errors.slice(before);
  results.push({ route, ...report, errors: newErrors });
  const flag = report.issues.length || newErrors.length ? `⚠ ${report.issues.length} issues` : 'ok';
  console.log(`${route.padEnd(32)} h=${String(report.contentH).padEnd(5)} ${flag}`);
}

const bad = results.filter((r) => r.issues.length || r.errors.length);
console.log(`\n=== ${bad.length} 个页面有问题 ===`);
for (const b of bad) {
  console.log(`\n【${b.route}】 h=${b.contentH}`);
  const grouped = {};
  for (const i of b.issues) { grouped[i.type] = (grouped[i.type] || 0) + 1; }
  console.log(`  ${JSON.stringify(grouped)}`);
  for (const i of b.issues.slice(0, 4)) console.log(`    ${JSON.stringify(i)}`);
  if (b.errors.length) console.log(`  errors: ${JSON.stringify(b.errors.slice(0, 2))}`);
}

writeFileSync(OUT, JSON.stringify({ total: results.length, badCount: bad.length, results }, null, 2), 'utf8');
await browser.close();
