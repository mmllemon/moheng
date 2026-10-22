// 精确测量：body 行高 1.55 → 1.7 在桌面端到底影响哪些元素
// 方法：同一页面内，用 JS 临时改 html 的 line-height，对比前后 computed
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const ROUTES = ['/', '/projects', '/cost/contracts', '/audit-logs', '/system/dictionaries', '/system/accounts', '/parties'];

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const affected = new Map();

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1400 });

  const r = await page.evaluate(() => {
    const snap = () => {
      const m = new Map();
      for (const el of document.querySelectorAll('body, body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none') continue;
        const b = el.getBoundingClientRect();
        const key = (() => {
          // 用 DOM 路径做稳定标识
          const path = [];
          let n = el;
          while (n && n !== document.body && path.length < 6) {
            const cls = (typeof n.className === 'string' ? n.className : '').split(/\s+/).filter(Boolean)[0] || '';
            path.unshift(n.tagName.toLowerCase() + (cls ? '.' + cls : ''));
            n = n.parentElement;
          }
          return path.join('>');
        })();
        m.set(el, { key, lh: cs.lineHeight, fs: cs.fontSize, h: Math.round(b.height), w: Math.round(b.width) });
      }
      return m;
    };

    const before = snap();
    // 临时把 body 行高改成 1.7（模拟改动）
    const style = document.createElement('style');
    style.id = '__lh_probe';
    style.textContent = 'body { line-height: 1.7 !important; }';
    document.head.appendChild(style);
    // 强制重排
    void document.body.offsetHeight;
    const after = snap();
    style.remove();

    const changed = [];
    for (const [el, a] of before) {
      const b = after.get(el);
      if (!b) continue;
      if (a.lh !== b.lh) {
        changed.push({ key: a.key, fs: a.fs, from: a.lh, to: b.lh, hFrom: a.h, hTo: b.h });
      }
    }
    return changed;
  });

  for (const c of r) {
    const k = `${c.key}|${c.fs}|${c.from}`;
    if (!affected.has(k)) affected.set(k, { ...c, routes: [route] });
    else affected.get(k).routes.push(route);
  }
  console.log(`  ${route}: ${r.length} 个元素行高会变`);
}

console.log(`\n=== 汇总：桌面端受 body 行高影响的元素 ${affected.size} 种 ===`);
const byFs = new Map();
for (const a of affected.values()) {
  if (!byFs.has(a.fs)) byFs.set(a.fs, []);
  byFs.get(a.fs).push(a);
}
for (const [fs, items] of [...byFs.entries()].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))) {
  const px = parseFloat(fs);
  console.log(`  ${fs.padEnd(8)} ${String(items.length).padStart(2)} 种   行高 ${items[0].from} → ${items[0].to}  高度 ${items[0].hFrom} → ${items[0].hTo}px`);
  for (const i of items.slice(0, 4)) {
    console.log(`      ${i.key.slice(-46)}`);
  }
}

await browser.close();
