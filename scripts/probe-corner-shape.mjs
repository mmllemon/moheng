import { chromium } from 'playwright-core';

const b = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const p = await b.newPage();
await p.setContent(
  '<div id="a" style="width:100px;height:100px;background:red;border-radius:20px;corner-shape:squircle"></div>'
);
const r = await p.evaluate(() => {
  const el = document.getElementById('a');
  const s = getComputedStyle(el);
  return {
    supports: CSS.supports('corner-shape', 'squircle'),
    computedShape: s.getPropertyValue('corner-shape'),
    computedRadius: s.getPropertyValue('border-radius'),
    chromeVersion: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1],
  };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
