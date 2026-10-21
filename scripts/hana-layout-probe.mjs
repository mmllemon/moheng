// 拆解 Hana 的布局精髓：读取运行中的 Hana renderer 的实际布局结构
// 用 file:// 加载 Hana 的 index.html（它是个静态产物，不需要后端就能渲染外壳）
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const HANA = 'http://127.0.0.1:8899/index.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/hana-layout.json';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)));

// 通过本地 HTTP 服务加载（renderer 是纯静态资源，file:// 下模块会被 CORS 拦）
await page.goto(HANA, { waitUntil: 'networkidle' }).catch((e) => errors.push('goto: ' + e.message.slice(0, 120)));
await page.waitForTimeout(2500);

// 采集完整布局树（深度优先，记录每个有意义的块）
const layout = await page.evaluate(() => {
  const out = [];
  const walk = (el, depth) => {
    if (depth > 8) return;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || r.width === 0) { return; }
    const cls = (el.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    const meaningful = r.height > 8 && r.width > 8;
    if (meaningful) {
      out.push({
        depth,
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 50),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: cs.display,
        gap: cs.gap,
        pad: cs.padding,
        margin: cs.margin,
        flexDir: cs.flexDirection,
        justify: cs.justifyContent,
        align: cs.alignItems,
        gridCols: cs.gridTemplateColumns.slice(0, 60),
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        color: cs.color,
        bg: cs.backgroundColor,
        radius: cs.borderTopLeftRadius,
        overflow: cs.overflow,
      });
    }
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(document.body, 0);
  return out;
});

// 关键：统计布局模式（flex vs grid、gap 分布、padding 分布）
const patterns = await page.evaluate(() => {
  const els = document.querySelectorAll('body *');
  const stat = { flex: 0, grid: 0, block: 0, gaps: {}, paddings: {}, fonts: {}, lineHeights: {} };
  for (const el of els) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (cs.display.includes('flex')) stat.flex++;
    else if (cs.display.includes('grid')) stat.grid++;
    else stat.block++;
    if (cs.gap && cs.gap !== 'normal') stat.gaps[cs.gap] = (stat.gaps[cs.gap] || 0) + 1;
    if (cs.padding && cs.padding !== '0px') stat.paddings[cs.padding] = (stat.paddings[cs.padding] || 0) + 1;
    stat.fonts[cs.fontSize] = (stat.fonts[cs.fontSize] || 0) + 1;
    stat.lineHeights[cs.lineHeight] = (stat.lineHeights[cs.lineHeight] || 0) + 1;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    displayCounts: { flex: stat.flex, grid: stat.grid, block: stat.block },
    topGaps: top(stat.gaps, 10),
    topPaddings: top(stat.paddings, 12),
    topFontSizes: top(stat.fonts, 10),
    topLineHeights: top(stat.lineHeights, 10),
  };
});

const result = { errors, blockCount: layout.length, layout: layout.slice(0, 300), patterns };
writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
console.log('blocks:', layout.length);
console.log('\n=== 布局模式 ===');
console.log(JSON.stringify(patterns, null, 1));
console.log('\n=== 顶层结构（depth<=2）===');
for (const b of layout.filter((x) => x.depth <= 2).slice(0, 25)) {
  console.log(`${'  '.repeat(b.depth)}${b.tag}.${b.cls}  ${b.rect.w}x${b.rect.h} @${b.rect.x},${b.rect.y}  ${b.display} gap=${b.gap}`);
}

await browser.close();
