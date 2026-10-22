// 顶栏左侧留白：找真正可见的第一个元素，及其与侧栏右缘的关系
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

for (const route of ['/projects', '/cost/contracts', '/audit-logs']) {
  await gotoRoute(page, route, { settle: 1300 });
  const r = await page.evaluate(() => {
    const tb = document.querySelector('.app-titlebar');
    const sb = document.querySelector('.app-sidebar');
    const cs = getComputedStyle(tb);
    const tbR = tb.getBoundingClientRect();
    const sbR = sb.getBoundingClientRect();

    // 所有直接子元素，标出可见性
    const kids = [...tb.children].map((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      return {
        tag: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
        x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
        visible: s.display !== 'none' && r.width > 0,
        text: (el.textContent || '').trim().slice(0, 10),
      };
    });

    // 递归找第一个可见的叶子内容
    const firstVisible = (() => {
      const walk = (el) => {
        for (const c of el.children) {
          const s = getComputedStyle(c);
          const b = c.getBoundingClientRect();
          if (s.display === 'none' || b.width < 1) continue;
          const inner = walk(c);
          if (inner) return inner;
          if ((c.textContent || '').trim().length > 0) {
            return { tag: c.tagName.toLowerCase(), x: Math.round(b.x), text: c.textContent.trim().slice(0, 10) };
          }
        }
        return null;
      };
      return walk(tb);
    })();

    return {
      padding: cs.padding,
      paddingLeft: cs.paddingLeft,
      tbX: Math.round(tbR.x), tbW: Math.round(tbR.width),
      sbRight: Math.round(sbR.right),
      kids,
      firstVisible,
      // 顶栏左缘到侧栏右缘的间隙
      gapFromSidebar: Math.round(tbR.x - sbR.right),
      // 第一个可见内容到顶栏左缘的距离
      contentOffset: firstVisible ? Math.round(firstVisible.x - tbR.x) : null,
    };
  });

  console.log(`\n=== ${route} ===`);
  console.log(`  顶栏 x=${r.tbX} w=${r.tbW}  padding=${r.padding}`);
  console.log(`  侧栏右缘 ${r.sbRight}，与顶栏间隙 ${r.gapFromSidebar}px`);
  console.log(`  第一个可见内容: ${r.firstVisible ? `${r.firstVisible.tag} "${r.firstVisible.text}" @ x=${r.firstVisible.x}` : '无'}`);
  console.log(`  内容距顶栏左缘: ${r.contentOffset}px`);
  console.log('  直接子元素:');
  for (const k of r.kids) {
    console.log(`    ${k.tag.padEnd(38)} ${k.w}x${k.h} @x=${k.x} ${k.visible ? '' : '(隐藏)'} ${k.text ? `"${k.text}"` : ''}`);
  }
}

await browser.close();
