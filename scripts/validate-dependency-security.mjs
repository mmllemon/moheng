import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [root, api, web, lock] = await Promise.all([
  readJson('package.json'),
  readJson('apps/api/package.json'),
  readJson('apps/web/package.json'),
  readJson('package-lock.json'),
]);

const packages = lock.packages ?? {};
const checks = [
  [
    'ExcelJS is pinned to the security-hardened 5.1.0 alias',
    api.dependencies?.exceljs === 'npm:exceljs-hardened@5.1.0' &&
      packages['node_modules/exceljs']?.version === '5.1.0' &&
      packages['node_modules/exceljs']?.name === 'exceljs-hardened',
  ],
  [
    'Apache ECharts is fixed at 6.1.0 or later',
    /^6\\./.test(web.dependencies?.echarts ?? '') &&
      (packages['node_modules/echarts']?.version ?? '') >= '6.1.0',
  ],
  [
    'echarts-for-react avoids known compromised 3.0.7 and is fixed at 3.0.6',
    web.dependencies?.['echarts-for-react'] === '3.0.6' &&
      packages['node_modules/echarts-for-react']?.version === '3.0.6',
  ],
  [
    'React Router DOM and core are both patched at 7.18.4',
    web.dependencies?.['react-router-dom'] === '7.18.4' &&
      packages['node_modules/react-router-dom']?.version === '7.18.4' &&
      packages['node_modules/react-router']?.version === '7.18.4',
  ],
  [
    'size-sensor remains pinned to the known locked safe version',
    root.overrides?.['size-sensor'] === '1.0.3' &&
      packages['node_modules/size-sensor']?.version === '1.0.3',
  ],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exitCode = 1;
