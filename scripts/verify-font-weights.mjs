// 精确验证可变字重：避开容器宽度上限，用 scrollWidth + 单字测量
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email], #email').first().fill('admin@local.test');
await page.locator('input[type=password], #password').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2200);

const result = await page.evaluate(async () => {
  await document.fonts.ready;

  const probe = document.createElement('span');
  // 少量汉字，保证不超出视口
  probe.textContent = '墨衡工程';
  probe.style.cssText =
    'position:fixed;left:0;top:0;font-family:"MH Serif SC",serif;font-size:64px;white-space:nowrap;visibility:hidden;';
  document.body.appendChild(probe);

  const measure = () => probe.getBoundingClientRect().width;
  const rows = {};
  for (const w of [200, 300, 400, 500, 600, 700, 800, 900]) {
    probe.style.fontWeight = String(w);
    rows[w] = Number(measure().toFixed(2));
  }

  // 用 font-variation-settings 直接推轴做对照
  probe.style.fontWeight = '400';
  const at400 = measure();
  probe.style.fontVariationSettings = '"wght" 900';
  const at900 = measure();
  probe.style.fontVariationSettings = '';

  // 检查字体是否真的被应用（不是回退到 serif）
  const fontsUsed = [];
  if (document.fonts.check('64px "MH Serif SC"')) fontsUsed.push('MH Serif SC available');

  probe.remove();

  return {
    rows,
    distinctWidths: new Set(Object.values(rows)).size,
    at400: Number(at400.toFixed(2)),
    at900: Number(at900.toFixed(2)),
    variationViaSettings: Math.abs(at900 - at400) > 0.5,
    fontsUsed,
    loadedFaces: Array.from(document.fonts).filter((f) => f.family.includes('MH Serif')).map((f) => ({ w: f.weight, s: f.status })),
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
