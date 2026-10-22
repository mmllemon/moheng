// 验证 harness 第二道防线：API 在线但登录失败时，脚本必须响亮失败
// 做法：把 harness 里的密码临时改错，跑一个脚本，看是否报「登录失败」
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const HARNESS = 'D:/WorkSpace/hana/moheng/scripts/_harness.mjs';
const orig = readFileSync(HARNESS, 'utf8');

copyFileSync(HARNESS, HARNESS + '.bak');

try {
  // 改错密码
  const broken = orig.replace("fill('ChangeMe123!')", "fill('WrongPassword!')");
  if (broken === orig) throw new Error('未能改到密码行');
  writeFileSync(HARNESS, broken, 'utf8');
  console.log('已把密码改成错的，运行一个脚本…\n');

  const child = spawn(process.execPath, ['scripts/toolbar-migration.mjs', 'capture', 'docs/gates/dummy.json'], {
    cwd: 'D:/WorkSpace/hana/moheng',
    stdio: 'pipe',
  });

  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  const code = await new Promise((res) => child.on('close', res));
  console.log('退出码:', code);
  console.log('输出:');
  console.log(out.split('\n').slice(0, 14).map((l) => '  ' + l).join('\n'));

  if (code !== 0 && /登录失败|登录页/.test(out)) {
    console.log('\n✓ 第二道防线生效：登录失败被拦住');
  } else if (code === 0) {
    console.log('\n✗ 严重问题：密码错了脚本居然通过了');
  } else {
    console.log('\n? 退出码非零，但没看到预期的登录错误，需人工看');
  }
} finally {
  writeFileSync(HARNESS, orig, 'utf8');
  console.log('\n已还原 harness');
}
