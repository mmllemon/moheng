/**
 * platform.js — 平台适配层
 *
 * Electron 环境：直接转发给 preload 注入的 window.hana（IPC）
 * Web 环境：降级到 HTTP API + 浏览器原生 API
 *
 * 使用方式：所有前端代码调 platform.xxx()，不再直接碰 window.hana。
 */
(function () {
  if (window.hana) {
    // Electron — 直接用 preload 注入的 IPC bridge
    window.platform = window.hana;
    return;
  }

  // Web / 非 Electron 环境 — HTTP fallback
  const params = new URLSearchParams(location.search);
  const devWeb = normalizeDevWebConfig(window.__HANA_DEV_WEB__);
  const token = params.get("token") || localStorage.getItem("hana-token") || "";
  const baseUrl = devWeb.apiBaseUrl || `${location.protocol}//${location.host}`;
  const serverPort = devWeb.serverPort || safePortFromBaseUrl(baseUrl) || location.port || "3000";

  function normalizeDevWebConfig(value) {
    if (!value || typeof value !== "object") {
      return { serverPort: "", apiBaseUrl: "" };
    }
    const serverPort = typeof value.serverPort === "number" || typeof value.serverPort === "string"
      ? String(value.serverPort).trim()
      : "";
    const apiBaseUrl = typeof value.apiBaseUrl === "string"
      ? value.apiBaseUrl.replace(/\/+$/, "")
      : "";
    return { serverPort, apiBaseUrl };
  }

  function safePortFromBaseUrl(value) {
    try {
      return new URL(value).port;
    } catch {
      return "";
    }
  }

  function apiFetch(path, opts = {}) {
    const headers = { ...opts.headers };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(`${baseUrl}${path}`, { ...opts, headers });
  }

  window.platform = {
    // 服务器连接
    getServerPort: async () => serverPort,
    getServerToken: async () => token,
    appReady: async () => {},
    syncWindowTheme: () => {},
    runEditCommand: async () => false,
    readClipboardImage: async () => null,

    // 文件 I/O → server HTTP
    readFile: (p) => apiFetch(`/api/fs/read?path=${encodeURIComponent(p)}`).then(r => r.ok ? r.text() : null),
    readFileSnapshot: async () => null,
    readFileBase64: (p) => apiFetch(`/api/fs/read-base64?path=${encodeURIComponent(p)}`).then(r => r.ok ? r.text() : null),
    readDocxHtml: (p) => apiFetch(`/api/fs/docx-html?path=${encodeURIComponent(p)}`).then(r => r.ok ? r.text() : null),
    readXlsxHtml: (p) => apiFetch(`/api/fs/xlsx-html?path=${encodeURIComponent(p)}`).then(r => r.ok ? r.text() : null),

    // 文件写入 / 监听 → Web 不支持
    writeFile: async () => false,
    writeFileBinary: async () => false,
    copyFile: async () => false,
    writeFileIfUnchanged: async () => ({ ok: false }),
    watchFile: async () => false,
    unwatchFile: async () => false,
    onFileChanged: () => {},
    watchWorkspace: async () => false,
    unwatchWorkspace: async () => false,
    onWorkspaceChanged: () => {},

    // 文件路径（Web 不支持系统路径）
    getFilePath: () => null,
    getAvatarPath: () => null,
    getSplashInfo: async () => ({}),
    // Web 环境无 OS 账户访问；批注署名回落链在此级直接跳过。
    getOSUserName: () => "",

    // 系统对话框 → Web 降级
    selectFolder: async () => null,
    selectFiles: async () => [],
    selectSkill: async () => null,

    // OS 集成 → 静默降级
    openFolder: () => {},
    openFile: () => {},
    openExternal: async (url) => {
      // 浏览器降级：noopener 打开时成功也可能返回 null，不能据此判定被拦截；
      // 也不返回 { ok: true }。真实抛出（如被策略禁止）原样传播。
      window.open(url, "_blank", "noopener");
    },
    showInFinder: () => {},
    startDrag: () => {},

    // 窗口管理 → 单页降级
    openSettings: () => {},
    reloadMainWindow: () => location.reload(),

    // 设置通信 → Web 环境暂不支持跨窗口
    settingsChanged: () => {},
    onSettingsChanged: () => {},
    onOpenSettingsModal: () => {},

    // 浏览器查看器 → Web 环境暂不支持
    isDesktopBrowserViewerAvailable: () => false,
    openBrowserViewer: () => {},
    closeBrowserViewer: () => {},
    browserHideViewer: () => {},
    onBrowserUpdate: () => {},
    browserSetViewerLayout: () => {},
    browserNavigate: () => {},
    browserGoBack: () => {},
    browserGoForward: () => {},
    browserReload: () => {},
    browserNewTab: () => {},
    browserSwitchTab: () => {},
    browserCloseTab: () => {},
    browserEmergencyStop: () => {},
    // Browser Preview 快照/事件在 Web 环境无原生视图可承载：状态恒为空、事件不触发；
    // attach/present/release 与 owned 批注（browserGetAnnotationState /
    // browserSetOwnedAnnotationMode / browserSubmitOwnedAnnotation /
    // browserOwnedAnnotationNoteRemoved 及其订阅）均保持未定义，组件据此显示“当前
    // 客户端不支持内置浏览器”，不以空 Promise 冒充成功。
    browserRequestPreviewState: async () => ({ workspaces: [] }),
    onBrowserPreviewUpdate: () => {},
    onBrowserPreviewOpen: () => {},
    onBrowserPresentationChanged: () => {},

    // Skill 查看器 → Web 环境暂不支持
    openSkillViewer: () => {},
    listSkillFiles: async () => [],
    readSkillFile: async () => null,
    readSkillFilePreview: async () => ({ kind: 'error', reason: 'unreadable' }),
    onSkillViewerLoad: () => {},
    closeSkillViewer: () => {},

    // Onboarding
    onboardingComplete: async () => {},
    debugOpenOnboarding: async () => {},
    debugOpenOnboardingPreview: async () => {},

    // 窗口控制（Web 不需要）
    getPlatform: async () => "web",
    windowMinimize: () => {},
    windowMaximize: () => {},
    windowClose: () => {},
    windowIsMaximized: async () => false,
    onMaximizeChange: () => {},
  };
})();

// ── 平台检测 ──
(async function initPlatform() {
  const p = window.platform;
  if (!p?.getPlatform) return;
  const plat = await p.getPlatform();
  document.documentElement.setAttribute("data-platform", plat);
  // Windows/Linux 窗口控制按钮已迁移到 React (App.tsx WindowControls)
})();
