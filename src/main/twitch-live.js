// Who's live on Twitch: your follows (sidebar, Following panel, go-live
// alerts) and stream info for tiles (title, game, viewers, uptime).
// Runs in the main process so alerts keep working while Prism is minimized.
const { ipcMain, net, session, Notification, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const settings = require('./settings');

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const twitchSession = () => session.fromPartition('persist:twitch');

async function authToken() {
  const [c] = await twitchSession().cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' }).catch(() => []);
  return c ? c.value : null;
}

// Twitch's own pages send a "Client-Integrity" header (a short-lived token
// from a browser check). Some account requests are refused without it, so
// Prism notes the one Twitch's pages use in your Twitch session and sends it
// along with its own requests.
let integrity = null; // { token, deviceId, sessionId, version, at }
const INTEGRITY_MAX_AGE = 10 * 60 * 60 * 1000;
function watchTwitchHeaders() {
  twitchSession().webRequest.onBeforeSendHeaders({ urls: ['*://gql.twitch.tv/*'] }, (d, cb) => {
    const hdr = {};
    for (const [k, v] of Object.entries(d.requestHeaders || {})) hdr[k.toLowerCase()] = v;
    if (hdr['client-integrity'] && !hdr['x-prism']) {
      integrity = { token: hdr['client-integrity'], deviceId: hdr['x-device-id'], sessionId: hdr['client-session-id'], version: hdr['client-version'], at: Date.now() };
    }
    cb({ requestHeaders: d.requestHeaders });
  });
}
const freshIntegrity = () => integrity && Date.now() - integrity.at < INTEGRITY_MAX_AGE ? integrity : null;

// If no Twitch page has run yet, briefly open twitch.tv in a hidden window so
// it produces one, then close it. At most once every 30 minutes.
let lastIntegrityTry = 0;
let integrityPending = null; // shared, so lookups running at the same time wait for the same one
function ensureIntegrity() {
  if (freshIntegrity()) return Promise.resolve(true);
  if (integrityPending) return integrityPending;
  if (Date.now() - lastIntegrityTry < 30 * 60 * 1000) return Promise.resolve(false);
  lastIntegrityTry = Date.now();
  integrityPending = (async () => {
    const w = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { partition: 'persist:twitch', sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    w.webContents.setAudioMuted(true);
    try {
      w.loadURL('https://www.twitch.tv/directory/following').catch(() => {});
      for (let i = 0; i < 50 && !freshIntegrity(); i++) await new Promise((r) => setTimeout(r, 500));
    } finally {
      if (!w.isDestroyed()) w.destroy();
      integrityPending = null;
    }
    return !!freshIntegrity();
  })();
  return integrityPending;
}

async function gql(query, variables, withAuth, useIntegrity) {
  const headers = { 'Client-Id': CLIENT_ID, 'Content-Type': 'text/plain', 'X-Prism': '1' };
  if (withAuth) {
    const t = await authToken();
    if (!t) return { signedIn: false, data: null };
    headers.Authorization = 'OAuth ' + t;
  }
  const integ = useIntegrity && freshIntegrity();
  if (integ) {
    headers['Client-Integrity'] = integ.token;
    if (integ.deviceId) headers['X-Device-Id'] = integ.deviceId;
    if (integ.sessionId) headers['Client-Session-Id'] = integ.sessionId;
    if (integ.version) headers['Client-Version'] = integ.version;
  }
  const res = await twitchSession().fetch('https://gql.twitch.tv/gql', { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const json = await res.json().catch(() => ({}));
  return { signedIn: true, status: res.status, data: json?.data || null, errors: json?.errors || (Array.isArray(json) ? null : json?.error ? [{ message: json.error + ': ' + (json.message || '') }] : null) };
}

async function myLogin() {
  const [c] = await twitchSession().cookies.get({ url: 'https://www.twitch.tv', name: 'login' }).catch(() => []);
  return c ? decodeURIComponent(c.value).toLowerCase() : null;
}

const STREAM_FIELDS = 'title viewersCount createdAt game { displayName }';
const toLive = (n) => ({
  login: n.login.toLowerCase(),
  name: n.displayName || n.login,
  avatar: n.profileImageURL,
  title: n.stream.title || '',
  viewers: n.stream.viewersCount || 0,
  game: n.stream.game?.displayName || '',
  startedAt: n.stream.createdAt || null
});
const errText = (r) => (r.errors || []).map((e) => e.message).filter(Boolean).join('; ') || (r.status && r.status !== 200 ? 'HTTP ' + r.status : '');

// Twitch's live-follows list, asked a few ways: if one is refused, the next
// is tried, ending with your whole follow list filtered to who's live.
// ---- Reading follows from twitch.tv itself ---------------------------------
// When Twitch refuses Prism's own requests, open your Following page in a
// hidden window (signed in, muted) and read the list Twitch sends that page,
// then close it. This works whenever twitch.tv itself works for you.
function collectLive(node, out, seen, flags) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) collectLive(x, out, seen, flags); return; }
  const add = (c) => {
    if (!c.login || seen.has(c.login.toLowerCase())) return;
    seen.add(c.login.toLowerCase());
    out.push(c);
  };
  if (node.followedLiveUsers) {
    flags.got = true;
    const f = node.followedLiveUsers;
    const nodes = f.nodes || (f.edges || []).map((e) => e && e.node);
    for (const n of nodes) if (n && n.login && n.stream) add(toLive(n));
  }
  if (Array.isArray(node.personalSections)) {
    for (const sec of node.personalSections) {
      if (!/FOLLOW/i.test(String(sec?.type || sec?.title?.key || ''))) continue;
      flags.got = true;
      for (const it of sec.items || []) {
        const u = it?.user, c = it?.content;
        if (!u?.login || !c || c.viewersCount == null) continue;
        add({
          login: u.login.toLowerCase(), name: u.displayName || u.login, avatar: u.profileImageURL || '',
          title: c.broadcaster?.broadcastSettings?.title || c.title || '', viewers: c.viewersCount || 0,
          game: c.game?.displayName || c.game?.name || '', startedAt: c.createdAt || null
        });
      }
    }
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectLive(v, out, seen, flags);
}

let sitePending = null;
let siteCache = null; // { at, live }
const FOLLOWS_PRELOAD = path.join(__dirname, '..', 'preload', 'twitch-follows.js');
function followingFromSite() {
  if (siteCache && Date.now() - siteCache.at < 3 * 60 * 1000) return Promise.resolve(siteCache.live);
  if (sitePending) return sitePending;
  sitePending = (async () => {
    const w = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
      partition: 'persist:twitch', preload: FOLLOWS_PRELOAD, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    w.webContents.setAudioMuted(true);
    const live = [], seen = new Set(), flags = { got: false };
    let settleTimer = null, done;
    const finished = new Promise((r) => (done = r));
    const onData = (e, text) => {
      if (e.sender !== w.webContents) return;
      try {
        const before = flags.got;
        collectLive(JSON.parse(text), live, seen, flags);
        // Once the list has arrived, wait a moment for the rest, then stop.
        if (flags.got && !before) settleTimer = setTimeout(done, 2500);
      } catch {}
    };
    ipcMain.on('twitch:follows-data', onData);
    try {
      w.loadURL('https://www.twitch.tv/directory/following/live').catch(() => {});
      await Promise.race([finished, new Promise((r) => setTimeout(r, 25000))]);
    } finally {
      ipcMain.removeListener('twitch:follows-data', onData);
      clearTimeout(settleTimer);
      if (!w.isDestroyed()) w.destroy();
      sitePending = null;
    }
    if (!flags.got) return null;
    live.sort((a, b) => b.viewers - a.viewers);
    siteCache = { at: Date.now(), live };
    return live;
  })();
  return sitePending;
}

let lastFollowError = '';
let directBlockedAt = 0; // when Twitch last refused all direct requests
let workingAttempt = 0; // remember which way worked, and try it first next time
async function fetchFollowing() {
  if (!(await authToken())) return { signedIn: false, live: [] };
  const login = await myLogin();
  const LIVE = `login displayName profileImageURL(width: 70) stream { ${STREAM_FIELDS} }`;
  const pagedFollows = (root, vars) => async (integ) => {
    let after = null, nodes = [], r = null;
    for (let page = 0; page < 8; page++) {
      r = await gql(`query($after: Cursor${vars.decl}) { ${root} { follows(first: 100, after: $after) {
        edges { cursor node { ${LIVE} } } pageInfo { hasNextPage } } } }`, { after, ...vars.values }, true, integ);
      const f = (vars.key === 'user' ? r.data?.user : r.data?.currentUser)?.follows;
      if (!f) return [r, undefined];
      nodes.push(...(f.edges || []).map((e) => e.node));
      if (!f.pageInfo?.hasNextPage || !f.edges?.length) break;
      after = f.edges[f.edges.length - 1].cursor;
    }
    return [r, nodes];
  };
  const attempts = [
    // Your live follows, asked by your username.
    login && (async (integ) => {
      const r = await gql(`query($login: String!) { user(login: $login) { followedLiveUsers(first: 100) { nodes { ${LIVE} } } } }`, { login }, true, integ);
      return [r, r.data?.user?.followedLiveUsers?.nodes];
    }),
    // Your live follows, asked as "the signed-in account".
    async (integ) => {
      const r = await gql(`query { currentUser { followedLiveUsers(first: 100) { nodes { ${LIVE} } } } }`, {}, true, integ);
      return [r, r.data?.currentUser?.followedLiveUsers?.nodes];
    },
    // Everyone you follow, keeping who's live.
    login && pagedFollows('user(login: $login)', { decl: ', $login: String!', values: { login }, key: 'user' }),
    pagedFollows('currentUser', { decl: '', values: {}, key: 'currentUser' })
  ].filter(Boolean);
  const order = [workingAttempt, ...attempts.map((_, i) => i).filter((i) => i !== workingAttempt)].filter((i) => i < attempts.length);

  const problems = [];
  const run = async (integ) => {
    for (const i of order) {
      try {
        const [r, nodes] = await attempts[i](integ);
        if (!r.signedIn) return { signedIn: false, live: [] };
        if (Array.isArray(nodes)) {
          workingAttempt = i;
          lastFollowError = '';
          const live = nodes.filter((n) => n && n.stream).map(toLive).sort((a, b) => b.viewers - a.viewers);
          return { signedIn: true, live };
        }
        problems.push(errText(r) || 'no data');
      } catch (e) {
        problems.push(e.message);
      }
    }
    return null;
  };
  // Direct requests first (skipped for 30 minutes after Twitch refused them
  // all), then the integrity header, then reading twitch.tv's own page.
  let out = null;
  if (Date.now() - directBlockedAt > 30 * 60 * 1000) {
    out = await run(!!freshIntegrity());
    if (!out && freshIntegrity()) out = await run(true);
    if (out) return out;
    directBlockedAt = Date.now();
  }
  const fromSite = await followingFromSite();
  if (fromSite) { lastFollowError = ''; return { signedIn: true, live: fromSite, via: 'site' }; }
  lastFollowError = [...new Set(problems)].join(' | ').slice(0, 300);
  console.warn('[prism] follows failed:', lastFollowError);
  return { signedIn: true, live: [], error: lastFollowError };
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
  watchTwitchHeaders();
  ipcMain.handle('twitch:following', () => fetchFollowing());
  ipcMain.handle('twitch:stream-info', (_e, logins) => streamInfo(logins));
  // First check seeds the list quietly, so you don't get alerts for everyone
  // who was already live when Prism opened.
  setTimeout(poll, 8000);
  pollTimer = setInterval(poll, 90 * 1000);
}

module.exports = { init, fetchFollowing, streamInfo, pollNow: poll };
