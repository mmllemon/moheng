// 统计卡规范验收：容器规格唯一性 + 卡片对齐一致性
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members',
  '/cost/contracts', '/cost/budget', '/cost/progress-bills', '/cost/changes',
  '/cost/downstream', '/cost/owner-finance', '/cost/costs', '/cost/analysis',
  '/reports', '/reports/designer', '/reports/studio',
  '/notifications', '/parties', '/audit-logs',
  '/settings/appearance',
  '/system', '/system/security', '/system/authorization', '/system/policies',
  '/system/governance', '/system/operations', '/system/dictionaries',
  '/system/parameters', '/system/accounts', '/system/assistant',
  '/account/security',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const rows = [];
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(950);

  const found = await page.evaluate(() => {
    const out = [];
    const cands = new Set();
    for (const el of document.querySelectorAll('[class*="grid"], [class*="metrics"], [class*="summary"], [class*="stats"], [class*="strip"]')) {
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.width < 300) continue;
      const cs = getComputedStyle(el);
      if (!/grid|flex/.test(cs.display)) continue;
      if (el.querySelectorAll('strong').length < 2) continue;
      cands.add(el);
    }
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    for (const el of cands) {
      const cs = getComputedStyle(el);
      const cards = [...el.children].filter(visible);
      if (cards.length < 2) continue;
      const c0 = getComputedStyle(cards[0]);
      // 可见的图标（排除 display:none 的）
      const iconVisible = cards.some((c) => [...c.querySelectorAll('svg, [class*="icon"]')].some(visible));
      out.push({
        gridCls: (el.className || '').toString().slice(0, 56),
        n: cards.length,
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
        radius: cs.borderTopLeftRadius,
        bg: cs.backgroundColor,
        borderTop: cs.borderTopWidth,
        borderBottom: cs.borderBottomWidth,
        padTop: cs.paddingTop,
        alignItems: c0.alignItems,
        cardPadLeft: c0.paddingLeft,
        cardBorderLeft: c0.borderLeftWidth,
        iconVisible,
        valueSize: (() => {
          const s = cards[0].querySelector('strong');
          return s ? getComputedStyle(s).fontSize : null;
        })(),
        valueWeight: (() => {
          const s = cards[0].querySelector('strong');
          return s ? getComputedStyle(s).fontWeight : null;
        })(),
      });
    }
    return out;
  });
  for (const f of found) rows.push({ route, ...f });
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const issues = [];
for (const r of rows) {
  const bad = [];
  if (r.radius !== '0px') bad.push(`radius=${r.radius}`);
  if (r.bg !== TRANSPARENT) bad.push(`bg=${r.bg}`);
  if (r.borderTop !== '1px') bad.push(`borderTop=${r.borderTop}`);
  if (r.borderBottom !== '1px') bad.push(`borderBottom=${r.borderBottom}`);
  if (r.alignItems !== 'flex-start' && r.alignItems !== 'normal') bad.push(`align=${r.alignItems}`);
  if (r.iconVisible) bad.push('有图标');
  if (r.valueSize !== '26px') bad.push(`value=${r.valueSize}`);
  if (r.valueWeight !== '600') bad.push(`weight=${r.valueWeight}`);
  if (bad.length) issues.push({ route: r.route, cls: r.gridCls, bad });
}

console.log(`=== 扫描 ${rows.length} 个统计块 / ${ROUTES.length} 个路由 ===\n`);
if (!issues.length) {
  console.log('全部符合规范：透明 · 圆角0 · 上下1px · 左对齐 · 无图标 · 26px/600');
} else {
  console.log(`仍有 ${issues.length} 处不合规：\n`);
  for (const i of issues) console.log(`  ${i.route.padEnd(24)} ${i.cls.padEnd(40)} ${i.bad.join(' | ')}`);
}

// 规格唯一性统计
const keys = new Map();
for (const r of rows) {
  const k = `radius=${r.radius} bg=${r.bg} bt=${r.borderTop} pad=${r.padTop} icon=${r.iconVisible} v=${r.valueSize}/${r.valueWeight}`;
  keys.set(k, (keys.get(k) || 0) + 1);
}
console.log(`\n=== 规格分布（共 ${keys.size} 种） ===`);
for (const [k, n] of [...keys.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(2)}×  ${k}`);

await browser.close();
