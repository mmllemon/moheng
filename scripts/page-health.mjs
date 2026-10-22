// 全量页面健康检查 v2：单次登录 + SPA 导航，避免重复 refresh 触发限流
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/page-health.json';

const ROUTES = [
  '/', '/projects', '/projects/members',
  '/cost/contracts', '/cost/budget', '/cost/progress-bills', '/cost/changes',
  '/cost/downstream', '/cost/downstream?view=finance', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis',
  '/reports', '/reports/designer', '/reports/studio', '/reports/preview',
  '/notifications', '/parties',
  '/audit-logs',
  '/settings/appearance',
  '/system', '/system/security', '/system/authorization', '/system/policies',
  '/system/governance', '/system/operations', '/system/dictionaries',
  '/system/parameters', '/system/accounts', '/system/assistant',
  '/account/security',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push({ type: 'pageerror', msg: e.message.slice(0, 200) }));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push({ type: 'console', msg: m.text().slice(0, 200) });
});

// 单次登录
await login(page);

const results = [];

for (const route of ROUTES) {
  const before = errors.length;

  // SPA 内导航，不重新加载页面（避免 refresh token 消耗）
  await page.evaluate((r) => {
    const [path, query] = r.split('?');
    window.history.pushState(null, '', path + (query ? '?' + query : ''));
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(1100);

  const health = await page.evaluate(() => {
    const body = document.body;
    const text = (body.innerText || '').trim();
    const content = document.querySelector('.page-wrap, .settings-content');
    const contentRect = content ? content.getBoundingClientRect() : null;
    const viewportW = window.innerWidth;

    const broken = [];
    for (const el of document.querySelectorAll('.panel, .settings-card, .data-table, .page-header, .sys-split')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      if (r.width > 0 && (r.width < 50 || r.right > viewportW + 20)) {
        broken.push({ cls: (el.className || '').toString().slice(0, 44), w: Math.round(r.width), right: Math.round(r.right) });
      }
      if (r.height === 0 && el.children.length > 0) {
        broken.push({ cls: (el.className || '').toString().slice(0, 44), note: 'zero-height' });
      }
    }

    return {
      url: location.pathname + location.search,
      textLen: text.length,
      textHead: text.replace(/\s+/g, ' ').slice(0, 80),
      hasShell: !!document.querySelector('.app-shell'),
      hasPageWrap: !!document.querySelector('.page-wrap'),
      hasHeader: !!document.querySelector('.page-header'),
      contentH: contentRect ? Math.round(contentRect.height) : 0,
      overflowX: (document.scrollingElement?.scrollWidth ?? 0) > viewportW + 1,
      brokenCount: broken.length,
      broken: broken.slice(0, 6),
      hasErrorText: /出错了|加载失败|无法加载|undefined|NaN|\[object Object\]/.test(text),
      isEmpty: text.length < 30,
    };
  });

  const newErrors = errors.slice(before).filter((e) => !e.msg.includes('429'));
  results.push({ route, ...health, errors: newErrors });

  const flags = [];
  if (!health.hasShell) flags.push('NO-SHELL');
  if (!health.hasPageWrap) flags.push('NO-PAGEWRAP');
  if (health.isEmpty) flags.push('EMPTY');
  if (health.hasErrorText) flags.push('ERROR-TEXT');
  if (health.overflowX) flags.push('OVERFLOW-X');
  if (health.brokenCount) flags.push('BROKEN:' + health.brokenCount);
  if (newErrors.length) flags.push('JS-ERR:' + newErrors.length);

  console.log(`${route.padEnd(34)} h=${String(health.contentH).padEnd(5)} txt=${String(health.textLen).padEnd(5)} ${flags.length ? flags.join(' ') : 'ok'}`);
}

const bad = results.filter((r) =>
  !r.hasShell || !r.hasPageWrap || r.isEmpty || r.hasErrorText || r.overflowX || r.brokenCount || r.errors.length
);

console.log('\n=== 汇总 ===');
console.log(`总 ${results.length}，异常 ${bad.length}`);
for (const b of bad) {
  console.log(`\n【${b.route}】 h=${b.contentH} txt=${b.textLen}`);
  console.log(`  text: "${b.textHead}"`);
  if (b.broken.length) console.log(`  broken: ${JSON.stringify(b.broken)}`);
  if (b.errors.length) console.log(`  errors: ${JSON.stringify(b.errors.slice(0, 3))}`);
}

writeFileSync(OUT, JSON.stringify({ total: results.length, brokenCount: bad.length, results }, null, 2), 'utf8');
await browser.close();
