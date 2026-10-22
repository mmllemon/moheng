// 全站扫描：所有禁用按钮在 hover 前后是否发生视觉变化
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/notifications',
  '/parties', '/audit-logs', '/settings/appearance', '/system', '/system/security',
  '/system/authorization', '/system/policies', '/system/governance', '/system/operations',
  '/system/dictionaries', '/system/parameters', '/system/accounts', '/system/assistant',
  '/account/security',
];

const b = await chromium.launch({ executablePath: CHROME, headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await c.newPage();
await login(p);

let checked = 0;
const bad = [];

for (const route of ROUTES) {
  await p.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await p.waitForTimeout(870);

  // 收集所有禁用按钮的初始样式
  const list = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button:disabled, [aria-disabled="true"]')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8) continue;
      out.push({
        i: out.length,
        txt: (el.textContent || '').trim().slice(0, 10),
        cls: (el.className || '').toString().slice(0, 40),
        bg: cs.backgroundColor,
        border: cs.borderTopColor,
        color: cs.color,
        rect: r.toJSON(),
      });
    }
    return out;
  });

  for (const item of list) {
    checked++;
    // hover 它
    await p.mouse.move(item.rect.x + item.rect.width / 2, item.rect.y + item.rect.height / 2);
    await p.waitForTimeout(120);
    const after = await p.evaluate((idx) => {
      const el = [...document.querySelectorAll('button:disabled, [aria-disabled="true"]')]
        .filter((e) => {
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height >= 8;
        })[idx];
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
    }, item.i);

    if (after && (after.bg !== item.bg || after.border !== item.border || after.color !== item.color)) {
      bad.push({ route, ...item, after });
    }
    await p.mouse.move(5, 5);
  }
}

console.log(`检查了 ${checked} 个禁用按钮\n`);
if (!bad.length) {
  console.log('✓ 全部禁用按钮 hover 无视觉变化');
} else {
  console.log(`✗ ${bad.length} 个禁用按钮 hover 时有变化：\n`);
  const seen = new Set();
  for (const x of bad) {
    const k = `${x.cls} ${x.bg}→${x.after.bg}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${x.route.padEnd(24)} "${x.txt}" .${x.cls}`);
    console.log(`      bg: ${x.bg} → ${x.after.bg}`);
  }
}

await b.close();
