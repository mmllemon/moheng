// 行高影响探针 v2：识别「没有自己声明 line-height 的元素」
// 方法：临时把所有元素的 line-height 设为 99px，看哪些元素跟着变
// → 跟着变的 = 原本继承 body；不变 = 自己有声明
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const ROUTES = ['/', '/projects', '/cost/contracts', '/audit-logs', '/system/dictionaries', '/system/accounts', '/parties', '/reports/studio'];

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const inherited = new Map();

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1400 });

  const r = await page.evaluate(() => {
    const get = (el) => {
      const cs = getComputedStyle(el);
      return { lh: cs.lineHeight, fs: cs.fontSize };
    };
    const pathOf = (el) => {
      const p = [];
      let n = el;
      while (n && n !== document.body && p.length < 5) {
        const cls = (typeof n.className === 'string' ? n.className : '').split(/\s+/).filter(Boolean)[0] || '';
        p.unshift(n.tagName.toLowerCase() + (cls ? '.' + cls : ''));
        n = n.parentElement;
      }
      return p.join('>');
    };

    const els = [...document.querySelectorAll('body *')].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return false;
      const b = el.getBoundingClientRect();
      return b.width > 1 && b.height > 1;
    });

    const before = new Map(els.map((el) => [el, get(el)]));

    // 关键：把 body 的 line-height 改成 3（= 39px at 13px），
    // 只有原本继承 body 的元素会跟着变成 39px
    const st = document.createElement('style');
    st.id = '__probe2';
    st.textContent = 'body, body * { line-height: 3 !important; }';
    document.head.appendChild(st);
    void document.body.offsetHeight;
    const afterAll = new Map(els.map((el) => [el, get(el)]));
    st.remove();
    void document.body.offsetHeight;

    // 再测：只改 body，不改子元素
    const st2 = document.createElement('style');
    st2.textContent = 'body { line-height: 3 !important; }';
    document.head.appendChild(st2);
    void document.body.offsetHeight;
    const afterBodyOnly = new Map(els.map((el) => [el, get(el)]));
    st2.remove();

    // 继承 body 的元素：body 改了就变
    const inh = [];
    for (const el of els) {
      const a = before.get(el);
      const b = afterBodyOnly.get(el);
      if (a && b && a.lh !== b.lh) {
        inh.push({ path: pathOf(el), fs: a.fs, lh: a.lh, newLh: b.lh });
      }
    }
    return { total: els.length, inherited: inh };
  });

  for (const i of r.inherited) {
    const k = `${i.path}|${i.fs}|${i.lh}`;
    if (!inherited.has(k)) inherited.set(k, { ...i, routes: [route] });
  }
  console.log(`  ${route}: ${r.total} 元素，其中 ${r.inherited.length} 个继承 body 行高`);
}

console.log(`\n=== 汇总：继承 body 行高的元素 ${inherited.size} 种 ===`);
const byFs = new Map();
for (const i of inherited.values()) {
  if (!byFs.has(i.fs)) byFs.set(i.fs, []);
  byFs.get(i.fs).push(i);
}
for (const [fs, items] of [...byFs.entries()].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))) {
  const px = parseFloat(fs);
  const old = +(px * 1.55).toFixed(2);
  const neu = +(px * 1.7).toFixed(2);
  console.log(`  ${fs.padEnd(8)} ${String(items.length).padStart(2)} 种   ${old} → ${neu}px (+${(neu - old).toFixed(2)})`);
  for (const i of items.slice(0, 5)) console.log(`      ${i.path.slice(-52)}`);
}

await browser.close();
