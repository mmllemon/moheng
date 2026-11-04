// 门禁自检：注入人造差异，确认 validate-ui-parity.mjs 真的会失败。
// 一个从不失败的门禁等于没有门禁 —— 这是必须验证的事。
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const WEB = 'docs/gates/ui-parity/web.json';
const base = JSON.parse(readFileSync(WEB, 'utf8'));
// web 侧也声明引擎，当作“真 Chrome 跑出来的结果”；与 electron 侧 signature 必须不同。
base.raw.web.env.engine = { requested: 'web', runtime: 'chrome', signature: 'chrome:156.0-selftest', desktopShell: false };

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
  // 2026-11-04：validate-ui-parity 现在先验引擎指纹（electron 侧必须声明真实桌面壳、
  // 两侧 signature 必须不同），否则“同一个 Chrome 跟自己比”会被直接拦下。
  // 这里的样本代表“真壳跑出来的结果”，后续差异注入的才是被测的逐项比对。
  const electronEngine = { requested: 'electron', runtime: 'electron', signature: 'electron:43.0.0-selftest', desktopShell: true };
  clone.raw.electron.env.engine = electronEngine;
  clone.summarize.electron.engine = electronEngine;
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

// 差异6：electron 侧其实仍是同一个浏览器（无桌面壳）→ 现在必须被引擎守卫拦下。
// 这是 2026-11-04 新增的防线：以前会把“同一引擎对同一引擎”当成逐项相等而放行。
{
  const e = perfectElectron();
  e.raw.electron.env.engine = { requested: 'electron', runtime: 'chrome', signature: 'chrome:156.0-selftest', desktopShell: false };
  e.summarize.electron.engine = e.raw.electron.env.engine;
  writeCase('stub-not-really-desktop', e);
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
