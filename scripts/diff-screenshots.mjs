// 用浏览器比对两张截图的像素差异（避免引入 canvas 依赖）
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function diff(label, aPath, bPath) {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newContext().then((c) => c.newPage());

  const aB64 = readFileSync(aPath).toString('base64');
  const bB64 = readFileSync(bPath).toString('base64');

  await p.setContent('<html><body></body></html>');
  const res = await p.evaluate(async ([a, b]) => {
    const load = (b64) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = 'data:image/png;base64,' + b64;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) {
      return { error: `尺寸不同 ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
    }
    const c = document.createElement('canvas');
    c.width = ia.width; c.height = ia.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ia, 0, 0);
    const da = ctx.getImageData(0, 0, c.width, c.height).data;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(0, 0, c.width, c.height).data;

    let changed = 0, total = 0, maxDelta = 0;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < c.height; y += 3) {
      for (let x = 0; x < c.width; x += 3) {
        total++;
        const i = (y * c.width + x) * 4;
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (d > 6) {
          changed++;
          if (d > maxDelta) maxDelta = d;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    return { changed, total, maxDelta, box: changed ? [minX, minY, maxX, maxY] : null, w: c.width, h: c.height };
  }, [aB64, bB64]);

  console.log(`\n=== ${label} ===`);
  if (res.error) { console.log('  ' + res.error); }
  else {
    const pct = ((res.changed / res.total) * 100).toFixed(2);
    console.log(`  画布 ${res.w}×${res.h}，采样 ${res.total}`);
    console.log(`  变化点 ${res.changed} (${pct}%)，最大色差 ${res.maxDelta}`);
    if (res.box) console.log(`  变化区域 x ${res.box[0]}–${res.box[2]}, y ${res.box[1]}–${res.box[3]}`);
  }
  await b.close();
}

await diff('policies', 'D:/WorkSpace/hana/moheng/docs/gates/input-skin/policies-before.png',
  'D:/WorkSpace/hana/moheng/docs/gates/input-skin/policies-after.png');
await diff('budget', 'D:/WorkSpace/hana/moheng/docs/gates/input-skin/budget-before.png',
  'D:/WorkSpace/hana/moheng/docs/gates/input-skin/budget-after.png');
