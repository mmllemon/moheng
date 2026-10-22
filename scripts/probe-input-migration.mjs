// 输入控件族迁移探针：移除 legacy/v6 里的输入相关规则后比对渲染
// 复用按钮族的验证方案：先确认删除数 > 0，再比对
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
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

// 需要比对的属性
const PROPS = ['h', 'w', 'bg', 'color', 'borderW', 'borderC', 'radius', 'fs', 'fw', 'pad', 'minH', 'shadow', 'outline', 'placeholderColor'];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function run(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  if (mode === 'strip') {
    await page.addInitScript(() => {
      window.__stripLog = { removed: 0, detail: [] };
      // 判定一条规则是否「与输入控件相关」
      const isInputish = (sel) => {
        const low = sel.toLowerCase();
        // 原生标签
        if (/(^|[\s,>+~(])(input|select|textarea)(?![a-z-])/.test(low)) return true;
        // 已知的输入类名（不含 switch/toggle，那是开关不是输入）
        return /\.(field|form-stack|form-grid|filter-bar|search-input|toolbar-search|toolbar-select|table-filter-select|select-control|select-option|select-popover|date-picker|input-with-icon|input-suffix|checkbox-line|quick-search)/.test(low);
      };

      const stripIn = (container) => {
        let rules;
        try { rules = container.cssRules; } catch { return 0; }
        if (!rules) return 0;
        let n = 0;
        for (let i = rules.length - 1; i >= 0; i--) {
          const rule = rules[i];
          if (rule.type === 1 && rule.selectorText) {
            if (isInputish(rule.selectorText)) {
              try { container.deleteRule(i); n++; } catch { }
            }
          } else if (rule.cssRules) {
            // CSSLayerBlockRule 的 type 实测为 0，必须靠 cssRules 存在来判断
            n += stripIn(rule);
          }
        }
        return n;
      };

      const apply = () => {
        for (const sheet of document.styleSheets) {
          const id = (sheet.ownerNode && sheet.ownerNode.getAttribute && sheet.ownerNode.getAttribute('data-vite-dev-id')) || '';
          if (!/legacy\.css|v6\.css/.test(id)) continue;
          const n = stripIn(sheet);
          if (n) { window.__stripLog.removed += n; window.__stripLog.detail.push(id.split('/').pop() + ':' + n); }
        }
      };
      document.addEventListener('DOMContentLoaded', () => setTimeout(apply, 0));
      setTimeout(apply, 400);
      setTimeout(apply, 1500);
    });
  }

  await login(page);

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
      const sel = 'input:not([type=hidden]), select, textarea, .select-control-trigger, .date-picker-trigger, .field, .toolbar-search, .search-input, .checkbox-line';
      const seen = new Set();
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.height < 4 || r.width < 4) continue;
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 40),
          h: Math.round(r.height), w: Math.round(r.width),
          bg: cs.backgroundColor, color: cs.color,
          borderW: cs.borderTopWidth, borderC: cs.borderTopColor,
          radius: cs.borderTopLeftRadius, fs: cs.fontSize, fw: cs.fontWeight,
          pad: cs.padding, minH: cs.minHeight,
          shadow: cs.boxShadow, outline: cs.outlineWidth,
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
console.log('实验（移除 legacy/v6 的输入相关规则）...');
const exp = await run('strip');

console.log(`\n删除日志: ${JSON.stringify(exp.stripLog)}`);
if (!exp.stripLog || exp.stripLog.removed === 0) {
  console.log('\n✗ 删除未生效，对比不可信。中止。');
  await browser.close();
  process.exit(1);
}

let total = 0, diff = 0;
const byProp = {};
const byRoute = {};
const byClass = {};

for (const route of ROUTES) {
  const a = base.data[route] || [];
  const b = exp.data[route] || [];
  if (a.length !== b.length) {
    console.log(`  ! ${route}: 元素数 ${a.length} vs ${b.length}`);
    continue;
  }
  for (let i = 0; i < a.length; i++) {
    total++;
    const ch = [];
    for (const k of PROPS) {
      if (String(a[i][k]) !== String(b[i][k])) {
        ch.push(`${k}: ${a[i][k]} → ${b[i][k]}`);
        byProp[k] = (byProp[k] || 0) + 1;
      }
    }
    if (ch.length) {
      diff++;
      const key = `${a[i].tag}.${a[i].cls}`;
      byClass[key] = (byClass[key] || 0) + 1;
      if (!byRoute[route]) byRoute[route] = [];
      byRoute[route].push({ tag: a[i].tag, cls: a[i].cls, ch });
    }
  }
}

console.log(`\n=== 结果 ===`);
console.log(`  控件总数: ${total}`);
console.log(`  有差异:   ${diff}  (${((diff / total) * 100).toFixed(1)}%)`);

if (Object.keys(byProp).length) {
  console.log(`\n  按属性:`);
  for (const [k, n] of Object.entries(byProp).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(11)} ${n}`);
}
if (Object.keys(byClass).length) {
  console.log(`\n  按控件类型（前 15）:`);
  for (const [k, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`    ${n.toString().padStart(4)}×  ${k}`);
}
if (Object.keys(byRoute).length) {
  console.log(`\n  按页面（前 10）:`);
  for (const [r, list] of Object.entries(byRoute).sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    console.log(`    ${r.padEnd(24)} ${list.length} 处`);
    for (const d of list.slice(0, 2)) console.log(`       ${d.tag}.${d.cls}  ${d.ch.slice(0, 2).join(' | ')}`);
  }
}

writeFileSync('docs/gates/input-migration-probe.json', JSON.stringify({ stripLog: exp.stripLog, total, diff, byProp, byClass, byRoute }, null, 2));
console.log('\n明细 → docs/gates/input-migration-probe.json');
await browser.close();
