// 美化反压缩 HanaAgent 前端渲染层（minified Vite chunks）
// 用法: node scripts/beautify-frontend.cjs [dir]
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = process.argv[2] || path.join(__dirname, '..', 'hana-frontend-recovered');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
console.log(`找到 ${files.length} 个 .js 文件`);

let ok = 0, fail = 0, skip = 0;
const failed = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  // 跳过体积过小（明显非 bundle 或已是 CSS 内联）的文件做快速判断
  try {
    const result = esbuild.transformSync(src, {
      loader: 'js',
      format: 'esm',
      target: 'es2020',
      legalComments: 'inline',
    });
    let out = result.code;
    // esbuild 有时仍会合并，确保每行不过长：用 printWidth 思路二次换行
    if (out && out.trim().length) {
      fs.writeFileSync(file, out);
      ok++;
    } else {
      skip++;
    }
  } catch (e) {
    fail++;
    failed.push({ file: path.relative(ROOT, file), err: String(e.message || e).split('\n')[0] });
  }
}

console.log(`完成: 成功 ${ok}, 跳过 ${skip}, 失败 ${fail}`);
if (failed.length) {
  console.log('失败文件 (前 20):');
  for (const f of failed.slice(0, 20)) console.log('  -', f.file, '::', f.err);
}
