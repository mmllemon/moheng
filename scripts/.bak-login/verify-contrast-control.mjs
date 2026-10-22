// 验证字体对比度控件：滑块五档、样例颜色跟随、Hana 同款观感
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email], #email').first().fill('admin@local.test');
await page.locator('input[type=password], #password').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2200);
await page.goto(BASE + '/settings/appearance', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const slider = page.locator('input[type=range][aria-label="字体对比度"]');
const exists = await slider.count();
if (!exists) {
  console.log(JSON.stringify({ error: 'contrast slider not found' }));
  await browser.close();
  process.exit(1);
}

const samples = [];
for (const step of [0, 1, 2, 3, 4]) {
  await slider.fill(String(step));
  await page.waitForTimeout(120);
  const state = await page.evaluate(() => {
    const sample = document.querySelector('.appearance-contrast-sample');
    const root = document.documentElement;
    const bars = Array.from(document.querySelectorAll('.contrast-rail span')).map((s) => ({
      on: s.classList.contains('is-on'),
      h: getComputedStyle(s).height,
    }));
    const label = document.querySelector('.settings-step-labels span:nth-child(2)')?.textContent;
    return {
      attr: root.dataset.contentContrast ?? '(无=13)',
      contentInk: getComputedStyle(root).getPropertyValue('--content-ink').trim() || '(未设)',
      sampleColor: sample ? getComputedStyle(sample).color : null,
      bodyColor: getComputedStyle(document.body).color,
      label,
      bars,
    };
  });
  samples.push({ step, ...state });
}

// 恢复默认
await slider.fill('2');
await page.waitForTimeout(100);

// 截图存档
await page.screenshot({ path: 'docs/gates/contrast-control.png', fullPage: false });

console.log(JSON.stringify({
  sliderFound: true,
  distinctSampleColors: new Set(samples.map((s) => s.sampleColor)).size,
  samples,
}, null, 2));
await browser.close();
