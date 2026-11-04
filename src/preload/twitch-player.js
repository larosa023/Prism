// Loaded only into Twitch player tiles when "Skip Twitch ads" is on.
// Twitch stitches ads into the video playlist itself, so normal filter lists
// can't remove them. This patches the player's video worker so ad segments
// are dropped from each playlist before the player sees them.
const { webFrame } = require('electron');

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

webFrame.executeJavaScript(PAGE_SCRIPT).catch(() => {});
