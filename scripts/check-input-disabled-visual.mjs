// 定向验证 9 处 disabled/readOnly 输入控件的实际视觉表现
import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await c.newPage();
await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2600);

async function inspect(route, label, picker) {
  await p.evaluate((r) => { history.pushState(null, '', r); dispatchEvent(new PopStateEvent('popstate')); }, route);
  await p.waitForTimeout(1100);
  const r = await p.evaluate((code) => {
    const el = eval(code);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      disabled: el.disabled,
      readOnly: el.readOnly,
      opacity: cs.opacity,
      bg: cs.backgroundColor,
      border: cs.borderTopColor,
      color: cs.color,
      cursor: cs.cursor,
      filter: cs.filter,
      rect: el.getBoundingClientRect().toJSON(),
    };
  }, picker);
  if (!r) { console.log(`\n${label}\n  未找到`); return; }
  console.log(`\n${label}`);
  console.log(`  <${r.tag}> disabled=${r.disabled} readOnly=${r.readOnly}`);
  console.log(`  opacity=${r.opacity}  cursor=${r.cursor}`);
  console.log(`  bg=${r.bg}`);
  console.log(`  border=${r.border}`);
  console.log(`  color=${r.color}`);

  const dim = parseFloat(r.opacity) < 1;
  const differentBg = r.bg !== 'rgba(0, 0, 0, 0)' && r.bg !== 'rgb(255, 255, 255)';
  const noCue = !dim && r.cursor !== 'not-allowed' && !differentBg;
  console.log(`  → ${noCue ? '✗ 无任何视觉提示' : '✓ 有提示'}`);

  // 悬停测试
  await p.mouse.move(r.rect.x + r.rect.width / 2, r.rect.y + r.rect.height / 2);
  await p.waitForTimeout(150);
  const after = await p.evaluate((code) => {
    const el = eval(code);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
  }, picker);
  if (after && (after.bg !== r.bg || after.border !== r.border)) {
    console.log(`  ✗ 悬停变化: bg ${r.bg} → ${after.bg} | border ${r.border} → ${after.border}`);
  }
  await p.mouse.move(3, 3);
}

await inspect('/system/appearance', '主题页：纸张强度滑杆（纹理关闭时禁用）',
  `[...document.querySelectorAll('input[type=range]')].find(e => e.disabled)`);

await inspect('/cost/changes', '变更页：只读金额输入',
  `[...document.querySelectorAll('input[readonly]')][0]`);

await inspect('/cost/contracts', '合同页：只读金额输入',
  `[...document.querySelectorAll('input[readonly]')][0]`);

await inspect('/projects', '项目页：只读金额输入',
  `[...document.querySelectorAll('input[readonly]')][0]`);

// 通过 SelectField 让一个 select 进入 disabled
await p.evaluate(() => { history.pushState(null, '', '/cost/budget'); dispatchEvent(new PopStateEvent('popstate')); });
await p.waitForTimeout(1200);
const hasDisabledSelect = await p.evaluate(() =>
  [...document.querySelectorAll('input[role=combobox]')].some((e) => e.disabled)
);
console.log(`\n/cost/budget 存在禁用的下拉触发器: ${hasDisabledSelect}`);

await b.close();
