// 多视口健康检查：排查响应式导致的崩溃
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/page-health-viewports.json';

const VIEWPORTS = [
  { w: 1440, h: 900, name: '1440-desktop' },
  { w: 1280, h: 800, name: '1280-laptop' },
  { w: 1024, h: 768, name: '1024-small' },
  { w: 768, h: 1024, name: '768-tablet' },
  { w: 390, h: 844, name: '390-mobile' },
];

const ROUTES = [
  '/cost/progress-bills', '/cost/changes', '/cost/owner-finance',
  '/cost/contracts', '/cost/budget', '/cost/costs', '/cost/analysis',
  '/projects', '/reports', '/system/accounts', '/system/parameters',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 150)));

  await login(page);

  console.log(`\n===== ${vp.name} (${vp.w}x${vp.h}) =====`);

  for (const route of ROUTES) {
    const before = errors.length;
    await page.evaluate((r) => {
      window.history.pushState(null, '', r);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForTimeout(1000);

    const info = await page.evaluate(() => {
      const vw = window.innerWidth;
      const scrollW = document.documentElement.scrollWidth;
      const bodyScrollW = document.body.scrollWidth;
      const pw = document.querySelector('.page-wrap');
      const pwR = pw ? pw.getBoundingClientRect() : null;

      // 检测元素被裁切
      let clipped = 0;
      for (const el of document.querySelectorAll('.panel, .settings-card, table, .page-header, button')) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display === 'none' || r.width === 0) continue;
        if (r.right > vw + 4) clipped++;
      }

      return {
        contentH: pwR ? Math.round(pwR.height) : 0,
        scrollW, bodyScrollW, vw,
        hasHScroll: Math.max(scrollW, bodyScrollW) > vw + 2,
        clipped,
        textLen: (document.body.innerText || '').trim().length,
      };
    });

    const newErr = errors.slice(before);
    const flags = [];
    if (info.hasHScroll) flags.push(`H-SCROLL(${info.scrollW}>${info.vw})`);
    if (info.clipped > 0) flags.push(`CLIPPED:${info.clipped}`);
    if (newErr.length) flags.push(`ERR:${newErr.length}`);
    if (info.textLen < 30) flags.push('EMPTY');

    results.push({ viewport: vp.name, route, ...info, errors: newErr, flags });
    console.log(`  ${route.padEnd(26)} h=${String(info.contentH).padEnd(5)} ${flags.length ? flags.join(' ') : 'ok'}`);
  }
  await ctx.close();
}

const bad = results.filter((r) => r.flags.length);
console.log(`\n=== 共 ${results.length} 组合，${bad.length} 有问题 ===`);
const byRoute = {};
for (const b of bad) { byRoute[b.route] = byRoute[b.route] || []; byRoute[b.route].push(b.viewport + ':' + b.flags.join(',')); }
for (const [r, v] of Object.entries(byRoute)) {
  console.log(`\n${r}`);
  for (const x of v) console.log(`  ${x}`);
}

writeFileSync(OUT, JSON.stringify({ total: results.length, badCount: bad.length, results }, null, 2), 'utf8');
await browser.close();
