// Runs in every YouTube page and embedded YouTube player in Prism.
//  - Ads: removes the ads YouTube sends with each video, hides ad boxes on the
//    page, and fast-forwards (muted) any ad that still starts to play.
//  - Speed: turns off ambient mode's glow (it redraws the video into a blurred
//    background all the time), and avoids video formats your PC can only
//    decode in software (AV1 on older graphics cards).
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const host = location.hostname;
if (/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) {
  let cfg = { ads: 'remove', codec: 'auto', av1Hardware: true, ambient: false };
  try { cfg = { ...cfg, ...ipcRenderer.sendSync('youtube:config') }; } catch {}

  // ---- Page CSS (one style sheet, added before the page draws) ------------------
  const css = [];
  if (cfg.ads !== 'off') css.push(`
    #masthead-ad, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer,
    ytd-statement-banner-renderer, ytd-primetime-promo-renderer, ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-compact-promoted-video-renderer,
    ytd-action-companion-ad-renderer, ytd-player-legacy-desktop-watch-ads-renderer, #player-ads,
    ytd-merch-shelf-renderer, ytd-brand-video-singleton-renderer, ytd-brand-video-shelf-renderer,
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer),
    ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
    ytd-search-pyv-renderer, ytd-movie-offer-module-renderer,
    .ytp-ad-overlay-container, .ytp-ad-overlay-slot, .ytp-ad-image-overlay, .ytp-featured-product,
    tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), ytd-enforcement-message-view-model,
    ytd-mealbar-promo-renderer, yt-mealbar-promo-renderer
    { display: none !important; }`);
  if (!cfg.ambient) css.push('#cinematics, #cinematics-container, #cinematic-container { display: none !important; }');
  if (css.length) { try { webFrame.insertCSS(css.join('\n')); } catch {} }

  // ---- Page script (runs in the page itself, before YouTube's own code) --------
  function pageScript(cfg) {
    if (window.__prismYT) return;
    Object.defineProperty(window, '__prismYT', { value: true });
    const wrap = (obj, key, apply) => {
      try {
        const orig = obj[key];
        if (typeof orig !== 'function') return;
        // A Proxy still looks like the browser's own function to the page.
        obj[key] = new Proxy(orig, { apply: (t, self, args) => apply(t, self, args) });
      } catch {}
    };

    // 1. Remove ads from the data YouTube sends with each video.
    if (cfg.ads === 'remove') {
      const KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
      const strip = (o) => { if (o && typeof o === 'object') for (const k of KEYS) if (k in o) delete o[k]; };
      const clean = (o) => {
        try {
          if (!o || typeof o !== 'object') return o;
          if (Array.isArray(o)) { for (const x of o) if (x && x.playerResponse) strip(x.playerResponse); return o; }
          strip(o);
          if (o.playerResponse) strip(o.playerResponse);
        } catch {}
        return o;
      };
      let initial;
      try {
        Object.defineProperty(window, 'ytInitialPlayerResponse', {
          configurable: true, get: () => initial, set: (v) => { initial = clean(v); }
        });
      } catch {}
      wrap(JSON, 'parse', (t, self, args) => {
        const r = Reflect.apply(t, self, args);
        return r && typeof r === 'object' && (r.adPlacements || r.playerAds || r.adSlots || r.playerResponse || Array.isArray(r)) ? clean(r) : r;
      });
      wrap(Response.prototype, 'json', (t, self, args) => {
        const p = Reflect.apply(t, self, args);
        return /\/youtubei\/v1\/(player|next|reel)/.test(self.url || '') ? p.then(clean) : p;
      });
    }

    // 2. Any ad that still plays: mute it, jump to its end, press Skip.
    //    Also closes the "Ad blockers are not allowed" box and resumes the video.
    if (cfg.ads !== 'off') {
      let saved = null;
      const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button';
      setInterval(() => {
        const player = document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting');
        const v = player && player.querySelector('video');
        if (v) {
          if (!saved) saved = { muted: v.muted, rate: v.playbackRate };
          v.muted = true;
          v.playbackRate = 16; // in case the jump below isn't allowed yet
          if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.3) v.currentTime = v.duration - 0.1;
          const skip = player.querySelector(SKIP);
          if (skip) skip.click();
        } else if (saved) {
          const main = document.querySelector('.html5-video-player video');
          if (main) {
            main.muted = saved.muted;
            if (main.playbackRate === 16) main.playbackRate = saved.rate === 16 ? 1 : saved.rate || 1;
          }
          saved = null;
        }
        const notice = document.querySelector('ytd-enforcement-message-view-model');
        if (notice) {
          notice.closest('tp-yt-paper-dialog')?.remove();
          document.querySelector('tp-yt-iron-overlay-backdrop')?.remove();
          const main = document.querySelector('.html5-video-player video');
          if (main && main.paused) main.play().catch(() => {});
        }
      }, 300);
    }

    // 3. Video formats: skip AV1 when the graphics card can't decode it (it
    //    would run on the CPU), and VP9 too in "H.264 only" mode.
    const noAv1 = cfg.codec === 'h264' || (cfg.codec === 'auto' && !cfg.av1Hardware);
    const noVp9 = cfg.codec === 'h264';
    if (noAv1 || noVp9) {
      const refuse = (type) => { const t = String(type || ''); return (noAv1 && /av01/i.test(t)) || (noVp9 && /vp0?9/i.test(t)); };
      for (const MS of [window.MediaSource, window.ManagedMediaSource]) {
        if (MS) wrap(MS, 'isTypeSupported', (t, self, args) => (refuse(args[0]) ? false : Reflect.apply(t, self, args)));
      }
      wrap(HTMLMediaElement.prototype, 'canPlayType', (t, self, args) => (refuse(args[0]) ? '' : Reflect.apply(t, self, args)));
      if (navigator.mediaCapabilities) {
        wrap(Object.getPrototypeOf(navigator.mediaCapabilities), 'decodingInfo', (t, self, args) => {
          const type = args[0] && args[0].video && args[0].video.contentType;
          return refuse(type) ? Promise.resolve({ supported: false, smooth: false, powerEfficient: false }) : Reflect.apply(t, self, args);
        });
      }
    }
  }

  try {
    contextBridge.executeInMainWorld({ func: pageScript, args: [cfg] });
  } catch {
    webFrame.executeJavaScript(`(${pageScript.toString()})(${JSON.stringify(cfg)})`).catch(() => {});
  }
}
