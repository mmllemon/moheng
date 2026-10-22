// 全量扫描：所有页面的统计卡容器 + 卡片，找出全部差异
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/stat-audit-full.json';

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

const report = [];

for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(1000);

  const found = await page.evaluate(() => {
    const out = [];
    // 所有可能是"统计卡容器"的 grid/flex 块：内部有 strong 且有 2+ 子项
    const cands = new Set();
    for (const el of document.querySelectorAll('[class*="grid"], [class*="metrics"], [class*="summary"], [class*="stats"], [class*="strip"]')) {
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.width < 300) continue;
      const cs = getComputedStyle(el);
      if (!/grid|flex/.test(cs.display)) continue;
      const strongs = el.querySelectorAll('strong, .metric-value, [class*="value"]');
      if (strongs.length < 2) continue;
      cands.add(el);
    }

    for (const el of cands) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const cards = [...el.children];
      const cardStyles = cards.slice(0, 2).map((c) => {
        const ccs = getComputedStyle(c);
        return {
          cls: (c.className || '').toString().slice(0, 36),
          alignItems: ccs.alignItems,
          textAlign: ccs.textAlign,
          padding: ccs.padding,
          borderLeft: ccs.borderLeftWidth,
          bg: ccs.backgroundColor.slice(0, 20),
          hasIcon: !!c.querySelector('svg, [class*="icon"]'),
        };
      });
      out.push({
        gridCls: (el.className || '').toString().slice(0, 64),
        w: Math.round(r.width), h: Math.round(r.height),
        display: cs.display,
        cols: cs.gridTemplateColumns.slice(0, 80),
        gap: cs.gap,
        padding: cs.padding,
        borderTop: cs.borderTopWidth + ' ' + cs.borderTopColor.slice(0, 22),
        borderBottom: cs.borderBottomWidth,
        radius: cs.borderTopLeftRadius,
        bg: cs.backgroundColor.slice(0, 22),
        childCount: cards.length,
        cardStyles,
      });
    }
    return out;
  });

  if (found.length) report.push({ route, blocks: found });
}

// 汇总所有容器规格
const specs = new Map();
for (const r of report) {
  for (const b of r.blocks) {
    const key = `${b.borderTop.split(' ')[0]}|${b.radius}|${b.padding}|${b.bg}`;
    if (!specs.has(key)) specs.set(key, []);
    specs.get(key).push({ route: r.route, cls: b.gridCls.slice(0, 40), h: b.h });
  }
}

console.log('=== 各页面统计块 ===');
for (const r of report) {
  console.log(`\n${r.route}`);
  for (const b of r.blocks) {
    const iconMark = b.cardStyles.some((c) => c.hasIcon) ? ' [有图标]' : '';
    const alignMark = b.cardStyles.some((c) => c.alignItems === 'center') ? ' [居中]' : '';
    console.log(`  ${b.gridCls.slice(0, 44).padEnd(46)} ${b.w}x${b.h} ${b.childCount}项${iconMark}${alignMark}`);
    console.log(`    border=${b.borderTop} radius=${b.radius} pad=${b.padding} bg=${b.bg}`);
    if (b.cardStyles[0]) console.log(`    card: align=${b.cardStyles[0].alignItems} pad=${b.cardStyles[0].padding} bL=${b.cardStyles[0].borderLeft}`);
  }
}

console.log('\n\n=== 规格分组（同规格的页面归为一组）===');
for (const [key, list] of [...specs.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n[${key}]  ${list.length} 处`);
  for (const x of list) console.log(`   ${x.route.padEnd(26)} ${x.cls}`);
}

writeFileSync(OUT, JSON.stringify({ report, specs: [...specs.entries()] }, null, 2), 'utf8');
await browser.close();
