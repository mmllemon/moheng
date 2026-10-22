import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2000);

const out = await p.evaluate(async () => {
  await document.fonts.ready;
  const mk = (css) => {
    const el = document.createElement('div');
    el.textContent = '墨衡工程';
    el.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;white-space:nowrap;font-size:64px;' + css;
    document.body.appendChild(el);
    const w = el.getBoundingClientRect().width;
    el.remove();
    return Number(w.toFixed(2));
  };

  return {
    // 可变轴强制
    wght200: mk('font-family:"MH Serif SC";font-variation-settings:"wght" 200;'),
    wght400: mk('font-family:"MH Serif SC";font-variation-settings:"wght" 400;'),
    wght700: mk('font-family:"MH Serif SC";font-variation-settings:"wght" 700;'),
    wght900: mk('font-family:"MH Serif SC";font-variation-settings:"wght" 900;'),
    // font-weight 方式
    fw200: mk('font-family:"MH Serif SC";font-weight:200;'),
    fw700: mk('font-family:"MH Serif SC";font-weight:700;'),
    // 对照：无衬线字体不同字重（应无差异，验证测量方法有效）
    sans400: mk('font-family:sans-serif;font-weight:400;'),
    sans700: mk('font-family:sans-serif;font-weight:700;'),
  };
});
console.log(JSON.stringify(out, null, 2));
await b.close();
