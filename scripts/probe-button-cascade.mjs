// 判定 .button 家族每条规则的每个属性是否真的影响渲染
// 方法：对每个属性，用 getComputedStyle 的值去匹配「哪条规则的值等于它」，
// 再结合 !important 与顺序推断胜出者；拿不到精确胜出者的，标记为不确定。
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

// 在页面里收集所有含 .button 的规则，带上来源文件名与顺序
const collectScript = `
(() => {
  const out = [];
  let order = 0;
  const walk = (rules, sheetName) => {
    for (const rule of rules) {
      if (rule.cssRules && rule.type !== 1) { walk(rule.cssRules, sheetName); continue; }
      if (!rule.selectorText) continue;
      if (!/\\.button/.test(rule.selectorText)) continue;
      const decls = [];
      for (let i = 0; i < rule.style.length; i++) {
        const name = rule.style[i];
        decls.push({
          name: name.toLowerCase(),
          value: rule.style.getPropertyValue(name).trim(),
          important: rule.style.getPropertyPriority(name) === 'important',
        });
      }
      out.push({ sel: rule.selectorText.replace(/\\s+/g, ' '), sheet: sheetName, order: order++, decls });
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    const name = (sheet.href || '').split('/').pop() || 'inline';
    walk(rules, name);
  }
  return out;
})()
`;

const allRules = [];
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(860);

  const res = await page.evaluate(({ script, rules }) => {
    const collected = eval(script);

    // 对每个按钮，找出它匹配的规则，然后判定每个属性谁胜出
    const els = [...document.querySelectorAll('.button')].filter((e) => getComputedStyle(e).display !== 'none');
    const outcome = new Map(); // key -> win count

    for (const el of els) {
      const matched = [];
      for (const rule of collected) {
        // 只按主选择器判断（逗号分组时逐个试）
        const parts = rule.selector.split(',').map((s) => s.trim());
        let hit = false;
        for (const p of parts) {
          try { if (el.matches(p)) { hit = true; break; } } catch { }
        }
        if (hit) matched.push(rule);
      }
      if (!matched.length) continue;

      const cs = getComputedStyle(el);
      // 对每个属性，在 matched 里找「值等于 computed」且优先级最高的
      const byProp = new Map();
      for (const rule of matched) {
        for (const d of rule.decls) {
          if (!byProp.has(d.name)) byProp.set(d.name, []);
          byProp.get(d.name).push({ ...d, sel: rule.sel, sheet: rule.sheet, order: rule.order });
        }
      }

      for (const [prop, list] of byProp) {
        // computed 值
        const computed = cs.getPropertyValue(prop);
        if (!computed) continue;
        // 候选里值能对上 computed 的（先比 important，再比 order）
        const norm = (v) => String(v).replace(/\\s+/g, ' ').trim();
        const candidates = list.filter((d) => {
          const v = norm(d.value);
          // 变量、calc 等无法字面对比，先标记为「不可判定」
          if (/var\(|calc\(|color-mix|clamp\(/.test(v)) return false;
          return norm(computed) === v || norm(computed).startsWith(v) || v.startsWith(norm(computed).split(' ')[0]);
        });
        let winnerKey;
        if (candidates.length) {
          candidates.sort((a, b) => (b.important - a.important) || (b.order - a.order));
          const w = candidates[0];
          winnerKey = `${w.sheet}|${w.sel}|${prop}`;
        } else {
          // 不可判定：按 important + order 推断最后一个声明该属性的规则
          const sorted = [...list].sort((a, b) => (b.important - a.important) || (b.order - a.order));
          const w = sorted[0];
          winnerKey = `${w.sheet}|${w.sel}|${prop}`;
        }
        outcome.set(winnerKey, (outcome.get(winnerKey) || 0) + 1);
      }
    }

    // 同时记录「声明了但从未胜出」的属性
    const declared = new Map();
    for (const rule of collected) {
      for (const d of rule.decls) {
        const k = `${rule.sheet}|${rule.sel}|${d.name}`;
        if (!declared.has(k)) declared.set(k, { sheet: rule.sheet, sel: rule.sel, prop: d.name });
      }
    }
    return {
      outcome: [...outcome.entries()],
      declared: [...declared.values()],
      btnCount: els.length,
    };
  }, { script: collectScript, rules: allRules.length });

  for (const [k, n] of res.outcome) {
    const entry = allRules.find((x) => false);
    void entry;
    const [sheet, sel, prop] = k.split('|');
    const key = `${sheet}|${sel}`;
    if (!globalThis.__agg) globalThis.__agg = new Map();
    if (!globalThis.__agg.has(key)) globalThis.__agg.set(key, { sheet, sel, total: 0, win: 0, props: [] });
    const g = globalThis.__agg.get(key);
    g.total++;
    g.win++;
    g.props.push(`${prop}(${n})`);
  }
  for (const d of res.declared) {
    const key = `${d.sheet}|${d.sel}`;
    if (!globalThis.__agg) globalThis.__agg = new Map();
    if (!globalThis.__agg.has(key)) globalThis.__agg.set(key, { sheet, sel: d.sel, total: 0, win: 0, props: [] });
    void key;
  }
}

const agg = globalThis.__agg || new Map();
const rows = [...agg.values()].sort((a, b) => b.win - a.win);
console.log(`=== 实际胜出的规则（${rows.length} 个选择器）===\n`);
for (const r of rows.slice(0, 50)) {
  console.log(`  [${r.sheet.padEnd(12)}] ${r.sel.slice(0, 76)}`);
  console.log(`      ${r.props.slice(0, 10).join(' ')}`);
}

await browser.close();
