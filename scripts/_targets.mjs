/**
 * 双 target 启动器：Web（Vite dev server）与 Electron（打包后的壳）。
 *
 * 供 ui-visual-regression.mjs 使用。设计目标：
 *   - 两个 target 用同一套 Playwright API 操作，返回结构完全一致
 *   - 每个 target 自己负责浏览器/壳的启动与清理
 *   - Chromium 版本可读出来，用于判定 corner-shape 是否被支持
 *
 * ── 为什么需要双 target ──
 *
 * moheng 最终要打包成 Electron 应用。Web 端用 Chrome 156（支持 squircle），
 * Electron 早期版本用 Chromium 126（不支持）。同一个 CSS 在两个容器里
 * 会渲染出不同圆角，必须能分别巡检、逐项比对。
 *
 * ── 为什么 Electron 必须 ≥ 43 ──
 *
 * corner-shape: squircle 需要 Chromium 139+。Electron 31 = Chromium 126，
 * 会静默退化为普通圆角（getComputedStyle 返回空串，不报错）。
 * Electron 43 = Chromium 150，满足要求。
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

/** squircle 需要的最低 Chromium 主版本 */
export const CORNER_SHAPE_MIN_CHROMIUM = 139;

const WEB_BASE = process.env.WEB_BASE_URL ?? 'http://localhost:5173';
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';
const CHROME_PATH =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/**
 * legacy target 用的旧内核。
 *
 * 优先 LEGACY_CHROME_PATH（例如指向一个 Chromium <139，专门验 squircle 退化）；
 * 否则在本机 Playwright 浏览器目录里找已安装的 chromium 构建，取构建号最大的一个；
 * 都找不到才交给 Playwright 自己解析（它会尝试下载新版 headless shell，离线环境下会失败）。
 */
function resolveLegacyChromePath() {
  const explicit = process.env.LEGACY_CHROME_PATH?.trim();
  if (explicit) return explicit;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() || join(homedir(), 'AppData', 'Local', 'ms-playwright');
  try {
    const builds = readdirSync(root)
      .map((name) => /^chromium-(\d+)$/.exec(name))
      .filter((match) => match !== null)
      .map((match) => Number(match[1]))
      .sort((a, b) => b - a);
    for (const build of builds) {
      const candidate = join(root, `chromium-${build}`, 'chrome-win64', 'chrome.exe');
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // 目录不存在就交给调用方兜底
  }
  return undefined;
}

const LEGACY_CHROME_PATH = resolveLegacyChromePath();

/** 从 UA 里取 Chromium 主版本；取不到返回 null */
export function chromiumMajor(ua) {
  if (!ua) return null;
  const m = /Chrom(e|ium)\/(\d+)/.exec(ua);
  return m ? Number(m[2]) : null;
}

/** 确认 API 已就绪，否则后续页面全是 500，巡检结果无意义 */
export async function assertApiUp() {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
      lastError = new Error(`API 返回 ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`API 未就绪（${API_BASE}）：${lastError?.message ?? '超时'}`);
}

/**
 * 启动一个 target。
 * 返回 { kind, page, pageErrors, open(path), newMobilePage(), close() }。
 *
 * pageErrors 是一个持续收集的数组：页面 console error 与未捕获异常都计入。
 * ui-visual-regression 会按路由切片（slice(before)）判断该路由是否有错。
 */
export async function launchTarget(kind) {
  // 2026-11-05：从 web/electron 改成 web/legacy。仓库里没有桌面壳（无 electron 依赖、无 main 进程），
  // 原来的 electron 分支和 web 启的是同一个 CHROME_PATH，比对必然全等但什么都没验。
  // 现在的第二 target 是**另一个 Chromium 构建**：默认 Playwright 自带（比系统 Chrome 旧），
  // 也可以用 LEGACY_CHROME_PATH 指向一个 Chromium <139，专门覆盖 squircle 静默降级那条路。
  const legacy = kind === 'legacy';
  const executablePath = legacy ? LEGACY_CHROME_PATH : CHROME_PATH;
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ['--window-size=1500,950'],
  });  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    deviceScaleFactor: 1,
    storageState: process.env.AUTH_STATE ?? undefined,
  });
  const page = await context.newPage();

  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push({ type: 'console', text: msg.text() });
  });
  page.on('pageerror', (error) => {
    pageErrors.push({ type: 'pageerror', text: String(error?.message ?? error) });
  });

  /** 登录（若 storageState 失效） */
  async function ensureLoggedIn() {
    if (!page.url().includes('/login')) return;
    await page.locator('input[type=email]').first().fill('admin@local.test');
    await page.locator('input[type=password]').first().fill('ChangeMe123!');
    await page.locator('button[type=submit]').first().click();
    await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 15_000 });
    await page.waitForTimeout(1200);
  }

  /**
   * 打开一个路由并返回环境信息。
   * 首次调用做完整导航（触发登录流程），后续路由由调用方用 history.pushState 切换。
   */
  async function open(path) {
    await page.goto(`${WEB_BASE}${path}`, { waitUntil: 'networkidle' });
    await ensureLoggedIn();
    if (!page.url().includes(path.split('?')[0]) && path !== '/') {
      await page.goto(`${WEB_BASE}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(300);

    return page.evaluate(() => ({
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      cornerShapeAccepted: (() => {
        const probe = document.createElement('div');
        probe.style.cornerShape = 'squircle';
        return probe.style.cornerShape === 'squircle';
      })(),
    }));
  }

  /**
   * 新建一个窄屏页面，用于巡检移动端布局。
   * 返回 { page, open(path), close() }。
   */
  async function newMobilePage({ width, height }) {
    const mobileContext = await browser.newContext({
      viewport: { width, height },
      locale: 'zh-CN',
      deviceScaleFactor: 1,
      storageState: process.env.AUTH_STATE ?? undefined,
    });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on('pageerror', (error) => {
      pageErrors.push({ type: 'pageerror', text: String(error?.message ?? error) });
    });

    async function mobileEnsureLoggedIn() {
      if (!mobilePage.url().includes('/login')) return;
      await mobilePage.locator('input[type=email]').first().fill('admin@local.test');
      await mobilePage.locator('input[type=password]').first().fill('ChangeMe123!');
      await mobilePage.locator('button[type=submit]').first().click();
      await mobilePage.waitForURL((u) => !u.toString().includes('/login'), { timeout: 15_000 });
      await mobilePage.waitForTimeout(1200);
    }

    return {
      page: mobilePage,
      async open(path) {
        await mobilePage.goto(`${WEB_BASE}${path}`, { waitUntil: 'networkidle' });
        await mobileEnsureLoggedIn();
        if (!mobilePage.url().includes(path.split('?')[0]) && path !== '/') {
          await mobilePage.goto(`${WEB_BASE}${path}`, { waitUntil: 'networkidle' });
          await mobilePage.waitForTimeout(600);
        }
        await mobilePage.waitForTimeout(300);
        return mobilePage.evaluate(() => ({
          ua: navigator.userAgent,
          dpr: window.devicePixelRatio,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));
      },
      async close() {
        await mobileContext.close();
      },
    };
  }

  return {
    kind,
    /** 引擎类型：web 用系统 Chrome，legacy 用另一个 Chromium 构建。签名在拿到 UA 后补齐。 */
    runtime: legacy ? 'chromium' : 'chrome',
    executablePath: executablePath ?? 'playwright-bundled-chromium',
    page,
    pageErrors,
    open,
    newMobilePage,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
