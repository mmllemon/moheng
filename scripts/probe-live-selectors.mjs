// 实测：旧层规则到底有多少在页面上真正生效
// 方法：注入一个探针，遍历页面上所有元素，检查是否有元素命中 legacy/v6 的 orphan 选择器
// 用 CSS.supports + 实际 DOM 匹配（querySelectorAll）判断
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { readFileSync } from 'node:fs';

const STYLES = 'D:/WorkSpace/hana/moheng/apps/web/src/styles';
const BASE = 'http://localhost:5173';

const legacy = readFileSync(`${STYLES}/legacy.css`, 'utf8');
const v6 = readFileSync(`${STYLES}/v6.css`, 'utf8');

// 抽取选择器（复用简版解析）
function selectors(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  let i = 0;
  while (true) {
    const brace = clean.indexOf('{', i);
    if (brace === -1) break;
    const sel = clean.slice(i, brace).trim();
    if (sel.startsWith('@')) {
      // 容器：跳过 selector 部分，进入内部
      const close = clean.indexOf('}', brace);
      // 粗略：把容器内也当作独立规则区
      i = brace + 1;
      continue;
    }
    for (const s of sel.split(',')) {
      const t = s.trim().replace(/\s+/g, ' ');
      if (t && !t.startsWith('@') && !t.startsWith('/*')) out.push(t);
    }
    const close = clean.indexOf('}', brace);
    i = close === -1 ? clean.length : close + 1;
  }
  return [...new Set(out)];
}

const legacySel = selectors(legacy);
const v6Sel = selectors(v6);

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await login(page);

const routes = ['/', '/projects', '/cost/contracts', '/system/accounts', '/settings/appearance', '/reports'];
const hitCount = new Map();

for (const route of routes) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const hits = await page.evaluate(({ legacySel, v6Sel }) => {
    const result = { legacy: [], v6: [] };
    const test = (list, bucket) => {
      for (const sel of list) {
        // 跳过伪元素和复杂伪类，只测能匹配元素的选择器
        if (sel.includes('::')) continue;
        try {
          const found = document.querySelectorAll(sel.replace(/:(hover|active|focus|focus-visible|focus-within)/g, ''));
          if (found.length > 0) result[bucket].push({ sel, n: found.length });
        } catch { /* 无效选择器跳过 */ }
      }
    };
    test(legacySel, 'legacy');
    test(v6Sel, 'v6');
    return result;
  }, { legacySel, v6Sel });

  for (const h of hits.legacy) hitCount.set('legacy|' + h.sel, (hitCount.get('legacy|' + h.sel) || 0) + h.n);
  for (const h of hits.v6) hitCount.set('v6|' + h.sel, (hitCount.get('v6|' + h.sel) || 0) + h.n);
}

// 分类统计
const stats = { legacy: { live: 0, dead: 0, liveSel: [] }, v6: { live: 0, dead: 0, liveSel: [] } };
for (const sel of legacySel) {
  const n = hitCount.get('legacy|' + sel) || 0;
  if (n > 0) { stats.legacy.live++; if (stats.legacy.liveSel.length < 40) stats.legacy.liveSel.push({ sel, n }); }
  else stats.legacy.dead++;
}
for (const sel of v6Sel) {
  const n = hitCount.get('v6|' + sel) || 0;
  if (n > 0) { stats.v6.live++; if (stats.v6.liveSel.length < 40) stats.v6.liveSel.push({ sel, n }); }
  else stats.v6.dead++;
}

console.log(JSON.stringify({
  legacy: { total: legacySel.length, live: stats.legacy.live, dead: stats.legacy.dead, sampleLive: stats.legacy.liveSel.slice(0, 20) },
  v6: { total: v6Sel.length, live: stats.v6.live, dead: stats.v6.dead, sampleLive: stats.v6.liveSel.slice(0, 20) },
}, null, 2));

await browser.close();
