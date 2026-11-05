// Who's live on Twitch: your follows (sidebar, Following panel, go-live
// alerts) and stream info for tiles (title, game, viewers, uptime).
// Runs in the main process so alerts keep working while Prism is minimized.
const { ipcMain, net, session, Notification, nativeImage } = require('electron');
const path = require('path');
const settings = require('./settings');

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const twitchSession = () => session.fromPartition('persist:twitch');

async function authToken() {
  const [c] = await twitchSession().cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' }).catch(() => []);
  return c ? c.value : null;
}

async function gql(query, variables, withAuth) {
  const headers = { 'Client-Id': CLIENT_ID, 'Content-Type': 'text/plain' };
  if (withAuth) {
    const t = await authToken();
    if (!t) return { signedIn: false, data: null };
    headers.Authorization = 'OAuth ' + t;
  }
  const res = await twitchSession().fetch('https://gql.twitch.tv/gql', { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const json = await res.json();
  return { signedIn: true, data: json?.data || null };
}

const STREAM_FIELDS = 'title viewersCount createdAt game { displayName }';

async function fetchFollowing() {
  try {
    const r = await gql(`query { currentUser { followedLiveUsers(first: 100) { nodes {
      login displayName profileImageURL(width: 70) stream { ${STREAM_FIELDS} } } } } }`, {}, true);
    if (!r.signedIn) return { signedIn: false, live: [] };
    const nodes = r.data?.currentUser?.followedLiveUsers?.nodes || [];
    const live = nodes.filter((n) => n && n.stream).map((n) => ({
      login: n.login.toLowerCase(),
      name: n.displayName,
      avatar: n.profileImageURL,
      title: n.stream.title,
      viewers: n.stream.viewersCount,
      game: n.stream.game?.displayName || '',
      startedAt: n.stream.createdAt
    })).sort((a, b) => b.viewers - a.viewers);
    return { signedIn: true, live };
  } catch (e) {
    return { signedIn: true, live: [], error: e.message };
  }
}

async function streamInfo(logins) {
  logins = [...new Set((logins || []).map((l) => String(l).toLowerCase()).filter((l) => /^\w{2,25}$/.test(l)))].slice(0, 50);
  if (!logins.length) return {};
  try {
    const r = await gql(`query($logins: [String!]) { users(logins: $logins) {
      login displayName profileImageURL(width: 70) stream { ${STREAM_FIELDS} } } }`, { logins }, false);
    const out = {};
    for (const u of r.data?.users || []) {
      if (!u) continue;
      out[u.login.toLowerCase()] = {
        name: u.displayName,
        avatar: u.profileImageURL,
        live: !!u.stream,
        title: u.stream?.title || '',
        viewers: u.stream?.viewersCount || 0,
        game: u.stream?.game?.displayName || '',
        startedAt: u.stream?.createdAt || null
      };
    }
    return out;
  } catch {
    return {};
  }
}

// ---- Go-live alerts -------------------------------------------------------
let known = null;        // logins live at the last check (null = not checked yet)
let pollTimer = null;
let ctx = { send: () => {}, focus: () => {} };
const appIcon = () => nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'icon.png'));

async function avatarImage(url) {
  try {
    const res = await net.fetch(url);
    return nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
  } catch { return appIcon(); }
}

async function poll() {
  const s = settings.get();
  const r = await fetchFollowing();
  if (!r.signedIn || r.error) return;
  ctx.send('twitch:following-update', r);
  const now = new Set(r.live.map((c) => c.login));
  if (known) {
    const autoAdd = new Set((s.autoAddChannels || []).map((l) => l.toLowerCase()));
    for (const c of r.live) {
      if (known.has(c.login)) continue;
      const auto = autoAdd.has(c.login);
      if (auto) ctx.send('stream:add', { platform: 'twitch', id: c.login, label: c.name, auto: true });
      if (!s.liveAlerts && !auto) continue;
      if (!Notification.isSupported()) continue;
      const n = new Notification({
        title: `${c.name} is live`,
        body: (c.game ? c.game + ' · ' : '') + (c.title || '') + (auto ? '\nAdded to multi-view' : '\nClick to watch in multi-view'),
        icon: c.avatar ? await avatarImage(c.avatar) : appIcon(),
        silent: !s.liveAlertSound
      });
      n.on('click', () => {
        ctx.focus();
        if (!auto) ctx.send('stream:add', { platform: 'twitch', id: c.login, label: c.name });
      });
      n.show();
    }
  }
  known = now;
}

function init(context) {
  ctx = context;
  ipcMain.handle('twitch:following', () => fetchFollowing());
  ipcMain.handle('twitch:stream-info', (_e, logins) => streamInfo(logins));
  // First check seeds the list quietly, so you don't get alerts for everyone
  // who was already live when Prism opened.
  setTimeout(poll, 8000);
  pollTimer = setInterval(poll, 90 * 1000);
}

module.exports = { init, fetchFollowing, streamInfo, pollNow: poll };
