// 工具栏族迁移：采集 → 删除 → 复采 → 严格比对
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { CHROME, ROUTES, assertApiUp, login, gotoRoute } from './_harness.mjs';

const PROPS = [
  'display', 'position', 'flexDirection', 'alignItems', 'justifyContent', 'flexWrap', 'gap',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'paddingTop', 'paddingRight',
  'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderTopWidth', 'borderTopColor', 'borderBottomWidth', 'borderBottomColor',
  'borderLeftWidth', 'borderLeftColor', 'borderRightWidth', 'borderRightColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'backgroundColor', 'backgroundImage', 'color', 'fontSize', 'fontWeight', 'fontFamily',
  'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'whiteSpace',
  'boxShadow', 'opacity', 'overflow', 'cursor', 'gridTemplateColumns',
];

export async function capture(outPath) {
  await assertApiUp();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);

  const result = {};
  for (const route of ROUTES) {
    await gotoRoute(page, route);
    const snap = await page.evaluate((props) => {
      const out = [];
      let idx = 0;
      for (const el of document.querySelectorAll('body *')) {
        if (/^(SCRIPT|STYLE|LINK|META|TITLE|HEAD|PATH|RECT|CIRCLE|LINE|POLYLINE|POLYGON|G|DEFS|USE)$/.test(el.tagName)) continue;
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
        if (out.length > 2600) break;
      }
      return out;
    }, PROPS);
    result[route] = snap;
  }
  await browser.close();
  writeFileSync(outPath, JSON.stringify(result, null, 1));
  const total = Object.values(result).reduce((s, a) => s + a.length, 0);
  return { total, routes: Object.keys(result).length };
}

export function compare(beforePath, afterPath, ignoreBox = false) {
  const a = JSON.parse(readFileSync(beforePath, 'utf8'));
  const b = JSON.parse(readFileSync(afterPath, 'utf8'));

  const diffs = [];
  for (const route of Object.keys(a)) {
    const ra = a[route], rb = b[route] || [];
    const max = Math.max(ra.length, rb.length);
    for (let i = 0; i < max; i++) {
      const ea = ra[i], eb = rb[i];
      if (!ea) { diffs.push({ route, i, what: '新增元素', detail: `${eb.tag}.${eb.cls}` }); continue; }
      if (!eb) { diffs.push({ route, i, what: '丢失元素', detail: `${ea.tag}.${ea.cls}` }); continue; }
      if (!ignoreBox) {
        const da = ea.box.map((v, k) => v - eb.box[k]);
        if (da.some((v) => Math.abs(v) > 1)) {
          diffs.push({ route, i, what: '位置/尺寸', detail: `${ea.tag}.${ea.cls.slice(0, 50)} ${ea.box} → ${eb.box}` });
        }
      }
      for (const p of Object.keys(ea.style)) {
        if (ea.style[p] !== eb.style[p]) {
          diffs.push({ route, i, what: p, detail: `${ea.tag}.${ea.cls.slice(0, 50)}: ${ea.style[p]} → ${eb.style[p]}` });
        }
      }
    }
  }
  return diffs;
}

if (process.argv[2] === 'capture') {
  const out = process.argv[3];
  const r = await capture(out);
  console.log(`快照 ${r.total} 个元素 / ${r.routes} 路由 → ${out}`);
} else if (process.argv[2] === 'compare') {
  const diffs = compare(process.argv[3], process.argv[4]);
  if (!diffs.length) {
    console.log('✓ 零差异：所有元素的位置、尺寸、全部外观属性完全一致');
  } else {
    const byKind = {};
    for (const d of diffs) (byKind[d.what] ||= []).push(d);
    console.log(`✗ 发现 ${diffs.length} 处差异\n`);
    for (const [kind, list] of Object.entries(byKind).sort((x, y) => y[1].length - x[1].length)) {
      console.log(`  ${kind}: ${list.length} 处`);
      for (const d of list.slice(0, 6)) console.log(`    ${d.route} [${d.i}] ${d.detail}`);
      if (list.length > 6) console.log(`    ...还有 ${list.length - 6} 处`);
    }
  }
}
