// 属性级泄漏分析：找出 legacy/v6 里定义了、但 hana.css 没覆盖的属性
// 这类属性会在级联中"漏"过来继续生效，是旧层删不掉的真原因
// 输出：每个重叠选择器的泄漏属性清单 + 是否可安全删除判定
import { readFileSync, writeFileSync } from 'node:fs';

const STYLES = 'D:/WorkSpace/hana/moheng/apps/web/src/styles';

// 极简 CSS 解析：支持 @media/@supports 容器、普通规则、多选择器逗号分隔
function parseCss(text) {
  const rules = [];
  let i = 0;
  const n = text.length;

  // 去掉注释但保留位置感（替换为空格）
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));

  function readBlock(start) {
    // start 指向 '{' 之后
    let depth = 1;
    let j = start;
    while (j < n && depth > 0) {
      if (clean[j] === '{') depth++;
      else if (clean[j] === '}') depth--;
      j++;
    }
    return { body: clean.slice(start, j - 1), end: j };
  }

  function parseSegment(from, to, atContext) {
    let k = from;
    while (k < to) {
      // 找下一个 '{'
      const braceIdx = clean.indexOf('{', k);
      if (braceIdx === -1 || braceIdx >= to) break;
      const selectorText = clean.slice(k, braceIdx).trim();

      if (selectorText.startsWith('@')) {
        // 容器：递归解析内部
        const { body, end } = readBlock(braceIdx + 1);
        parseSegment(braceIdx + 1, braceIdx + 1 + body.length, selectorText);
        k = end;
      } else {
        const { body, end } = readBlock(braceIdx + 1);
        // 声明解析
        const decls = {};
        for (const part of body.split(';')) {
          const idx = part.indexOf(':');
          if (idx === -1) continue;
          const prop = part.slice(0, idx).trim().toLowerCase();
          const val = part.slice(idx + 1).trim();
          if (prop && val) decls[prop] = val;
        }
        const selectors = selectorText.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
        for (const sel of selectors) {
          rules.push({ selector: sel, decls, at: atContext || null });
        }
        k = end;
      }
    }
  }

  parseSegment(0, n, null);
  return rules;
}

// 选择器归一化：用于判断"是否同一个目标元素"
function normSelector(sel) {
  return sel.replace(/\s+/g, ' ').trim();
}

// 粗略特异度：id(100) + class/attr/pseudo-class(10) + element(1)
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+/g) || []).length;
  const attrs = (sel.match(/\[[^\]]+\]/g) || []).length;
  const pseudos = (sel.match(/:(?!:)[\w-]+/g) || []).length;
  const elements = (sel.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 100 + (classes + attrs + pseudos) * 10 + elements;
}

const hana = parseCss(readFileSync(`${STYLES}/hana.css`, 'utf8'));
const layers = {
  legacy: parseCss(readFileSync(`${STYLES}/legacy.css`, 'utf8')),
  v6: parseCss(readFileSync(`${STYLES}/v6.css`, 'utf8')),
};

// hana 的选择器 -> 声明集合
const hanaBySelector = new Map();
for (const r of hana) {
  if (!hanaBySelector.has(r.selector)) hanaBySelector.set(r.selector, { decls: {}, maxSpec: 0, ats: new Set() });
  const entry = hanaBySelector.get(r.selector);
  Object.assign(entry.decls, r.decls);
  entry.maxSpec = Math.max(entry.maxSpec, specificity(r.selector));
  if (r.at) entry.ats.add(r.at);
}

const report = { legacy: [], v6: [] };
for (const [layerName, rules] of Object.entries(layers)) {
  const bySel = new Map();
  for (const r of rules) {
    if (!bySel.has(r.selector)) bySel.set(r.selector, { decls: {}, maxSpec: 0, ats: new Set() });
    const e = bySel.get(r.selector);
    Object.assign(e.decls, r.decls);
    e.maxSpec = Math.max(e.maxSpec, specificity(r.selector));
    if (r.at) e.ats.add(r.at);
  }

  for (const [sel, old] of bySel) {
    const cur = hanaBySelector.get(sel);
    if (!cur) {
      // hana 完全没有这个选择器 → 整条规则都是"旧层独有"
      report[layerName].push({
        selector: sel,
        spec: old.maxSpec,
        at: [...old.ats],
        status: 'orphan',
        props: Object.keys(old.decls),
        propCount: Object.keys(old.decls).length,
      });
      continue;
    }
    // 有同名选择器 → 比较属性集合
    const leaked = Object.keys(old.decls).filter((p) => !(p in cur.decls));
    if (leaked.length === 0) continue; // 完全被覆盖，可删
    const higherSpec = old.maxSpec > cur.maxSpec;
    report[layerName].push({
      selector: sel,
      spec: old.maxSpec,
      hanaSpec: cur.maxSpec,
      at: [...old.ats],
      status: higherSpec ? 'leak-higher-spec' : 'leak-same-spec',
      props: leaked,
      propCount: leaked.length,
    });
  }
}

// 汇总
const summary = {};
for (const layer of ['legacy', 'v6']) {
  const list = report[layer];
  summary[layer] = {
    orphanRules: list.filter((r) => r.status === 'orphan').length,
    leakHigherSpec: list.filter((r) => r.status === 'leak-higher-spec').length,
    leakSameSpec: list.filter((r) => r.status === 'leak-same-spec').length,
    totalLeakedProps: list.reduce((a, r) => a + r.propCount, 0),
  };
}

// 泄漏属性频次排行（哪些属性最爱漏）
const propFreq = {};
for (const layer of ['legacy', 'v6']) {
  for (const r of report[layer]) {
    for (const p of r.props) propFreq[p] = (propFreq[p] || 0) + 1;
  }
}
const topProps = Object.entries(propFreq).sort((a, b) => b[1] - a[1]).slice(0, 30);

writeFileSync(
  'D:/WorkSpace/hana/moheng/docs/gates/property-leak-analysis.json',
  JSON.stringify({ summary, topLeakedProps: topProps, detail: report }, null, 2),
  'utf8'
);

console.log(JSON.stringify({ summary, topLeakedProps: topProps.slice(0, 15) }, null, 2));
