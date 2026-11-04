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
  autoUpdater.on('update-available', (i) => emit({ status: 'downloading', available: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => emit({ status: 'up-to-date', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => emit({ status: 'ready', available: i.version }));
  autoUpdater.on('error', (e) => emit({ status: 'error', error: String(e?.message || e).split('\n')[0] }));

  if (!app.isPackaged) {
    emit({ status: 'dev', error: null });
    return;
  }
  if (settings.get().autoUpdate) {
    setTimeout(check, 5000);
    setInterval(check, 4 * 60 * 60 * 1000); // every 4 hours
  }
}

function check() {
  if (!app.isPackaged) return emit({ status: 'dev' });
  if (state.status === 'downloading' || state.status === 'ready') return state;
  autoUpdater.checkForUpdates().catch((e) => emit({ status: 'error', error: e.message }));
  return state;
}

function install() {
  if (state.status === 'ready') autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, check, install, getState: () => state };
