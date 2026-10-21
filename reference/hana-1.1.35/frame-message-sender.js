(function installFrameMessageSender() {
  var bootstrapName = '__hanaConsumeFrameMessageSender';
  var surfaceDocument = document;
  function send(iframe, message, targetOrigin) {
    if (!iframe || iframe.ownerDocument !== surfaceDocument || !iframe.isConnected) return false;
    var frameWindow = iframe.contentWindow;
    if (!frameWindow) return false;
    frameWindow.postMessage(message, targetOrigin);
    return true;
  }
  Object.defineProperty(window, bootstrapName, {
    configurable: true,
    value: function consumeFrameMessageSender() {
      delete window[bootstrapName];
      return send;
    },
  });
})();
