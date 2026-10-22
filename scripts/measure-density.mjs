// 信息密度测量 v2：修正行高测量与选择器
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

const ROUTES = ['/projects', '/cost/contracts', '/audit-logs', '/system/accounts', '/system/dictionaries'];

for (const route of ROUTES) {
  await gotoRoute(page, route, { settle: 1400 });

  const m = await page.evaluate(() => {
    const out = { route: location.pathname };
    const bcs = getComputedStyle(document.body);
    out.bodyFs = parseFloat(bcs.fontSize);
    out.bodyLh = parseFloat(bcs.lineHeight);

    // 视口内可见滚动条高度
    out.viewportH = window.innerHeight;

    const table = document.querySelector('.data-table');
    if (table) {
      const td = table.querySelector('tbody td');
      if (td) {
        const t = getComputedStyle(td);
        out.cellFs = parseFloat(t.fontSize);
        out.cellLh = parseFloat(t.lineHeight);
        out.cellPadV = `${t.paddingTop} / ${t.paddingBottom}`;
        // 由 line-height + padding 推算单行行高
        out.computedRowH = Math.round(parseFloat(t.lineHeight) + parseFloat(t.paddingTop) + parseFloat(t.paddingBottom));
      }
      const rows = [...table.querySelectorAll('tbody tr')];
      out.rowCount = rows.length;
      // 取中位数，排除换行的异常行
      const hs = rows.map((r) => r.getBoundingClientRect().height).filter((h) => h > 0).sort((a, b) => a - b);
      if (hs.length) {
        out.rowHMin = Math.round(hs[0]);
        out.rowHMedian = Math.round(hs[Math.floor(hs.length / 2)]);
        out.rowHMax = Math.round(hs[hs.length - 1]);
      }
    }

    // 各种容器：打印实际匹配到的
    out.containers = [];
    for (const sel of ['.topbar', '.titlebar', '.page-wrap', '.content-area', '.main-shell', '.main-content', '.chat-area']) {
      const e = document.querySelector(sel);
      if (e) {
        const r = e.getBoundingClientRect();
        out.containers.push({ sel, h: Math.round(r.height), w: Math.round(r.width) });
      }
    }

    // 第一个面板的 padding
    const panel = document.querySelector('.panel, .data-table-panel, .table-panel');
    if (panel) {
      const t = getComputedStyle(panel);
      out.panelPad = t.padding;
      out.panelRadius = t.borderRadius;
    }
    return out;
  });

  console.log(`\n=== ${m.route} ===`);
  console.log(`  正文 ${m.bodyFs}px / ${m.bodyLh}px   视口高 ${m.viewportH}px`);
  if (m.cellFs) {
    console.log(`  单元格 ${m.cellFs}px / 行高 ${m.cellLh}px / 内边距 ${m.cellPadV}`);
    console.log(`  实测行高 min/中位/max = ${m.rowHMin}/${m.rowHMedian}/${m.rowHMax}px（${m.rowCount} 行）`);
  }
  if (m.containers.length) {
    console.log('  容器: ' + m.containers.map((c) => `${c.sel} ${c.w}x${c.h}`).join('  '));
  }
  if (m.panelPad) console.log(`  面板 padding ${m.panelPad}  圆角 ${m.panelRadius}`);
}

await browser.close();
