// Runs in every page of Prism's site sessions, but only does anything on
// Google's sign-in pages: there it makes the page see a regular Firefox
// browser, matching the request headers Prism sends, so Google doesn't
// refuse sign-in as "this browser or app may not be secure".
const { webFrame } = require('electron');

if (/(^|\.)accounts\.google\.com$/.test(location.hostname) || /(^|\.)accounts\.youtube\.com$/.test(location.hostname)) {
  webFrame.executeJavaScript(`(() => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
    const def = (obj, key, value) => { try { Object.defineProperty(obj, key, { get: () => value, configurable: true }); } catch {} };
    const nav = Navigator.prototype;
    def(nav, 'userAgent', ua);
    def(nav, 'appVersion', ua.slice(8));
    def(nav, 'vendor', '');
    def(nav, 'platform', 'Win32');
    def(nav, 'userAgentData', undefined);
    def(nav, 'webdriver', false);
    try { delete window.chrome; } catch {}
  })();`).catch(() => {});
}
