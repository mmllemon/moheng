// 稳定的快照：等待元素数量与文本长度稳定后再采集
// 教训：固定 sleep 会和异步数据赛跑，.empty-state 骨架屏与真实内容尺寸差 200px+
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { CHROME, ROUTES, assertApiUp, login } from './_harness.mjs';

const PROPS = [
  'display', 'flexDirection', 'alignItems', 'justifyContent', 'flexWrap', 'gap',
  'minWidth', 'minHeight', 'maxWidth', 'paddingTop', 'paddingRight',
  'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderTopWidth', 'borderTopColor', 'borderBottomWidth', 'borderBottomColor',
  'borderTopLeftRadius', 'borderTopRightRadius',
  'backgroundColor', 'color', 'fontSize', 'fontWeight', 'fontFamily',
  'lineHeight', 'letterSpacing', 'whiteSpace', 'boxShadow', 'opacity',
  'overflow', 'cursor', 'gridTemplateColumns', 'textAlign',
];

async function waitStable(page, { minMs = 500, maxMs = 6000 } = {}) {
  const t0 = Date.now();
  let last = -1, same = 0;
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(minMs);
    const sig = await page.evaluate(() => {
      const n = document.querySelectorAll('body *').length;
      const t = (document.body.innerText || '').length;
      return n * 100000 + t;
    });
    if (sig === last) {
      same++;
      if (same >= 2) return { ok: true, waited: Date.now() - t0 };
    } else {
      same = 0;
      last = sig;
    }
  }
  return { ok: false, waited: Date.now() - t0 };
}

async function captureRoute(page, route) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  const st = await waitStable(page);
  if (!st.ok) console.warn(`    ⚠ ${route} 未在 ${st.waited}ms 内稳定`);

  return page.evaluate((props) => {
    const out = [];
    let idx = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (/^(SCRIPT|STYLE|LINK|META|TITLE|HEAD|PATH|RECT|CIRCLE|LINE|POLYLINE|POLYGON|G|DEFS|USE|TSPAN)$/.test(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const style = {};
      for (const p of props) style[p] = cs[p];
      out.push({
        i: idx++,
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 90),
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        style,
      });
    }
    return out;
  }, PROPS);
}

const outPath = process.argv[2];
await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await waitStable(page, { maxMs: 5000 });

const result = {};
for (const route of ROUTES) {
  result[route] = await captureRoute(page, route);
  console.log(`  ${route.padEnd(24)} ${result[route].length}`);
}
await browser.close();
writeFileSync(outPath, JSON.stringify(result, null, 1));
const total = Object.values(result).reduce((s, a) => s + a.length, 0);
console.log(`\n合计 ${total} 元素 → ${outPath}`);
