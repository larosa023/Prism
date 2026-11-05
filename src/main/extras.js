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

// ---- Twitch channel points --------------------------------------------------
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
let claimBlocked = false; // Twitch refused automatic claims (it can require a browser check)

async function twitchGql(query, variables) {
  const ses = session.fromPartition('persist:twitch');
  const [tok] = await ses.cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' }).catch(() => []);
  if (!tok) return { signedIn: false };
  const res = await ses.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-Id': CLIENT_ID, Authorization: 'OAuth ' + tok.value, 'Content-Type': 'text/plain' },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json().catch(() => ({}));
  return { signedIn: true, data: json.data, errors: json.errors };
}

ipcMain.handle('twitch:points', async (_e, login) => {
  try {
    const r = await twitchGql(`query($login: String!) { channel(name: $login) { id
      self { communityPoints { balance availableClaim { id } } } } }`, { login: String(login).toLowerCase() });
    if (!r.signedIn) return { signedIn: false };
    const ch = r.data?.channel;
    const cp = ch?.self?.communityPoints;
    if (!ch || !cp) return { signedIn: true, unavailable: true };
    return { signedIn: true, channelId: ch.id, balance: cp.balance, claimId: cp.availableClaim?.id || null, claimBlocked };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('twitch:points-claim', async (_e, channelId, claimId) => {
  if (claimBlocked) return { blocked: true };
  try {
    const r = await twitchGql(`mutation($input: ClaimCommunityPointsInput!) {
      claimCommunityPoints(input: $input) { currentPoints error { code } } }`, { input: { channelID: channelId, claimID: claimId } });
    const out = r.data?.claimCommunityPoints;
    if (out && !out.error) return { ok: true, balance: out.currentPoints };
    const msg = JSON.stringify(r.errors || out?.error || '');
    if (/integrity|failed integrity|unauthorized|forbidden/i.test(msg)) claimBlocked = true;
    return { ok: false, blocked: claimBlocked, error: msg.slice(0, 120) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

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
