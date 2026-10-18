import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = process.env.API_SMOKE_BASE_URL ?? `http://127.0.0.1:${process.env.API_SMOKE_PORT ?? '3181'}`;
const email = process.env.SMOKE_ADMIN_EMAIL;
const password = process.env.SMOKE_ADMIN_PASSWORD;
if (!process.env.DATABASE_URL || !email || !password) {
  throw new Error('API smoke gate requires DATABASE_URL, SMOKE_ADMIN_EMAIL, and SMOKE_ADMIN_PASSWORD.');
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
function successEnvelope(body, label) {
  invariant(body && body.success === true, `${label}: API did not return a success envelope.`);
  return body.data;
}
const logs = [];
const child = spawn(process.execPath, ['apps/api/dist/src/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(new URL(baseUrl).port || 3181),
    JWT_SECRET: 'ci-isolated-smoke-secret-not-for-production-0001',
    COOKIE_SECURE: 'false',
    BACKGROUND_WORKER_ENABLED: 'false',
    ASSISTANT_POC_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let exited = false;
let exitSummary = '';
const capture = (stream, prefix) => stream.on('data', (chunk) => {
  logs.push(`${prefix}${chunk.toString()}`);
  while (logs.join('').length > 16000) logs.shift();
});
capture(child.stdout, '[stdout] ');
capture(child.stderr, '[stderr] ');
child.once('error', (error) => { exited = true; exitSummary = `spawn error: ${error.message}`; });
child.once('exit', (code, signal) => {
  exited = true;
  exitSummary = `API exited before completion (code=${code}, signal=${signal}).`;
});

async function jsonRequest(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(8000),
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
  });
  let body;
  try { body = await response.json(); }
  catch { throw new Error(`${path}: expected JSON response, received HTTP ${response.status}.`); }
  return { response, body };
}

async function stopApi() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exitedPromise = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const stopped = await Promise.race([exitedPromise.then(() => true), delay(4000).then(() => false)]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exitedPromise, delay(1500)]);
  }
}

let token;
try {
  const deadline = Date.now() + 45000;
  let readiness = null;
  while (Date.now() < deadline && !exited) {
    try {
      const result = await jsonRequest('/health/ready', { signal: AbortSignal.timeout(2000) });
      if (result.response.status === 200 && result.body?.success === true && result.body?.data?.database === 'ok') {
        readiness = result;
        break;
      }
    } catch { /* server is still starting */ }
    await delay(400);
  }
  invariant(!exited && readiness, `API did not become ready within 45 seconds. ${exitSummary}\n${logs.join('')}`);
  successEnvelope(readiness.body, 'readiness');
  console.log('PASS API process starts and PostgreSQL readiness is healthy');

  const unauthenticated = await jsonRequest('/api/projects');
  invariant(unauthenticated.response.status === 401, 'Unauthenticated project listing must return HTTP 401.');
  invariant(unauthenticated.body?.success === false, 'Unauthenticated project listing must return a structured failure.');
  console.log('PASS protected project API rejects unauthenticated requests');

  const metaResult = await jsonRequest('/api/meta');
  invariant(metaResult.response.status === 200, '/api/meta must return HTTP 200.');
  const meta = successEnvelope(metaResult.body, 'API metadata');
  invariant(Array.isArray(meta.modules) && meta.modules.some((item) => item.id === 'reports'), 'API metadata must expose the reports module.');
  console.log('PASS API metadata and module registry');

  const login = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  invariant(login.response.status === 200, `Admin login must return HTTP 200; received ${login.response.status}.`);
  const loginData = successEnvelope(login.body, 'admin login');
  invariant(typeof loginData.accessToken === 'string' && loginData.accessToken.length > 20, 'Login must issue an access token.');
  invariant(loginData.user?.role === 'ADMIN', 'Smoke fixture must authenticate as an administrator.');
  token = loginData.accessToken;
  const authorization = { authorization: `Bearer ${token}` };
  console.log('PASS seeded administrator can log in and receives an access token');

  const projects = await jsonRequest('/api/projects', { headers: authorization });
  invariant(projects.response.status === 200, `Authenticated project listing must return HTTP 200; received ${projects.response.status}.`);
  const projectRows = successEnvelope(projects.body, 'project listing');
  invariant(Array.isArray(projectRows), 'Project listing data must be an array.');
  const demo = projectRows.find((item) => item.code === 'DEMO-001');
  invariant(demo, 'Project listing must return seeded project DEMO-001.');
  invariant(Number(demo.mainContract?.amount) === 12580000, 'Demo project main contract amount must survive migration and seed.');
  console.log('PASS authenticated project and main-contract read path');

  const reports = await jsonRequest('/api/reports/catalog', { headers: authorization });
  invariant(reports.response.status === 200, `Report catalog must return HTTP 200; received ${reports.response.status}.`);
  const reportRows = successEnvelope(reports.body, 'standard report catalog');
  invariant(Array.isArray(reportRows) && reportRows.length > 0, 'Standard report catalog must contain entries.');
  console.log('PASS authenticated standard report catalog');

  const studio = await jsonRequest('/api/reports/studio/catalog?domain=COMPANY', { headers: authorization });
  invariant(studio.response.status === 200, `Company report-studio catalog must return HTTP 200; received ${studio.response.status}.`);
  const studioData = successEnvelope(studio.body, 'company report-studio catalog');
  invariant(studioData.domain === 'COMPANY' && Array.isArray(studioData.sources) && studioData.sources.length > 0,
    'Company report-studio catalog must include available data sources.');
  console.log('PASS authenticated company-level report-studio data sources');

  console.log('PASS API runtime smoke gate: readiness, authorization, login, project/contract read, standard reports, and report studio');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (logs.length) console.error(logs.join(''));
  process.exitCode = 1;
} finally {
  await stopApi();
}
