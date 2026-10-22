// 多视口快照：验证断点内的样式没被破坏
// 单视口快照测不到 @media，这是卡片族要特别补的一关
import { chromium } from 'playwright-core';
import { writeFileSync, readFileSync } from 'node:fs';
import { CHROME, ROUTES, assertApiUp, login, gotoRoute, waitStable } from './_harness.mjs';

const VIEWPORTS = [
  { w: 1440, h: 900, label: 'desktop' },
  { w: 1024, h: 800, label: 'laptop' },
  { w: 768, h: 800, label: 'tablet' },
  { w: 600, h: 800, label: 'mobile' },
];

const PROPS = [
  'display', 'flexDirection', 'alignItems', 'justifyContent', 'flexWrap', 'gap',
  'gridTemplateColumns', 'minWidth', 'minHeight', 'maxWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginBottom',
  'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
  'borderTopLeftRadius', 'backgroundColor', 'color', 'fontSize', 'fontWeight',
  'lineHeight', 'letterSpacing', 'boxShadow', 'opacity', 'overflow',
];

async function capture(outPath) {
  await assertApiUp();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const result = {};

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await login(page);
    await waitStable(page, { maxMs: 4000 });

    const perRoute = {};
    for (const route of ROUTES) {
      await gotoRoute(page, route, { settle: 700 });
      await waitStable(page, { minMs: 300, maxMs: 2500 });
      perRoute[route] = await page.evaluate((props) => {
        const out = [];
        let i = 0;
        for (const el of document.querySelectorAll('body *')) {
          if (/^(SCRIPT|STYLE|LINK|META|TITLE|HEAD|PATH|RECT|CIRCLE|LINE|POLYLINE|POLYGON|G|DEFS|USE|TSPAN)$/.test(el.tagName)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          const st = {};
          for (const p of props) st[p] = cs[p];
          out.push({
            i: i++,
            tag: el.tagName.toLowerCase(),
            cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
            box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            st,
          });
        }
        return out;
      }, PROPS);
    }
    result[vp.label] = perRoute;
    const n = Object.values(perRoute).reduce((s, a) => s + a.length, 0);
    console.log(`  ${vp.label.padEnd(10)} ${vp.w}px  ${n} 元素`);
    await ctx.close();
  }
  await browser.close();
  writeFileSync(outPath, JSON.stringify(result, null, 1));
}

function compare(aPath, bPath) {
  const a = JSON.parse(readFileSync(aPath, 'utf8'));
  const b = JSON.parse(readFileSync(bPath, 'utf8'));
  const diffs = [];
  for (const vp of Object.keys(a)) {
    for (const route of Object.keys(a[vp])) {
      const ra = a[vp][route], rb = (b[vp] || {})[route] || [];
      const max = Math.max(ra.length, rb.length);
      for (let i = 0; i < max; i++) {
        const ea = ra[i], eb = rb[i];
        if (!ea) { diffs.push({ vp, route, what: '新增', d: `[${i}] ${eb.tag}.${eb.cls}` }); continue; }
        if (!eb) { diffs.push({ vp, route, what: '丢失', d: `[${i}] ${ea.tag}.${ea.cls}` }); continue; }
        const db = ea.box.map((v, k) => v - eb.box[k]);
        if (db.some((v) => Math.abs(v) > 1)) {
          diffs.push({ vp, route, what: '尺寸', d: `${ea.tag}.${ea.cls.slice(0, 40)} ${ea.box} → ${eb.box}` });
        }
        for (const p of Object.keys(ea.st)) {
          if (ea.st[p] !== eb.st[p]) {
            diffs.push({ vp, route, what: p, d: `${ea.tag}.${ea.cls.slice(0, 40)}: ${ea.st[p]} → ${eb.st[p]}` });
          }
        }
      }
    }
  }
  return diffs;
}

const mode = process.argv[2];
if (mode === 'capture') {
  await capture(process.argv[3]);
  console.log(`\n→ ${process.argv[3]}`);
} else if (mode === 'compare') {
  const diffs = compare(process.argv[3], process.argv[4]);
  if (!diffs.length) {
    console.log('✓ 四视口零差异');
  } else {
    const byVp = {};
    for (const d of diffs) (byVp[d.vp] ||= []).push(d);
    console.log(`✗ ${diffs.length} 处差异\n`);
    for (const [vp, list] of Object.entries(byVp)) {
      console.log(`  ${vp}: ${list.length} 处`);
      for (const d of list.slice(0, 8)) console.log(`    ${d.route} ${d.what} ${d.d}`);
      if (list.length > 8) console.log(`    ...还有 ${list.length - 8}`);
    }
  }
}
