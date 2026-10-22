// 只检查 .button 体系（语义按钮类），排除其它可点击控件
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/notifications', '/parties', '/audit-logs',
  '/settings/appearance', '/system', '/system/security', '/system/governance',
  '/system/dictionaries', '/system/parameters', '/system/accounts', '/system/assistant',
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
  await page.waitForTimeout(870);

  const items = await page.evaluate(() => {
    const out = [];
    // 只认带 .button 语义类的元素
    for (const el of document.querySelectorAll('.button')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8) continue;
      const txt = (el.textContent || '').trim();
      if (!txt) continue;
      let zone = '普通';
      if (el.closest('.page-actions')) zone = '页头';
      else if (el.closest('.dialog-actions')) zone = '对话框';
      else if (el.closest('.row-actions, td')) zone = '表格行内';
      else if (el.closest('.ldg-tools')) zone = '台账工具';
      else if (el.closest('.data-table')) zone = '数据表';
      out.push({
        zone,
        txt: txt.slice(0, 8),
        fs: cs.fontSize,
        fw: cs.fontWeight,
        h: Math.round(r.height),
        cls: (el.className || '').toString().slice(0, 44),
      });
    }
    return out;
  });
  for (const it of items) rows.push({ route, ...it });
}

console.log(`=== .button 体系：${rows.length} 个实例 ===\n`);

const combos = new Map();
for (const r of rows) combos.set(`${r.fs}/${r.fw}`, (combos.get(`${r.fs}/${r.fw}`) || 0) + 1);
console.log('组合分布:');
for (const [k, n] of [...combos.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}×  ${k}`);
}
console.log(`\n共 ${combos.size} 种\n`);

console.log('按区域:');
const zones = new Map();
for (const r of rows) {
  if (!zones.has(r.zone)) zones.set(r.zone, new Map());
  const m = zones.get(r.zone);
  m.set(`${r.fs}/${r.fw}`, (m.get(`${r.fs}/${r.fw}`) || 0) + 1);
}
for (const [z, m] of zones) {
  console.log(`  ${z}: ${[...m.entries()].map(([k, n]) => `${k}(${n})`).join('  ')}`);
}

// 同区域必须同字号，但按高度档位区分：
//   32px 档 → 13px；  26px 档 → 11.5px；  表格行内 → 10.5px
// 按高度分档而不是按区域，因为同一区域里可能存在主按钮与紧凑按钮共存。
console.log('\n=== 断言：同高度档位字号必须一致 ===');
let bad = 0;
const byH = new Map();
for (const r of rows) {
  if (!byH.has(r.h)) byH.set(r.h, new Map());
  const m = byH.get(r.h);
  m.set(r.fs, (m.get(r.fs) || 0) + 1);
}
for (const [h, m] of [...byH.entries()].sort((a, b) => a[0] - b[0])) {
  const fsSet = [...m.keys()];
  const mark = fsSet.length > 1 ? '✗' : '✓';
  if (fsSet.length > 1) bad++;
  console.log(`  ${mark} ${h}px 档: ${fsSet.join(' vs ')}`);
}

// 表格行内单独看：它应该是 10.5
const inTable = rows.filter((r) => r.zone === '表格行内');
const tableFs = [...new Set(inTable.map((r) => r.fs))];
if (tableFs.length > 1) {
  bad++;
  console.log(`  ✗ 表格行内不一致: ${tableFs.join(' vs ')}`);
} else {
  console.log(`  ✓ 表格行内统一: ${tableFs[0] || '(无)'}`);
}

console.log(bad ? `\n${bad} 处不一致` : '\n全部通过：三档字号按高度绑定');

await browser.close();
