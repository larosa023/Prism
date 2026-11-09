// Built-in updater: checks GitHub Releases (larosa023/Prism), downloads in
// the background, and installs when you restart.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const settings = require('./settings');

let send = () => {};
let state = { status: 'idle', version: app.getVersion() };

function emit(patch) {
  state = { ...state, ...patch };
  send('updater:state', state);
}

function init(sendToUi) {
  send = sendToUi;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking', error: null }));
  autoUpdater.on('update-available', () => { retries = 0; clearTimeout(retryTimer); });
  autoUpdater.on('update-available', (i) => emit({ status: 'downloading', available: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => { retries = 0; clearTimeout(retryTimer); emit({ status: 'up-to-date', checkedAt: Date.now() }); });
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => emit({ status: 'ready', available: i.version }));
  autoUpdater.on('error', (e) => failed(e));

  if (!app.isPackaged) {
    emit({ status: 'dev', error: null });
    return;
  }
  if (settings.get().autoUpdate) {
    setTimeout(check, 5000);
    setInterval(check, 4 * 60 * 60 * 1000); // every 4 hours
  }
}

// GitHub sometimes doesn't answer (a 504 "Gateway Time-out", or no internet).
// That's not something you need to read a stack trace about: say so in one
// line and try again by itself a few times (after 1, 3, 10 and 30 minutes).
const RETRY_MINUTES = [1, 3, 10, 30];
let retries = 0;
let retryTimer = null;
function friendly(e) {
  const msg = String(e?.message || e || '');
  const code = msg.match(/HttpError: (\d{3})/)?.[1] || msg.match(/\b(5\d\d)\b/)?.[1];
  if (code && code.startsWith('5')) return "GitHub isn't responding right now (error " + code + ').';
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|net::ERR_|socket hang up|timed? ?out/i.test(msg)) return "Couldn't reach GitHub (check your internet connection).";
  if (/\b(403|429)\b|rate limit/i.test(msg)) return 'GitHub is limiting update checks for a while.';
  return msg.split('\n')[0].slice(0, 160);
}
function failed(e) {
  console.warn('[prism] update check failed', e?.message || e);
  clearTimeout(retryTimer);
  let error = friendly(e);
  if (retries < RETRY_MINUTES.length) {
    const min = RETRY_MINUTES[retries++];
    error += ` Trying again in ${min} minute${min === 1 ? '' : 's'}.`;
    retryTimer = setTimeout(() => check(true), min * 60 * 1000);
  }
  emit({ status: 'error', error });
}

function check(isRetry = false) {
  if (!app.isPackaged) return emit({ status: 'dev' });
  if (state.status === 'downloading' || state.status === 'ready') return state;
  if (!isRetry) { retries = 0; clearTimeout(retryTimer); }
  autoUpdater.checkForUpdates().catch((e) => failed(e));
  return state;
}

function install() {
  if (state.status === 'ready') autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, check, install, getState: () => state };
