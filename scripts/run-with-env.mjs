// 跨平台设置环境变量后执行命令，避免引入 cross-env 依赖。
// 用法：node scripts/run-with-env.mjs KEY=VALUE [KEY2=VALUE2] -- command...
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const sepIndex = argv.indexOf('--');
const envPairs = [];
const rest = [];

if (sepIndex >= 0) {
  envPairs.push(...argv.slice(0, sepIndex));
  rest.push(...argv.slice(sepIndex + 1));
} else {
  // 无分隔符时：从第一个不含 '=' 的参数开始视为命令
  let index = 0;
  while (index < argv.length && argv[index].includes('=')) {
    envPairs.push(argv[index]);
    index += 1;
  }
  rest.push(...argv.slice(index));
}

if (!rest.length) {
  console.error('用法: node scripts/run-with-env.mjs KEY=VALUE -- command [args...]');
  process.exit(2);
}

const env = { ...process.env };
for (const pair of envPairs) {
  const eq = pair.indexOf('=');
  if (eq <= 0) {
    console.error(`无效的环境变量: ${pair}`);
    process.exit(2);
  }
  env[pair.slice(0, eq)] = pair.slice(eq + 1);
}

const [command, ...args] = rest;
const child = spawn(command, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
child.on('error', (error) => {
  console.error(`启动失败: ${error.message}`);
  process.exit(1);
});
