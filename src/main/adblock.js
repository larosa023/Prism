// Built-in ad blocking using uBlock Origin's filter lists.
// Runs the lists through Ghostery's engine, which understands uBO syntax
// (network rules, cosmetic rules and +js() scriptlets).
const { app, ipcMain, net, utilityProcess } = require('electron');
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

// Use Chromium's network stack (net.fetch). Node's built-in fetch can crash
// the app with "assert(!this.paused)" while downloading big filter lists.
const download = (url, opts) => net.fetch(url, opts);

const MAX_AGE = 24 * 60 * 60 * 1000; // refresh lists once a day
let blocker = null;
let sessions = [];
let status = { ready: false, rules: 0, updated: null, error: null };

const cacheDir = () => path.join(app.getPath('userData'), 'filters');


// Download a list if it's missing or out of date (kept on disk only).
async function ensureList(key, url, force) {
  const file = path.join(cacheDir(), key + '.txt');
  if (!force && !isStale(file)) return;
  try {
    const res = await download(url, { headers: { 'User-Agent': 'Prism/1.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(file, text);
  } catch (e) {
    console.warn('filter list failed', key, e.message);
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

// ---- Building the engine -----------------------------------------------------
// Parsing ~5 MB of filter lists is slow, so it happens on a worker thread, and
// the finished engine is saved. Later launches load the saved engine in a few
// milliseconds; it's rebuilt (in the background) only when the lists change.
const crypto = require('crypto');
const ENGINE_FILE = () => path.join(cacheDir(), 'engine.bin');
const ENGINE_META = () => path.join(cacheDir(), 'engine.json');
const ENGINE_LIB_VERSION = (() => { try { return require('@ghostery/adblocker/package.json').version; } catch { return '?'; } })();

function fileStamp(file) {
  try { const st = fs.statSync(file); return st.size + ':' + Math.round(st.mtimeMs); } catch { return 'none'; }
}
function cacheKey(enabled) {
  const s = settings.get();
  const parts = [ENGINE_LIB_VERSION, ...enabled.map((k) => k + '=' + fileStamp(path.join(cacheDir(), k + '.txt'))),
    'res=' + fileStamp(path.join(cacheDir(), 'resources.json')), 'custom=' + (s.customFilters || ''), 'allow=' + (s.allowlist || []).join(',')];
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}
const isStale = (file) => { try { return Date.now() - fs.statSync(file).mtimeMs > MAX_AGE; } catch { return true; } };

// YouTube gets Prism's own ad handling (preload/youtube.js), which is built for
// it; the general page filtering is skipped there.
const OWN_HANDLING = /^https?:\/\/([\w-]+\.)*(youtube\.com|youtube-nocookie\.com)\//;

function finish(engine) {
  // Don't watch every change on the page to look for more things to hide.
  // On busy pages (YouTube, Twitch chat) that watcher ran on every change,
  // talked to the app each time and piled up style sheets, which made long
  // sessions slow. Page-wide and site-specific hiding still apply on load.
  engine.config.enableMutationObserver = false;
  const inject = engine.onInjectCosmeticFilters;
  engine.onInjectCosmeticFilters = (event, url, msg) =>
    (isAllowlisted(url) || OWN_HANDLING.test(url) ? Promise.resolve() : inject(event, url, msg));
  return engine;
}

function loadSaved(key) {
  try {
    const meta = JSON.parse(fs.readFileSync(ENGINE_META(), 'utf8'));
    if (meta.key !== key) return null;
    const engine = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(ENGINE_FILE())));
    return { engine: finish(engine), rules: meta.rules };
  } catch {
    return null;
  }
}

function buildInProcess(files, extra) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'adblock-worker.js'), [], { serviceName: 'Prism filter builder' });
    let done = false;
    child.once('message', (m) => { done = true; m.error ? reject(new Error(m.error)) : resolve(m); });
    child.once('exit', (code) => { if (!done) reject(new Error('filter build stopped (' + code + ')')); });
    child.postMessage({ files, extra, resourcesFile: path.join(cacheDir(), 'resources.json'), outFile: ENGINE_FILE() });
  });
}

// Make sure the scriptlet resources are downloaded (kept on disk only).
async function resourcesText(force) {
  const resFile = path.join(cacheDir(), 'resources.json');
  if (!force && !isStale(resFile)) return;
  try {
    const r = await fetchResources(download);
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(resFile, r);
  } catch {}
}

// Returns { engine, rules, fromCache }.
async function build(force = false) {
  const s = settings.get();
  const enabled = Object.keys(LISTS).filter((k) => s.filterLists[k]);
  if (!force) {
    const saved = loadSaved(cacheKey(enabled));
    if (saved) return { ...saved, fromCache: true };
  }
  for (const k of enabled) await ensureList(k, LISTS[k].url, force);
  await resourcesText(force);
  fs.mkdirSync(cacheDir(), { recursive: true });
  const { rules } = await buildInProcess(enabled.map((k) => path.join(cacheDir(), k + '.txt')), [s.customFilters || '', allowlistRules()].join('\n'));
  try { fs.writeFileSync(ENGINE_META(), JSON.stringify({ key: cacheKey(enabled), rules, at: Date.now() })); } catch {}
  return { engine: finish(ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(ENGINE_FILE())))), rules, fromCache: false };
}

// The engine registers app-wide IPC handlers each time it's turned on for a
// session, so we manage those here to run one engine across every session.
const IPC = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled'];
function clearIpc() { for (const c of IPC) ipcMain.removeHandler(c); }
const noCsp = new WeakSet(); // sessions where page-policy rules are skipped
function enableOn(ses) {
  if (!blocker || blocker.isBlockingEnabled(ses)) return;
  clearIpc();
  blocker.enableBlockingInSession(ses);
  // Those rules only matter for a few rare sites; skipping them means pages'
  // responses don't each wait on Prism.
  if (noCsp.has(ses)) ses.webRequest.onHeadersReceived(null);
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

let building = null;
async function rebuild(force = false) {
  if (building) { await building.catch(() => {}); if (!force) return status; }
  const s = settings.get();
  building = (async () => {
    const { engine, rules, fromCache } = await build(force);
    applyToSessions();
    blocker = engine;
    if (s.adblockEnabled) for (const ses of sessions) enableOn(ses);
    status = { ready: true, enabled: s.adblockEnabled, rules, updated: new Date().toISOString(), error: null };
    // Loaded the saved engine? Check for newer lists later, in the background.
    if (fromCache) {
      const enabled = Object.keys(LISTS).filter((k) => s.filterLists[k]);
      if (enabled.some((k) => isStale(path.join(cacheDir(), k + '.txt')))) setTimeout(() => refreshLists(), 60 * 1000);
    }
  })();
  try {
    await building;
  } catch (e) {
    status = { ...status, error: e.message };
    console.error('adblock build failed', e);
  } finally {
    building = null;
  }
  return status;
}

// Download any out-of-date lists and rebuild if something changed.
async function refreshLists() {
  const s = settings.get();
  const enabled = Object.keys(LISTS).filter((k) => s.filterLists[k]);
  const before = cacheKey(enabled);
  for (const k of enabled) await ensureList(k, LISTS[k].url, false);
  await resourcesText(false);
  if (cacheKey(enabled) !== before) return rebuild(false);
  return status;
}

function attach(ses, { skipCsp = false } = {}) {
  if (skipCsp) noCsp.add(ses);
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
setInterval(() => refreshLists(), MAX_AGE).unref?.();

module.exports = { rebuild, attach, setEnabled, lists, getStatus };
