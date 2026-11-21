// Kick playback lookup, Twitch channel points, and the pop-out mini player.
const { ipcMain, session, BrowserWindow, screen } = require('electron');
const path = require('path');
const settings = require('./settings');

// ---- Kick: get the stream's playback URL for the lightweight player -------
ipcMain.handle('kick:playback', async (_e, slug) => {
  slug = String(slug || '').toLowerCase();
  if (!/^[\w-]{1,40}$/.test(slug)) return { error: 'bad channel name' };
  try {
    const res = await session.fromPartition('persist:kick').fetch(`https://kick.com/api/v2/channels/${slug}`, {
      headers: { Accept: 'application/json' }
    });
    if (res.status === 404) return { error: 'channel not found' };
    if (!res.ok) return { error: 'Kick returned HTTP ' + res.status };
    const j = await res.json();
    if (!j.livestream || j.livestream.is_live === false) return { offline: true };
    if (!j.playback_url) return { error: 'no playback URL' };
    return {
      url: j.playback_url,
      title: j.livestream.session_title || '',
      viewers: j.livestream.viewer_count || 0,
      game: j.livestream.categories?.[0]?.name || '',
      startedAt: j.livestream.created_at || j.livestream.start_time || null
    };
  } catch (e) {
    return { error: e.message };
  }
});

// ---- Kick: who you follow that's live (signed in on the Kick tab) ----------
// Kick's site sends its sign-in cookie as a "Bearer" token to its own API;
// Prism does the same with the Kick tab's cookies. If Kick's bot protection
// turns a direct request away, the request is made from a hidden Kick page.
const KICK = 'persist:kick';
async function kickToken() {
  const ses = session.fromPartition(KICK);
  const c = (await ses.cookies.get({ url: 'https://kick.com', name: 'session_token' }))[0];
  return c ? decodeURIComponent(c.value) : null;
}
function packKick(list) {
  const out = [];
  for (const c of list || []) {
    const ls = c.livestream || c.current_livestream || {};
    const live = c.is_live ?? ls.is_live ?? !!c.livestream;
    if (!live) continue;
    const slug = String(c.channel_slug || c.slug || c.channel?.slug || '').toLowerCase();
    if (!slug) continue;
    out.push({
      platform: 'kick', login: slug, id: slug,
      name: c.user_username || c.username || c.user?.username || c.channel?.user?.username || slug,
      avatar: c.profile_picture || c.user?.profile_pic || c.user?.profilepic || c.channel?.user?.profile_pic || '',
      viewers: c.viewer_count ?? ls.viewer_count ?? ls.viewers ?? 0,
      title: c.session_title || ls.session_title || '',
      game: c.category_name || ls.categories?.[0]?.name || c.categories?.[0]?.name || ''
    });
  }
  return out;
}
let kickPage = null;
async function kickFetchInPage(url, token) {
  // A hidden kick.com page, so the request carries what Kick's site would.
  if (!kickPage || kickPage.isDestroyed()) {
    kickPage = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { partition: KICK, sandbox: true, contextIsolation: true, backgroundThrottling: true } });
    await kickPage.loadURL('https://kick.com/robots.txt').catch(() => {});
    setTimeout(() => { if (kickPage && !kickPage.isDestroyed()) kickPage.destroy(); kickPage = null; }, 5 * 60 * 1000);
  }
  return kickPage.webContents.executeJavaScript(`fetch(${JSON.stringify(url)}, { credentials: 'include', headers: { Accept: 'application/json', Authorization: 'Bearer ' + ${JSON.stringify(token)} } })
    .then(async (r) => ({ status: r.status, text: await r.text() })).catch((e) => ({ status: 0, text: String(e) }))`);
}
async function kickGet(url, token) {
  try {
    const res = await session.fromPartition(KICK).fetch(url, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
    const text = await res.text();
    if (res.ok && /^\s*[{[]/.test(text)) return { status: res.status, json: JSON.parse(text) };
    if (res.status === 401) return { status: 401 };
  } catch {}
  const r = await kickFetchInPage(url, token);
  if (r.status >= 200 && r.status < 300 && /^\s*[{[]/.test(r.text)) return { status: r.status, json: JSON.parse(r.text) };
  return { status: r.status, error: r.status ? 'Kick returned HTTP ' + r.status : r.text };
}
ipcMain.handle('kick:following', async () => {
  try {
    const token = await kickToken();
    if (!token) return { signedIn: false, live: [] };
    const live = [];
    let cursor = 0;
    for (let page = 0; page < 10; page++) {
      const r = await kickGet(`https://kick.com/api/v2/channels/followed?cursor=${cursor}`, token);
      if (r.status === 401) return { signedIn: false, live: [] }; // signed out on Kick
      if (!r.json) return { signedIn: true, live, error: r.error };
      const list = r.json.channels || r.json.data || (Array.isArray(r.json) ? r.json : []);
      const got = packKick(list);
      live.push(...got);
      const next = r.json.nextCursor ?? r.json.next_cursor;
      // Live channels come first; stop at the first page with nobody live.
      if (!next || !list.length || !got.length) break;
      cursor = next;
    }
    return { signedIn: true, live };
  } catch (e) {
    return { signedIn: true, live: [], error: e.message };
  }
});

// (Channel points moved to twitch-points.js.)

// ---- Pop-out mini player ----------------------------------------------------
const minis = new Map(); // key -> BrowserWindow

function openMini(stream, send) {
  const key = stream.platform + ':' + stream.id;
  if (minis.has(key)) { minis.get(key).focus(); return; }
  const area = screen.getPrimaryDisplay().workArea;
  const saved = settings.get().miniBounds;
  const w = saved?.width || 480, hgt = saved?.height || 270;
  const win = new BrowserWindow({
    width: w, height: hgt,
    x: saved?.x ?? area.x + area.width - w - 24 - minis.size * 30,
    y: saved?.y ?? area.y + area.height - hgt - 24 - minis.size * 30,
    minWidth: 240, minHeight: 135,
    frame: false, alwaysOnTop: true, skipTaskbar: false, backgroundColor: '#000000',
    title: `${stream.label || stream.id} · Prism`,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true, backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setAspectRatio(16 / 9);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'mini.html'), { query: { s: JSON.stringify(stream) } });
  const remember = () => { if (!win.isDestroyed()) settings.set({ miniBounds: win.getBounds() }); };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('closed', () => { minis.delete(key); send('mini:closed', key); });
  minis.set(key, win);
}

function init({ send }) {
  ipcMain.handle('mini:open', (_e, stream) => openMini(stream, send));
  ipcMain.handle('mini:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle('mini:return', (e, key) => { send('mini:return', key); BrowserWindow.fromWebContents(e.sender)?.close(); });
}

module.exports = { init };
