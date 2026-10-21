/**
 * i18n — 轻量国际化模块
 *
 * 用法：
 *   await i18n.load("zh");           // 加载语言包
 *   t("sidebar.title")               // → "对话"
 *   t("tool.bash.running", { name }) // → "💻 Hana 正在小心翼翼地用你的电脑"
 *
 * 占位符：{key} 格式，在第二个参数对象中查找替换
 *
 * Per-agent override：
 *   i18n.setAgentOverrides({ thinking: { phrases: ["计算中..."] } })
 *   → t("thinking.phrases") 优先返回 agent 覆盖值，找不到才走全局语言包
 */

const I18N_STATE_CHANGE_EVENT = "hana-i18n-state-change";
const MOBILE_ASSET_VERSION_META = "hana-mobile-asset-version";

function readMobileAssetVersion() {
  if (window.__hanaMobileAssetVersion && !window.__hanaMobileAssetVersion.startsWith("__HANA_")) {
    return window.__hanaMobileAssetVersion;
  }
  const currentScript = document.currentScript;
  if (currentScript && currentScript.src) {
    try {
      const token = new URL(currentScript.src, window.location.href).searchParams.get("v");
      if (token && !token.startsWith("__HANA_")) return token;
    } catch {}
  }
  const meta = document.querySelector(`meta[name="${MOBILE_ASSET_VERSION_META}"]`);
  const token = meta?.getAttribute("content") || "";
  return token && !token.startsWith("__HANA_") ? token : "";
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

const i18n = {
  /** 全局语言包数据 */
  _data: {},

  /**
   * 英文兜底包：当前 locale 缺某个 key 时回退到这里，避免把 key 字面量吐给用户。
   * 只在展示层读时兜底，绝不写回 _data。en locale 时与 _data 共用同一份引用。
   */
  _fallbackData: {},

  /** Per-agent 局部覆盖（同 locale JSON 结构的子集） */
  _agentOverrides: {},

  /** 当前 locale（"zh" / "zh-TW" / "ja" / "ko" / "en"） */
  locale: "zh",

  /** 默认 agent 名（占位符 {name} 的 fallback） */
  defaultName: "Hanako",

  /** 语言包加载修订号：成功、fallback、失败都会递增并广播 */
  revision: 0,

  /** 当前语言包加载状态，供 React store 同步 */
  loadState: {
    status: "idle",
    locale: "zh",
    requestedLocale: "zh",
    actualLocale: null,
    fallbackLocale: null,
    error: null,
    revision: 0,
  },

  /** mobile shell 注入的资源版本；桌面端没有时保持空字符串 */
  assetVersion: readMobileAssetVersion(),

  /**
   * 加载语言包
   * @param {string} locale  "zh-CN" / "zh-TW" / "ja" / "ko" / "en" 等
   */
  async load(locale) {
    if (!this.assetVersion) this.assetVersion = readMobileAssetVersion();
    const key = this._resolveKey(locale);
    const requestedLocale = locale || key;
    this.locale = key;
    this._setLoadState({
      status: "loading",
      locale: key,
      requestedLocale,
      actualLocale: null,
      fallbackLocale: null,
      error: null,
    });
    try {
      this._data = await this._fetchLocale(key);
      // 英文兜底包：key 缺失时读时回退。en locale 时共用同一份，避免二次请求。
      // 兜底加载失败不影响主 locale 已成功的展示，静默降级为空兜底。
      if (key === "en") {
        this._fallbackData = this._data;
      } else {
        await this._loadFallbackData();
      }
      this._setLoadState({
        status: "ready",
        locale: key,
        requestedLocale,
        actualLocale: key,
        fallbackLocale: null,
        error: null,
      });
    } catch (err) {
      console.warn(`[i18n] Failed to load locale "${key}", trying fallback:`, err);
      if (key !== "en") {
        try {
          this._data = await this._fetchLocale("en");
          // 主 locale 加载失败已整体回退到英文，_data 即英文包，兜底共用同一份。
          this._fallbackData = this._data;
          this._setLoadState({
            status: "fallback",
            locale: key,
            requestedLocale,
            actualLocale: "en",
            fallbackLocale: "en",
            error: errorMessage(err),
          });
          return;
        } catch (fallbackErr) {
          this._data = {};
          this._fallbackData = {};
          const message = `Failed to load locale "${key}" and fallback "en": ${errorMessage(fallbackErr)}`;
          console.error(`[i18n] ${message}`, { cause: err, fallbackErr });
          this._setLoadState({
            status: "error",
            locale: key,
            requestedLocale,
            actualLocale: null,
            fallbackLocale: "en",
            error: message,
          });
          throw new Error(message);
        }
      }
      this._data = {};
      this._fallbackData = {};
      const message = `Failed to load locale "${key}": ${errorMessage(err)}`;
      console.error(`[i18n] ${message}`);
      this._setLoadState({
        status: "error",
        locale: key,
        requestedLocale,
        actualLocale: null,
        fallbackLocale: null,
        error: message,
      });
      throw new Error(message);
    }
  },

  async _fetchLocale(key) {
    const res = await fetch(this._versionedUrl(`./locales/${key}.json`), { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
    return await res.json();
  },

  /**
   * 加载英文兜底包。仅在非 en locale 成功加载后调用。
   * 兜底包加载失败不影响主 locale 展示：静默降级为空兜底，只留一条 warn。
   */
  async _loadFallbackData() {
    try {
      this._fallbackData = await this._fetchLocale("en");
    } catch (err) {
      this._fallbackData = {};
      console.warn(`[i18n] Failed to load English fallback bundle:`, err);
    }
  },

  _versionedUrl(url) {
    if (!this.assetVersion) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${encodeURIComponent(this.assetVersion)}`;
  },

  _setLoadState(next) {
    this.revision += 1;
    this.loadState = {
      ...this.loadState,
      ...next,
      revision: this.revision,
    };
    window.dispatchEvent(new CustomEvent(I18N_STATE_CHANGE_EVENT, {
      detail: this.loadState,
    }));
  },

  /** locale 字符串 → JSON 文件名 key */
  _resolveKey(locale) {
    if (!locale) return "zh";
    if (locale === "zh-TW" || locale === "zh-Hant") return "zh-TW";
    if (locale.startsWith("zh")) return "zh";
    if (locale.startsWith("ja")) return "ja";
    if (locale.startsWith("ko")) return "ko";
    return "en";
  },

  /**
   * 设置当前 agent 的 locale 覆盖
   * @param {object|null} overrides  部分 locale 对象（同 zh.json 结构的子集），null 清空
   */
  setAgentOverrides(overrides) {
    this._agentOverrides = overrides || {};
  },

  /**
   * 按 dot path 取值（agent override > 全局语言包）
   * @param {string} path  如 "sidebar.title" 或 "tool.bash.running"
   * @returns {*}
   */
  _get(path) {
    const exactOverride = this._agentOverrides?.[path];
    if (exactOverride !== undefined && exactOverride !== null) return exactOverride;
    const exact = this._data?.[path];
    if (exact !== undefined && exact !== null) return exact;
    const keys = path.split(".");
    const override = keys.reduce((obj, k) => obj?.[k], this._agentOverrides);
    if (override !== undefined && override !== null) return override;
    const nested = keys.reduce((obj, k) => obj?.[k], this._data);
    if (nested !== undefined && nested !== null) return nested;
    // 当前 locale 缺该 key：回退英文兜底包（先 flat 后 nested），只读不写回。
    if (this._fallbackData === this._data) return undefined;
    const fallbackExact = this._fallbackData?.[path];
    if (fallbackExact !== undefined && fallbackExact !== null) return fallbackExact;
    return keys.reduce((obj, k) => obj?.[k], this._fallbackData);
  },

  /**
   * 翻译
   * @param {string} path   如 "sidebar.title"
   * @param {object} [vars] 占位符变量，如 { name: "Hana", n: 3 }
   * @returns {string}
   */
  t(path, vars) {
    let val = this._get(path);
    if (val === undefined || val === null) return path; // fallback: 返回 key 本身
    if (typeof val !== "string") return val;

    // 替换占位符
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        val = val.replaceAll(`{${k}}`, v);
      }
    }
    // 未提供 name 时用 defaultName
    val = val.replaceAll("{name}", this.defaultName);

    return val;
  },
};

/**
 * 快捷函数
 * @param {string} path
 * @param {object} [vars]
 * @returns {string}
 */
function t(path, vars) {
  return i18n.t(path, vars);
}

// React module 通过 window.i18n / window.t 访问
if (i18n.assetVersion) window.__hanaMobileAssetVersion = i18n.assetVersion;
window.i18n = i18n;
window.t = t;
