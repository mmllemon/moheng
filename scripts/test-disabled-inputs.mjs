// 构造真实场景：打开变更审批弹窗，检查只读输入；关闭纹理，检查禁用滑杆
import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await c.newPage();
await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2600);

async function report(el, label) {
  const r = await p.evaluate((node) => {
    if (!node) return null;
    const cs = getComputedStyle(node);
    return {
      disabled: node.disabled, readOnly: node.readOnly,
      opacity: cs.opacity, bg: cs.backgroundColor, border: cs.borderTopColor,
      color: cs.color, cursor: cs.cursor,
      rect: node.getBoundingClientRect().toJSON(),
    };
  }, el);
  if (!r) { console.log(`\n${label}: 未找到`); return null; }
  console.log(`\n${label}`);
  console.log(`  disabled=${r.disabled} readOnly=${r.readOnly} opacity=${r.opacity} cursor=${r.cursor}`);
  console.log(`  bg=${r.bg}`);
  console.log(`  border=${r.border}`);
  console.log(`  color=${r.color}`);
  const dim = parseFloat(r.opacity) < 1;
  const cursorCue = r.cursor === 'not-allowed' || r.cursor === 'default';
  console.log(`  → ${dim || cursorCue ? '✓ 有视觉提示' : '✗ 与普通输入框无区别'}`);

  await p.mouse.move(r.rect.x + r.rect.width / 2, r.rect.y + r.rect.height / 2);
  await p.waitForTimeout(150);
  const after = await p.evaluate((node) => {
    const cs = getComputedStyle(node);
    return { bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
  }, el);
  if (after.bg !== r.bg || after.border !== r.border || after.color !== r.color) {
    console.log(`  ✗ 悬停变化: bg ${r.bg} → ${after.bg}  border ${r.border} → ${after.border}`);
  } else {
    console.log('  ✓ 悬停无变化');
  }
  await p.mouse.move(3, 3);
  return r;
}

// --- 场景 1：变更审批弹窗里的只读金额 ---
await p.evaluate(() => { history.pushState(null, '', '/cost/changes'); dispatchEvent(new PopStateEvent('popstate')); });
await p.waitForTimeout(1300);

// 找一个能打开审批弹窗的按钮
const opened = await p.evaluate(() => {
  const cands = [...document.querySelectorAll('button')].filter((e) => {
    const t = (e.textContent || '').trim();
    return !e.disabled && /审核|审批|处理|填写/.test(t);
  });
  if (!cands.length) return { ok: false, labels: [...document.querySelectorAll('button')].map((e) => (e.textContent || '').trim()).slice(0, 20) };
  cands[0].click();
  return { ok: true, label: (cands[0].textContent || '').trim() };
});
console.log('打开审批弹窗:', JSON.stringify(opened));
await p.waitForTimeout(900);

const readonlyEl = await p.evaluateHandle(() => document.querySelector('.dialog input[readonly]'));
await report(readonlyEl, '变更审批弹窗：只读的「内部送审金额」');

// 对比同弹窗里的普通输入（作为参照）
const normalEl = await p.evaluateHandle(() => {
  const all = [...document.querySelectorAll('.dialog input')].filter((e) => !e.readOnly && !e.disabled);
  return all[0] || null;
});
await report(normalEl, '同弹窗：普通可编辑输入（参照）');

await p.keyboard.press('Escape');
await p.waitForTimeout(500);

// --- 场景 2：纹理强度滑杆禁用态 ---
await p.evaluate(() => { history.pushState(null, '', '/settings/appearance'); dispatchEvent(new PopStateEvent('popstate')); });
await p.waitForTimeout(1300);

// 关闭纹理，让滑杆禁用
const offResult = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter((e) => (e.textContent || '').trim() === '关闭' || (e.textContent || '').includes('无纹理'));
  return btns.map((e) => (e.textContent || '').trim());
});
console.log('\n纹理开关候选:', JSON.stringify(offResult));

const disabledRange = await p.evaluateHandle(() => document.querySelector('input[type=range][disabled]'));
await report(disabledRange, '主题页：被禁用的纹理强度滑杆');

await b.close();
