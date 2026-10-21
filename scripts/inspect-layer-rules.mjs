// 核实 legacy.css 的 @layer 结构里到底有没有 .button 规则，以及删除能否触及
import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await ctx.newPage();
await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await p.waitForTimeout(2200);

const r = await p.evaluate(() => {
  const result = { sheets: [], layerButtonRules: [], allButtonRules: [] };

  const walk = (rules, path, sheetName, depth) => {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const here = `${path}[${i}]`;
      if (rule.type === 1 && rule.selectorText) {
        if (/\.button/.test(rule.selectorText)) {
          const entry = { sheet: sheetName, depth, type: rule.type, sel: rule.selectorText.slice(0, 70) };
          result.allButtonRules.push(entry);
          if (depth > 0) result.layerButtonRules.push(entry);
        }
      } else if (rule.cssRules) {
        walk(rule.cssRules, here, sheetName, depth + 1);
      }
    }
  };

  for (const sheet of document.styleSheets) {
    const id = (sheet.ownerNode && sheet.ownerNode.getAttribute && sheet.ownerNode.getAttribute('data-vite-dev-id')) || '(no-id)';
    const short = String(id).split('/').pop();
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    // 顶层类型统计
    const types = {};
    for (const rule of rules) types[rule.type] = (types[rule.type] || 0) + 1;
    result.sheets.push({ sheet: short, topLevelRules: rules.length, types });
    walk(rules, '', short, 0);
  }
  return result;
});

console.log('=== 样式表顶层结构 ===');
console.log('type: 1=style 3=@media 4=@layer 7=@supports\n');
for (const s of r.sheets) {
  console.log(`  ${s.sheet.padEnd(26)} 顶层 ${String(s.topLevelRules).padStart(5)} 条  类型分布 ${JSON.stringify(s.types)}`);
}

console.log(`\n=== 含 .button 的规则：共 ${r.allButtonRules.length} 条 ===`);
const bySheet = {};
for (const x of r.allButtonRules) bySheet[x.sheet] = (bySheet[x.sheet] || 0) + 1;
for (const [k, v] of Object.entries(bySheet)) console.log(`  ${k.padEnd(26)} ${v} 条`);

console.log(`\n=== 其中嵌在 @layer / @media 里的：${r.layerButtonRules.length} 条 ===`);
for (const x of r.layerButtonRules.slice(0, 30)) {
  console.log(`  depth=${x.depth} [${x.sheet}] ${x.sel}`);
}

await b.close();
