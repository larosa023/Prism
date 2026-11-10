// Past broadcasts, clips, pinned chat messages, hype trains and channel ids,
// all read from Twitch's public API (no sign-in needed).
const { ipcMain } = require('electron');
const { gql } = require('./twitch-live');

const login = (l) => String(l || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
const TOKEN_PARAMS = { platform: 'web', playerBackend: 'mediaplayer', playerType: 'site' };

// Channel ids for logins (live raid notices are keyed by id).
const ids = new Map();
async function userIds(logins) {
  const want = [...new Set(logins.map(login).filter(Boolean))].filter((l) => !ids.has(l));
  for (let i = 0; i < want.length; i += 100) {
    const r = await gql('query($l: [String!]) { users(logins: $l) { id login } }', { l: want.slice(i, i + 100) });
    for (const u of r.data?.users || []) if (u) ids.set(u.login.toLowerCase(), u.id);
  }
  const out = {};
  for (const l of logins.map(login)) if (ids.has(l)) out[l] = ids.get(l);
  return out;
}

async function videos(l) {
  l = login(l);
  const r = await gql(`query($l: String!) { user(login: $l) { displayName profileImageURL(width: 70)
    videos(first: 30, type: ARCHIVE, sort: TIME) { edges { node { id title lengthSeconds createdAt viewCount previewThumbnailURL(width: 320, height: 180) game { name } } } }
    highlights: videos(first: 12, type: HIGHLIGHT, sort: TIME) { edges { node { id title lengthSeconds createdAt viewCount previewThumbnailURL(width: 320, height: 180) game { name } } } }
    week: clips(first: 24, criteria: { period: LAST_WEEK }) { edges { node { slug title durationSeconds viewCount createdAt thumbnailURL curator { displayName } } } }
    all: clips(first: 24, criteria: { period: ALL_TIME }) { edges { node { slug title durationSeconds viewCount createdAt thumbnailURL curator { displayName } } } } } }`, { l });
  const u = r.data?.user;
  if (!u) return { error: r.errors?.[0]?.message || 'Channel not found' };
  const vid = (e) => e?.node && { id: e.node.id, title: e.node.title || 'Untitled broadcast', seconds: e.node.lengthSeconds || 0, at: e.node.createdAt,
    views: e.node.viewCount || 0, thumb: /404_processing/.test(e.node.previewThumbnailURL || '') ? '' : e.node.previewThumbnailURL, game: e.node.game?.name || '' };
  const clip = (e) => e?.node && { slug: e.node.slug, title: e.node.title, seconds: e.node.durationSeconds || 0, views: e.node.viewCount || 0,
    at: e.node.createdAt, thumb: e.node.thumbnailURL, by: e.node.curator?.displayName || '' };
  return {
    name: u.displayName, avatar: u.profileImageURL,
    videos: (u.videos?.edges || []).map(vid).filter(Boolean),
    highlights: (u.highlights?.edges || []).map(vid).filter(Boolean),
    clipsWeek: (u.week?.edges || []).map(clip).filter(Boolean),
    clipsAll: (u.all?.edges || []).map(clip).filter(Boolean)
  };
}

// The playlist for a past broadcast.
async function vodMaster(id) {
  id = String(id).replace(/\D/g, '');
  const r = await gql('query($id: ID!, $p: PlaybackAccessTokenParams!) { videoPlaybackAccessToken(id: $id, params: $p) { value signature } }', { id, p: TOKEN_PARAMS });
  const t = r.data?.videoPlaybackAccessToken;
  if (!t) return { error: r.errors?.[0]?.message || "Couldn't open that broadcast" };
  const url = `https://usher.ttvnw.net/vod/${id}.m3u8?allow_source=true&allow_audio_only=true&player=twitchweb&playlist_include_framerate=true&sig=${t.signature}&token=${encodeURIComponent(t.value)}`;
  const res = await require('electron').net.fetch(url, { signal: AbortSignal.timeout(10000) });
  if (res.status === 403) return { error: 'This broadcast is for subscribers only.' };
  if (!res.ok) return { error: 'HTTP ' + res.status };
  return { master: await res.text() };
}

// A clip's video file (the best H.264 version).
async function clipUrl(slug) {
  const r = await gql(`query($s: ID!, $p: PlaybackAccessTokenParams!) { clip(slug: $s) { title durationSeconds broadcaster { login displayName }
    playbackAccessToken(params: $p) { value signature } videoQualities { quality frameRate sourceURL } } }`, { s: String(slug), p: TOKEN_PARAMS });
  const c = r.data?.clip;
  if (!c?.playbackAccessToken || !c.videoQualities?.length) return { error: "Couldn't open that clip" };
  const best = [...c.videoQualities].sort((a, b) => Number(b.quality) - Number(a.quality))[0];
  return {
    url: `${best.sourceURL}?sig=${c.playbackAccessToken.signature}&token=${encodeURIComponent(c.playbackAccessToken.value)}`,
    title: c.title, seconds: c.durationSeconds, login: c.broadcaster?.login, name: c.broadcaster?.displayName
  };
}

// What sits above chat: the pinned message and a running hype train.
async function chatExtras(l) {
  l = login(l);
  const r = await gql(`query($l: String!) { user(login: $l) { channel {
    hypeTrain { execution { id startedAt expiresAt isGoldenKappaTrain progress { goal progression total remainingSeconds level { value goal } } } }
    pinnedChatMessages(first: 1) { edges { node { id endsAt pinnedBy { displayName } pinnedMessage { id sender { displayName login chatColor } content { text } } } } } } } }`, { l });
  const ch = r.data?.user?.channel;
  if (!ch) return { error: r.errors?.[0]?.message || '' };
  const ex = ch.hypeTrain?.execution;
  const pin = ch.pinnedChatMessages?.edges?.[0]?.node;
  return {
    hype: ex && ex.progress ? {
      id: ex.id, level: ex.progress.level?.value || 1, progress: ex.progress.progression || 0, goal: ex.progress.goal || ex.progress.level?.goal || 1,
      endsAt: ex.expiresAt || (ex.progress.remainingSeconds ? new Date(Date.now() + ex.progress.remainingSeconds * 1000).toISOString() : null),
      golden: !!ex.isGoldenKappaTrain
    } : null,
    pinned: pin?.pinnedMessage ? {
      id: pin.id, endsAt: pin.endsAt, by: pin.pinnedBy?.displayName || '',
      name: pin.pinnedMessage.sender?.displayName || '', color: pin.pinnedMessage.sender?.chatColor || '', text: pin.pinnedMessage.content?.text || ''
    } : null
  };
}

const safe = (fn) => async (_e, ...a) => { try { return await fn(...a); } catch (e) { return { error: e.message }; } };
function init() {
  ipcMain.handle('twitch:user-ids', safe((logins) => userIds(logins || [])));
  ipcMain.handle('twitch:videos', safe(videos));
  ipcMain.handle('twitch:vod-master', safe(vodMaster));
  ipcMain.handle('twitch:clip-url', safe(clipUrl));
  ipcMain.handle('twitch:chat-extras', safe(chatExtras));
}

module.exports = { init };
