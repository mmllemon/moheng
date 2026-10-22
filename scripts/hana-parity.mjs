// Hana 视觉对齐 —— 精确版
// 只报告"实际渲染值"与 Hana 真值的真实差异，单位换算与舍入误差不计
import { chromium } from 'playwright-core';
import { login } from './_harness.mjs';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/hana-parity.json';

// Hana 1.1.35 真值（哈希验证自 reference/hana-1.1.35）
const SPEC = {
  '--bg': '#f8f4ed',
  '--bg-card': '#fcfaf5',
  '--sidebar-bg': '#f4f0ea',
  '--text': '#3b3d3f',
  '--text-muted': '#6b6f73',
  '--accent': '#537d96',
  '--accent-hover': '#456a80',
};
const NUM_SPEC = {
  '--titlebar-h': 44, '--sidebar-width': 240,
  '--radius-xs': 3, '--radius-sm': 5, '--radius-md': 8, '--radius-lg': 12,
  '--radius-input': 6, '--radius-card': 8,
  '--space-2': 2, '--space-4': 4, '--space-6': 6, '--space-8': 8, '--space-10': 10,
  '--space-12': 12, '--space-14': 14, '--space-16': 16, '--space-24': 24,
  '--space-32': 32, '--space-40': 40,
  '--fs-title': 16, '--fs-body': 14.4, '--fs-ui': 13.12, '--fs-caption': 12.48,
  '--fs-hint': 11.2, '--fs-micro': 9.92,
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);

// 用真实渲染解析（rem → px）
const resolved = await page.evaluate((numTokens) => {
  const cs = getComputedStyle(document.documentElement);
  const probe = (v) => {
    const d = document.createElement('div');
    d.style.width = v;
    d.style.position = 'absolute';
    document.body.appendChild(d);
    const w = parseFloat(getComputedStyle(d).width);
    d.remove();
    return w;
  };
  const out = { colors: {}, numbers: {}, cornerScale: cs.getPropertyValue('--corner-radius-scale').trim() };
  for (const t of Object.keys(numTokens)) out.numbers[t] = probe(`var(${t})`);
  for (const t of ['--bg', '--bg-card', '--sidebar-bg', '--text', '--text-muted', '--accent', '--accent-hover']) {
    out.colors[t] = cs.getPropertyValue(t).trim();
  }
  return out;
}, NUM_SPEC);

const hexOf = (v) => {
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return s;
};

const diffs = [];
for (const [tok, want] of Object.entries(SPEC)) {
  const got = resolved.colors[tok];
  if (hexOf(got) !== hexOf(want)) diffs.push({ kind: 'color', token: tok, want, got });
}
for (const [tok, want] of Object.entries(NUM_SPEC)) {
  const got = resolved.numbers[tok];
  if (got === null || got === undefined) { diffs.push({ kind: 'missing', token: tok, want, got: null }); continue; }
  // 容差 0.05px（rem 换算的舍入）
  if (Math.abs(got - want) > 0.05) diffs.push({ kind: 'number', token: tok, want, got: +got.toFixed(3), delta: +(got - want).toFixed(3) });
}

// 组件几何
const comps = [
  { name: '侧栏', sel: '.app-sidebar', axis: 'width', want: 240 },
  { name: '标题层', sel: '.app-titlebar', axis: 'height', want: 44 },
];
const compOut = [];
for (const c of comps) {
  const v = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  }, c.sel);
  compOut.push({ ...c, got: v, ok: v ? (c.axis === 'width' ? v.w : v.h) === c.want : null });
}

// 设置窗（在设置路由下）
await page.goto(BASE + '/settings/appearance', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
for (const c of [
  { name: '设置窗', sel: '.settings-window', axis: 'width', want: 960 },
  { name: '设置导航', sel: '.settings-nav', axis: 'width', want: 208 },
]) {
  const v = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  }, c.sel);
  compOut.push({ ...c, got: v, ok: v ? (c.axis === 'width' ? v.w : v.h) === c.want : null });
}

const summary = {
  colorDiffs: diffs.filter((d) => d.kind === 'color').length,
  numberDiffs: diffs.filter((d) => d.kind === 'number').length,
  missingTokens: diffs.filter((d) => d.kind === 'missing').length,
  componentFails: compOut.filter((c) => c.ok === false).length,
  cornerScale: resolved.cornerScale,
  cornerScaleOk: Math.abs(Number(resolved.cornerScale) - 1.8408964152537137) < 1e-6,
};

writeFileSync(OUT, JSON.stringify({ summary, diffs, components: compOut, resolved }, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 1));
console.log('\n=== 真实差异 ===');
if (!diffs.length) console.log('(无)');
for (const d of diffs) console.log(`${d.kind.padEnd(8)} ${d.token.padEnd(18)} Hana=${String(d.want).padEnd(10)} moheng=${String(d.got).padEnd(12)} ${d.delta ? 'Δ' + d.delta : ''}`);
console.log('\n=== 组件 ===');
for (const c of compOut) console.log(`${c.name.padEnd(8)} ${c.ok ? 'OK' : 'FAIL'} got=${JSON.stringify(c.got)} want ${c.axis}=${c.want}`);

await browser.close();
