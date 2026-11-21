// Runs in every page of Prism's site sessions, but only does anything on
// Google's sign-in pages: there it makes the page see a regular Firefox
// browser, matching the request headers Prism sends, so Google doesn't
// refuse sign-in as "this browser or app may not be secure" (Google's check
// looks for a browser that says one thing and does another, so the page has
// to see Firefox's features, not Chrome's).
const { webFrame } = require('electron');

if (/(^|\.)accounts\.google\.com$/.test(location.hostname) || /(^|\.)accounts\.youtube\.com$/.test(location.hostname)) {
  webFrame.executeJavaScript(`(() => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
    const def = (obj, key, value) => { try { Object.defineProperty(obj, key, { get: () => value, configurable: true, enumerable: true }); } catch {} };
    const nav = Navigator.prototype;
    def(nav, 'userAgent', ua);
    def(nav, 'appVersion', '5.0 (Windows)');
    def(nav, 'vendor', '');
    def(nav, 'vendorSub', '');
    def(nav, 'productSub', '20100101');
    def(nav, 'platform', 'Win32');
    def(nav, 'oscpu', 'Windows NT 10.0; Win64; x64');
    def(nav, 'buildID', '20181001000000');
    def(nav, 'webdriver', false);
    // Chrome-only features that Firefox doesn't have.
    for (const k of ['userAgentData', 'deviceMemory', 'connection', 'hid', 'serial', 'usb', 'bluetooth', 'keyboard', 'ink', 'scheduling',
      'virtualKeyboard', 'windowControlsOverlay', 'managed', 'login', 'storageBuckets', 'presentation', 'contacts', 'getBattery', 'getInstalledRelatedApps',
      'setAppBadge', 'clearAppBadge', 'requestMediaKeySystemAccess_', 'xr']) {
      try { delete nav[k]; } catch {}
      try { if (k in navigator) def(nav, k, undefined); } catch {}
    }
    for (const k of ['chrome', 'webkitRequestFileSystem', 'webkitResolveLocalFileSystemURL', 'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker',
      'documentPictureInPicture', 'launchQueue', 'queryLocalFonts', 'getScreenDetails', 'onappinstalled', 'onbeforeinstallprompt']) {
      try { delete window[k]; } catch {}
      try { if (k in window) Object.defineProperty(window, k, { value: undefined, configurable: true }); } catch {}
    }
    // Firefox-only window properties.
    def(window, 'mozInnerScreenX', window.screenX);
    def(window, 'mozInnerScreenY', window.screenY + (window.outerHeight - window.innerHeight));
    def(window, 'InstallTrigger', undefined);
  })();`).catch(() => {});
}
