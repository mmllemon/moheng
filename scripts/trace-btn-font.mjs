import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await c.newPage();
await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2600);

for (const [route, label] of [['/reports', '导出 CSV'], ['/system/assistant', '保存配置'], ['/system/assistant', '读取模型']]) {
  await p.evaluate((r) => { window.history.pushState(null, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
  await p.waitForTimeout(1100);
  const res = await p.evaluate((lab) => {
    const el = [...document.querySelectorAll('.button')].find((e) => (e.textContent || '').includes(lab));
    if (!el) return null;
    const hits = [];
    for (const sh of document.styleSheets) {
      let rs; try { rs = sh.cssRules; } catch { continue; }
      const walk = (arr) => {
        for (const rule of arr) {
          if (rule.cssRules && rule.type !== 1) { walk(rule.cssRules); continue; }
          if (rule.selectorText) {
            try {
              if (el.matches(rule.selectorText) && rule.style.fontSize) {
                hits.push({ sel: rule.selectorText.slice(0, 88), fs: rule.style.fontSize });
              }
            } catch { }
          }
          if (rule.cssRules) walk(rule.cssRules);
        }
      };
      walk(rs);
    }
    return { txt: (el.textContent || '').trim().slice(0, 10), actual: getComputedStyle(el).fontSize, cls: el.className, hits };
  }, label);
  console.log(`\n### ${route}  "${label}"`);
  if (!res) { console.log('  未找到'); continue; }
  console.log(`  实际: ${res.actual}   class: ${res.cls}`);
  for (const h of res.hits) console.log(`    ${h.fs.padEnd(10)} ${h.sel}`);
}
await b.close();
