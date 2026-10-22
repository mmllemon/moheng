// 量对话式布局的垂直间距：找出中间大空白是谁造成的
import { chromium } from 'playwright-core';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 2000 });

const m = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
      mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom,
      display: cs.display,
    };
  };
  return {
    agent: pick('.convo-speaker-agent'),
    agentRow: pick('.convo-speaker-agent .convo-avatar-row'),
    headline: pick('.convo-headline'),
    subtitle: pick('.convo-subtitle'),
    actions: pick('.convo-actions'),
    user: pick('.convo-speaker-user'),
    userRow: pick('.convo-speaker-user .convo-avatar-row'),
    body: pick('.convo-body'),
    kpi: pick('.projects-kpi-strip'),
    toolbar: pick('.projects-toolbar'),
  };
});

console.log('=== 元素盒模型（top / bottom / 高）===');
for (const [k, v] of Object.entries(m)) {
  if (!v) { console.log(`  ${k.padEnd(12)} 不存在`); continue; }
  console.log(`  ${k.padEnd(12)} ${String(v.top).padStart(4)}→${String(v.bottom).padStart(4)}  高${String(v.h).padStart(4)}  mt=${v.mt} mb=${v.mb} pt=${v.pt} pb=${v.pb}`);
}

console.log('\n=== 空白间隙 ===');
const gaps = [
  ['agent块底 → user块顶', m.agent?.bottom, m.user?.top],
  ['user头像行底 → 正文顶', m.userRow?.bottom, m.body?.top],
  ['正文顶 → KPI顶', m.body?.top, m.kpi?.top],
];
for (const [label, a, b] of gaps) {
  if (a == null || b == null) continue;
  console.log(`  ${label.padEnd(22)} ${b - a}px`);
}

await browser.close();
