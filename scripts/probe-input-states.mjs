// 核实：是真的没有禁用/只读输入控件，还是审计条件漏了
import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await c.newPage();
await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2600);

// 1) 源码里有多少 disabled / readOnly 出现在输入控件上
console.log('=== 源码统计 ===');
const fs = await import('node:fs');
const path = await import('node:path');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir)) {
    const fp = path.join(dir, e);
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp, out);
    else if (/\.tsx$/.test(e)) out.push(fp);
  }
  return out;
}
const files = walk('D:/WorkSpace/hana/moheng/apps/web/src');
let inputDisabled = 0;
let inputReadOnly = 0;
const spots = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // <input ... disabled  /  <select ... disabled  /  <textarea ... disabled
  const re = /<(input|select|textarea)\b[^>]*?\b(disabled|readOnly|readonly)\b[^>]*>/gs;
  let m;
  while ((m = re.exec(src))) {
    if (m[2] === 'disabled') inputDisabled++;
    else inputReadOnly++;
    spots.push({
      file: path.basename(f),
      tag: m[1],
      attr: m[2],
      snippet: m[0].replace(/\s+/g, ' ').slice(0, 110),
    });
  }
}
console.log(`  输入控件带 disabled: ${inputDisabled}`);
console.log(`  输入控件带 readOnly: ${inputReadOnly}`);
for (const s of spots.slice(0, 14)) {
  console.log(`    [${s.file}] <${s.tag}> ${s.attr}`);
  console.log(`        ${s.snippet}`);
}

// 2) 运行时：动态打开一个含表单的对话框，看是否有禁用输入
console.log('\n=== 运行时检查：打开弹窗后 ===');
const tries = [
  ['/system/dictionaries', '新建分类'],
  ['/system/accounts', '创建账号'],
  ['/cost/budget', '新增清单'],
  ['/parties', '新建记录'],
];
for (const [route, btnText] of tries) {
  await p.evaluate((r) => { history.pushState(null, '', r); dispatchEvent(new PopStateEvent('popstate')); }, route);
  await p.waitForTimeout(1100);
  const clicked = await p.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').includes(t) && !e.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  }, btnText);
  if (!clicked) { console.log(`  ${route} "${btnText}" —— 未找到按钮`); continue; }
  await p.waitForTimeout(900);
  const found = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (!el.disabled && !el.readOnly) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        disabled: el.disabled,
        readOnly: el.readOnly,
        opacity: cs.opacity,
        bg: cs.backgroundColor,
        cursor: cs.cursor,
        placeholder: el.getAttribute('placeholder') || '',
      });
    }
    return out;
  });
  console.log(`  ${route} 弹窗内禁用/只读输入: ${found.length}`);
  for (const f of found.slice(0, 4)) {
    console.log(`     ${f.tag} disabled=${f.disabled} readOnly=${f.readOnly} opacity=${f.opacity} bg=${f.bg}`);
  }
  // 关闭弹窗
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
}

await b.close();
