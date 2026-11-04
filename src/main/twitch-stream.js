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
  const res = await net.fetch('https://gql.twitch.tv/gql', { method: 'POST', headers, body: JSON.stringify(body) });
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
  const res = await net.fetch(url, { cache: 'no-store' });
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

async function backupMediaPlaylist(login, state, currentUrl) {
  const target = state.variants.get(currentUrl) || { res: '', bw: 0 };
  for (const type of BACKUP_PLAYER_TYPES) {
    try {
      let b = state.backups.get(type);
      if (!b || Date.now() - b.at > 5 * 60 * 1000) {
        const tok = await accessToken(login, type, type !== 'autoplay');
        const m = await fetchText(usherUrl(login, tok));
        if (m.status !== 200) continue;
        b = { variants: parseMaster(m.text), at: Date.now() };
        state.backups.set(type, b);
      }
      const v = closestVariant(b.variants, target);
      if (!v) continue;
      const media = await fetchText(v.url);
      if (media.status === 200 && !media.text.includes(AD_SIGNIFIER)) return media.text;
    } catch {}
  }
  return null;
}

function stateFor(login) {
  let s = channels.get(login);
  if (!s) { s = { variants: new Map(), backups: new Map(), inAd: false }; channels.set(login, s); }
  return s;
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
    for (const v of parseMaster(m.text)) state.variants.set(v.url, v);
    return { master: m.text };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('twitch:stream-playlist', async (_e, login, url) => {
  login = String(login).toLowerCase();
  if (!/^https:\/\/[\w.-]+\.(ttvnw\.net|twitch\.tv|cloudfront\.net|live-video\.net)\//.test(url)) return { error: 'blocked url' };
  const state = stateFor(login);
  try {
    const r = await fetchText(url);
    if (r.status !== 200) return { status: r.status };
    if (!r.text.includes(AD_SIGNIFIER)) {
      state.inAd = false;
      return { text: r.text };
    }
    state.inAd = true;
    const backup = await backupMediaPlaylist(login, state, url);
    if (backup) return { text: backup, ad: 'swapped' };
    return { text: stripAds(r.text).text, ad: 'stripped' };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.on('twitch:stream-forget', (_e, login) => channels.delete(String(login).toLowerCase()));

module.exports = { stripAds, parseMaster };
