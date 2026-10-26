// 美化 Electron 外壳层里的压缩 bundle (.cjs/.js)
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = process.argv[2] || path.join(__dirname, '..', 'hana-electron-shell');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js') || name.endsWith('.cjs')) out.push(p);
  }
  return out;
}

// 只处理：单行/超长行 的 bundle，避免动到已是源码的文件
const targets = walk(ROOT).filter((f) => {
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split('\n').length;
  const maxLen = text.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  return lines <= 5 || maxLen > 5000; // 单行压缩 或 含超长行
});

console.log(`命中需要美化的 bundle: ${targets.length} 个`);
let ok = 0, fail = 0;
for (const file of targets) {
  const src = fs.readFileSync(file, 'utf8');
  try {
    const r = esbuild.transformSync(src, {
      loader: 'js',
      format: 'cjs',
      target: 'es2020',
      legalComments: 'inline',
    });
    if (r.code && r.code.trim()) {
      fs.writeFileSync(file, r.code);
      ok++;
    }
  } catch (e) {
    fail++;
    console.log('  失败:', path.relative(ROOT, file), '::', String(e.message).split('\n')[0]);
  }
}
console.log(`美化完成: 成功 ${ok}, 失败 ${fail}`);
