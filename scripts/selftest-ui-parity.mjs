// 门禁自检：注入人造差异，确认 validate-ui-parity.mjs 真的会失败。
// 一个从不失败的门禁等于没有门禁 —— 这是必须验证的事。
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const WEB = 'docs/gates/ui-parity/web.json';
const base = JSON.parse(readFileSync(WEB, 'utf8'));

const tmp = mkdtempSync(join(tmpdir(), 'uiparity-'));
const cases = [];

function writeCase(name, electron, env = {}) {
  const dir = join(tmp, name);
  writeFileSync(join(tmp, `${name}-dir.txt`), dir);
  const out = { ...tmp, dir };
  cases.push({ name, electron, env, dir });
}

// 克隆一份 web 结果作为"完美的 electron"
function perfectElectron() {
  const clone = JSON.parse(JSON.stringify(base));
  clone.raw.electron = clone.raw.web;
  clone.summarize.electron = clone.summarize.web;
  delete clone.raw.web;
  delete clone.summarize.web;
  clone.target = 'electron';
  return clone;
}

// 基线：完全一致 → 应通过
writeCase('identical', perfectElectron());

// 差异1：某个路由 rounded 掉 1（squircle 少生效一处）
{
  const e = perfectElectron();
  e.raw.electron.routes.find((r) => r.route === '/cost/budget').rounded -= 1;
  writeCase('rounded-off-by-one', e);
}

// 差异2：Electron 的 Chromium 太低（126）→ squircle 不支持
{
  const e = perfectElectron();
  e.raw.electron.env.chromiumMajor = 126;
  e.raw.electron.env.cornerShapeSupported = false;
  writeCase('chromium-too-old', e);
}

// 差异3：外壳度量偏差 1px（侧栏 x 从 6 变 7）
{
  const e = perfectElectron();
  e.raw.electron.shell.sidebar.x = 7;
  writeCase('shell-off-by-one', e);
}

// 差异4：Electron 侧自己有一个失败项
{
  const e = perfectElectron();
  e.summarize.electron.failureCount = 1;
  e.summarize.electron.failures = [{ check: 'chromium-too-old-for-squircle' }];
  writeCase('target-self-failure', e);
}

// 差异5：焦点陷阱行为不同
{
  const e = perfectElectron();
  e.raw.electron.dialog.trapped = false;
  writeCase('focus-trap-differs', e);
}

console.log('逐案验证门禁是否会失败：\n');
let wrong = 0;

for (const testCase of cases) {
  const dir = join(tmp, testCase.name);
  // 每次用独立目录，避免互相污染
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'web.json'), JSON.stringify(base));
  writeFileSync(join(dir, 'electron.json'), JSON.stringify(testCase.electron));

  let code = 0;
  let output = '';
  try {
    output = execFileSync(process.execPath, ['scripts/validate-ui-parity.mjs'], {
      env: { ...process.env, RESULT_DIR: dir },
      encoding: 'utf8',
    });
    code = 0;
  } catch (error) {
    code = error.status ?? 1;
    output = (error.stdout ?? '') + (error.stderr ?? '');
  }

  const shouldFail = testCase.name !== 'identical';
  const didFail = code !== 0;
  const ok = shouldFail === didFail;
  if (!ok) wrong += 1;

  console.log(`${ok ? 'OK  ' : 'BAD '} ${testCase.name.padEnd(22)} 期望${shouldFail ? '失败' : '通过'} 实际${didFail ? '失败' : '通过'}`);
  if (!ok) console.log('    输出片段: ' + output.split('\n').filter((l) => l.startsWith('FAIL') || l.startsWith('SKIP')).slice(0, 3).join(' | '));
}

rmSync(tmp, { recursive: true, force: true });

console.log('');
if (wrong) {
  console.log(`${wrong} 个案子的门禁行为不符合预期。`);
  process.exitCode = 1;
} else {
  console.log(`全部 ${cases.length} 个案子行为正确：一致则通过，任一差异则失败。`);
}
