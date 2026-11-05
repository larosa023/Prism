// NoPixel areas: where each streamer is, read from their Twitch preview.
// NoPixel's HUD shows the area and street beside the minimap ("PILLBOX HILL /
// VESPUCCI BLVD"). Twitch refreshes each live stream's preview image every few
// minutes; Prism crops the HUD corner, reads the text, and matches it to GTA's
// area names. It's an estimate, a few minutes old, and "unknown" when the HUD
// isn't visible (hidden, covered by an overlay, or a non-game scene).
const { ipcMain, net, nativeImage, app } = require('electron');
const path = require('path');

// GTA V areas, grouped by part of the map.
const REGIONS = {
  'Los Santos': ['Alta', 'Banning', 'Burton', 'Chamberlain Hills', 'Cypress Flats', 'Davis', 'Del Perro', 'Del Perro Beach',
    'Downtown', 'Downtown Vinewood', 'East Vinewood', 'El Burro Heights', 'Elysian Island', 'Hawick', 'La Mesa', 'La Puerta',
    'Legion Square', 'Little Seoul', 'Los Santos International Airport', 'Mirror Park', 'Mission Row', 'Morningwood',
    'Murrieta Heights', 'Pillbox Hill', 'Port of South Los Santos', 'Rancho', 'Richards Majestic', 'Rockford Hills', 'Strawberry',
    'Terminal', 'Textile City', 'Vespucci', 'Vespucci Beach', 'Vespucci Canals', 'West Vinewood', 'Vinewood', 'Maze Bank Arena',
    'Vinewood Racetrack', 'Vinewood Bowl', 'Diamond Casino', 'Puerto Del Sol', 'Del Perro Pier', 'Cypress Flats Port'],
  'Vinewood Hills & west coast': ['Vinewood Hills', 'Richman', 'Richman Glen', 'GWC and Golfing Society', 'Pacific Bluffs', 'Banham Canyon',
    'Chumash', 'Tongva Hills', 'Tongva Valley', 'Great Chaparral', 'Land Act Dam', 'Land Act Reservoir', 'Tataviam Mountains',
    'Palomino Highlands', 'Mount Haan', 'Ron Alternates Wind Farm', 'Palmer-Taylor Power Station', 'San Chianski Mountain Range',
    'Davis Quartz', 'Noose Headquarters', 'Rogers Salvage & Scrap'],
  'Blaine County': ['Sandy Shores', 'Alamo Sea', 'Grand Senora Desert', 'Harmony', 'Grapeseed', 'Stab City', 'Fort Zancudo',
    'Lago Zancudo', 'Zancudo River', 'Redwood Lights Track', 'Raton Canyon', 'Cassidy Creek', 'Mount Josiah', 'North Chumash',
    'Braddock Pass', 'Galilee', 'Humane Labs and Research', 'Mount Chiliad', 'Chiliad Mountain State Wilderness', 'Calafia Bridge',
    'Mount Gordo', 'El Gordo Lighthouse', 'Thomson Scrapyard', 'Sandy Shores Airfield', 'McKenzie Field'],
  'Paleto & north': ['Paleto Bay', 'Paleto Forest', 'Paleto Cove', 'Procopio Beach', 'Procopio Promenade'],
  'At sea': ['Pacific Ocean', 'San Andreas', 'Alamo Sea Waters']
};
const ZONES = [];
for (const [region, names] of Object.entries(REGIONS)) for (const name of names) ZONES.push({ name, region, key: norm(name) });
// Longest names first, so "Vespucci Beach" wins over "Vespucci".
ZONES.sort((a, b) => b.key.length - a.key.length);

function norm(s) { return String(s).toUpperCase().replace(/[^A-Z&]/g, ''); }

function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
}

// Pick the GTA area a line of OCR text most likely is.
function matchZone(lines) {
  let best = null;
  for (const raw of lines) {
    const line = norm(raw);
    if (line.length < 4) continue;
    for (const z of ZONES) {
      let score = similarity(line, z.key);
      if (line.includes(z.key) && z.key.length >= 5) score = Math.max(score, 0.95);
      const need = z.key.length <= 5 ? 0.8 : 0.7; // short names need a closer match
      if (score >= need && (!best || score > best.score)) best = { ...z, score };
    }
  }
  return best;
}

// ---- Text recognition (one background worker, one image at a time) --------
let workerPromise = null;
function ocrWorker() {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    const langDir = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
    workerPromise = (async () => {
      const w = await createWorker('eng', 1, {
        langPath: path.join(langDir, '4.0.0_best_int'), gzip: true,
        cachePath: path.join(app.getPath('userData'), 'ocr-cache')
      });
      await w.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ &'.-", tessedit_pageseg_mode: '6' });
      return w;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// White HUD text on a busy game picture -> black text on white, enlarged.
function hudImage(img, box) {
  const { width, height } = img.getSize();
  const rect = { x: Math.round(width * box.x), y: Math.round(height * box.y), width: Math.round(width * box.w), height: Math.round(height * box.h) };
  const crop = img.crop(rect).resize({ width: rect.width * 3, quality: 'best' });
  const { width: w, height: h } = crop.getSize();
  const px = crop.toBitmap(); // BGRA
  for (let i = 0; i < px.length; i += 4) {
    const v = 0.114 * px[i] + 0.587 * px[i + 1] + 0.299 * px[i + 2];
    const out = v > 170 ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = out;
    px[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG();
}

// Where the HUD text sits: beside the minimap, top-right. A wider area is
// tried if the usual spot doesn't read (streams laid out differently).
// The last one is the top-left corner, where NoPixel shows a property's
// address ("192 POPULAR ST, LA MESA") while you're in a house.
const BOXES = [{ x: 0.78, y: 0.22, w: 0.22, h: 0.21 }, { x: 0.66, y: 0.10, w: 0.34, h: 0.42 }, { x: 0, y: 0, w: 0.32, h: 0.09 }];

async function preview(login) {
  const url = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-1280x720.jpg?t=${Math.floor(Date.now() / 60000)}`;
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
  return img.isEmpty() ? null : img;
}

async function locate(login, imgJob) {
  const img = await (imgJob || preview(login));
  if (!img) return null;
  const w = await ocrWorker();
  for (const box of BOXES) {
    const { data } = await w.recognize(hudImage(img, box));
    const lines = data.text.split('\n').map((l) => l.trim()).filter(Boolean);
    const z = matchZone(lines);
    if (z) return { area: z.name, region: z.region };
  }
  return { area: null };
}

// ---- Queue: keeps going through who's live, refreshing each every ~4 min ----
const results = new Map(); // login -> { area, region, at }
let queue = [];
let running = false;
let send = () => {};

// The text-recognition engine takes ~50-60 MB, so it's shut down a minute
// after the last reading and started again when needed.
let idleTimer = null;
function scheduleIdleShutdown() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (running || queue.length || !workerPromise) return;
    const p = workerPromise;
    workerPromise = null;
    try { (await p).terminate(); } catch {}
  }, 60 * 1000);
}

// Progress for the Areas view: how many of this round are read so far.
let round = { total: 0, done: 0, found: 0, error: '' };
const status = () => ({ ...round, running, left: queue.length });
const fresh = (login) => { const p = results.get(login); return p && Date.now() - p.at < 4 * 60 * 1000; };

async function pump() {
  if (running) return;
  running = true;
  clearTimeout(idleTimer);
  let next = null; // the next preview, downloaded while this one is read
  while (queue.length) {
    const login = queue.shift();
    const prev = results.get(login);
    if (fresh(login)) continue;
    const job = next && next.login === login ? next.job : preview(login).catch(() => null);
    const upcoming = queue.find((l) => !fresh(l));
    next = upcoming ? { login: upcoming, job: preview(upcoming).catch(() => null) } : null;
    try {
      const r = await locate(login, job);
      round.done++;
      if (r?.area) round.found++;
      round.error = '';
      if (r) {
        // Keep the last known area if this preview couldn't be read.
        const keep = !r.area && prev?.area ? { area: prev.area, region: prev.region, at: prev.at, stale: true } : { ...r, at: Date.now() };
        results.set(login, keep);
        send('nopixel:location', { login, ...keep });
      }
    } catch (e) {
      round.done++;
      round.error = e.message || String(e);
      console.warn('[prism] area reading failed', login, round.error);
      // The reader itself didn't start: stop this round rather than fail
      // the same way for everyone.
      if (!workerPromise) { queue = []; }
    }
    send('nopixel:locate-status', status());
  }
  running = false;
  send('nopixel:locate-status', status());
  scheduleIdleShutdown();
}

function init(ctx) {
  send = ctx.send;
  ipcMain.handle('nopixel:locate', (_e, logins) => {
    const want = (logins || []).map((l) => String(l).toLowerCase()).filter((l) => /^\w{2,25}$/.test(l));
    const known = new Set(queue);
    const add = want.filter((l) => !known.has(l) && !fresh(l));
    if (!running && !queue.length) round = { total: 0, done: 0, found: 0, error: round.error };
    round.total += add.length;
    queue.push(...add);
    pump();
    return Object.fromEntries([...results].filter(([l]) => want.includes(l)));
  });
  ipcMain.handle('nopixel:regions', () => Object.keys(REGIONS));
  ipcMain.handle('nopixel:locate-status', () => status());
}

module.exports = { init, matchZone, hudImage, REGIONS };
