// Predictions, polls and mod actions for the chat you're looking at.
// Everything goes through Twitch's own web requests, signed in as you; if
// Twitch asks for its security header, the request is tried again with it.
const { ipcMain } = require('electron');
const crypto = require('crypto');
const live = require('./twitch-live');

const login = (l) => String(l || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
const rid = () => crypto.randomBytes(16).toString('hex');

// Run a request; on an integrity complaint get the header and try once more.
async function run(query, variables) {
  let r = await live.gql(query, variables, true, !!live.freshIntegrity());
  const bad = (x) => (x.errors || []).some((e) => e?.extensions?.code === 'IntegrityCheckFailed' || /integrity/i.test(e?.message || ''));
  if (bad(r) && (await live.ensureIntegrity())) r = await live.gql(query, variables, true, true);
  return r;
}

let myId = null;
async function selfId() {
  if (myId) return myId;
  const r = await live.gql('query { currentUser { id login } }', {}, true);
  myId = r.data?.currentUser?.id || null;
  return myId;
}

const PRED = `id status title createdAt lockedAt endedAt predictionWindowSeconds
  outcomes { id title color totalPoints totalUsers topPredictors { points user { displayName } } }
  winningOutcome { id }`;

// The prediction and poll going on in a channel (and your part in them).
async function state(l) {
  l = login(l);
  // Signed out, predictions can still be seen; polls and your own part need you signed in.
  const q = (me) => {
    const mine = me ? ' self { prediction { points outcome { id } } }' : '';
    return `query($l: String!) {
    channel(name: $l) { id
      ${me ? 'self { communityPoints { balance } }' : ''}
      activePredictionEvents { ${PRED}${mine} }
      lockedPredictionEvents { ${PRED}${mine} }
      resolvedPredictionEvents(first: 1) { edges { node { ${PRED}${mine} } } } }
    ${me ? `user(login: $l) { latestPoll { id title status durationSeconds startedAt endedAt remainingDurationMilliseconds totalVoters
      choices { id title totalVoters votes { total } } } }` : ''} }`;
  };
  let r = await live.gql(q(true), { l }, true);
  if (!r.signedIn) r = { ...(await live.gql(q(false), { l })), signedIn: false };
  const ch = r.data?.channel;
  if (!ch) return { error: live.errText(r) || 'unavailable' };
  const pack = (e) => e && {
    id: e.id, status: e.status, title: e.title, createdAt: e.createdAt, lockedAt: e.lockedAt, endedAt: e.endedAt, window: e.predictionWindowSeconds,
    winner: e.winningOutcome?.id || null,
    outcomes: (e.outcomes || []).map((o) => ({ id: o.id, title: o.title, color: o.color, points: o.totalPoints || 0, users: o.totalUsers || 0,
      top: o.topPredictors?.[0] ? { name: o.topPredictors[0].user?.displayName || '', points: o.topPredictors[0].points } : null })),
    mine: e.self?.prediction ? { points: e.self.prediction.points, outcome: e.self.prediction.outcome?.id } : null
  };
  const resolved = ch.resolvedPredictionEvents?.edges?.[0]?.node;
  const pred = ch.activePredictionEvents?.[0] || ch.lockedPredictionEvents?.[0] ||
    // a result stays up for 3 minutes after it's decided
    (resolved && resolved.endedAt && Date.now() - new Date(resolved.endedAt) < 3 * 60 * 1000 ? resolved : null);
  const p = r.data?.user?.latestPoll;
  const poll = p && (p.status === 'ACTIVE' || (p.endedAt && Date.now() - new Date(p.endedAt) < 2 * 60 * 1000)) ? {
    id: p.id, title: p.title, status: p.status, endsAt: p.status === 'ACTIVE' && p.remainingDurationMilliseconds != null ? Date.now() + p.remainingDurationMilliseconds : null,
    total: p.totalVoters || 0,
    choices: (p.choices || []).map((c) => ({ id: c.id, title: c.title, votes: c.votes?.total ?? c.totalVoters ?? 0 }))
  } : null;
  return { channelId: ch.id, signedIn: r.signedIn !== false, balance: ch.self?.communityPoints?.balance ?? null, prediction: pack(pred), poll };
}

async function predict({ eventId, outcomeId, points }) {
  points = Math.floor(Number(points));
  if (!eventId || !outcomeId || !(points > 0)) return { ok: false, error: 'Pick an amount.' };
  const r = await run(`mutation($i: MakePredictionInput!) { makePrediction(input: $i) { prediction { id points } error { code maxPointsPerEvent } } }`,
    { i: { eventID: eventId, outcomeID: outcomeId, points, transactionID: rid() } });
  if (!r.signedIn) return { ok: false, error: 'Sign in to Twitch first.' };
  const out = r.data?.makePrediction;
  if (out?.prediction) return { ok: true };
  const code = out?.error?.code || '';
  const msg = {
    NOT_ENOUGH_POINTS: "You don't have that many channel points.",
    EVENT_NOT_ACTIVE: 'Predictions are closed.',
    MAX_POINTS_PER_EVENT: `That's over the limit for this prediction${out?.error?.maxPointsPerEvent ? ` (${out.error.maxPointsPerEvent.toLocaleString()})` : ''}.`,
    DUPLICATE_TRANSACTION: 'Already sent.',
    USER_BANNED: "You can't predict in this channel."
  }[code];
  return { ok: false, error: msg || code || (live.errText(r)) || 'Twitch refused the prediction.' };
}

async function vote({ pollId, choiceId }) {
  const uid = await selfId();
  if (!uid) return { ok: false, error: 'Sign in to Twitch first.' };
  const r = await run(`mutation($i: VoteInPollInput!) { voteInPoll(input: $i) { error { code } } }`,
    { i: { pollID: pollId, choiceID: choiceId, userID: uid, voteID: rid() } });
  const out = r.data?.voteInPoll;
  if (out && !out.error) return { ok: true };
  const code = out?.error?.code || '';
  return { ok: false, error: { POLL_NOT_ACTIVE: 'The poll has ended.', USER_ALREADY_VOTED: 'You already voted.', VOTE_ID_CONFLICT: 'You already voted.' }[code] || code || (live.errText(r)) || 'Twitch refused the vote.' };
}

// Delete a message, time someone out, ban or unban (channels you moderate).
async function mod({ action, channelId, user, messageId, seconds, reason }) {
  let r, out;
  if (action === 'delete') {
    r = await run(`mutation($i: DeleteChatMessageInput!) { deleteChatMessage(input: $i) { responseCode } }`, { i: { channelID: channelId, messageID: messageId } });
    out = r.data?.deleteChatMessage;
    if (out && (!out.responseCode || out.responseCode === 'SUCCESS')) return { ok: true };
    return { ok: false, error: friendly(out?.responseCode || errOf(r)) };
  }
  if (action === 'unban') {
    r = await run(`mutation($i: UnbanUserFromChatRoomInput!) { unbanUserFromChatRoom(input: $i) { ban { bannedUser { login } } error { code } } }`,
      { i: { channelID: channelId, bannedUserLogin: login(user) } });
    out = r.data?.unbanUserFromChatRoom;
    return out && !out.error ? { ok: true } : { ok: false, error: friendly(out?.error?.code || errOf(r)) };
  }
  const input = { channelID: channelId, bannedUserLogin: login(user), reason: reason || '' };
  if (action === 'timeout') input.expiresIn = Math.max(1, Math.round(seconds || 600)) + 's';
  r = await run(`mutation($i: BanUserFromChatRoomInput!) { banUserFromChatRoom(input: $i) { ban { bannedUser { login } expiresAt } error { code } } }`, { i: input });
  out = r.data?.banUserFromChatRoom;
  return out && !out.error ? { ok: true } : { ok: false, error: friendly(out?.error?.code || errOf(r)) };
}
const errOf = (r) => (!r.signedIn ? 'SIGNED_OUT' : live.errText(r)) || '';
function friendly(code) {
  return {
    SIGNED_OUT: 'Sign in to Twitch first.',
    FORBIDDEN: "You're not a moderator in this channel.",
    TARGET_IS_MODERATOR: "Moderators can't be banned or timed out.",
    TARGET_IS_BROADCASTER: "The streamer can't be banned.",
    TARGET_ALREADY_BANNED: 'Already banned.',
    TARGET_NOT_BANNED: "They aren't banned.",
    TARGET_IS_SELF: "That's you.",
    TARGET_NOT_FOUND: 'No one by that name.',
    TARGET_IS_ANONYMOUS: 'No one by that name.',
    DURATION_INVALID: 'That length is not allowed.'
  }[code] || code || 'Twitch refused.';
}

const safe = (fn) => async (_e, arg) => { try { return await fn(arg); } catch (e) { return { ok: false, error: e.message || String(e) }; } };
function init() {
  ipcMain.handle('twitch:interact-state', safe(state));
  ipcMain.handle('twitch:predict', safe(predict));
  ipcMain.handle('twitch:poll-vote', safe(vote));
  ipcMain.handle('twitch:mod', safe(mod));
}

module.exports = { init };
