// 测量墨衡页面上所有按钮的实际规格，与 Hana 规律对照
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/moheng-buttons.json';

const ROUTES = ['/', '/projects', '/cost/contracts', '/settings/appearance', '/system/accounts', '/reports', '/audit-logs'];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const all = [];
for (const r of ROUTES) {
  await page.goto(BASE + r, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const btns = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role="button"], a.btn, .button')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const cs = getComputedStyle(el);
      out.push({
        cls: (el.className || '').toString().slice(0, 60),
        text: (el.textContent || '').trim().slice(0, 14),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        display: cs.display,
        alignItems: cs.alignItems,
        justify: cs.justifyContent,
        gap: cs.gap,
        padding: cs.padding,
        radius: cs.borderTopLeftRadius,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        cornerShape: cs.getPropertyValue('corner-shape'),
        hasIcon: !!el.querySelector('svg, img'),
      });
    }
    return out;
  });
  for (const b of btns) all.push({ route: r, ...b });
}

// 统计
const tally = (fn) => {
  const o = {};
  for (const b of all) { const v = fn(b); if (v) o[v] = (o[v] || 0) + 1; }
  return Object.entries(o).sort((a, b) => b[1] - a[1]);
};

console.log('total buttons:', all.length);

console.log('\n=== 高度分布 ===');
for (const [v, n] of tally((b) => b.h + 'px').slice(0, 14)) console.log(`  ${String(v).padEnd(10)} ${n}`);

console.log('\n=== display ===');
for (const [v, n] of tally((b) => b.display).slice(0, 6)) console.log(`  ${String(v).padEnd(16)} ${n}`);

console.log('\n=== align-items ===');
for (const [v, n] of tally((b) => b.alignItems).slice(0, 6)) console.log(`  ${String(v).padEnd(16)} ${n}`);

console.log('\n=== justify-content ===');
for (const [v, n] of tally((b) => b.justify).slice(0, 6)) console.log(`  ${String(v).padEnd(16)} ${n}`);

console.log('\n=== 圆角 ===');
for (const [v, n] of tally((b) => b.radius).slice(0, 10)) console.log(`  ${String(v).padEnd(16)} ${n}`);

console.log('\n=== padding ===');
for (const [v, n] of tally((b) => b.padding).slice(0, 12)) console.log(`  ${String(v).padEnd(30)} ${n}`);

console.log('\n=== gap ===');
for (const [v, n] of tally((b) => b.gap).slice(0, 8)) console.log(`  ${String(v).padEnd(16)} ${n}`);

console.log('\n=== 字号 ===');
for (const [v, n] of tally((b) => b.fontSize).slice(0, 8)) console.log(`  ${String(v).padEnd(12)} ${n}`);

console.log('\n=== corner-shape ===');
for (const [v, n] of tally((b) => b.cornerShape || '(none)').slice(0, 6)) console.log(`  ${String(v).padEnd(20)} ${n}`);

// 问题诊断
const problems = {
  notFlex: all.filter((b) => !/flex/.test(b.display)),
  notCentered: all.filter((b) => /flex/.test(b.display) && (b.alignItems !== 'center' || b.justify !== 'center')),
  noCornerShape: all.filter((b) => !b.cornerShape || b.cornerShape === 'none'),
  oddHeights: all.filter((b) => ![20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48].includes(b.h)),
};

console.log('\n=== 问题 ===');
console.log(`非 flex 布局: ${problems.notFlex.length}`);
for (const b of problems.notFlex.slice(0, 6)) console.log(`  ${b.route} .${b.cls.slice(0, 34)} "${b.text}" display=${b.display}`);
console.log(`flex 但未居中: ${problems.notCentered.length}`);
for (const b of problems.notCentered.slice(0, 6)) console.log(`  ${b.route} .${b.cls.slice(0, 34)} align=${b.alignItems} justify=${b.justify}`);
console.log(`缺 corner-shape: ${problems.noCornerShape.length}`);
for (const b of problems.noCornerShape.slice(0, 6)) console.log(`  ${b.route} .${b.cls.slice(0, 34)} radius=${b.radius}`);
console.log(`高度不在档位: ${problems.oddHeights.length}`);
for (const b of problems.oddHeights.slice(0, 10)) console.log(`  ${b.route} .${b.cls.slice(0, 34)} h=${b.h}px`);

writeFileSync(OUT, JSON.stringify({ total: all.length, buttons: all, problems: {
  notFlex: problems.notFlex.length, notCentered: problems.notCentered.length,
  noCornerShape: problems.noCornerShape.length, oddHeights: problems.oddHeights.length,
  notFlexSamples: problems.notFlex.slice(0, 20),
  notCenteredSamples: problems.notCentered.slice(0, 20),
  oddHeightSamples: problems.oddHeights.slice(0, 20),
} }, null, 2), 'utf8');

await browser.close();
