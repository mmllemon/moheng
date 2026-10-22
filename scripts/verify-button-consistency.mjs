// 按钮一致性验收：同一容器内必须同高，全站只有两档
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/reports/studio',
  '/notifications', '/parties', '/audit-logs', '/settings/appearance',
  '/system', '/system/security', '/system/authorization', '/system/policies',
  '/system/governance', '/system/operations', '/system/dictionaries',
  '/system/parameters', '/system/accounts', '/system/assistant', '/account/security',
];

const ALLOWED = new Set([32, 26]);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

let problems = 0;
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(950);

  const res = await page.evaluate((allowed) => {
    const issues = [];
    // 检查这些容器内按钮必须同高
    const containers = [
      '.page-actions', '.table-heading-actions', '.ds-section-actions',
      '.settings-section-actions', '.table-toolbar',
    ];
    for (const sel of containers) {
      for (const box of document.querySelectorAll(sel)) {
        const btns = [...box.querySelectorAll('.button')].filter((b) => {
          const cs = getComputedStyle(b);
          return cs.display !== 'none' && b.getBoundingClientRect().height > 0;
        });
        if (btns.length < 2) continue;
        const hs = [...new Set(btns.map((b) => Math.round(b.getBoundingClientRect().height)))];
        if (hs.length > 1) {
          issues.push({
            type: 'mixed-height', sel,
            detail: btns.map((b) => `${Math.round(b.getBoundingClientRect().height)}px:"${(b.textContent || '').trim().slice(0, 14)}"`).join(' '),
          });
        }
      }
    }
    // 检查全局是否只剩三档：
    //   32px 主操作 / 26px 紧凑 / 24px 表格行内
    // 20 / 22 曾经作为「行内操作更小」的豁免放行，现已统一到 24px，
    // 留着豁免会让真实偏移静默通过，所以收掉。
    const offTier = [];
    for (const b of document.querySelectorAll('button.button, a.button')) {
      const cs = getComputedStyle(b);
      if (cs.display === 'none') continue;
      const h = Math.round(b.getBoundingClientRect().height);
      if (h < 8) continue;
      if (![...allowed, 24].includes(h)) {
        offTier.push({ h, cls: (b.className || '').toString().slice(0, 44), text: (b.textContent || '').trim().slice(0, 16) });
      }
    }
    return { issues, offTier };
  }, [...ALLOWED]);

  if (res.issues.length || res.offTier.length) {
    console.log(`\n${route}`);
    for (const i of res.issues) {
      problems++;
      console.log(`  ✗ 同容器高度不一致 [${i.sel}]  ${i.detail}`);
    }
    for (const o of res.offTier) {
      problems++;
      console.log(`  · 非标准档位 ${o.h}px  "${o.text}"  ${o.cls}`);
    }
  }
}

console.log(`\n${problems ? '问题共 ' + problems + ' 处' : '全部通过：同容器同高，全站三档（32 / 26 / 24）'}`);
await browser.close();
