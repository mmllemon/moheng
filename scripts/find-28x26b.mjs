import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const c=await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
const p=await c.newPage();
await p.goto('http://localhost:5173/login',{waitUntil:'networkidle'});
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2600);
// 在首页直接扫所有元素，不限 button
const o = await p.evaluate(() => {
  const a = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const b = el.getBoundingClientRect();
    if (Math.round(b.height) !== 26 || Math.round(b.width) !== 28) continue;
    a.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 46),
      aria: el.getAttribute('aria-label') || el.getAttribute('title') || '',
      txt: (el.textContent || '').trim().slice(0, 10),
      path: (() => { let n = el.parentElement, s = []; while (n && n !== document.body && s.length < 3) { s.push((n.className || '').toString().split(' ')[0] || n.tagName.toLowerCase()); n = n.parentElement; } return s.join(' > '); })(),
    });
  }
  return a.slice(0, 8);
});
console.log(JSON.stringify(o, null, 1));
await b.close();
