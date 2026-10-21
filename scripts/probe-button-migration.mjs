// 修正版迁移探针：正确处理 @layer 包裹，并先验证删除真的生效
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/notifications',
  '/parties', '/audit-logs', '/settings/appearance', '/system', '/system/security',
  '/system/policies', '/system/governance', '/system/operations',
  '/system/dictionaries', '/system/parameters', '/system/accounts',
  '/system/assistant', '/account/security',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function run(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  if (mode === 'strip') {
    await page.addInitScript(() => {
      window.__stripLog = { removed: 0, sheets: [] };
      // 递归处理 @layer / @media 包裹
      const stripIn = (container, tag) => {
        let rules;
        try { rules = container.cssRules; } catch { return 0; }
        if (!rules) return 0;
        let n = 0;
        for (let i = rules.length - 1; i >= 0; i--) {
          const rule = rules[i];
          if (rule.type === 1 && rule.selectorText && /\.button/.test(rule.selectorText)) {
            try { container.deleteRule(i); n++; } catch { }
          } else if (rule.cssRules && (rule.type === 4 || rule.type === 3 || rule.type === 7 || rule.constructor.name === 'CSSLayerBlockRule')) {
            // 4=layer 3=@media 7=@supports
            // 注意：Chrome 里 CSSLayerBlockRule 的 type 实测为 0，不是 4，
            // 所以必须兼判 constructor.name，否则 layer 内的规则删不到。
            n += stripIn(rule, tag);
          }
        }
        return n;
      };
      const apply = () => {
        for (const sheet of document.styleSheets) {
          const id = (sheet.ownerNode && sheet.ownerNode.getAttribute && sheet.ownerNode.getAttribute('data-vite-dev-id')) || '';
          if (!/legacy\.css|v6\.css/.test(id)) continue;
          const n = stripIn(sheet, id);
          if (n) { window.__stripLog.removed += n; window.__stripLog.sheets.push(id.split('/').pop() + ':' + n); }
        }
      };
      document.addEventListener('DOMContentLoaded', () => setTimeout(apply, 0));
      setTimeout(apply, 400);
      setTimeout(apply, 1500);
    });
  }

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.locator('input[type=email]').first().fill('admin@local.test');
  await page.locator('input[type=password]').first().fill('ChangeMe123!');
  await page.locator('button[type=submit]').first().click();
  await page.waitForTimeout(2600);

  const stripLog = mode === 'strip' ? await page.evaluate(() => window.__stripLog) : null;

  const data = {};
  for (const route of ROUTES) {
    await page.evaluate((r) => {
      window.history.pushState(null, '', r);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForTimeout(840);

    data[route] = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.button')) {
        if (getComputedStyle(el).display === 'none') continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        out.push({
          cls: (el.className || '').toString(),
          txt: (el.textContent || '').trim().slice(0, 12),
          h: Math.round(r.height), w: Math.round(r.width),
          bg: cs.backgroundColor, color: cs.color,
          borderW: cs.borderTopWidth, borderC: cs.borderTopColor,
          radius: cs.borderTopLeftRadius, fs: cs.fontSize, fw: cs.fontWeight,
          pad: cs.padding, minH: cs.minHeight, shadow: cs.boxShadow, transform: cs.transform,
        });
      }
      return out;
    });
  }
  await ctx.close();
  return { data, stripLog };
}

console.log('基线...');
const base = await run('normal');
console.log('实验（移除 legacy/v6 的 .button 规则）...');
const exp = await run('strip');

console.log(`\n删除日志: ${JSON.stringify(exp.stripLog)}`);
if (!exp.stripLog || exp.stripLog.removed === 0) {
  console.log('\n✗ 删除未生效，本次对比不可信。中止。');
  await browser.close();
  process.exit(1);
}

let totalEls = 0, diffEls = 0;
const byProp = {};
const byRoute = {};

for (const route of ROUTES) {
  const a = base.data[route] || [];
  const b = exp.data[route] || [];
  totalEls += a.length;
  if (a.length !== b.length) { console.log(`  ! ${route}: 数量 ${a.length} vs ${b.length}`); continue; }
  for (let i = 0; i < a.length; i++) {
    const ch = [];
    for (const k of Object.keys(a[i])) {
      if (k === 'cls' || k === 'txt') continue;
      if (String(a[i][k]) !== String(b[i][k])) { ch.push(`${k}: ${a[i][k]} → ${b[i][k]}`); byProp[k] = (byProp[k] || 0) + 1; }
    }
    if (ch.length) {
      diffEls++;
      (byRoute[route] = byRoute[route] || []).push({ txt: a[i].txt, cls: a[i].cls.slice(0, 44), ch });
    }
  }
}

console.log(`\n=== 结果 ===`);
console.log(`  按钮总数: ${totalEls}`);
console.log(`  有差异:   ${diffEls}`);
if (Object.keys(byProp).length) {
  console.log(`\n  按属性:`);
  for (const [k, n] of Object.entries(byProp).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(11)} ${n}`);
  console.log(`\n  按页面:`);
  for (const [r, list] of Object.entries(byRoute)) {
    console.log(`    ${r} (${list.length})`);
    for (const d of list.slice(0, 2)) console.log(`       "${d.txt}" ${d.ch.slice(0, 2).join(' | ')}`);
  }
}

writeFileSync('docs/gates/button-migration-probe.json', JSON.stringify({ stripLog: exp.stripLog, totalEls, diffEls, byProp, byRoute }, null, 2));
console.log('\n明细 → docs/gates/button-migration-probe.json');
await browser.close();
