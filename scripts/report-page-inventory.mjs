/**
 * 逐页结构清点：给 docs/阶段二-逐页视觉签认清单.md 用。
 *
 * 只读：打开每个路由，统计台账三件套的份数与关键度量，打印 markdown 表格。
 * 不写数据库、不改页面、不生成基线；需要 dev server（web 5173 / api 3001）在跑。
 *
 *   node scripts/report-page-inventory.mjs              # 打印表格
 *   node scripts/report-page-inventory.mjs --json       # 打印原始 JSON
 *   WIDTH=1500 HEIGHT=1000 node scripts/report-page-inventory.mjs
 */
import { launchTarget, assertApiUp } from './_targets.mjs';

const ROUTES = [
  '/', '/projects', '/notifications',
  '/cost', '/cost/contracts', '/cost/budget', '/cost/progress-bills', '/cost/changes',
  '/cost/owner-finance', '/cost/costs', '/cost/analysis', '/cost/downstream', '/cost/downstream-finance',
  '/reports', '/reports/designer', '/reports/preview',
  '/parties', '/audit-logs',
  '/system', '/system/accounts', '/system/assistant', '/system/security', '/system/authorization',
  '/system/policies', '/system/governance', '/system/dictionaries', '/system/parameters', '/system/operations',
  '/settings/appearance', '/account/security',
];

const width = Number(process.env.WIDTH ?? 1500);
const height = Number(process.env.HEIGHT ?? 1000);
const asJson = process.argv.includes('--json');

await assertApiUp();
const target = await launchTarget('web', { width, height });
const { page, pageErrors } = target;

// 2026-11-05：先到 /login 完成登录。直接从 / 开始第一个路由时，页面会在拿到 token 前
// 发一轮请求，控制厐里会出现一条 401——那是登录时序，不是页面缺陷。
await target.open('/login');
await page.waitForTimeout(1000);

/** 等 DOM 连续 350ms 不变，避免量到上一页的骨架 */
async function waitSettled(budget = 6000) {
  const deadline = Date.now() + budget;
  let last = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const signature = await page.evaluate(() => {
      const transition = document.querySelector('.route-transition');
      return `${document.querySelectorAll('body *').length}:${(transition?.textContent ?? '').length}`;
    });
    if (signature !== last) { last = signature; stableSince = Date.now(); }
    else if (Date.now() - stableSince > 350) return;
    await page.waitForTimeout(120);
  }
}

const rows = [];
async function measure(route) {
  const before = pageErrors.length;
  await target.open(route);
  await waitSettled();
  const info = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.ldg-section-card'));
    const heads = Array.from(document.querySelectorAll('.ldg-section-head'));
    const widths = cards.map((el) => Math.round(el.getBoundingClientRect().width)).filter((value) => value > 0);
    const headHeights = [...new Set(heads.map((el) => Math.round(el.getBoundingClientRect().height)))];
    const hiddenSections = Array.from(document.querySelectorAll('.ldg-section[hidden]')).length;
    return {
      sections: document.querySelectorAll('.ldg-section').length,
      cards: cards.length,
      hiddenSections,
      maxCardWidth: widths.length ? Math.max(...widths) : 0,
      headHeights: headHeights.sort((a, b) => a - b),
      radius: cards.length ? getComputedStyle(cards[0]).borderRadius : null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      panelsLeft: document.querySelectorAll('.panel').length,
      shellExtra: document.querySelectorAll('.v6-hero, .v6-section').length ? 'v6 区块'
        : document.querySelectorAll('.projects-ledger').length ? '项目台账'
          : '',
      title: document.querySelector('h1')?.textContent?.trim().slice(0, 20) ?? '',
    };
  });
  const texts = pageErrors.slice(before).map((item) => String(item.text ?? item).slice(0, 160));
  const rateLimited = texts.filter((text) => text.includes('429')).length;
  return { route, ...info, errors: texts.length - rateLimited, rateLimited, errorTexts: texts.filter((text) => !text.includes('429')) };
}

for (const route of ROUTES) {
  // 先隔一下再开下一页：API 全局限流 120 次/分钟，每页大约 4～6 个请求，
  // 连续点击会把额度用完。节奏放慢后大多数情况不会命中 429。
  await new Promise((resolve) => setTimeout(resolve, 1400));
  let row = await measure(route);
  // 2026-11-05：命中 429 是脚本自己造成的（不是页面缺陷），等一个窗口再重测该路由一次。
  if (row.rateLimited > 0) {
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    row = await measure(route);
  }
  rows.push(row);
}

await target.close();

if (asJson) {
  console.log(JSON.stringify({ viewport: { width, height }, rows }, null, 2));
} else {
  console.log(`| 路由 | 标题 | 段/卡 | 卡宽 | 卡头 | 圆角 | 横向溢出 | 残留 panel | 控制台 |`);
  console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const row of rows) {
    const shape = row.hiddenSections ? `${row.sections}/${row.cards}（含 ${row.hiddenSections} 段 hidden）` : `${row.sections}/${row.cards}`;
    const extra = row.shellExtra ? ` · ${row.shellExtra}` : '';
    console.log(`| \`${row.route}\` | ${row.title || '-'}${extra} | ${shape} | ${row.maxCardWidth || '-'} | ${row.headHeights.join('/') || '-'} | ${row.radius ?? '-'} | ${row.overflow} | ${row.panelsLeft} | ${row.errors}${row.rateLimited ? `（重测前 429 ${row.rateLimited}）` : ''} |`);
  }
  const bad = rows.filter((row) => row.overflow > 0 || row.errors > 0 || row.panelsLeft > 0);
  console.log(`\n共 ${rows.length} 条路由；横向溢出/控制台报错/残留 .panel 的路由：${bad.length} 条${bad.length ? ' → ' + bad.map((row) => row.route).join(', ') : ''}`);
  for (const row of bad) {
    for (const text of row.errorTexts ?? []) console.log(`  [${row.route}] ${text}`);
  }
}
