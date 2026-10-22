// 行高改动真实影响：对比改前改后的实际渲染行高
// 判据：继承 body 的元素（computed lineHeight 变化）vs 自己声明的（不变）
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const ROUTES = ['/projects', '/cost/contracts', '/audit-logs', '/system/dictionaries', '/system/accounts'];

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

// 先注入一个探针函数，记录每个有文字元素的行高与来源
const results = [];

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1300 });
  const r = await page.evaluate(() => {
    const out = { changed: [], own: [] };
    const bodyLh = getComputedStyle(document.body).lineHeight;
    const bodyFs = parseFloat(getComputedStyle(document.body).fontSize);
    const bodyRatio = parseFloat(bodyLh) / bodyFs;

    for (const el of document.querySelectorAll('body *')) {
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
      if (!txt) continue;
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1 || cs.display === 'none') continue;
      const fs = parseFloat(cs.fontSize);
      const lh = parseFloat(cs.lineHeight);
      if (!lh || !fs) continue;
      const ratio = lh / fs;
      const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      const tag = el.tagName.toLowerCase() + (cls ? '.' + cls : '');

      // 关键：这个元素的行高比是否等于 body 的比，且字面值等于 fs*bodyRatio
      // → 说明它继承自 body（没有自己的 line-height 声明）
      const isInherited = Math.abs(ratio - bodyRatio) < 0.01;

      // 它属于哪个字号档，改成 1.7 后会怎样
      const newLh = isInherited ? fs * 1.7 : lh;
      const delta = newLh - lh;

      const item = { tag, fs: cs.fontSize, lh: cs.lineHeight, ratio: +ratio.toFixed(3), delta: +delta.toFixed(2), text: txt.slice(0, 12), h: Math.round(b.height) };
      if (delta > 0.1) out.changed.push(item);
      else out.own.push(item);
    }
    return { ...out, bodyRatio: +bodyRatio.toFixed(3) };
  });

  results.push({ route, ...r });
}

console.log('=== 当前 body 行高比 ===');
console.log(`  ${results[0].bodyRatio}`);

const allChanged = new Map();
const allOwn = new Set();
for (const r of results) {
  for (const c of r.changed) {
    const k = `${c.tag}|${c.fs}|${c.lh}`;
    if (!allChanged.has(k)) allChanged.set(k, { ...c, routes: [r.route] });
  }
  for (const o of r.own) allOwn.add(`${o.tag}|${o.fs}|${o.lh}`);
}

console.log(`\n=== 行高实际变大的元素: ${allChanged.size} 种 ===`);
const byFs = new Map();
for (const c of allChanged.values()) {
  if (!byFs.has(c.fs)) byFs.set(c.fs, []);
  byFs.get(c.fs).push(c);
}
for (const [fs, items] of [...byFs.entries()].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))) {
  console.log(`  ${fs.padEnd(8)} ${String(items.length).padStart(2)} 种  lh ${items[0].lh} → +${items[0].delta}px`);
  for (const i of items.slice(0, 3)) console.log(`      ${i.tag.padEnd(34)} "${i.text}"`);
}
console.log(`\n不受影响（自己有行高）: ${allOwn.size} 种`);

// 关键：元素高度变化的元素
console.log('\n=== 元素可见高度变化（h 只受行高影响的单行元素）===');
let grew = 0;
for (const c of allChanged.values()) {
  // 单行元素高度 ≈ 行高
  if (c.h > 0 && c.h <= parseFloat(c.lh) + 4) grew++;
}
console.log(`  单行元素中会有 ${grew} 种高度增加约 1-2px`);

await browser.close();
