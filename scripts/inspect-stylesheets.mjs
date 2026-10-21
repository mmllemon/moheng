// 修正版：Vite 开发模式下 CSS 是内联 <style>，按内容特征识别来源
import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await ctx.newPage();

await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await p.waitForTimeout(2200);

const info = await p.evaluate(() => {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    // 判断来源：看 ownerNode 的 id / data-vite-dev-id
    const node = sheet.ownerNode;
    const id = node && (node.getAttribute('data-vite-dev-id') || node.id || '');
    // 取首几条规则的文本作为指纹
    let sample = '';
    for (let i = 0; i < Math.min(3, rules.length); i++) {
      sample += (rules[i].cssText || '').slice(0, 40);
    }
    let btnCount = 0;
    let total = 0;
    for (const rule of rules) {
      total++;
      if (rule.type === 1 && rule.selectorText && /\.button/.test(rule.selectorText)) btnCount++;
    }
    out.push({ id: String(id).slice(0, 80), total, btnCount, sample: sample.slice(0, 60) });
  }
  return out;
});

console.log(`共 ${info.length} 个样式表：\n`);
for (const x of info) {
  console.log(`  id=${x.id || '(空)'}`);
  console.log(`     规则 ${x.total}，含 .button ${x.btnCount}`);
  if (x.btnCount) console.log(`     样本: ${x.sample}`);
}

await b.close();
