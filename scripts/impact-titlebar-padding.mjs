// 顶栏左 padding 24 → 12 的视觉影响
// 关键疑问：这个 24px 是不是和非对称设计有关（右侧只有 12）
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const width of [1440, 1024]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);
  await gotoRoute(page, '/projects', { settle: 1400 });

  const r = await page.evaluate(() => {
    const tb = document.querySelector('.app-titlebar');
    const ctxEl = document.querySelector('.titlebar-context');
    const acts = document.querySelector('.titlebar-actions');
    const content = document.querySelector('.app-content');
    const pageWrap = document.querySelector('.page-wrap');
    const tbR = tb.getBoundingClientRect();
    const cs = getComputedStyle(tb);
    const pwCs = pageWrap ? getComputedStyle(pageWrap) : null;

    return {
      paddingLeft: cs.paddingLeft,
      paddingRight: cs.paddingRight,
      // 顶栏内容左缘
      tbLeft: Math.round(tbR.x),
      ctxLeft: ctxEl ? Math.round(ctxEl.getBoundingClientRect().x) : null,
      // 右侧内容右缘
      actsRight: acts ? Math.round(acts.getBoundingClientRect().right) : null,
      actsW: acts ? Math.round(acts.getBoundingClientRect().width) : null,
      // 主内容区左 padding 用于对比
      pageWrapPadding: pwCs ? pwCs.padding : null,
      pageWrapLeft: pageWrap ? Math.round(pageWrap.getBoundingClientRect().x) : null,
      // page-wrap 里第一个可见块内容的左缘
      firstBlockX: (() => {
        if (!pageWrap) return null;
        for (const el of pageWrap.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          if (b.width > 50 && b.height > 10 && s.display !== 'none') return Math.round(b.x);
        }
        return null;
      })(),
    };
  });

  console.log(`\n=== ${width}px ===`);
  console.log(`  顶栏 x=${r.tbLeft}  padding-left=${r.paddingLeft}  padding-right=${r.paddingRight}`);
  console.log(`  面包屑左缘 x=${r.ctxLeft}  → 距顶栏左缘 ${r.ctxLeft - r.tbLeft}px`);
  console.log(`  右侧动作区右缘 x=${r.actsRight}（宽 ${r.actsW}）`);
  console.log(`  主内容区 page-wrap x=${r.pageWrapLeft} padding=${r.pageWrapPadding}`);
  console.log(`  page-wrap 首块内容 x=${r.firstBlockX}`);
  console.log('');
  console.log(`  → 顶栏文字 "${'(面包屑)'}" 左缘 ${r.ctxLeft} vs 内容块左缘 ${r.firstBlockX}`);
  console.log(`    差值 ${r.firstBlockX !== null && r.ctxLeft !== null ? Math.abs(r.ctxLeft - r.firstBlockX) : '?'}px`);
  console.log('');
  console.log(`  若 padding-left 改 12px：面包屑左缘 ${r.ctxLeft} → ${r.tbLeft + 12}`);
  console.log(`  与内容块左缘 ${r.firstBlockX} 的差值将由 ${Math.abs(r.ctxLeft - r.firstBlockX)} 变为 ${Math.abs(r.tbLeft + 12 - r.firstBlockX)}px`);

  await ctx.close();
}

await browser.close();
