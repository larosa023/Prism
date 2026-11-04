// Twitch ad handling. By default Prism runs pixeltris's TwitchAdSolutions
// script (video-swap-new), the same one uBlock Origin loads through
// "userResourcesLocation" + twitch.tv##+js(twitch-videoad).
const { app, ipcMain, net } = require('electron');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const DEFAULT_URL = 'https://raw.githubusercontent.com/pixeltris/TwitchAdSolutions/master/video-swap-new/video-swap-new-ublock-origin.js';
const MAX_AGE = 12 * 60 * 60 * 1000;

let code = '';
let status = { loaded: false, version: null, updated: null, error: null, url: null };

const cacheFile = () => path.join(app.getPath('userData'), 'twitch-adscript.js');

// Accepts a uBO resources file ("name.js text/javascript" header, one or more
// resources separated by blank lines) or a plain userscript.
function extractScript(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (/^[\w.-]+\.js\s+(text|application)\/javascript\s*$/.test(lines[0] || '')) {
    // Keep only the first resource (twitch-videoad.js).
    const body = [];
    for (let i = 1; i < lines.length; i++) {
      if (i > 1 && /^[\w.-]+\.js\s+(text|application)\/javascript\s*$/.test(lines[i]) && lines[i - 1].trim() === '') break;
      body.push(lines[i]);
    }
    return body.join('\n');
  }
  return text;
}

function describe(text, url, when) {
  const v = text.match(/ourTwitchAdSolutionsVersion\s*=\s*(\d+)/) || text.match(/@version\s+([\d.]+)/);
  status = { loaded: !!text, version: v ? v[1] : null, updated: when, error: null, url };
}

function loadCache() {
  try {
    const raw = fs.readFileSync(cacheFile(), 'utf8');
    const meta = JSON.parse(fs.readFileSync(cacheFile() + '.json', 'utf8'));
    if (meta.url === scriptUrl()) {
      code = raw;
      describe(code, meta.url, meta.updated);
      return Date.now() - new Date(meta.updated).getTime() < MAX_AGE;
    }
  } catch {}
  return false;
}

const scriptUrl = () => (settings.get().twitchAdScriptUrl || DEFAULT_URL).trim();

async function refresh(force = false) {
  const url = scriptUrl();
  const fresh = loadCache();
  if (fresh && !force) return status;
  if (!/^https:\/\//.test(url)) {
    status = { ...status, error: 'The script address must start with https://' };
    return status;
  }
  try {
    const res = await net.fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = extractScript(await res.text());
    if (text.length < 200 || !/twitch/i.test(text)) throw new Error("That file doesn't look like a Twitch ad script");
    code = text;
    const updated = new Date().toISOString();
    fs.writeFileSync(cacheFile(), code);
    fs.writeFileSync(cacheFile() + '.json', JSON.stringify({ url, updated }));
    describe(code, url, updated);
  } catch (e) {
    status = { ...status, error: e.message }; // keep using the cached copy if we have one
  }
  return status;
}

function init() {
  loadCache();
  refresh(false);
  setInterval(() => refresh(true), MAX_AGE).unref?.();

  // The Twitch player preload asks for this synchronously so the script runs
  // before any of Twitch's own code.
  ipcMain.on('twitch:adscript-sync', (e) => {
    const s = settings.get();
    e.returnValue = { method: s.twitchAdMethod, code: s.twitchAdMethod === 'tas' ? code : '', previews: s.twitchPreviews };
  });
  ipcMain.handle('twitch:adscript-status', () => ({ ...status, defaultUrl: DEFAULT_URL }));
  ipcMain.handle('twitch:adscript-refresh', () => refresh(true));
}

module.exports = { init, refresh, DEFAULT_URL, extractScript };
