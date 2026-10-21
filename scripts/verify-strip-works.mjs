// 验证探针本身有效：确认 stripping 真的删掉了规则
import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await ctx.newPage();

await p.addInitScript(() => {
  window.__stripped = { legacy: 0, v6: 0, other: 0 };
  const strip = (sheet, tag) => {
    let rules;
    try { rules = sheet.cssRules; } catch { return; }
    if (!rules) return;
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i];
      if (rule.type === 1 && rule.selectorText && /\.button/.test(rule.selectorText)) {
        try { sheet.deleteRule(i); window.__stripped[tag]++; } catch { }
      }
    }
  };
  const apply = () => {
    for (const sheet of document.styleSheets) {
      const name = (sheet.href || '').split('/').pop() || '';
      if (/legacy/.test(name)) strip(sheet, 'legacy');
      else if (/v6/.test(name)) strip(sheet, 'v6');
      else if (/\.button/.test(name)) strip(sheet, 'other');
    }
  };
  document.addEventListener('DOMContentLoaded', () => setTimeout(apply, 0));
  setTimeout(apply, 400);
  setTimeout(apply, 1500);
});

await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);

const r = await p.evaluate(() => {
  const remaining = [];
  for (const sheet of document.styleSheets) {
    const name = (sheet.href || '').split('/').pop() || 'inline';
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    let n = 0;
    for (const rule of rules) {
      if (rule.type === 1 && rule.selectorText && /\.button/.test(rule.selectorText)) n++;
    }
    if (n) remaining.push({ sheet: name, count: n });
  }
  return { stripped: window.__stripped, remaining };
});

console.log('=== 已删除的规则数 ===');
console.log(JSON.stringify(r.stripped, null, 1));
console.log('\n=== 剩余含 .button 的样式表 ===');
for (const x of r.remaining) console.log(`  ${x.sheet.padEnd(30)} ${x.count} 条`);
console.log('\n判定:', r.stripped.legacy > 0 || r.stripped.v6 > 0
  ? '✓ 删除确实生效（探针有效）'
  : '✗ 删除没生效（0 差异不可信）');

await b.close();
