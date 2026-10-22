// hana 顶栏文字规格 vs moheng 实测
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const css = readFileSync('D:/WorkSpace/hana/moheng/reference/hana-1.1.35/styles.css', 'utf8');
function grab(sel) {
  const lines = css.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === `${sel} {` || t === `${sel}{`) {
      const d = {};
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith('}')) {
        const l = lines[j].trim();
        const k = l.indexOf(':');
        if (k > 0 && !l.startsWith('/*')) d[l.slice(0, k).trim()] = l.slice(k + 1).replace(/;.*/, '').trim();
        j++;
      }
      return d;
    }
  }
  return null;
}

console.log('=== hana 顶栏相关规格 ===');
const targets = ['.titlebar', '.tb-toggle', '.tbTabs', '.tb-right-group', '.titlebar-minimal'];
for (const t of targets) {
  const d = grab(t);
  if (!d) continue;
  console.log(`\n${t}`);
  const keep = ['height', 'padding', 'gap', 'font-size', 'color', 'background-color', 'border-bottom', 'display', 'align-items', 'justify-content', 'width', 'flex-shrink'];
  for (const k of keep) if (d[k]) console.log(`  ${k.padEnd(16)} ${d[k]}`);
}

// moheng 实测
await assertApiUp();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await login(page);
await gotoRoute(page, '/projects', { settle: 1400 });

const m = await page.evaluate(() => {
  const g = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const cs = getComputedStyle(e);
    return {
      h: Math.round(e.getBoundingClientRect().height),
      fontSize: cs.fontSize, color: cs.color, fontWeight: cs.fontWeight,
      letterSpacing: cs.letterSpacing, lineHeight: cs.lineHeight,
      padding: cs.padding, gap: cs.gap, background: cs.backgroundColor,
      textTransform: cs.textTransform,
    };
  };
  return {
    titlebar: g('.app-titlebar'),
    wordmark: g('.titlebar-wordmark'),
    separator: g('.titlebar-separator'),
    contextStrong: g('.titlebar-context strong'),
    globalScope: g('.titlebar-global-scope'),
    icon: g('.titlebar-icon'),
    brandMark: g('.sidebar-brand-mark'),
    wordmarkStrong: g('.sidebar-wordmark strong'),
    wordmarkSub: g('.sidebar-wordmark span'),
  };
});

console.log('\n\n=== moheng 实测 ===');
for (const [k, v] of Object.entries(m)) {
  if (!v) { console.log(`\n${k}: (不存在)`); continue; }
  console.log(`\n${k}`);
  console.log(`  高度 ${v.h}px  字号 ${v.fontSize}  行高 ${v.lineHeight}`);
  console.log(`  颜色 ${v.color}  字重 ${v.fontWeight}  字距 ${v.letterSpacing}`);
  if (v.padding !== '0px') console.log(`  padding ${v.padding}  gap ${v.gap}`);
}

await browser.close();
