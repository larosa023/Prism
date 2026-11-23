// Backend for Prism's lightweight Twitch player.
// Instead of loading player.twitch.tv (a whole web app per stream), Prism asks
// Twitch for the stream's playlist directly and plays it with hls.js inside
// the main window. Playlists pass through here so ads can be handled the same
// way TwitchAdSolutions does it: when Twitch stitches in an ad, switch to a
// backup playlist that has none, or drop the ad segments as a last resort.
const { ipcMain, net, session } = require('electron');
const crypto = require('crypto');

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
const MAIN_PLAYER_TYPE = 'popout';
const BACKUP_PLAYER_TYPES = ['autoplay', 'picture-by-picture', 'embed'];
const AD_SIGNIFIER = 'stitched-ad';
const LIVE_SIGNIFIER = ',live';

const deviceId = crypto.randomBytes(16).toString('hex');
const channels = new Map(); // login -> { variants: Map(url -> {res, bw}), backups: Map(type -> {master, at}), inAd }

const twitchSession = () => session.fromPartition('persist:twitch');

async function authToken() {
  const [c] = await twitchSession().cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' }).catch(() => []);
  return c ? c.value : null;
}

async function accessToken(login, playerType, withAuth = true) {
  const headers = { 'Client-Id': CLIENT_ID, 'X-Device-Id': deviceId, 'Content-Type': 'text/plain' };
  const auth = withAuth ? await authToken() : null;
  if (auth) headers.Authorization = 'OAuth ' + auth; // signed in: subs and Turbo stay ad-free
  const body = {
    operationName: 'PlaybackAccessToken',
    variables: { isLive: true, login, isVod: false, vodID: '', playerType, platform: playerType === 'autoplay' ? 'android' : 'web' },
    extensions: { persistedQuery: { version: 1, sha256Hash: TOKEN_HASH } }
  };
  const res = await net.fetch('https://gql.twitch.tv/gql', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const json = await res.json().catch(() => null);
  const tok = json?.data?.streamPlaybackAccessToken;
  if (!tok && auth) return accessToken(login, playerType, false); // sign-in rejected: try without it
  if (!tok) throw new Error('Twitch did not return a stream token');
  return tok;
}

function usherUrl(login, tok) {
  const u = new URL(`https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(login)}.m3u8`);
  const p = u.searchParams;
  p.set('allow_source', 'true');
  p.set('allow_audio_only', 'true');
  p.set('fast_bread', 'true');
  p.set('player_backend', 'mediaplayer');
  p.set('playlist_include_framerate', 'true');
  p.set('reassignments_supported', 'true');
  p.set('supported_codecs', 'h264');
  p.set('cdm', 'wv');
  p.set('p', String(Math.floor(Math.random() * 1e7)));
  p.set('sig', tok.signature);
  p.set('token', tok.value);
  return u.toString();
}

// Parse a master playlist into [{ url, res, bw, name }].
function parseMaster(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const res = (lines[i].match(/RESOLUTION=(\d+x\d+)/) || [])[1] || '';
    const bw = Number((lines[i].match(/BANDWIDTH=(\d+)/) || [])[1] || 0);
    const url = (lines[i + 1] || '').trim();
    if (url && !url.startsWith('#')) out.push({ url, res, bw });
  }
  return out;
}

function closestVariant(variants, target) {
  if (!variants.length) return null;
  const [tw, th] = (target.res || '0x0').split('x').map(Number);
  let best = variants[0], score = Infinity;
  for (const v of variants) {
    const [w, h] = (v.res || '0x0').split('x').map(Number);
    const s = Math.abs(w * h - tw * th) + Math.abs(v.bw - target.bw) / 1000;
    if (s < score) { score = s; best = v; }
  }
  return best;
}

async function fetchText(url) {
  // A request that never finishes would freeze the stream, so give up after
  // 10 seconds and let the player ask again.
  const res = await net.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  return { status: res.status, text: res.status === 200 ? await res.text() : '' };
}

// Remove ad segments: each segment is its tag lines plus the URI line.
function stripAds(text) {
  const lines = text.split('\n');
  const out = [];
  let block = [];
  let segIsAd = false;
  let removed = 0;
  let headerDone = false;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-DATERANGE') && line.includes(AD_SIGNIFIER)) continue;
    if (line.startsWith('#EXT-X-TWITCH-PREFETCH')) continue;
    if (!headerDone && !line.startsWith('#EXT-X-PROGRAM-DATE-TIME') && !line.startsWith('#EXTINF')) { out.push(line); continue; }
    headerDone = true;
    if (line.startsWith('#EXTINF')) segIsAd = !line.includes(LIVE_SIGNIFIER);
    block.push(line);
    if (line && !line.startsWith('#')) {
      if (segIsAd) removed++;
      else out.push(...block);
      block = [];
      segIsAd = false;
    }
  }
  out.push(...block);
  return { text: out.join('\n'), removed };
}

// The ad-free backup streams' lists of qualities, kept ready so an ad break
// doesn't have to wait for them (each takes a Twitch pass plus a request).
async function backupMaster(login, state, type) {
  let b = state.backups.get(type);
  if (b && Date.now() - b.at < 4 * 60 * 1000) return b;
  if (b?.pending) return b.pending;
  const pending = (async () => {
    try {
      const tok = await accessToken(login, type, type !== 'autoplay');
      const m = await fetchText(usherUrl(login, tok));
      if (m.status !== 200) return null;
      const fresh = { variants: parseMaster(m.text), at: Date.now() };
      state.backups.set(type, fresh);
      return fresh;
    } catch { return null; } finally { if (state.backups.get(type)?.pending) state.backups.delete(type); }
  })();
  state.backups.set(type, { ...(b || {}), pending, at: b?.at || 0 });
  return pending;
}
function prewarmBackups(login, state) {
  for (const type of BACKUP_PLAYER_TYPES) backupMaster(login, state, type).catch(() => {});
}

// Ask every backup at once and take the first ad-free one (in order of
// preference), instead of trying them one after another.
async function backupMediaPlaylist(login, state, currentUrl) {
  const target = state.variants.get(currentUrl) || { res: '', bw: 0 };
  const tries = BACKUP_PLAYER_TYPES.map(async (type) => {
    const b = await backupMaster(login, state, type);
    const v = b?.variants && closestVariant(b.variants, target);
    if (!v) return null;
    const media = await fetchText(v.url);
    return media.status === 200 && !media.text.includes(AD_SIGNIFIER) ? { type, text: media.text } : null;
  });
  for (const t of tries) {
    const r = await t.catch(() => null);
    if (r) return r;
  }
  return null;
}

// ---- One smooth stream out of two ------------------------------------------
// During an ad break the player is fed a different copy of the stream (the
// ad-free backup), whose segments are numbered differently and start a few
// seconds in the past. Fed in raw, that made the player stall for ~10 s. So
// every segment the player sees gets Prism's own running number, video
// already shown (by its timestamp) is skipped, and a "discontinuity" marks
// each switch so the player carries on without a hitch.
// Twitch lists the next one or two segments before they're finished
// ("#EXT-X-TWITCH-PREFETCH"); twitch.tv starts fetching them early, which is
// how it stays ~2 s closer to live. With low latency on, Prism lists them as
// ordinary segments, marked so the player knows to wait for them (the
// segment loader retries a "not ready yet") and replaced by the finished
// segment's own entry once Twitch lists it.
const PREFETCH_MARK = '#prism-prefetch';
function parsePlaylist(text, withPrefetch) {
  const lines = text.split('\n');
  const header = [];
  const segs = [];
  let tags = [];
  let started = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith('#EXT-X-TWITCH-PREFETCH:')) {
      const last = segs[segs.length - 1];
      if (!withPrefetch || !last) continue;
      const url = line.slice('#EXT-X-TWITCH-PREFETCH:'.length).trim();
      const pdt = last.pdt ? last.pdt + last.dur * 1000 : 0;
      segs.push({ uri: url + PREFETCH_MARK, key: url, prefetch: true, dur: last.dur, pdt, ad: false,
        tags: [...(pdt ? [`#EXT-X-PROGRAM-DATE-TIME:${new Date(pdt).toISOString()}`] : []), `#EXTINF:${last.dur.toFixed(3)},live`] });
      continue;
    }
    if (/^#EXT-X-(MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE|DISCONTINUITY$|ENDLIST)/.test(line)) continue;
    if (line.startsWith('#EXT-X-DATERANGE') && line.includes(AD_SIGNIFIER)) continue;
    if (!started && !line.startsWith('#EXTINF') && !line.startsWith('#EXT-X-PROGRAM-DATE-TIME')) { header.push(line); continue; }
    started = true;
    if (!line.startsWith('#')) {
      const inf = tags.find((t) => t.startsWith('#EXTINF')) || '';
      const pdtTag = tags.find((t) => t.startsWith('#EXT-X-PROGRAM-DATE-TIME:'));
      segs.push({ uri: line, key: line, tags, dur: parseFloat(inf.slice(8)) || 2, pdt: pdtTag ? Date.parse(pdtTag.slice(25)) || 0 : 0, ad: !inf.includes(LIVE_SIGNIFIER) });
      tags = [];
    } else tags.push(line);
  }
  return { header, segs };
}
function splice(lvl, text, src, withPrefetch) {
  const { header, segs } = parsePlaylist(text, withPrefetch && !text.includes(AD_SIGNIFIER));
  for (const sg of segs) {
    if (sg.ad) continue;
    if (lvl.seqOf.has(sg.key)) {
      // A segment listed early is now finished: take Twitch's details for it
      // (real length and time), but keep the address the player already
      // knows (a changed address for the same segment makes it give up).
      if (!sg.prefetch) {
        const e = lvl.segs.find((x) => x.key === sg.key);
        if (e?.prefetch) { e.prefetch = false; e.tags = sg.tags; }
      }
      continue;
    }
    // Already played this moment (from the other copy of the stream)?
    if (sg.pdt && lvl.lastPdt && sg.pdt <= lvl.lastPdt + 250) continue;
    const seq = lvl.next++;
    lvl.seqOf.set(sg.key, seq);
    if (lvl.src && lvl.src !== src) lvl.disc.push(seq);
    lvl.src = src;
    if (sg.pdt) lvl.lastPdt = sg.pdt;
    lvl.segs.push({ seq, key: sg.key, uri: sg.uri, tags: sg.tags, prefetch: !!sg.prefetch });
  }
  // Keep the newest ~30 s worth, and forget older numbers.
  while (lvl.segs.length > 15) lvl.seqOf.delete(lvl.segs.shift().key);
  const win = lvl.segs.slice(-8);
  if (!win.length) return text;
  const first = win[0].seq;
  const discBefore = lvl.disc.filter((d) => d < first).length;
  // Twitch says segments can be 6 s though they're 2 s; the player uses this
  // to pace playlist checks and how much extra delay a hiccup adds, so give
  // it the real length.
  const longest = Math.max(1, ...win.map((sg) => parseFloat((sg.tags.find((t) => t.startsWith('#EXTINF')) || '').slice(8)) || 2));
  const head = header.filter((l) => l !== '#EXTM3U').map((l) => (l.startsWith('#EXT-X-TARGETDURATION:') ? `#EXT-X-TARGETDURATION:${Math.ceil(longest)}` : l));
  const out = [...head, `#EXT-X-MEDIA-SEQUENCE:${first}`, `#EXT-X-DISCONTINUITY-SEQUENCE:${discBefore}`];
  for (const sg of win) {
    if (lvl.disc.includes(sg.seq)) out.push('#EXT-X-DISCONTINUITY');
    out.push(...sg.tags, sg.uri);
  }
  return '#EXTM3U\n' + out.join('\n') + '\n';
}
function levelState(state, url) {
  let lvl = state.levels.get(url);
  if (!lvl) { lvl = { seqOf: new Map(), segs: [], disc: [], next: 1, lastPdt: 0, src: null }; state.levels.set(url, lvl); }
  return lvl;
}

function stateFor(login) {
  let s = channels.get(login);
  if (!s) { s = { variants: new Map(), backups: new Map(), levels: new Map(), inAd: false, recent: [], seen: new Set() }; channels.set(login, s); }
  return s;
}

// Remember the last ~2 minutes of video segments the player was given, for clips.
const KEEP_SECONDS = 130;
function rememberSegments(state, text) {
  let dur = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('#EXTINF')) dur = parseFloat(line.slice(8)) || 2;
    else if (line && !line.startsWith('#')) {
      const uri = line.trim();
      if (!state.seen.has(uri)) {
        state.seen.add(uri);
        state.recent.push({ uri, dur, at: Date.now() });
      }
      dur = 0;
    }
  }
  let total = state.recent.reduce((a, x) => a + x.dur, 0);
  while (total > KEEP_SECONDS && state.recent.length) {
    const x = state.recent.shift();
    state.seen.delete(x.uri);
    total -= x.dur;
  }
}

ipcMain.handle('twitch:stream-master', async (_e, login) => {
  login = String(login).toLowerCase();
  try {
    const tok = await accessToken(login, MAIN_PLAYER_TYPE);
    const m = await fetchText(usherUrl(login, tok));
    if (m.status === 404 || m.status === 403) return { offline: true };
    if (m.status !== 200) return { error: 'HTTP ' + m.status };
    const state = stateFor(login);
    state.variants.clear();
    state.backups.clear();
    state.levels.clear();
    for (const v of parseMaster(m.text)) state.variants.set(v.url, v);
    // Get the ad-free backups ready now, so an ad break doesn't wait on them.
    setTimeout(() => prewarmBackups(login, state), 3000);
    return { master: m.text };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('twitch:stream-playlist', async (_e, login, url, opts) => {
  const prefetch = !!opts?.prefetch;
  login = String(login).toLowerCase();
  if (!/^https:\/\/[\w.-]+\.(ttvnw\.net|twitch\.tv|cloudfront\.net|live-video\.net)\//.test(url)) return { error: 'blocked url' };
  const state = stateFor(login);
  try {
    const r = await fetchText(url);
    if (r.status !== 200) return { status: r.status };
    const lvl = levelState(state, url);
    if (!r.text.includes(AD_SIGNIFIER)) {
      const adEnded = state.inAd;
      state.inAd = false;
      rememberSegments(state, r.text);
      // Keep the backups fresh for the next ad break.
      if (BACKUP_PLAYER_TYPES.some((t) => Date.now() - (state.backups.get(t)?.at || 0) > 4 * 60 * 1000)) prewarmBackups(login, state);
      const text = splice(lvl, r.text, 'main', prefetch);
      return adEnded ? { text, adEnded: true } : { text };
    }
    state.inAd = true;
    const backup = await backupMediaPlaylist(login, state, url);
    if (backup) { rememberSegments(state, backup.text); return { text: splice(lvl, backup.text, 'backup:' + backup.type, prefetch), ad: 'swapped' }; }
    // No backup without ads: drop the ad segments (the picture waits).
    const text = splice(lvl, r.text, 'main');
    return { text, ad: 'stripped' };
  } catch (e) {
    return { error: e.message };
  }
});

// Save the last N seconds of a stream as a video file (MPEG-TS, plays in
// Windows Media Player, VLC and most editors).
ipcMain.handle('twitch:clip', async (_e, login, seconds) => {
  const { app } = require('electron');
  const fs = require('fs');
  const path = require('path');
  login = String(login).toLowerCase();
  const state = channels.get(login);
  if (!state || !state.recent.length) return { error: "Nothing to clip yet. Let the stream play for a bit first." };
  const want = Math.max(10, Math.min(120, Number(seconds) || 60));
  const picked = [];
  let total = 0;
  for (let i = state.recent.length - 1; i >= 0 && total < want; i--) { picked.unshift(state.recent[i]); total += state.recent[i].dur; }
  const dir = path.join(app.getPath('videos'), 'Prism Clips');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(dir, `${login} ${stamp}.ts`);
  const out = fs.createWriteStream(file);
  let saved = 0;
  try {
    for (const seg of picked) {
      const res = await net.fetch(seg.uri);
      if (!res.ok) continue; // a segment that's no longer available is skipped
      out.write(Buffer.from(await res.arrayBuffer()));
      saved += seg.dur;
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (!saved) { try { fs.unlinkSync(file); } catch {} return { error: "Twitch didn't hand back the video for that clip." }; }
  return { file, seconds: Math.round(saved) };
});
ipcMain.handle('clip:show', (_e, file) => require('electron').shell.showItemInFolder(file));
ipcMain.handle('clip:folder', () => {
  const { app, shell } = require('electron');
  const dir = require('path').join(app.getPath('videos'), 'Prism Clips');
  require('fs').mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.on('twitch:stream-forget', (_e, login) => channels.delete(String(login).toLowerCase()));

module.exports = { stripAds, parseMaster };
