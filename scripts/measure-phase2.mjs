// 第 2 期外观项：改动前后的视觉差异测量
// 三项都会改变外观，必须量化
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1500 });

const m = await page.evaluate(() => {
  const g = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      x: Math.round(r.x), y: Math.round(r.y),
      padding: cs.padding, paddingLeft: cs.paddingLeft,
      display: cs.display, gap: cs.gap,
    };
  };
  // 侧栏头的两个按钮
  const toggles = [...document.querySelectorAll('.app-sidebar-titlebar .sidebar-toggle')];
  // 侧栏头容器
  const titlebar = g('.app-sidebar-titlebar');
  const profile = g('.app-sidebar-profile');
  const scroll = g('.app-sidebar-scroll');
  const footer = g('.app-sidebar-footer');
  const userRow = g('.sidebar-user-row');
  const appTitlebar = g('.app-titlebar');

  return {
    sidebarTitlebar: titlebar,
    toggles: toggles.map((t) => {
      const r = t.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) };
    }),
    sidebarProfile: profile,
    sidebarScroll: scroll,
    sidebarFooter: footer,
    sidebarUserRow: userRow,
    appTitlebar,
    // 侧栏头里第一个按钮左边缘到侧栏左边缘的距离
    firstToggleOffset: toggles.length ? Math.round(toggles[0].getBoundingClientRect().x - document.querySelector('.app-sidebar').getBoundingClientRect().x) : null,
    // 顶栏内容的第一个子元素位置
    titlebarFirstChildX: (() => {
      const tb = document.querySelector('.app-titlebar');
      const fc = tb && tb.firstElementChild;
      return fc ? Math.round(fc.getBoundingClientRect().x) : null;
    })(),
  };
});

console.log('=== 当前实测 ===');
console.log(`侧栏头 ${m.sidebarTitlebar.w}x${m.sidebarTitlebar.h}  padding=${m.sidebarTitlebar.padding}`);
console.log(`  按钮 ${m.toggles.length} 个: ${m.toggles.map((t) => `${t.w}x${t.h}`).join(', ')}`);
console.log(`  首个按钮距侧栏左缘 ${m.firstToggleOffset}px`);
console.log(`侧栏 profile 段 ${m.sidebarProfile.w}x${m.sidebarProfile.h}`);
console.log(`侧栏 scroll 段 ${m.sidebarScroll.w}x${m.sidebarScroll.h}`);
console.log(`侧栏 footer ${m.sidebarFooter.w}x${m.sidebarFooter.h}  display=${m.sidebarFooter.display}`);
console.log(`  userRow ${m.sidebarUserRow ? `${m.sidebarUserRow.w}x${m.sidebarUserRow.h} display=${m.sidebarUserRow.display}` : 'null'}`);
console.log(`顶栏 ${m.appTitlebar.w}x${m.appTitlebar.h}  paddingLeft=${m.appTitlebar.paddingLeft}`);
console.log(`顶栏首个子元素 x=${m.titlebarFirstChildX}`);

console.log('\n=== 若改动的预测 ===');
// 1. 侧栏头 padding 0 10px → 8px 16px
const tbH = m.sidebarTitlebar.h;
const newTbH = 8 + 32 + 8; // padding上 + 按钮高 + padding下
console.log(`1. 侧栏头 padding 0 10px → 8px 16px:`);
console.log(`   高度 ${tbH} → ${newTbH}px (+${newTbH - tbH})`);
console.log(`   scroll 段高度会减少 ${newTbH - tbH}px（因为固定总高）`);
console.log(`   按钮左缘 ${m.firstToggleOffset} → 16px (+${16 - m.firstToggleOffset})`);

// 2. 图标按钮 32 → 26
console.log(`\n2. 图标按钮 32x32 → 26x26:`);
console.log(`   两个按钮并排总宽 ${m.toggles.length * 32} → ${m.toggles.length * 26}px (-${m.toggles.length * 6})`);
console.log(`   行高（按钮占位）32 → 26px`);

// 3. 顶栏 padding-left 24 → 12
console.log(`\n3. 顶栏 padding-left 24 → 12px:`);
console.log(`   首个子元素 x=${m.titlebarFirstChildX} → ${m.titlebarFirstChildX - 12}`);

await browser.close();
writeFileSync('D:/WorkSpace/hana/moheng/docs/gates/phase2-before.json', JSON.stringify(m, null, 1));
console.log('\n→ docs/gates/phase2-before.json');
