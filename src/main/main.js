const { app, BrowserWindow, ipcMain, session, shell, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const settings = require('./settings');
const adblock = require('./adblock');
const updater = require('./updater');
const twitchAds = require('./twitch-ads');
require('./twitch-stream');

// ---------------------------------------------------------------------------
// Platforms. Each one gets its own saved session so sign-ins stick.
// ---------------------------------------------------------------------------
const PLATFORMS = {
  twitch:  { partition: 'persist:twitch',  home: 'https://www.twitch.tv/',  domains: ['twitch.tv', 'ttvnw.net', 'jtvnw.net'] },
  youtube: { partition: 'persist:youtube', home: 'https://www.youtube.com/', domains: ['youtube.com', 'youtu.be', 'google.com', 'googlevideo.com', 'ytimg.com'] },
  tiktok:  { partition: 'persist:tiktok',  home: 'https://www.tiktok.com/', domains: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com'] },
  kick:    { partition: 'persist:kick',    home: 'https://kick.com/',       domains: ['kick.com'] }
};

// Domains that sign-in popups are allowed to open in.
const AUTH_HOSTS = [
  'accounts.google.com', 'id.twitch.tv', 'passport.twitch.tv', 'www.twitch.tv',
  'appleid.apple.com', 'www.facebook.com', 'm.facebook.com', 'twitter.com', 'x.com',
  'api.twitter.com', 'www.tiktok.com', 'kick.com', 'discord.com', 'login.live.com'
];

const TWITCH_PLAYER_PRELOAD = path.join(__dirname, '..', 'preload', 'twitch-player.js');

// Look like regular Chrome (Google refuses sign-in from browsers that say "Electron").
const CHROME_UA = app.userAgentFallback
  .replace(/\s?Electron\/\S+/i, '')
  .replace(/\s?prism\/\S+/i, '');
app.userAgentFallback = CHROME_UA;

// Lighter on memory: don't keep a spare renderer process warm.
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,CalculateNativeWinOcclusion');

let win = null;

// Never show a crash dialog for a background hiccup (a failed download,
// a dropped connection); log it and keep the app running.
process.on('uncaughtException', (e) => console.error('[prism] uncaught', e));
process.on('unhandledRejection', (e) => console.error('[prism] unhandled', e));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

function hostMatches(host, list) {
  return list.some((d) => host === d || host.endsWith('.' + d));
}

function setupSession(ses) {
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ['fullscreen', 'clipboard-sanitized-write'].includes(permission));
  adblock.attach(ses);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  const s = settings.get();
  win = new BrowserWindow({
    width: s.bounds?.width || 1440,
    height: s.bounds?.height || 880,
    x: s.bounds?.x,
    y: s.bounds?.y,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0e0e12',
    title: 'Prism',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0e12', symbolColor: '#c9c4d6', height: 36 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: true
    }
  });

  win.once('ready-to-show', () => {
    if (s.maximized) win.maximize();
    win.show();
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    settings.set(maximized ? { maximized } : { maximized, bounds: win.getBounds() });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Keep the app window itself from navigating anywhere.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Lock down every <webview> the UI creates.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event, prefs, params) => {
    const allowed = Object.values(PLATFORMS).map((p) => p.partition);
    if (!allowed.includes(params.partition)) return event.preventDefault();
    if (prefs.preload) {
      const norm = (p) => decodeURIComponent(String(p)).replace(/^file:\/+/i, '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
      if (norm(prefs.preload) !== norm(TWITCH_PLAYER_PRELOAD)) delete prefs.preload;
    }
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.backgroundThrottling = true;
  });

  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      let host = '';
      try { host = new URL(url).hostname; } catch {}
      // Sign-in popups open in a small in-app window that shares the session.
      if (hostMatches(host, AUTH_HOSTS)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520, height: 720, autoHideMenuBar: true, backgroundColor: '#0e0e12',
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
          }
        };
      }
      // Links to the same platform stay in the tab; everything else goes to your browser.
      const sameSite = Object.values(PLATFORMS).some((p) => hostMatches(host, p.domains));
      if (sameSite) contents.loadURL(url);
      else if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    contents.on('context-menu', (_ev, params) => {
      const items = [
        { label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
        { label: 'Reload', click: () => contents.reload() },
        { type: 'separator' }
      ];
      if (params.linkURL) items.push({ label: 'Open link in browser', click: () => shell.openExternal(params.linkURL) },
                                     { label: 'Copy link', click: () => require('electron').clipboard.writeText(params.linkURL) });
      if (params.selectionText) items.push({ role: 'copy' });
      if (params.isEditable) items.push({ role: 'cut' }, { role: 'paste' });
      Menu.buildFromTemplate(items).popup();
    });
  }
});

// ---------------------------------------------------------------------------
// IPC for the UI
// ---------------------------------------------------------------------------
const ADBLOCK_KEYS = ['filterLists', 'customFilters', 'allowlist'];

ipcMain.handle('settings:get', () => settings.get());
ipcMain.handle('settings:set', async (_e, patch) => {
  const s = settings.set(patch);
  if ('adblockEnabled' in patch) adblock.setEnabled(s.adblockEnabled);
  if ('twitchAdScriptUrl' in patch) twitchAds.refresh(true).then((st) => send('twitch:adscript-status', st));
  if (ADBLOCK_KEYS.some((k) => k in patch)) adblock.rebuild(false).then((st) => send('adblock:status', st));
  return s;
});
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, p]) => [k, { partition: p.partition, home: p.home }])),
  twitchPreload: pathToFileURL(TWITCH_PLAYER_PRELOAD).href
}));

ipcMain.handle('adblock:lists', () => adblock.lists());
ipcMain.handle('adblock:status', () => adblock.getStatus());
ipcMain.handle('adblock:update', async () => {
  const st = await adblock.rebuild(true);
  send('adblock:status', st);
  return st;
});

ipcMain.handle('updater:check', () => updater.check());
ipcMain.handle('updater:install', () => updater.install());
ipcMain.handle('updater:state', () => updater.getState());

ipcMain.handle('open-external', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

// Who is signed in on each platform (read from that platform's own cookies).
const SIGNED_IN_COOKIE = {
  twitch: { url: 'https://www.twitch.tv', name: 'auth-token' },
  youtube: { url: 'https://www.youtube.com', name: 'LOGIN_INFO' },
  tiktok: { url: 'https://www.tiktok.com', name: 'sessionid' },
  kick: { url: 'https://kick.com', name: 'session_token' }
};

ipcMain.handle('accounts:status', async () => {
  const out = {};
  for (const [k, c] of Object.entries(SIGNED_IN_COOKIE)) {
    const ses = session.fromPartition(PLATFORMS[k].partition);
    const found = await ses.cookies.get({ url: c.url, name: c.name }).catch(() => []);
    out[k] = found.length > 0;
  }
  const login = await session.fromPartition(PLATFORMS.twitch.partition).cookies.get({ url: 'https://www.twitch.tv', name: 'login' }).catch(() => []);
  out.twitchLogin = login[0]?.value || null;
  return out;
});

ipcMain.handle('accounts:signout', async (_e, platform) => {
  const p = PLATFORMS[platform];
  if (!p) return false;
  await session.fromPartition(p.partition).clearStorageData();
  return true;
});

// Twitch chat signs in with the same account you use on twitch.tv.
ipcMain.handle('twitch:chat-auth', async () => {
  const ses = session.fromPartition(PLATFORMS.twitch.partition);
  const [token] = await ses.cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' }).catch(() => []);
  const [login] = await ses.cookies.get({ url: 'https://www.twitch.tv', name: 'login' }).catch(() => []);
  if (!token || !login) return null;
  return { token: token.value, login: decodeURIComponent(login.value) };
});

// Live channels you follow on Twitch (uses your Twitch sign-in).
const TWITCH_WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
ipcMain.handle('twitch:following', async () => {
  const ses = session.fromPartition(PLATFORMS.twitch.partition);
  const [token] = await ses.cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' }).catch(() => []);
  if (!token) return { signedIn: false, live: [] };
  const query = `query { currentUser { followedLiveUsers(first: 100) { nodes {
    login displayName profileImageURL(width: 50)
    stream { title viewersCount game { displayName } }
  } } } }`;
  try {
    const res = await ses.fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': TWITCH_WEB_CLIENT_ID, Authorization: 'OAuth ' + token.value, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ query })
    });
    const json = await res.json();
    const nodes = json?.data?.currentUser?.followedLiveUsers?.nodes || [];
    const live = nodes.filter((n) => n && n.stream).map((n) => ({
      login: n.login,
      name: n.displayName,
      avatar: n.profileImageURL,
      title: n.stream.title,
      viewers: n.stream.viewersCount,
      game: n.stream.game?.displayName || ''
    })).sort((a, b) => b.viewers - a.viewers);
    return { signedIn: true, live };
  } catch (e) {
    return { signedIn: true, live: [], error: e.message };
  }
});

// Turn a YouTube @handle or channel link into the video that's live right now.
ipcMain.handle('youtube:resolve-live', async (_e, url) => {
  if (!/^https:\/\/(www\.|m\.)?youtube\.com\//.test(url)) return null;
  const target = /\/live\/?$/.test(url) ? url : url.replace(/\/$/, '') + '/live';
  try {
    const res = await session.fromPartition(PLATFORMS.youtube.partition).fetch(target);
    const html = await res.text();
    const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
});

// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  settings.load();
  for (const p of Object.values(PLATFORMS)) setupSession(session.fromPartition(p.partition));
  session.defaultSession.setUserAgent(CHROME_UA);

  twitchAds.init();
  createWindow();
  updater.init(send);

  // Build the ad blocker in the background; streams start right away.
  adblock.rebuild(false).then((st) => send('adblock:status', st));
});

app.on('window-all-closed', () => app.quit());
