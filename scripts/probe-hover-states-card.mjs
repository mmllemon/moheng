// hover 状态探针：真实鼠标悬停后采集表格行样式
// 普通快照测不到 :hover，这是表格族的关键盲区
import { chromium } from 'playwright-core';
import { writeFileSync, readFileSync } from 'node:fs';
import { CHROME, assertApiUp, login, gotoRoute } from './_harness.mjs';

const ROUTES = ['/audit-logs', '/projects', '/cost/contracts', '/cost/progress-bills'];

const PROPS = [
  'backgroundColor', 'backgroundImage', 'boxShadow', 'color',
  'paddingLeft', 'paddingRight', 'borderBottomWidth', 'borderBottomColor',
];

async function capture(outPath) {
  await assertApiUp();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);

  const result = {};
  for (const route of ROUTES) {
    await gotoRoute(page, route, { settle: 1200 });
    result[route] = [];

    // 找出前 3 个有 hover 效果的数据行
    const rows = await page.evaluate(() => {
      return [...document.querySelectorAll('.data-table tbody tr')]
        .filter((r) => {
          const b = r.getBoundingClientRect();
          return b.width > 10 && b.height > 10;
        })
        .slice(0, 3)
        .map((r, i) => {
          r.setAttribute('data-hover-probe', String(i));
          return i;
        });
    });

    for (const idx of rows) {
      const sel = `tr[data-hover-probe="${idx}"]`;
      // 悬停前
      const before = await page.evaluate(([s, props]) => {
        const tr = document.querySelector(s);
        if (!tr) return null;
        const out = {};
        const tds = tr.querySelectorAll('td');
        out.cells = [...tds].slice(0, 2).map((td) => {
          const cs = getComputedStyle(td);
          const o = {};
          for (const p of props) o[p] = cs[p];
          return o;
        });
        return out;
      }, [sel, PROPS]);

      // 悬停
      await page.hover(sel).catch(() => { });
      await page.waitForTimeout(220);

      const after = await page.evaluate(([s, props]) => {
        const tr = document.querySelector(s);
        if (!tr) return null;
        const out = {};
        const tds = tr.querySelectorAll('td');
        out.cells = [...tds].slice(0, 2).map((td) => {
          const cs = getComputedStyle(td);
          const o = {};
          for (const p of props) o[p] = cs[p];
          return o;
        });
        return out;
      }, [sel, PROPS]);

      result[route].push({ idx, before, after });

      // 移开鼠标，避免影响下一行
      await page.mouse.move(0, 0);
      await page.waitForTimeout(120);
    }
  }
  await browser.close();
  writeFileSync(outPath, JSON.stringify(result, null, 1));
  const n = Object.values(result).reduce((s, a) => s + a.length, 0);
  console.log(`采集 ${n} 行的 hover 前后状态 → ${outPath}`);
}

function compare(aPath, bPath) {
  const a = JSON.parse(readFileSync(aPath, 'utf8'));
  const b = JSON.parse(readFileSync(bPath, 'utf8'));
  const diffs = [];
  for (const route of Object.keys(a)) {
    const ra = a[route], rb = b[route] || [];
    for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
      const ea = ra[i], eb = rb[i];
      if (!ea || !eb) { diffs.push({ route, d: `行数不同 ${ra.length} vs ${rb.length}` }); break; }
      for (const phase of ['before', 'after']) {
        if (!ea[phase] || !eb[phase]) continue;
        for (let c = 0; c < Math.max(ea[phase].cells.length, eb[phase].cells.length); c++) {
          const ca = ea[phase].cells[c], cb = eb[phase].cells[c];
          if (!ca || !cb) continue;
          for (const p of Object.keys(ca)) {
            if (ca[p] !== cb[p]) {
              diffs.push({ route, d: `[${i}]${phase} 单元格${c} ${p}: ${ca[p]} → ${cb[p]}` });
            }
          }
        }
      }
    }
  }
  return diffs;
}

const mode = process.argv[2];
if (mode === 'capture') await capture(process.argv[3]);
else if (mode === 'compare') {
  const diffs = compare(process.argv[3], process.argv[4]);
  if (!diffs.length) console.log('✓ hover 前后状态零差异');
  else {
    console.log(`✗ ${diffs.length} 处差异`);
    for (const d of diffs.slice(0, 20)) console.log(`  ${d.route} ${d.d}`);
  }
}
