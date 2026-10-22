// 移动端顶栏确认
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const w of [1024, 768, 600]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);
  await gotoRoute(page, '/projects', { settle: 1400 });
  const r = await page.evaluate(() => {
    const c = document.querySelector('.titlebar-context');
    const strong = c && c.querySelector('strong');
    const wordmark = document.querySelector('.titlebar-wordmark');
    const sep = document.querySelector('.titlebar-separator');
    return {
      text: (c ? c.textContent : '').trim(),
      fs: strong ? getComputedStyle(strong).fontSize : null,
      w: c ? Math.round(c.getBoundingClientRect().width) : 0,
      wordmarkGone: !wordmark,
      sepCount: document.querySelectorAll('.titlebar-separator').length,
    };
  });
  console.log(`${String(w).padEnd(6)}px  "${r.text}"  ${r.fs}  宽${r.w}  MOHENG已移除=${r.wordmarkGone}  分隔符${r.sepCount}个`);
  await ctx.close();
}

await browser.close();
