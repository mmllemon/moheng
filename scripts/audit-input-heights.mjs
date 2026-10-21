// 输入类控件（input/select/textarea/搜索框）高度与样式审计
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/reports/studio',
  '/notifications', '/parties', '/audit-logs', '/settings/appearance',
  '/system', '/system/security', '/system/authorization', '/system/policies',
  '/system/governance', '/system/operations', '/system/dictionaries',
  '/system/parameters', '/system/accounts', '/system/assistant', '/account/security',
];

const TIERS = new Set([32, 26, 24, 72]); // 32 常规 / 26 紧凑 / 24 紧凑内框 / 72 文本域
// 工具栏搜索框内框：外框 32px 减两侧 1px 边框 = 30px，是正确嵌套，不算偏差
const WRAP_INNER = new Set([30, 24]);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').first().fill('admin@local.test');
await page.locator('input[type=password]').first().fill('ChangeMe123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2600);

const rows = [];
for (const route of ROUTES) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(950);

  const fields = await page.evaluate(() => {
    const out = [];
    // 只看真正的输入元素，不看包裹容器（容器内部差 2px 是边框的正常结果）
    const sels = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), select, textarea';
    for (const el of document.querySelectorAll(sels)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 6 || r.width < 10) continue;
      const wrap = el.closest('.toolbar-search, .settings-search, .ldg-search, .assistant-key-line');
      out.push({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        cls: (el.className || '').toString().slice(0, 40),
        path: (() => {
          let n = el.parentElement, p = [];
          while (n && n !== document.body && p.length < 3) {
            p.push((n.className || '').toString().split(' ')[0] || n.tagName.toLowerCase());
            n = n.parentElement;
          }
          return p.join(' > ');
        })(),
        h: Math.round(r.height),
        pad: cs.padding,
        fontSize: cs.fontSize,
        radius: cs.borderTopLeftRadius,
        inWrap: !!wrap,
        wrapH: wrap ? Math.round(wrap.getBoundingClientRect().height) : null,
        wrapBorder: wrap ? parseFloat(getComputedStyle(wrap).borderTopWidth) || 0 : 0,
      });
    }
    return out;
  });
  for (const f of fields) rows.push({ route, ...f });
}

console.log(`=== ${rows.length} 个输入控件 ===\n`);

const tally = (list, label) => {
  const m = new Map();
  for (const r of list) {
    const k = `${r.h}px | pad=${r.pad} | fs=${r.fontSize} | r=${r.radius}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  console.log(`--- ${label}：${list.length} 个，${m.size} 种 ---`);
  for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}×  ${k}`);
  }
};
tally(rows.filter((r) => r.tag !== 'textarea'), '单行输入');
tally(rows.filter((r) => r.tag === 'textarea'), '文本域');

let problems = 0;

// 1. 高度必须是标准档（包裹框内框例外）
console.log('\n--- 非标准档位 ---');
const offTier = rows.filter((r) => !TIERS.has(r.h) && !(r.inWrap && WRAP_INNER.has(r.h)));
if (offTier.length) {
  for (const r of offTier) {
    problems++;
    console.log(`  ${r.route.padEnd(24)} ${r.h}px  <${r.tag}>  ${r.path}`);
  }
} else console.log('  （无）');

// 2. 包裹框内：input 高度 + 2*边框 应等于外框高度
console.log('\n--- 包裹框内嵌高度（外框 - 内框 应等于 2×边框）---');
const wrapped = rows.filter((r) => r.inWrap);
let wOk = 0;
for (const r of wrapped) {
  const expected = r.wrapH - r.wrapBorder * 2;
  if (r.h !== expected) {
    problems++;
    console.log(`  ${r.route.padEnd(24)} 外框${r.wrapH}px 内框${r.h}px 边框${r.wrapBorder}px → 应为${expected}px`);
  } else wOk++;
}
console.log(`  检查 ${wrapped.length} 个，符合 ${wOk} 个`);

// 3. 圆角必须统一
console.log('\n--- 圆角不一致 ---');
const radii = new Map();
for (const r of rows) radii.set(r.radius, (radii.get(r.radius) || 0) + 1);
for (const [k, n] of [...radii.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}×  ${k}`);
  if (!['11.0454px', '0px'].includes(k)) problems++;
}

console.log(`\n${problems ? '问题共 ' + problems + ' 处' : '全部通过：两档高度、内嵌正确、圆角统一'}`);
await browser.close();

await browser.close();
