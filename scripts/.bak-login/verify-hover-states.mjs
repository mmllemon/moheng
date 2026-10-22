// 验证正常按钮 hover 时的三色联动是否生效
import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await c.newPage();
await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2600);

const CASES = [
  ['/projects', 'button-primary', '进入驾驶舱'],
  ['/projects', 'button-secondary', '项目成员'],
  ['/cost/contracts', 'button-ghost', null],
  ['/audit-logs', 'button-ghost', '刷新'],
  ['/parties', 'button-primary', '新建记录'],
];

for (const [route, cls, label] of CASES) {
  await p.evaluate((r) => { window.history.pushState(null, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
  await p.waitForTimeout(1000);

  const info = await p.evaluate(([c, lab]) => {
    const el = [...document.querySelectorAll('.' + c)].find((e) => {
      if (e.disabled) return false;
      const cs = getComputedStyle(e);
      return cs.display !== 'none' && (!lab || (e.textContent || '').includes(lab));
    });
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      txt: (el.textContent || '').trim().slice(0, 10),
      bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color,
      rect: el.getBoundingClientRect().toJSON(),
    };
  }, [cls, label]);
  if (!info) { console.log(`${route} .${cls} —— 未找到`); continue; }

  await p.mouse.move(info.rect.x + info.rect.width / 2, info.rect.y + info.rect.height / 2);
  await p.waitForTimeout(350);

  const after = await p.evaluate(([c, lab]) => {
    const el = [...document.querySelectorAll('.' + c)].find((e) => {
      if (e.disabled) return false;
      const cs = getComputedStyle(e);
      return cs.display !== 'none' && (!lab || (e.textContent || '').includes(lab));
    });
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
  }, [cls, label]);

  const ch = [];
  if (after.bg !== info.bg) ch.push('bg');
  if (after.border !== info.border) ch.push('border');
  if (after.color !== info.color) ch.push('color');

  console.log(`\n${route}  .${cls}  "${info.txt}"`);
  console.log(`   变化维度: ${ch.length ? ch.join(' + ') : '（无变化 ✗）'}`);
  if (ch.includes('bg')) console.log(`   bg:     ${info.bg} → ${after.bg}`);
  if (ch.includes('border')) console.log(`   border: ${info.border} → ${after.border}`);
  if (ch.includes('color')) console.log(`   color:  ${info.color} → ${after.color}`);

  await p.mouse.move(3, 3);
}

await b.close();
