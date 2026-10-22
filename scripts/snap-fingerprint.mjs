// 全站计算样式指纹：遍历所有可见元素，记录关键属性，用于「删规则前后」严格比对
// 这是最硬的验证：不猜谁的属性被覆盖，直接看删除后计算值变不变
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2] || 'docs/gates/fingerprint-after.json';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/notifications',
  '/parties', '/audit-logs', '/settings/appearance', '/system', '/system/security',
  '/system/policies', '/system/governance', '/system/operations',
  '/system/dictionaries', '/system/parameters', '/system/accounts',
  '/system/assistant', '/account/security',
];

// 抓取哪些属性
const PROPS = [
  'display', 'position', 'flexDirection', 'alignItems', 'justifyContent', 'flexWrap', 'gap',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'paddingTop', 'paddingRight',
  'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderTopWidth', 'borderTopColor', 'borderBottomWidth', 'borderBottomColor',
  'borderLeftWidth', 'borderLeftColor', 'borderRightWidth', 'borderRightColor',
  'borderTopLeftRadius', 'borderTopRightRadius',
  'backgroundColor', 'backgroundImage', 'color', 'fontSize', 'fontWeight', 'fontFamily',
  'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'whiteSpace',
  'boxShadow', 'opacity', 'visibility', 'overflow', 'cursor', 'zIndex', 'gridTemplateColumns',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const result = {};

for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(950);

  const snap = await page.evaluate((props) => {
    const out = [];
    const all = document.querySelectorAll('body *');
    let idx = 0;
    for (const el of all) {
      if (/^(SCRIPT|STYLE|LINK|META|TITLE|HEAD)$/.test(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;

      const rec = { i: idx++, tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 90) };
      const style = {};
      for (const p of props) style[p] = cs[p];
      // 位置和尺寸单独放，便于区分
      rec.box = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
      rec.style = style;
      out.push(rec);
      if (out.length > 2600) break;
    }
    return out;
  }, PROPS);

  result[route] = snap;
  console.log(`  ${route.padEnd(24)} ${snap.length} 个可见元素`);
}

writeFileSync(OUT, JSON.stringify(result, null, 1));
const totalEl = Object.values(result).reduce((s, a) => s + a.length, 0);
console.log(`\n合计 ${totalEl} 个元素快照 → ${OUT}`);
await browser.close();
