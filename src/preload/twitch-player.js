// Loaded into every Twitch page and player in Prism. Twitch stitches ads into
// the video itself, so filter lists alone can't remove them.
//   'tas'     -> runs the TwitchAdSolutions script (video-swap-new by default),
//                exactly like uBlock Origin's twitch.tv##+js(twitch-videoad)
//   'builtin' -> Prism's simple version: drops ad segments from the playlist
//   'off'     -> nothing
const { webFrame, ipcRenderer } = require('electron');

const PAGE_SCRIPT = `(() => {
  if (window.__prismAdSkip) return;
  window.__prismAdSkip = true;

  const WORKER_HOOK = \`
    const realFetch = self.fetch;
    const AD_MARKERS = ['stitched-ad', 'twitch-stitched-ad', 'X-TV-TWITCH-AD', 'twitch-ad-quartile'];
    const hasAd = (t) => AD_MARKERS.some((m) => t.includes(m));

    function strip(text) {
      const lines = text.split('\\\\n');
      const out = [];
      let dropNextUri = false;
      for (const line of lines) {
        if (line.startsWith('#EXTINF')) {
          // Live segments are titled "live"; ad segments are not.
          if (!line.includes(',live')) { dropNextUri = true; continue; }
        } else if (dropNextUri && line && !line.startsWith('#')) {
          dropNextUri = false;
          continue;
        }
        if (line.startsWith('#EXT-X-DATERANGE') && hasAd(line)) continue;
        if (line.startsWith('#EXT-X-TWITCH-PREFETCH')) continue; // prefetch can carry ads during a break
        out.push(line);
      }
      return out.join('\\\\n');
    }

    self.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const res = await realFetch.call(this, input, init);
      if (!url.includes('.m3u8') || !/ttvnw\\\\.net|twitch\\\\.tv/.test(url)) return res;
      let text;
      try { text = await res.clone().text(); } catch { return res; }
      if (!hasAd(text)) return res;
      const headers = new Headers(res.headers);
      headers.delete('content-length');
      try { self.postMessage({ __prism: 'ad-blocked' }); } catch {}
      return new Response(strip(text), { status: res.status, statusText: res.statusText, headers });
    };
  \`;

  const RealWorker = window.Worker;
  window.Worker = class extends RealWorker {
    constructor(url, options) {
      const src = String(url);
      if (options && options.type === 'module') { super(url, options); return; }
      const absolute = new URL(src, location.href).href;
      const blob = new Blob([WORKER_HOOK + '\\nimportScripts(' + JSON.stringify(absolute) + ');'], { type: 'application/javascript' });
      super(URL.createObjectURL(blob), options);
      this.addEventListener('message', (e) => {
        if (e.data && e.data.__prism === 'ad-blocked') e.stopImmediatePropagation();
      });
    }
  };
})();`;

if (/(^|\.)twitch\.tv$/.test(location.hostname)) {
  let cfg = { method: 'off', code: '' };
  try { cfg = ipcRenderer.sendSync('twitch:adscript-sync'); } catch {}
  if (location.hostname === 'www.twitch.tv' && cfg.previews && cfg.previews !== 'off') setupPreviews(cfg.previews);
  if (cfg.method === 'tas' && cfg.code) webFrame.executeJavaScript(cfg.code).catch(() => {});
  else if (cfg.method === 'builtin' || (cfg.method === 'tas' && !cfg.code)) webFrame.executeJavaScript(PAGE_SCRIPT).catch(() => {});
}

// ---------------------------------------------------------------------------
// Sidebar previews: hover a live channel in Twitch's left sidebar to see it.
// ---------------------------------------------------------------------------
function setupPreviews(mode) {
  const W = 440, H = 248;
  let box = null, timer = null, current = null;

  const style = `position:fixed;z-index:99999;width:${W}px;height:${H}px;border-radius:8px;overflow:hidden;
    background:#000 center/cover no-repeat;box-shadow:0 10px 30px rgba(0,0,0,.6);border:1px solid #3a3a48;pointer-events:none;`;

  function loginFrom(a) {
    const nav = a.closest('#side-nav, [data-a-target="side-nav-bar"], [data-a-target="side-nav-bar-collapsed"], .side-nav, .side-bar-contents');
    if (!nav) return null;
    const parts = new URL(a.href, location.href).pathname.split('/').filter(Boolean);
    if (parts.length !== 1 || !/^\w{2,25}$/.test(parts[0])) return null;
    // Skip offline channels.
    const card = a.closest('.side-nav-card, [class*="side-nav-card"]') || a;
    if (/\boffline\b/i.test(card.textContent || '')) return null;
    return parts[0].toLowerCase();
  }

  function show(a, login) {
    hide();
    current = login;
    const r = a.getBoundingClientRect();
    box = document.createElement('div');
    box.setAttribute('style', style);
    box.style.left = Math.min(r.right + 10, window.innerWidth - W - 10) + 'px';
    box.style.top = Math.max(10, Math.min(r.top + r.height / 2 - H / 2, window.innerHeight - H - 10)) + 'px';
    box.style.backgroundImage = `url("https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-${W}x${H}.jpg?t=${Date.now() / 60000 | 0}")`;
    document.documentElement.appendChild(box);
    if (mode === 'video') {
      timer = setTimeout(() => {
        if (!box || current !== login) return;
        const f = document.createElement('iframe');
        f.src = `https://player.twitch.tv/?channel=${login}&parent=twitch.tv&muted=true&autoplay=true&controls=false`;
        f.setAttribute('style', 'width:100%;height:100%;border:0;');
        f.allow = 'autoplay';
        box.appendChild(f);
      }, 450);
    }
  }

  function hide() {
    clearTimeout(timer);
    current = null;
    if (box) { box.remove(); box = null; }
  }

  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) { if (box) hide(); return; }
    const login = loginFrom(a);
    if (!login) { if (box) hide(); return; }
    if (login !== current) show(a, login);
  }, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  document.addEventListener('click', hide, true);
}
