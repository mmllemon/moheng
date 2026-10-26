// 环境契约的端到端验证：在真实进程里确认端口回填与就绪握手。
//
// 为什么不用单元测试代替：
//   单元测试证明 resolvePortPolicy 会拒绝 PORT=0，但证明不了
//   "PORT=0 之后 Fastify 真的把系统分配的端口回填到了 ready 文件"。
//   后者只有在真实 listen 之后才成立。
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const API_DIR = 'apps/api';
const tmp = mkdtempSync(join(tmpdir(), 'runtime-contract-'));

const results = [];
function check(label, condition, detail) {
  results.push({ label, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ' :: ' + JSON.stringify(detail)}`);
}

/** 启动 API 子进程，等待就绪文件或退出 */
function startApi({ env: extraEnv, readyFile, waitMs = 45000 }) {
  return new Promise((resolve) => {
    const child = spawn('node', ['--import=tsx', 'src/server.ts'], {
      cwd: API_DIR,
      env: { ...process.env, ...extraEnv },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      resolve({ ok: false, reason: 'timeout', out });
    }, waitMs);

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
      if (readyFile && existsSync(readyFile)) {
        finish({ ok: true, out, child });
      }
    });
    child.stderr.on('data', (chunk) => { out += chunk.toString(); });
    child.on('exit', (code) => finish({ ok: false, reason: `exit ${code}`, out, code }));
  });
}

function stopChild(child) {
  if (!child) return;
  try { child.kill(); } catch {}
}

// ---------- 场景 1：standalone + PORT=0 必须被拒绝 ----------
{
  const payload = await startApi({ env: { RUNTIME_MODE: 'standalone', PORT: '0' }, readyFile: null, waitMs: 20000 });
  check('standalone + PORT=0 启动被拒绝', payload.ok === false && payload.code !== 0, {
    reason: payload.reason,
  });
  check('拒绝理由明确提到随机端口/反向代理', /随机端口|反向代理/.test(payload.out), payload.out.slice(-300));
}

// ---------- 场景 2：standalone + pglite 必须被拒绝 ----------
{
  const payload = await startApi({
    env: { RUNTIME_MODE: 'standalone', DATABASE_URL: 'pglite://./data' },
    readyFile: null,
    waitMs: 20000,
  });
  check('standalone + pglite 启动被拒绝', payload.ok === false && payload.code !== 0, { reason: payload.reason });
  check('拒绝理由提到 DBA/备份/审计', /DBA|备份|审计/.test(payload.out), payload.out.slice(-300));
}

// ---------- 场景 3：embedded + pglite 必须被拒绝（适配器未接） ----------
{
  const payload = await startApi({
    env: { RUNTIME_MODE: 'embedded', PORT: '0', DATABASE_URL: 'pglite://./data' },
    readyFile: null,
    waitMs: 20000,
  });
  check('embedded + pglite（适配器未接）启动被拒绝', payload.ok === false && payload.code !== 0, { reason: payload.reason });
  check('拒绝理由提到静默降级/假成功', /静默降级|假成功/.test(payload.out), payload.out.slice(-300));
}

// ---------- 场景 4：embedded + PORT=0 真实启动，检查端口回填 ----------
{
  const readyFile = join(tmp, 'ready.json');
  const payload = await startApi({
    env: { RUNTIME_MODE: 'embedded', PORT: '0', MOHENG_READY_FILE: readyFile },
    readyFile,
    waitMs: 60000,
  });

  check('embedded + PORT=0 成功启动并写出就绪文件', payload.ok && existsSync(readyFile), { reason: payload.reason });

  if (payload.ok) {
    const info = JSON.parse(readFileSync(readyFile, 'utf8'));
    console.log('  ready 文件内容:', JSON.stringify(info));

    check('就绪文件里的端口不是 0', info.port > 0, { port: info.port });
    check('端口落在合法范围', info.port > 1024 && info.port <= 65535, { port: info.port });
    check('baseUrl 与 host/port 自洽', info.baseUrl === `http://${info.host}:${info.port}`, {
      baseUrl: info.baseUrl, host: info.host, port: info.port,
    });
    check('mode 正确回填', info.mode === 'embedded', { mode: info.mode });
    check('databaseScheme 正确回填', info.databaseScheme === 'postgresql', { scheme: info.databaseScheme });
    check('就绪文件不含数据库凭据', !JSON.stringify(info).includes('moheng_local_pw'), '凭据不应出现在就绪文件中');

    // 真访问一次，确认这个端口真的在服务
    let healthOk = false;
    try {
      const response = await fetch(info.baseUrl + '/health', { signal: AbortSignal.timeout(8000) });
      const body = await response.json();
      healthOk = response.ok && body?.data?.api === 'ok';
    } catch {}
    check('用回填的 baseUrl 能访问 /health', healthOk, { baseUrl: info.baseUrl });

    stopChild(payload.child);
  }
}

rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((row) => !row.ok);
console.log('');
if (failed.length) {
  console.log(`${failed.length} 项失败，${results.length - failed.length} 项通过。`);
  process.exitCode = 1;
} else {
  console.log(`全部 ${results.length} 项通过。`);
}
