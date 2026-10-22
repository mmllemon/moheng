// 测量墨衡的数据表格现状，对照 Hana 的阅读态表格设计语言
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/moheng-tables.json';

const ROUTES = ['/projects', '/cost/contracts', '/cost/costs', '/parties', '/audit-logs', '/system/accounts', '/reports'];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const all = [];
for (const r of ROUTES) {
  await page.goto(BASE + r, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    return tables.map((t) => {
      const wrap = t.closest('.table-scroll, .data-table-panel, .panel');
      const th = t.querySelector('thead th');
      const td = t.querySelector('tbody td');
      const row = t.querySelector('tbody tr');
      const evenRow = t.querySelector('tbody tr:nth-child(even)');
      const cs = (el) => el ? getComputedStyle(el) : null;
      const thS = cs(th), tdS = cs(td), rowS = cs(row), evenS = cs(evenRow), tS = cs(t);

      // 检测是否有竖线
      const hasVerticalBorder = tdS ? (parseFloat(tdS.borderLeftWidth) > 0 || parseFloat(tdS.borderRightWidth) > 0) : false;

      return {
        rows: t.querySelectorAll('tbody tr').length,
        cols: t.querySelectorAll('thead th').length,
        tableLayout: tS?.tableLayout,
        borderCollapse: tS?.borderCollapse,
        borderSpacing: tS?.borderSpacing,
        hasVerticalBorder,
        th: thS ? {
          padding: thS.padding,
          fontSize: thS.fontSize,
          fontWeight: thS.fontWeight,
          letterSpacing: thS.letterSpacing,
          textAlign: thS.textAlign,
          color: thS.color,
          bg: thS.backgroundColor,
          borderBottom: `${thS.borderBottomWidth} ${thS.borderBottomStyle} ${thS.borderBottomColor}`,
          height: Math.round(th.getBoundingClientRect().height),
        } : null,
        td: tdS ? {
          padding: tdS.padding,
          fontSize: tdS.fontSize,
          color: tdS.color,
          bg: tdS.backgroundColor,
          borderBottom: `${tdS.borderBottomWidth} ${tdS.borderBottomStyle} ${tdS.borderBottomColor}`,
          height: Math.round(td.getBoundingClientRect().height),
          fontVariantNumeric: tdS.fontVariantNumeric,
        } : null,
        rowHoverBg: null, // 需 hover 才测
        zebraBg: evenS ? evenS.backgroundColor : null,
        wrapOverflow: wrap ? getComputedStyle(wrap).overflow : null,
      };
    });
  });
  for (const t of info) all.push({ route: r, ...t });
}

// 测 hover 态（单独做）
await page.goto(BASE + '/projects', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const hoverTest = await page.evaluate(async () => {
  const row = document.querySelector('tbody tr');
  if (!row) return null;
  const before = getComputedStyle(row).backgroundColor;
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  const after = getComputedStyle(row).backgroundColor;
  return { before, after, changed: before !== after };
});

console.log('tables found:', all.length);
console.log('\n=== 表格总览 ===');
for (const t of all) {
  console.log(`${t.route.padEnd(20)} rows=${String(t.rows).padEnd(4)} cols=${String(t.cols).padEnd(3)} vertical-border=${t.hasVerticalBorder} collapse=${t.borderCollapse}`);
}

console.log('\n=== 表头样式 ===');
for (const t of all.filter((x) => x.th)) {
  console.log(`${t.route.padEnd(20)} pad=${String(t.th.padding).padEnd(20)} fs=${String(t.th.fontSize).padEnd(7)} fw=${String(t.th.fontWeight).padEnd(4)} ls=${String(t.th.letterSpacing).padEnd(8)} bg=${t.th.bg}`);
}

console.log('\n=== 单元格样式 ===');
for (const t of all.filter((x) => x.td)) {
  console.log(`${t.route.padEnd(20)} pad=${String(t.td.padding).padEnd(20)} fs=${String(t.td.fontSize).padEnd(7)} h=${String(t.td.height).padEnd(4)} bottom=${t.td.borderBottom}`);
}

console.log('\n=== 斑马纹 ===');
const zebras = new Set(all.map((t) => t.zebraBg));
for (const z of zebras) console.log('  ' + (z ?? '(none)'));

console.log('\n=== hover 测试 ===');
console.log(JSON.stringify(hoverTest));

writeFileSync(OUT, JSON.stringify({ tables: all, hoverTest, zebraVariants: [...zebras] }, null, 2), 'utf8');
await browser.close();
