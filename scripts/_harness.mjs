// 所有浏览器脚本共用的登录助手：确保真的进了应用，没进就抛出响亮错误
// 教训：API 未启动时登录会静默失败，脚本仍会「成功」跑完全部路由，
// 产出的全是一份登录页的重复快照。必须显式校验。
export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const BASE = 'http://localhost:5173';

export const ROUTES = [
  '/', '/projects', '/projects/members', '/cost/contracts', '/cost/budget',
  '/cost/progress-bills', '/cost/changes', '/cost/downstream', '/cost/owner-finance',
  '/cost/costs', '/cost/analysis', '/reports', '/reports/designer', '/notifications',
  '/parties', '/audit-logs', '/settings/appearance', '/system', '/system/security',
  '/system/policies', '/system/governance', '/system/operations',
  '/system/dictionaries', '/system/parameters', '/system/accounts',
  '/system/assistant', '/account/security',
];

/** 检查 API 是否在线；离线时直接失败，不静默降级 */
export async function assertApiUp() {
  let ok = false;
  try {
    const r = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(5000) });
    ok = r.ok;
  } catch { ok = false; }
  if (!ok) {
    throw new Error(
      'API 未运行（http://localhost:3001 不可达）。\n' +
      '登录会静默失败，所有路由快照都会变成登录页的重复，脚本却仍然"通过"。\n' +
      '先启动：npm run dev'
    );
  }
}

/**
 * 登录并校验真的进入了应用。
 * 失败时抛出错误，而不是返回一个假的成功。
 */
export async function login(page, { timeout = 4000 } = {}) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.locator('input[type=email]').first().fill('admin@local.test');
  await page.locator('input[type=password]').first().fill('ChangeMe123!');
  await page.locator('button[type=submit]').first().click();
  await page.waitForTimeout(timeout);

  const stillOnLogin = await page.evaluate(() => !!document.querySelector('.login-screen'));
  if (stillOnLogin) {
    // 抓一下错误提示，便于定位
    const msg = await page.evaluate(() => {
      const e = document.querySelector('.login-error, .form-error, [role=alert]');
      return e ? e.textContent.trim().slice(0, 120) : '(无错误提示)';
    });
    throw new Error(`登录失败，仍停在登录页。提示: ${msg}`);
  }
  // 二次确认：应用外壳存在
  const hasShell = await page.evaluate(() =>
    !!document.querySelector('.app-shell, .app-main, .sidebar, nav')
  );
  if (!hasShell) throw new Error('登录后未找到应用外壳，页面可能未正确渲染');
}

/**
 * 导航到某路由，并确认渲染出了内容（不是空白）。
 */
export async function gotoRoute(page, route, { settle = 950 } = {}) {
  await page.evaluate((r) => {
    window.history.pushState(null, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(settle);

  const info = await page.evaluate(() => ({
    onLogin: !!document.querySelector('.login-screen'),
    bodyLen: (document.body.innerText || '').trim().length,
    els: document.querySelectorAll('body *').length,
  }));
  if (info.onLogin) throw new Error(`${route}: 被弹回登录页（会话失效）`);
  if (info.bodyLen < 20) throw new Error(`${route}: 页面几乎空白（${info.bodyLen} 字符）`);
  return info;
}
