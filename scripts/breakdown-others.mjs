// 细分「其它」类的 568 条规则，按选择器首类名聚类
import { readFileSync, writeFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map.json', 'utf8'));

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
  for (const f of FAMILIES) if (f.test(sel)) return f.name;
  return null;
}

const all = [
  ...d.dead.map((x) => ({ ...x, kind: 'dead' })),
  ...d.partial.map((x) => ({ ...x, kind: 'partial' })),
  ...d.alive.map((x) => ({ ...x, kind: 'alive' })),
];

const others = all.filter((x) => familyOf(x.sel) === null);
console.log(`「其它」共 ${others.length} 条\n`);

// 按选择器中的第一个类名聚类
const clusters = new Map();
for (const x of others) {
  const m = x.sel.match(/\.([a-z][a-z0-9-]*[a-z0-9])/i);
  const key = m ? m[1] : '(无类名)';
  if (!clusters.has(key)) clusters.set(key, { key, dead: 0, partial: 0, alive: 0, samples: [] });
  const g = clusters.get(key);
  g[x.kind]++;
  if (g.samples.length < 2) g.samples.push(x.sel.slice(0, 60));
}

const sorted = [...clusters.values()].sort((a, b) => (b.dead + b.partial + b.alive) - (a.dead + a.partial + a.alive));

console.log('按首个类名聚类（前 25）:\n');
console.log('类名'.padEnd(28) + '总'.padStart(5) + '可删'.padStart(6) + '接管'.padStart(6) + '保留'.padStart(6));
console.log('-'.repeat(60));
for (const c of sorted.slice(0, 25)) {
  const total = c.dead + c.partial + c.alive;
  console.log(
    ('.' + c.key).padEnd(28) +
    String(total).padStart(5) +
    String(c.dead).padStart(6) +
    String(c.partial).padStart(6) +
    String(c.alive).padStart(6)
  );
}

// 统计：有多少是业务专有类名（含业务词）
const bizWords = /cost|ldg|report|project|party|contract|budget|invoice|bill|owner|finance|change|approv|audit|system|settings|member|dict|policy|workflow|assistant|account|security|notice|todo|summary|downstream/;
const biz = others.filter((x) => bizWords.test(x.sel));
const generic = others.filter((x) => !bizWords.test(x.sel));
console.log(`\n其中业务专有类名: ${biz.length} 条`);
console.log(`    通用类名:     ${generic.length} 条`);

// 业务类的可删比例
const bizDead = biz.filter((x) => x.kind === 'dead').length;
const genDead = generic.filter((x) => x.kind === 'dead').length;
console.log(`    业务类可删: ${bizDead}/${biz.length} (${((bizDead / biz.length) * 100).toFixed(0)}%)`);
console.log(`    通用类可删: ${genDead}/${generic.length} (${((genDead / generic.length) * 100).toFixed(0)}%)`);

writeFileSync('docs/gates/migration-others-breakdown.json', JSON.stringify({
  total: others.length,
  clusters: sorted.map((c) => ({ cls: c.key, dead: c.dead, partial: c.partial, alive: c.alive })),
}, null, 2));

console.log('\n细分 → docs/gates/migration-others-breakdown.json');
