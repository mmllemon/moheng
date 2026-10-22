// 主题一致性探针 v2：判据改为「相对比较」
// 不预设立场判断颜色深浅，而是看：同元素在 4 套主题下是否真的变了
// 该变的没变 = 硬编码；变的幅度异常 = 可能有问题
import { chromium } from 'playwright-core';
import { writeFileSync, readFileSync } from 'node:fs';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const THEMES = ['warm-paper', 'plain-white', 'midnight', 'high-contrast'];
const ROUTES = ['/', '/projects', '/cost/contracts', '/system/dictionaries', '/audit-logs'];

const SURFACES = {
  body: 'body',
  panel: '.panel',
  tableHead: '.data-table thead th',
  tableCell: '.data-table tbody td',
  input: '.field input, .toolbar-search input, .ldg-search',
  sidebar: '.sidebar',
  heading: 'h1',
  primaryBtn: '.button-primary',
  secondaryBtn: '.button-secondary',
  badge: '.status-badge',
  metric: '.system-overview-metric, .owner-metric, .v6-block, .metric-card',
  pageHeader: '.page-header',
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
await assertApiUp();

const result = {};

for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(500);

  result[theme] = {};
  for (const route of ROUTES) {
    await gotoRoute(page, route, { settle: 1000 });
    result[theme][route] = await page.evaluate((surfaces) => {
      const out = {};
      for (const [name, sel] of Object.entries(surfaces)) {
        const e = document.querySelector(sel);
        if (!e) continue;
        const cs = getComputedStyle(e);
        out[name] = {
          bg: cs.backgroundColor,
          color: cs.color,
          border: cs.borderTopColor,
        };
      }
      return out;
    }, SURFACES);
  }
  await ctx.close();
  console.log(`  ${theme}`);
}
await browser.close();

writeFileSync('D:/WorkSpace/hana/moheng/docs/gates/theme-probe.json', JSON.stringify(result, null, 1));

// 分析：对每个表面，统计它在 4 主题下有几种不同的 bg
console.log('\n=== 各表面在 4 套主题下的唯一背景色数量 ===');
console.log('（1 种 = 完全不跟随主题，疑似硬编码）\n');

const agg = new Map();
for (const theme of THEMES) {
  for (const [route, surfaces] of Object.entries(result[theme])) {
    for (const [name, v] of Object.entries(surfaces)) {
      if (!agg.has(name)) agg.set(name, new Map());
      const m = agg.get(name);
      if (!m.has(v.bg)) m.set(v.bg, []);
      m.get(v.bg).push(`${theme}${route}`);
    }
  }
}

for (const [name, colors] of [...agg.entries()].sort((a, b) => a[1].size - b[1].size)) {
  const n = colors.size;
  const flag = n === 1 ? '  ⚠ 未跟随主题' : n === 2 ? '  ~ 仅 2 种' : '';
  console.log(`${name.padEnd(14)} ${n} 种${flag}`);
  if (n <= 2) {
    for (const [c, where] of colors) {
      console.log(`      ${c.padEnd(34)} ${where.slice(0, 3).join(', ')}${where.length > 3 ? ` +${where.length - 3}` : ''}`);
    }
  }
}

// 文字色同理
console.log('\n=== 各表面文字色跟随情况 ===');
for (const name of agg.keys()) {
  const set = new Set();
  for (const theme of THEMES) for (const s of Object.values(result[theme])) if (s[name]) set.add(s[name].color);
  if (set.size === 1) console.log(`  ⚠ ${name.padEnd(14)} 文字色恒定: ${[...set][0]}`);
}
console.log('\n→ docs/gates/theme-probe.json');
