// 决定性实验：我现在改的这些东西，到底依赖不依赖旧层？
// 方法：临时禁用 legacy+v6，看我的新规则是否还能正确渲染
import { chromium } from 'playwright-core';
import { assertApiUp, login } from './_harness.mjs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
await assertApiUp();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

// 识别样式表
const sheets = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('style')).map((el, i) => {
    const id = (el.getAttribute('data-vite-dev-id') || '').split(/[\\/]/).pop() || '';
    let rules = -1;
    try { rules = el.sheet?.cssRules.length ?? -1; } catch {}
    return { i, id, rules };
  });
});
console.log('=== 样式表 ===');
console.log(JSON.stringify(sheets, null, 1));

const PROBE = () => {
  const out = {};
  // 我改过的组件
  const m = document.querySelector('.change-summary, .bill-summary, .owner-metric, .security-metric');
  if (m) {
    const cs = getComputedStyle(m);
    const v = m.querySelector('strong');
    out.statCard = {
      found: true,
      width: Math.round(m.getBoundingClientRect().width),
      paddingLeft: cs.paddingLeft,
      borderLeft: cs.borderLeftWidth,
      bg: cs.backgroundColor.slice(0, 20),
      valueFontSize: v ? getComputedStyle(v).fontSize : null,
      valueFvn: v ? getComputedStyle(v).fontVariantNumeric : null,
    };
  } else out.statCard = { found: false };

  // 我改过的表格
  const t = document.querySelector('.data-table');
  if (t) {
    const th = t.querySelector('thead th');
    const td = t.querySelector('tbody td');
    const evenTd = t.querySelector('tbody tr:nth-child(even) td');
    out.table = {
      found: true,
      thFontSize: th ? getComputedStyle(th).fontSize : null,
      thWeight: th ? getComputedStyle(th).fontWeight : null,
      thBg: th ? getComputedStyle(th).backgroundColor.slice(0, 30) : null,
      tdPadding: td ? getComputedStyle(td).padding : null,
      zebraBg: evenTd ? getComputedStyle(evenTd).backgroundColor.slice(0, 30) : null,
    };
  } else out.table = { found: false };

  // 我改过的按钮
  const btn = document.querySelector('.icon-button, .titlebar-icon, .sidebar-toggle');
  if (btn) {
    const cs = getComputedStyle(btn);
    out.button = {
      found: true,
      width: Math.round(btn.getBoundingClientRect().width),
      height: Math.round(btn.getBoundingClientRect().height),
      display: cs.display,
      justify: cs.justifyContent,
      radius: cs.borderTopLeftRadius,
    };
  } else out.button = { found: false };

  // 关键：旧层仍在提供的基础样式（侧栏、标题层）
  const sb = document.querySelector('.app-sidebar');
  const tb = document.querySelector('.app-titlebar');
  out.shell = {
    sidebarW: sb ? Math.round(sb.getBoundingClientRect().width) : null,
    sidebarBg: sb ? getComputedStyle(sb).backgroundColor.slice(0, 24) : null,
    titlebarH: tb ? Math.round(tb.getBoundingClientRect().height) : null,
  };

  return out;
};

const ROUTES = ['/cost/changes', '/cost/owner-finance', '/system/security', '/system', '/notifications'];

console.log('\n=== 旧层启用时 ===');
const withLayers = {};
for (const r of ROUTES) {
  await page.goto(BASE + r, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  withLayers[r] = await page.evaluate(PROBE);
  console.log(`${r}: stat=${JSON.stringify(withLayers[r].statCard)} table=${withLayers[r].table.found} btn=${withLayers[r].button.found}`);
}

// 禁用 legacy + v6
await page.evaluate(() => {
  for (const el of document.querySelectorAll('style')) {
    const id = (el.getAttribute('data-vite-dev-id') || '').split(/[\\/]/).pop() || '';
    if (id.includes('legacy') || id.includes('v6')) {
      if (el.sheet) el.sheet.disabled = true;
    }
  }
});
await page.waitForTimeout(400);

console.log('\n=== 旧层禁用后 ===');
const withoutLayers = {};
for (const r of ROUTES) {
  await page.goto(BASE + r, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // 每次导航后重新禁用（页面重建）
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('style')) {
      const id = (el.getAttribute('data-vite-dev-id') || '').split(/[\\/]/).pop() || '';
      if (id.includes('legacy') || id.includes('v6')) {
        if (el.sheet) el.sheet.disabled = true;
      }
    }
  });
  await page.waitForTimeout(300);
  withoutLayers[r] = await page.evaluate(PROBE);
  console.log(`${r}: stat=${JSON.stringify(withoutLayers[r].statCard)} table=${withoutLayers[r].table.found} btn=${withoutLayers[r].button.found}`);
}

// 差异汇总
console.log('\n=== 差异 ===');
for (const r of ROUTES) {
  const a = withLayers[r], b = withoutLayers[r];
  const diffs = [];
  if (JSON.stringify(a.statCard) !== JSON.stringify(b.statCard)) diffs.push({ stat: { with: a.statCard, without: b.statCard } });
  if (JSON.stringify(a.table) !== JSON.stringify(b.table)) diffs.push({ table: { with: a.table, without: b.table } });
  if (JSON.stringify(a.button) !== JSON.stringify(b.button)) diffs.push({ button: { with: a.button, without: b.button } });
  if (JSON.stringify(a.shell) !== JSON.stringify(b.shell)) diffs.push({ shell: { with: a.shell, without: b.shell } });
  console.log(`${r}: ${diffs.length ? diffs.length + ' 处差异' : '无差异'}`);
  for (const d of diffs) console.log('   ' + JSON.stringify(d));
}

await browser.close();
