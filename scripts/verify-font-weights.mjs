// 精确验证字重是否真的生效：用中文字符 + 直接量渲染宽度
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

  // 用大量常用汉字，确保覆盖到实际切片
  const probe = document.createElement('div');
  probe.textContent = '墨衡工程经营项目合同成本报表审计账户权限治理字典参数运维日志';
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;font-family:"MH Serif SC",serif;font-size:48px;white-space:nowrap;letter-spacing:0;';
  document.body.appendChild(probe);

  const measure = (weight) => {
    probe.style.fontWeight = String(weight);
    return probe.getBoundingClientRect().width;
  };

  const widths = {};
  for (const w of [300, 400, 500, 600, 700]) widths[w] = measure(w);

  // 同时测 font-variation-settings 强制轴
  probe.style.fontWeight = '400';
  const base = probe.getBoundingClientRect().width;
  probe.style.fontVariationSettings = '"wght" 700';
  const varied = probe.getBoundingClientRect().width;
  probe.style.fontVariationSettings = '';

  probe.remove();

  const faces = Array.from(document.fonts)
    .filter((f) => f.family.includes('MH Serif SC'))
    .map((f) => ({ weight: f.weight, status: f.status }));

  return {
    widths,
    distinct: new Set(Object.values(widths).map((w) => w.toFixed(2))).size,
    baseWidth: base,
    variedWidth: varied,
    variationWorks: Math.abs(varied - base) > 0.5,
    faceCount: faces.length,
    loadedCount: faces.filter((f) => f.status === 'loaded').length,
    weightRange: [...new Set(faces.map((f) => f.weight))].sort(),
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
