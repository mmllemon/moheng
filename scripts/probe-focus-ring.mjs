// 探针：真实键盘焦点下的轮廓，用 Tab 键真实触发 :focus-visible
import { chromium } from 'playwright-core';
import { CHROME, login } from './_harness.mjs';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await page.evaluate(() => {
  history.pushState(null, '', '/system/policies');
  dispatchEvent(new PopStateEvent('popstate'));
});
await page.waitForTimeout(1500);

const out = [];
// 真实键盘 Tab 前进 8 次，每次记录当前焦点元素
await page.evaluate(() => document.body.focus());
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    let fv = null;
    try { fv = el.matches(':focus-visible'); } catch { }
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
      focusVisible: fv,
      outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
      offset: cs.outlineOffset,
      boxShadow: cs.boxShadow.slice(0, 60),
    };
  });
  if (r) out.push({ step: i + 1, ...r });
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
