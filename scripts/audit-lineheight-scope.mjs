// 行高影响面：哪些元素实际继承 body 的 1.55，哪些自己有定义
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const ROUTES = ['/projects', '/cost/contracts', '/audit-logs', '/system/dictionaries', '/system/accounts'];

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const inherit = new Map();
const own = new Map();

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1300 });
  const r = await page.evaluate(() => {
    const out = { inherit: [], own: [] };
    // 穿透检查：所有有文字的元素
    for (const el of document.querySelectorAll('body *')) {
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
      if (!txt) continue;
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      if (cs.display === 'none') continue;

      const fs = parseFloat(cs.fontSize);
      const lh = cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight);
      const ratio = lh ? +(lh / fs).toFixed(3) : null;

      const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      const key = el.tagName.toLowerCase() + (cls ? '.' + cls : '') + `|${cs.fontSize}|${ratio}`;
      const item = { key, tag: el.tagName.toLowerCase() + (cls ? '.' + cls : ''), fs: cs.fontSize, lh: cs.lineHeight, ratio, text: txt.slice(0, 14), h: Math.round(b.height) };

      // 判断是否继承自 body：计算值的行高比接近 1.55
      if (ratio !== null && Math.abs(ratio - 1.55) < 0.005) out.inherit.push(item);
      else if (ratio !== null) out.own.push(item);
    }
    return out;
  });

  for (const i of r.inherit) if (!inherit.has(i.key)) inherit.set(i.key, { ...i, routes: [route] });
  for (const i of r.own) if (!own.has(i.key)) own.set(i.key, { ...i, routes: [route] });
}

console.log('=== 使用 1.55 行高比的元素（会被 body 改动影响）===\n');
const inh = [...inherit.values()];
console.log(`共 ${inh.length} 种元素签名\n`);
for (const i of inh.slice(0, 20)) {
  console.log(`  ${i.tag.padEnd(36)} ${i.fs.padEnd(8)} lh=${i.lh.padEnd(12)} h=${i.h}px  "${i.text}"`);
}
if (inh.length > 20) console.log(`  … 还有 ${inh.length - 20} 种`);

// 按字号分组，看影响量
const byFs = new Map();
for (const i of inh) {
  if (!byFs.has(i.fs)) byFs.set(i.fs, 0);
  byFs.set(i.fs, byFs.get(i.fs) + 1);
}
console.log('\n按字号分布:');
for (const [fs, n] of [...byFs.entries()].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))) {
  const px = parseFloat(fs);
  const old = +(px * 1.55).toFixed(2);
  const neu = +(px * 1.7).toFixed(2);
  console.log(`  ${fs.padEnd(8)} ${String(n).padStart(2)} 种   行高 ${old} → ${neu}px (+${(neu - old).toFixed(2)})`);
}

console.log(`\n=== 自己有行高定义的元素（不受影响）: ${own.size} 种 ===`);

await browser.close();
