// 验证：禁用状态下按钮是否仍有 hover 视觉反馈
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await c.newPage();
await login(p);

// 找一个禁用按钮
await p.evaluate(() => { history.pushState(null, '', '/system/dictionaries'); dispatchEvent(new PopStateEvent('popstate')); });
await p.waitForTimeout(1400);

const target = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button:disabled')].find((e) => (e.textContent || '').trim());
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  return {
    txt: (btn.textContent || '').trim().slice(0, 10),
    cls: btn.className,
    bg: cs.backgroundColor,
    color: cs.color,
    border: cs.borderTopColor,
    opacity: cs.opacity,
    rect: btn.getBoundingClientRect().toJSON(),
  };
});

if (!target) { console.log('本页无禁用按钮'); }
else {
  console.log('禁用按钮（未 hover）:');
  console.log('  ', target.txt, '|', target.cls);
  console.log('   bg=', target.bg, ' color=', target.color, ' border=', target.border, ' opacity=', target.opacity);

  // 模拟 hover
  await p.mouse.move(target.rect.x + target.rect.width / 2, target.rect.y + target.rect.height / 2);
  await p.waitForTimeout(400);

  const after = await p.evaluate((sel) => {
    const btn = [...document.querySelectorAll('button:disabled')].find((e) => (e.textContent || '').trim() === sel);
    if (!btn) return null;
    const cs = getComputedStyle(btn);
    return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, opacity: cs.opacity };
  }, target.txt);

  console.log('\n禁用按钮（hover 中）:');
  console.log('   bg=', after.bg, ' color=', after.color, ' border=', after.border, ' opacity=', after.opacity);

  const changed = after.bg !== target.bg || after.border !== target.border || after.color !== target.color;
  console.log(`\n${changed ? '✗ 禁用按钮 hover 后样式发生了变化（用户会以为能点）' : '✓ 禁用按钮 hover 无变化'}`);
}

await b.close();
