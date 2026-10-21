/**
 * 启动错误可视化：远程面（Pad / 手机浏览器）没有本机控制台可看，
 * 启动链路任何一环失败都不允许白屏——把错误直接画到屏幕上。
 * 必须是外部脚本（CSP script-src 'self' 禁止 inline），且尽早加载。
 */
(function installBootErrorSurface() {
  var booted = false;
  var reported = [];

  function markBooted() {
    booted = true;
  }

  // 渲染层任何一次成功挂载都视为启动成功，之后的错误交给应用内处理。
  window.__hanaMarkBooted = markBooted;

  function describe(event) {
    if (!event) return "unknown error";
    if (event.reason !== undefined) {
      var reason = event.reason;
      if (reason && reason.stack) return String(reason.stack);
      return "unhandledrejection: " + String(reason);
    }
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      var url = target.src || target.href;
      return "resource failed: <" + (target.tagName || "?").toLowerCase() + "> " + url;
    }
    var parts = [];
    if (event.message) parts.push(event.message);
    if (event.filename) parts.push(event.filename + ":" + (event.lineno || 0) + ":" + (event.colno || 0));
    if (event.error && event.error.stack) parts.push(String(event.error.stack));
    return parts.join("\n") || "unknown error event";
  }

  function render() {
    if (booted) return;
    var root = document.getElementById("react-root") || document.body;
    if (!root) return;
    var panel = document.getElementById("hana-boot-error");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "hana-boot-error";
      panel.style.cssText = [
        "box-sizing:border-box",
        "max-width:640px",
        "margin:48px auto",
        "padding:20px 22px",
        "border:1px solid rgba(160,80,60,0.35)",
        "border-radius:calc(8px * var(--corner-radius-scale, 1));corner-shape:squircle",
        "background:#fdf6ee",
        "color:#5a3c32",
        "font:13px/1.6 -apple-system, system-ui, sans-serif",
        "white-space:pre-wrap",
        "word-break:break-all",
        "user-select:text",
        "-webkit-user-select:text",
      ].join(";");
      root.appendChild(panel);
    }
    var ua = navigator.userAgent;
    panel.textContent = "Hana 启动失败（把这段截图给开发者）\n\n"
      + reported.join("\n\n----\n\n")
      + "\n\nUA: " + ua + "\nURL: " + location.href;
  }

  function report(event) {
    if (booted) return;
    var text = describe(event);
    if (reported.indexOf(text) === -1) reported.push(text);
    render();
  }

  window.addEventListener("error", report, true);
  window.addEventListener("unhandledrejection", report);

  // 兜底心跳：8 秒后仍未挂载且没有捕获到任何错误，也要给出可见状态，
  // 不允许无限白屏。
  setTimeout(function () {
    if (booted || reported.length > 0) return;
    reported.push("renderer did not mount within 8s and no error event was captured");
    render();
  }, 8000);
})();
