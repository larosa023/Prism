// Channel points: balance for each Twitch stream you're watching, and an
// automatic bonus claimer. Every minute it checks the Twitch streams in your
// multi-view; when a bonus is waiting it claims it, trying in order:
//   1. a normal claim request,
//   2. the same with the security header Twitch's own pages send,
//   3. Twitch's own chat page in a hidden window, clicking "Claim Bonus".
// Whichever works is remembered and tried first next time.
const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const settings = require('./settings');
const live = require('./twitch-live');

const balances = new Map(); // login -> { channelId, balance, claimId, at }
const claimedTotal = new Map(); // login -> points claimed this session
let preferred = 'request'; // 'request' | 'integrity' | 'page'
let send = () => {};

async function getPoints(login, useIntegrity) {
  const r = await live.gql(`query($login: String!) { channel(name: $login) { id
    self { communityPoints { balance availableClaim { id } } } } }`, { login }, true, useIntegrity);
  if (!r.signedIn) return { signedIn: false };
  const ch = r.data?.channel;
  const cp = ch?.self?.communityPoints;
  if (!ch || !cp) return { signedIn: true, unavailable: true, error: live.errText(r) };
  return { signedIn: true, channelId: ch.id, balance: cp.balance, claimId: cp.availableClaim?.id || null };
}

async function claimByRequest(p, useIntegrity) {
  const r = await live.gql(`mutation($input: ClaimCommunityPointsInput!) {
    claimCommunityPoints(input: $input) { currentPoints error { code } } }`, { input: { channelID: p.channelId, claimID: p.claimId } }, true, useIntegrity);
  const out = r.data?.claimCommunityPoints;
  if (out && !out.error && out.currentPoints != null) return { ok: true, balance: out.currentPoints };
  return { ok: false, error: live.errText(r) || out?.error?.code || 'refused' };
}

// Open the channel's chat in a hidden window and click "Claim Bonus".
const CLAIM_PRELOAD = path.join(__dirname, '..', 'preload', 'twitch-claim.js');
let pageBusy = Promise.resolve();
function claimByPage(login) {
  const run = async () => {
    const w = new BrowserWindow({ show: false, width: 420, height: 720, webPreferences: {
      partition: 'persist:twitch', preload: CLAIM_PRELOAD, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    w.webContents.setAudioMuted(true);
    let clicked = false, done;
    const finished = new Promise((r) => (done = r));
    const onClick = (e) => { if (e.sender === w.webContents) { clicked = true; setTimeout(done, 2500); } };
    ipcMain.on('twitch:claim-clicked', onClick);
    try {
      w.loadURL(`https://www.twitch.tv/popout/${encodeURIComponent(login)}/chat`).catch(() => {});
      await Promise.race([finished, new Promise((r) => setTimeout(r, 25000))]);
    } finally {
      ipcMain.removeListener('twitch:claim-clicked', onClick);
      if (!w.isDestroyed()) w.destroy();
    }
    return { ok: clicked };
  };
  // One hidden page at a time.
  const p = pageBusy.then(run, run);
  pageBusy = p.catch(() => {});
  return p;
}

async function claim(login, p) {
  const order = { request: ['request', 'integrity', 'page'], integrity: ['integrity', 'request', 'page'], page: ['page', 'request', 'integrity'] }[preferred];
  for (const how of order) {
    let r;
    if (how === 'request') r = await claimByRequest(p, false);
    else if (how === 'integrity') {
      if (!(await live.ensureIntegrity())) continue;
      r = await claimByRequest(p, true);
    } else {
      r = await claimByPage(login);
      if (r.ok) {
        const after = await getPoints(login, !!live.freshIntegrity()).catch(() => null);
        r.balance = after?.balance ?? p.balance + 50;
      }
    }
    if (r.ok) { preferred = how; return r; }
  }
  return { ok: false };
}

async function tick() {
  const s = settings.get();
  const logins = [...new Set((s.streams || []).filter((x) => x.platform === 'twitch').map((x) => x.id.toLowerCase()))];
  for (const login of logins) {
    try {
      const p = await getPoints(login, preferred === 'integrity' && !!live.freshIntegrity());
      if (!p.signedIn) return;
      if (p.unavailable) continue;
      balances.set(login, { ...p, at: Date.now() });
      if (p.claimId && s.autoClaimPoints) {
        const r = await claim(login, p);
        if (r.ok) {
          const gained = Math.max(0, (r.balance ?? p.balance) - p.balance) || 50;
          claimedTotal.set(login, (claimedTotal.get(login) || 0) + gained);
          balances.set(login, { ...p, balance: r.balance ?? p.balance + gained, claimId: null, at: Date.now() });
          send('twitch:points-claimed', { login, gained, balance: r.balance, total: claimedTotal.get(login), via: preferred });
        }
      }
    } catch {}
  }
  send('twitch:points-update', Object.fromEntries([...balances].map(([l, v]) => [l, { ...v, claimed: claimedTotal.get(l) || 0 }])));
}

function init(ctx) {
  send = ctx.send;
  ipcMain.handle('twitch:points-all', () => Object.fromEntries([...balances].map(([l, v]) => [l, { ...v, claimed: claimedTotal.get(l) || 0 }])));
  ipcMain.handle('twitch:points-check', () => tick());
  setTimeout(tick, 15000);
  setInterval(tick, 60 * 1000);
}

module.exports = { init, tick };
