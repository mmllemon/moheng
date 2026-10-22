// canvas 墨量测量（修正 font 简写语法：font 属性必须完整，family 放最后）
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

  const inkOf = ({ weight = 400, family = '"MH Serif SC"', variation = null, text = '墨衡工程经营' }) => {
    const canvas = document.createElement('canvas');
    const size = 96;
    canvas.width = size * text.length + 40;
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    // 正确顺序：style weight size family
    ctx.font = `normal ${weight} ${size}px ${family}`;
    if (variation) ctx.fontVariantCaps = 'normal';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    ctx.fillText(text, 10, 10);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) ink += data[i];
    return Math.round(ink / 1000);
  };

  const rows = {};
  for (const w of [200, 300, 400, 500, 600, 700, 800, 900]) rows[w] = inkOf({ weight: w });
  const sans = { 400: inkOf({ weight: 400, family: 'sans-serif' }), 700: inkOf({ weight: 700, family: 'sans-serif' }) };
  const serifSys = { 400: inkOf({ weight: 400, family: 'serif' }), 700: inkOf({ weight: 700, family: 'serif' }) };

  return {
    mhSerifByWeight: rows,
    distinctMh: new Set(Object.values(rows)).size,
    sansControl: sans,
    serifControl: serifSys,
  };
});

console.log(JSON.stringify(out, null, 2));
await b.close();
