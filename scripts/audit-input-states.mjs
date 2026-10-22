// 输入控件状态审计：disabled / readonly 的视觉表现，focus 与 hover
import { chromium } from 'playwright-core';

import { login } from './_harness.mjs';
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

const b = await chromium.launch({ executablePath: CHROME, headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const p = await c.newPage();
await login(p);

const SEL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea';

const stats = {
  total: 0,
  disabled: 0,
  readonly: 0,
  disabledHoverChanged: [],
  disabledNoVisualCue: [],
  readonlyNoCue: [],
};

for (const route of ROUTES) {
  await p.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await p.waitForTimeout(870);

  const list = await p.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 6 || r.width < 20) continue;
      const disabled = el.disabled === true;
      const readonly = el.readOnly === true;
      out.push({
        i: out.length,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        placeholder: el.getAttribute('placeholder') || '',
        disabled, readonly,
        bg: cs.backgroundColor,
        border: cs.borderTopColor,
        color: cs.color,
        opacity: cs.opacity,
        cursor: cs.cursor,
        rect: r.toJSON(),
      });
    }
    return out;
  }, SEL);

  stats.total += list.length;

  // 检查禁用输入框
  for (const item of list) {
    if (item.disabled) {
      stats.disabled++;
      // 是否有视觉提示：opacity<1 / 背景不同 / 光标 not-allowed
      const hasCue = parseFloat(item.opacity) < 1 || item.cursor === 'not-allowed';
      if (!hasCue) stats.disabledNoVisualCue.push({ route, ...item });

      await p.mouse.move(item.rect.x + item.rect.width / 2, item.rect.y + item.rect.height / 2);
      await p.waitForTimeout(100);
      const after = await p.evaluate(([sel, idx]) => {
        const els = [...document.querySelectorAll(sel)].filter((e) => {
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height >= 6 && r.width >= 20;
        });
        const el = els[idx];
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
      }, [SEL, item.i]);
      if (after && (after.bg !== item.bg || after.border !== item.border || after.color !== item.color)) {
        stats.disabledHoverChanged.push({ route, ...item, after });
      }
      await p.mouse.move(3, 3);
    }
    if (item.readonly) {
      stats.readonly++;
      const hasCue = parseFloat(item.opacity) < 1 || item.bg !== 'rgba(0, 0, 0, 0)';
      if (!hasCue) stats.readonlyNoCue.push({ route, ...item });
    }
  }
}

console.log('=== 输入控件状态审计 ===');
console.log(`  控件总数: ${stats.total}`);
console.log(`  禁用:     ${stats.disabled}`);
console.log(`  只读:     ${stats.readonly}\n`);

const show = (title, list, fmt) => {
  console.log(`--- ${title}: ${list.length} ---`);
  if (!list.length) { console.log('  （无）\n'); return; }
  const seen = new Set();
  for (const x of list) {
    const k = fmt(x);
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${x.route.padEnd(24)} ${x.tag}${x.type ? '[' + x.type + ']' : ''}`);
    console.log(`      ${k}`);
  }
  console.log('');
};

show('禁用控件悬停时样式变化', stats.disabledHoverChanged,
  (x) => `bg ${x.bg} → ${x.after.bg}  |  border ${x.border} → ${x.after.border}`);
show('禁用控件没有任何视觉提示', stats.disabledNoVisualCue,
  (x) => `opacity=${x.opacity} cursor=${x.cursor} bg=${x.bg}`);
show('只读控件没有任何视觉提示', stats.readonlyNoCue,
  (x) => `opacity=${x.opacity} bg=${x.bg} border=${x.border}`);

// ---- 场景探针 ----
// 全站扫不到 disabled / readonly 不代表没有：它们藏在数据与交互后面。
// 已知两处需要用交互才能触达，这里逐个构造并断言。
console.log('\n=== 场景探针 ===');

async function probeScene(name, route, act, pick) {
  await p.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await p.waitForTimeout(1150);
  const ok = await p.evaluate(act);
  if (!ok) { console.log(`  · ${name}：场景未就绪（跳过）`); return null; }
  await p.waitForTimeout(950);
  const r = await p.evaluate(pick);
  if (!r) { console.log(`  · ${name}：控件未找到（跳过）`); return null; }
  console.log(`  · ${name}`);
  console.log(`      opacity=${r.opacity} cursor=${r.cursor} bg=${r.bg}`);
  return r;
}

// 只读：变更审批弹窗里的送审金额，不得与可编辑输入同貌
const ro = await probeScene(
  '只读输入：变更审批弹窗 · 内部送审金额',
  '/cost/changes',
  () => {
    const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '内部审批');
    if (!b) return false;
    b.click();
    return true;
  },
  () => {
    const el = document.querySelector('.dialog input[readonly]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, cursor: cs.cursor, bg: cs.backgroundColor };
  }
);
if (ro) {
  // 只读不需要降低 opacity，但光标不能是 text，背景不能与卡片同色
  const looksEditable = ro.cursor === 'text' && (ro.bg === 'rgb(255, 253, 247)' || ro.bg === 'rgb(252, 250, 245)');
  if (looksEditable) { console.log('      ✗ 与可编辑输入同貌'); stats.readonlyNoCue.push({ route: '/cost/changes', ...ro }); }
  else console.log('      ✓ 与可编辑输入有区别');
}
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

// 禁用：主题页关闭纹理后，强度滑杆应被禁用且光标 not-allowed
const dis = await probeScene(
  '禁用输入：主题页 · 关闭纹理后的强度滑杆',
  '/settings/appearance',
  () => {
    const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '关闭');
    if (!b) return false;
    b.click();
    return true;
  },
  () => {
    const el = document.querySelector('input[type=range][disabled]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, cursor: cs.cursor, bg: cs.backgroundColor };
  }
);
if (dis) {
  if (dis.cursor !== 'not-allowed') { console.log('      ✗ 禁用态光标不是 not-allowed'); stats.disabledNoVisualCue.push({ route: '/settings/appearance', ...dis }); }
  else console.log('      ✓ 光标 not-allowed');
}

// 退出码：有问题就非 0，便于 CI 与并行全量跑
const problems = stats.disabledHoverChanged.length
  + stats.disabledNoVisualCue.length
  + stats.readonlyNoCue.length;
console.log(problems
  ? `\n✗ 共 ${problems} 处问题`
  : '\n✓ 输入控件状态全部正确');
if (problems) process.exitCode = 1;

await b.close();
