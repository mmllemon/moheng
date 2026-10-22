// 量化「盒子感」：统计页面上可见的边框盒子、字号阶梯、留白比例
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/', { settle: 1600 });

const m = await page.evaluate(() => {
  const vh = window.innerHeight, vw = window.innerWidth;
  const main = document.querySelector('.app-content') || document.body;

  // 可见的「盒子」：有边框或明显背景色、面积够大
  const boxes = [];
  for (const el of main.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 30) continue;
    if (r.top > vh || r.bottom < 0) continue;

    const bw = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
      .map((k) => parseFloat(cs[k])).reduce((a, b) => a + b, 0);
    const bg = cs.backgroundColor;
    const isOpaque = bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg);
    const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;

    if (bw > 0 || (isOpaque && radius > 0) || hasShadow) {
      boxes.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.'),
        area: Math.round(r.width * r.height),
        bw: Math.round(bw), bg: isOpaque ? bg : '', radius: Math.round(radius), shadow: hasShadow,
      });
    }
  }

  // 字号阶梯
  const sizes = new Map();
  for (const el of main.querySelectorAll('*')) {
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!txt) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const fs = parseFloat(cs.fontSize);
    if (!fs) continue;
    sizes.set(fs, (sizes.get(fs) || 0) + 1);
  }

  // 正文基准与最大标题
  const bodyFs = parseFloat(getComputedStyle(document.body).fontSize);
  const h1 = document.querySelector('h1');
  const h1Fs = h1 ? parseFloat(getComputedStyle(h1).fontSize) : null;

  // 内容区留白：page-wrap 的左右 padding 占视宽比
  const pw = document.querySelector('.page-wrap');
  const pwCs = pw ? getComputedStyle(pw) : null;

  return {
    boxCount: boxes.length,
    top: boxes.sort((a, b) => b.area - a.area).slice(0, 10),
    bodyFs, h1Fs,
    scaleRatio: h1Fs ? +(h1Fs / bodyFs).toFixed(2) : null,
    pagePadding: pwCs ? `${pwCs.paddingLeft}/${pwCs.paddingRight}` : null,
    sizes: [...sizes.entries()].sort((a, b) => b[0] - a[0]).slice(0, 10),
  };
});

console.log('=== moheng 首页「盒子感」实测 ===\n');
console.log(`可见盒子（有边框/背景/阴影）: ${m.boxCount} 个`);
for (const b of m.top) {
  console.log(`  ${(b.tag + (b.cls ? '.' + b.cls : '')).padEnd(30)} 面积${String(b.area).padStart(7)}  边框${b.bw}px 圆角${b.radius}  背景=${b.bg || '无'}${b.shadow ? ' +阴影' : ''}`);
}

console.log(`\n正文字号 ${m.bodyFs}px`);
console.log(`H1 字号 ${m.h1Fs}px`);
console.log(`标题/正文 比 = ${m.scaleRatio}`);
console.log(`页面左右 padding = ${m.pagePadding}`);

console.log('\n字号阶梯（前10档）:');
for (const [fs, n] of m.sizes) console.log(`  ${String(fs).padEnd(6)}px  ${n} 处`);

await browser.close();
