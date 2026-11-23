// Runs in Kick's chat page (kick.com/popout/<channel>/chat) inside Prism's
// chat panel. It listens to the same live chat feed Kick's page uses and
// remembers each person's recent messages, so clicking a message opens that
// person's chat history in Prism, like Twitch chat does.
//
// Finding who was clicked doesn't depend on how Kick builds its page: the
// clicked line's text is matched against the messages heard on the feed.
const { ipcRenderer } = require('electron');

const route = /^\/popout\/([^/]+)\/chat/.exec(location.pathname);
if (location.hostname === 'kick.com' && route) {
  const slug = route[1].toLowerCase();
  const PUSHER = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';
  const PER_USER = 60;
  const users = new Map();   // lower name -> { name, color, badges, msgs: [{ text, raw, at }] }
  const recent = [];         // newest last: { key, name, plain }
  let watching = null;       // the person whose card is open in Prism

  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // "[emote:37226:KEKW] hi" -> "hi" (emotes show as pictures, not text)
  const plainOf = (c) => norm(String(c || '').replace(/\[emote:\d+:[^\]]*\]/g, ' '));

  function add(m) {
    const s = m?.sender;
    if (!s?.username || m.type === 'gift' ) return;
    const key = s.username.toLowerCase();
    let u = users.get(key);
    if (!u) { u = { name: s.username, color: '', badges: [], msgs: [] }; users.set(key, u); }
    u.color = s.identity?.color || u.color;
    u.badges = (s.identity?.badges || []).map((b) => ({ type: b.type, text: b.text, count: b.count }));
    const at = Date.parse(m.created_at) || Date.now();
    if (m.id && u.msgs.some((x) => x.id === m.id)) return;
    u.msgs.push({ id: m.id, raw: String(m.content || ''), at });
    if (u.msgs.length > PER_USER) u.msgs.shift();
    recent.push({ key, name: norm(s.username), plain: plainOf(m.content) });
    if (recent.length > 400) recent.shift();
    if (users.size > 3000) users.delete(users.keys().next().value);
    if (watching === key) send('prism-kick-user-update', key);
  }
  function card(key) {
    const u = users.get(key);
    return u && { slug, login: key, name: u.name, color: u.color, badges: u.badges, msgs: u.msgs };
  }
  function send(channel, key) { try { ipcRenderer.sendToHost(channel, card(key)); } catch {} }

  async function start() {
    let info;
    try { info = await (await fetch(`/api/v2/channels/${slug}`, { headers: { Accept: 'application/json' } })).json(); } catch { return; }
    const chatroom = info?.chatroom?.id;
    if (!chatroom) return;
    // The last messages from before the page opened.
    if (info.id) {
      fetch(`/api/v2/channels/${info.id}/messages`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((j) => {
        const list = (j?.data?.messages || j?.messages || []).slice().sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
        for (const m of list) add(m);
      }).catch(() => {});
    }
    connect(chatroom);
  }
  function connect(chatroom) {
    let ws;
    try { ws = new WebSocket(PUSHER); } catch { return; }
    ws.onopen = () => ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroom}.v2` } }));
    ws.onmessage = (e) => {
      let d;
      try { d = JSON.parse(e.data); } catch { return; }
      if (d.event === 'pusher:ping') { ws.send(JSON.stringify({ event: 'pusher:pong', data: {} })); return; }
      if (d.event === 'App\\Events\\ChatMessageEvent') { try { add(typeof d.data === 'string' ? JSON.parse(d.data) : d.data); } catch {} }
    };
    ws.onclose = () => setTimeout(() => connect(chatroom), 5000);
  }

  // Which message line was clicked? The closest element (from the click
  // outward) whose text holds a known sender's name and that message's words.
  function whoClicked(target) {
    let el = target;
    for (let i = 0; el && el !== document.body && i < 10; i++, el = el.parentElement) {
      const t = norm(el.textContent);
      if (t.length < 2) continue;
      if (t.length > 1000) return null;
      // One message line holds one message. Holding several means we've
      // climbed past the line into the chat list (a click on empty space).
      const hits = [];
      for (let j = recent.length - 1; j >= 0 && hits.length < 2; j--) {
        const r = recent[j];
        if (!t.includes(r.name)) continue;
        if (r.plain && !t.includes(r.plain.slice(0, 40))) continue;
        hits.push(r);
      }
      if (hits.length === 1) return hits[0].key;
      if (hits.length > 1) return null;
    }
    return null;
  }
  document.addEventListener('click', (e) => {
    if (e.button !== 0 || e.defaultPrevented) return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"], a[href], [role="dialog"], form')) return;
    const key = whoClicked(e.target);
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    watching = key;
    send('prism-kick-user', key);
  }, true);
  ipcRenderer.on('prism-kick-card-closed', () => { watching = null; });

  start();
}
