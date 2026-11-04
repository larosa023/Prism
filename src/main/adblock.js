// Built-in ad blocking using uBlock Origin's filter lists.
// Runs the lists through Ghostery's engine, which understands uBO syntax
// (network rules, cosmetic rules and +js() scriptlets).
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { ElectronBlocker, fetchResources } = require('@ghostery/adblocker-electron');
const settings = require('./settings');

const UBO = 'https://ublockorigin.github.io/uAssets/filters';
const LISTS = {
  'ubo-filters':     { name: 'uBlock Origin – Ads', url: `${UBO}/filters.txt` },
  'ubo-badware':     { name: 'uBlock Origin – Badware risks', url: `${UBO}/badware.txt` },
  'ubo-privacy':     { name: 'uBlock Origin – Privacy', url: `${UBO}/privacy.txt` },
  'ubo-quick-fixes': { name: 'uBlock Origin – Quick fixes', url: `${UBO}/quick-fixes.txt` },
  'ubo-unbreak':     { name: 'uBlock Origin – Unbreak', url: `${UBO}/unbreak.txt` },
  easylist:          { name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
  easyprivacy:       { name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
  'peter-lowe':      { name: "Peter Lowe's list", url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext' }
};

const MAX_AGE = 24 * 60 * 60 * 1000; // refresh lists once a day
let blocker = null;
let sessions = [];
let status = { ready: false, rules: 0, updated: null, error: null };

const cacheDir = () => path.join(app.getPath('userData'), 'filters');

async function cachedText(key, url, force) {
  const file = path.join(cacheDir(), key + '.txt');
  let stat = null;
  try { stat = fs.statSync(file); } catch {}
  if (stat && !force && Date.now() - stat.mtimeMs < MAX_AGE) return fs.readFileSync(file, 'utf8');
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Prism/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(file, text);
    return text;
  } catch (e) {
    if (stat) return fs.readFileSync(file, 'utf8'); // offline: use the last copy
    console.warn('filter list failed', key, e.message);
    return '';
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function isAllowlisted(url) {
  const host = hostOf(url);
  return settings.get().allowlist.some((d) => host === d || host.endsWith('.' + d));
}

function allowlistRules() {
  // Network exceptions for every request made from an allowlisted site.
  return settings.get().allowlist.map((d) => `@@*$domain=${d}`).join('\n');
}

async function build(force = false) {
  const s = settings.get();
  const enabled = Object.keys(LISTS).filter((k) => s.filterLists[k]);
  const texts = await Promise.all(enabled.map((k) => cachedText(k, LISTS[k].url, force)));
  const all = [...texts, s.customFilters || '', allowlistRules()].join('\n');

  const next = ElectronBlocker.parse(all, { loadCosmeticFilters: true, loadNetworkFilters: true, enableHtmlFiltering: true });

  // Scriptlet resources (needed for uBO's +js() rules).
  try {
    const resFile = path.join(cacheDir(), 'resources.json');
    let resources = null;
    try {
      if (!force && Date.now() - fs.statSync(resFile).mtimeMs < MAX_AGE) resources = fs.readFileSync(resFile, 'utf8');
    } catch {}
    if (!resources) {
      try {
        resources = await fetchResources(fetch);
        fs.mkdirSync(cacheDir(), { recursive: true });
        fs.writeFileSync(resFile, resources);
      } catch { try { resources = fs.readFileSync(resFile, 'utf8'); } catch {} }
    }
    if (resources) next.updateResources(resources, String(resources.length));
  } catch (e) {
    console.warn('resources failed', e.message);
  }

  // Skip cosmetic filtering on allowlisted sites.
  const inject = next.onInjectCosmeticFilters;
  next.onInjectCosmeticFilters = (event, url, msg) => (isAllowlisted(url) ? Promise.resolve() : inject(event, url, msg));

  return next;
}


// The engine registers app-wide IPC handlers each time it's turned on for a
// session, so we manage those here to run one engine across every session.
const IPC = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled'];
function clearIpc() { for (const c of IPC) ipcMain.removeHandler(c); }
function enableOn(ses) {
  if (!blocker || blocker.isBlockingEnabled(ses)) return;
  clearIpc();
  blocker.enableBlockingInSession(ses);
}
function disableOn(ses, engine = blocker) {
  if (!engine || !engine.isBlockingEnabled(ses)) return;
  engine.disableBlockingInSession(ses);
  // Disabling one session drops the shared handlers; put them back for the rest.
  if (blocker && sessions.some((s) => blocker.isBlockingEnabled(s))) {
    clearIpc();
    ipcMain.handle(IPC[0], (e, url, msg) => blocker.onInjectCosmeticFilters(e, url, msg));
    ipcMain.handle(IPC[1], (e) => blocker.onIsMutationObserverEnabled(e));
  }
}

function applyToSessions() {
  const old = blocker;
  blocker = null;
  for (const ses of sessions) disableOn(ses, old);
  clearIpc();
}

async function rebuild(force = false) {
  const s = settings.get();
  try {
    const next = await build(force);
    applyToSessions();
    blocker = next;
    if (s.adblockEnabled) for (const ses of sessions) enableOn(ses);
    status = {
      ready: true,
      enabled: s.adblockEnabled,
      rules: blocker.getFilters().networkFilters.length + blocker.getFilters().cosmeticFilters.length,
      updated: new Date().toISOString(),
      error: null
    };
  } catch (e) {
    status = { ...status, error: e.message };
    console.error('adblock build failed', e);
  }
  return status;
}

function attach(ses) {
  if (!sessions.includes(ses)) sessions.push(ses);
  if (settings.get().adblockEnabled) enableOn(ses);
}

function setEnabled(on) {
  for (const ses of sessions) (on ? enableOn : disableOn)(ses);
  if (!on) clearIpc();
  status.enabled = on;
  return status;
}

const lists = () => Object.entries(LISTS).map(([id, l]) => ({ id, name: l.name }));
const getStatus = () => status;

// Refresh lists in the background every day while the app is open.
setInterval(() => rebuild(true), MAX_AGE).unref?.();

module.exports = { rebuild, attach, setEnabled, lists, getStatus };
