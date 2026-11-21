// Runs in every page of Prism's site sessions, but only does anything on
// Google's sign-in pages. Google refuses sign-in from apps' built-in browsers
// ("This browser or app may not be secure"). Prism runs on Chrome's engine,
// so on those pages it presents itself as regular Google Chrome: Electron
// (what Prism is built on) leaves out a few things real Chrome has, which is
// how Google tells the two apart. This fills them in, matching the request
// headers Prism sends.
const { webFrame } = require('electron');

if (/(^|\.)accounts\.google\.com$/.test(location.hostname) || /(^|\.)accounts\.youtube\.com$/.test(location.hostname)) {
  webFrame.executeJavaScript(`(() => {
    const nav = Navigator.prototype;
    const def = (obj, key, get) => { try { Object.defineProperty(obj, key, { get, configurable: true, enumerable: true }); } catch {} };
    def(nav, 'webdriver', () => false);

    // "Google Chrome" in the browser's brand list (Electron only says "Chromium").
    const uad = navigator.userAgentData;
    if (uad) {
      const withChrome = (list) => {
        if (!Array.isArray(list) || list.some((b) => b.brand === 'Google Chrome')) return list;
        const c = list.find((b) => b.brand === 'Chromium');
        return c ? [...list, { brand: 'Google Chrome', version: c.version }] : list;
      };
      const brands = withChrome(uad.brands);
      const proto = Object.getPrototypeOf(uad);
      def(proto, 'brands', () => brands);
      const high = proto.getHighEntropyValues;
      proto.getHighEntropyValues = function (hints) {
        return high.call(this, hints).then((v) => ({ ...v, brands: withChrome(v.brands), ...(v.fullVersionList ? { fullVersionList: withChrome(v.fullVersionList) } : {}) }));
      };
      const toJSON = proto.toJSON;
      if (toJSON) proto.toJSON = function () { return { ...toJSON.call(this), brands }; };
    }

    // window.chrome's app / csi / loadTimes, which every Chrome page has
    // (Electron's is missing them).
    {
      const start = performance.timeOrigin / 1000;
      const parts = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: () => null, getIsInstalled: () => false, runningState: () => 'cannot_run'
        },
        csi: () => ({ startE: Math.round(start * 1000), onloadT: Math.round(start * 1000 + 300), pageT: performance.now(), tran: 15 }),
        loadTimes: () => ({
          requestTime: start, startLoadTime: start, commitLoadTime: start + 0.1, finishDocumentLoadTime: start + 0.3, finishLoadTime: start + 0.4,
          firstPaintTime: start + 0.2, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2'
        })
      };
      let chrome = window.chrome;
      if (!chrome || typeof chrome !== 'object') {
        chrome = {};
        try { Object.defineProperty(window, 'chrome', { value: chrome, configurable: true, writable: true, enumerable: true }); } catch {}
      }
      for (const [k, v] of Object.entries(parts)) if (!(k in chrome)) { try { chrome[k] = v; } catch {} }
    }
  })();`).catch(() => {});
}
