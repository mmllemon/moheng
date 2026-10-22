// 从全量地图生成可读报告：按组件族归类，给出每个族的迁移建议
import { readFileSync, writeFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map.json', 'utf8'));

// 组件族归类：按选择器里的关键类名/标签
const FAMILIES = [
  { name: '按钮', test: (s) => /\.button|\.btn/.test(s) },
  { name: '表单控件', test: (s) => /\b(input|select|textarea)\b|\.field\b|\.form-|\.checkbox-line|\.input-/.test(s) },
  { name: '表格', test: (s) => /table|tbody|thead|\bth\b|\btd\b|\.data-table|\.ldg-table/.test(s) },
  { name: '卡片与面板', test: (s) => /\.panel|\.card|\.metric|\.stat|\.tile|\.box|notice-summary/.test(s) },
  { name: '弹层', test: (s) => /\.dialog|\.modal|\.popover|\.dropdown|\.menu|backdrop/.test(s) },
  { name: '导航与侧栏', test: (s) => /sidebar|nav|\.tab|breadcrumb|titlebar|topbar/.test(s) },
  { name: '标签与徽标', test: (s) => /\.badge|\.tag|\.chip|\.pill|\.status|\.eyebrow/.test(s) },
  { name: '排版与文本', test: (s) => /^(h1|h2|h3|h4|h5|h6|p|a|small|strong|em|code|pre)\b|^body|^html|^\*/.test(s.trim()) },
  { name: '工具栏', test: (s) => /toolbar|filter-bar|page-actions|section-head|page-header/.test(s) },
  { name: '布局骨架', test: (s) => /page-wrap|app-main|app-shell|content|grid|stack|layout/.test(s) },
  { name: '动效与偏好', test: (s) => /data-motion|preference|theme|animation|transition|@keyframes/.test(s) },
];

function familyOf(sel) {
  for (const f of FAMILIES) {
    if (f.test(sel)) return f.name;
  }
  return '其它';
}

const all = [
  ...d.dead.map((x) => ({ ...x, kind: 'dead' })),
  ...d.partial.map((x) => ({ ...x, kind: 'partial' })),
  ...d.alive.map((x) => ({ ...x, kind: 'alive' })),
];

const byFamily = new Map();
for (const x of all) {
  const f = familyOf(x.sel);
  if (!byFamily.has(f)) byFamily.set(f, { name: f, dead: 0, partial: 0, alive: 0, rules: [] });
  const g = byFamily.get(f);
  g[x.kind]++;
  g.rules.push(x);
}

const rows = [...byFamily.values()].sort((a, b) => (b.dead + b.partial + b.alive) - (a.dead + a.partial + a.alive));

console.log('=== 按组件族分类 ===\n');
console.log('族名'.padEnd(14) + '总数'.padStart(6) + '可删'.padStart(8) + '需接管'.padStart(9) + '须保留'.padStart(9) + '  建议');
console.log('-'.repeat(80));

const plan = [];
for (const r of rows) {
  const total = r.dead + r.partial + r.alive;
  let advice;
  if (r.dead === total) advice = '整族可删';
  else if (r.dead / total >= 0.6) advice = '先删可删部分，再接管';
  else if (r.partial / total >= 0.4) advice = '需先接管关键属性';
  else if (r.alive / total >= 0.5) advice = '旧层仍是主力，暂不动';
  else advice = '需逐条判断';
  console.log(
    r.name.padEnd(14) +
    String(total).padStart(6) +
    String(r.dead).padStart(8) +
    String(r.partial).padStart(9) +
    String(r.alive).padStart(9) +
    '  ' + advice
  );
  plan.push({ family: r.name, total, dead: r.dead, partial: r.partial, alive: r.alive, advice });
}

// 三轮迁移路线：按「可删比例」排序
const rounds = [];
const sorted = [...plan].sort((a, b) => (b.dead / b.total) - (a.dead / a.total));
console.log('\n\n=== 建议的迁移顺序（按可删比例降序）===\n');
let cumulative = 0;
for (let i = 0; i < sorted.length; i++) {
  const p = sorted[i];
  cumulative += p.dead;
  const ratio = ((p.dead / p.total) * 100).toFixed(0);
  let round = i < 3 ? '第 1 轮' : i < 6 ? '第 2 轮' : '第 3 轮';
  console.log(`${round}  ${p.family.padEnd(14)} 可删 ${String(p.dead).padStart(3)}/${String(p.total).padStart(3)} (${ratio.padStart(3)}%)  累计可删 ${cumulative}`);
}

console.log(`\n全站可删总计: ${d.dead.length} 条 / ${d.total} 条 (${((d.dead.length / d.total) * 100).toFixed(1)}%)`);
console.log(`须接管后才能删: ${d.partial.length} 条`);
console.log(`旧层仍承担功能: ${d.alive.length} 条`);

writeFileSync('docs/gates/migration-plan.json', JSON.stringify({ plan, rounds: sorted.length }, null, 2));
console.log('\n计划 → docs/gates/migration-plan.json');
