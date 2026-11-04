// Lean native Twitch chat: one WebSocket for every channel, plain DOM,
// capped history. Far lighter than loading twitch.tv's chat page per stream.
(function () {
  const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

  function parseTags(raw) {
    const tags = {};
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      const k = i < 0 ? part : part.slice(0, i);
      const v = i < 0 ? '' : part.slice(i + 1);
      tags[k] = v.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\').replace(/\\r/g, '').replace(/\\n/g, '');
    }
    return tags;
  }

  function parseLine(line) {
    let rest = line;
    let tags = {};
    let prefix = '';
    if (rest.startsWith('@')) {
      const sp = rest.indexOf(' ');
      tags = parseTags(rest.slice(1, sp));
      rest = rest.slice(sp + 1);
    }
    if (rest.startsWith(':')) {
      const sp = rest.indexOf(' ');
      prefix = rest.slice(1, sp);
      rest = rest.slice(sp + 1);
    }
    const ti = rest.indexOf(' :');
    const trailing = ti >= 0 ? rest.slice(ti + 2) : null;
    const params = (ti >= 0 ? rest.slice(0, ti) : rest).split(' ').filter(Boolean);
    const command = params.shift();
    return { tags, prefix, command, params, trailing, nick: prefix.split('!')[0] };
  }

  class TwitchChat {
    constructor(handlers) {
      this.h = handlers;
      this.channels = new Set();
      this.ws = null;
      this.auth = null;
      this.backoff = 1000;
      this.closedOnPurpose = false;
      this.userState = {};
      this.pingTimer = null;
    }

    get signedIn() { return !!this.auth; }

    connect(auth) {
      this.auth = auth || null;
      this.closedOnPurpose = false;
      if (this.ws) { this.closedOnPurpose = true; try { this.ws.close(); } catch {} }
      const ws = new WebSocket(IRC_URL);
      this.ws = ws;
      ws.onopen = () => {
        this.closedOnPurpose = false;
        this.backoff = 1000;
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        if (this.auth) {
          ws.send('PASS oauth:' + this.auth.token);
          ws.send('NICK ' + this.auth.login);
        } else {
          ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
        }
        for (const ch of this.channels) ws.send('JOIN #' + ch);
        this.h.onState?.({ connected: true, signedIn: !!this.auth });
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => { try { ws.send('PING :prism'); } catch {} }, 240000);
      };
      ws.onmessage = (e) => {
        for (const line of String(e.data).split('\r\n')) if (line) this.handle(parseLine(line));
      };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (this.ws !== ws) return;
        this.h.onState?.({ connected: false });
        if (!this.closedOnPurpose) {
          setTimeout(() => this.connect(this.auth), this.backoff);
          this.backoff = Math.min(this.backoff * 2, 30000);
        }
      };
    }

    handle(m) {
      const ch = (m.params[0] || '').replace(/^#/, '');
      switch (m.command) {
        case 'PING': this.ws.send('PONG :' + (m.trailing || 'tmi.twitch.tv')); break;
        case 'RECONNECT': this.connect(this.auth); break;
        case 'PRIVMSG': this.h.onMessage?.(ch, { tags: m.tags, nick: m.nick, text: m.trailing || '' }); break;
        case 'USERNOTICE': this.h.onNotice?.(ch, { tags: m.tags, text: m.trailing || '' }); break;
        case 'NOTICE':
          if (/authentication failed|improperly formatted auth/i.test(m.trailing || '')) {
            // Saved sign-in no longer works for chat; fall back to read-only.
            this.h.onAuthFailed?.();
            this.connect(null);
            return;
          }
          this.h.onSystem?.(ch, m.trailing || ''); break;
        case 'ROOMSTATE': if (m.tags['room-id']) this.h.onRoom?.(ch, m.tags['room-id']); break;
        case 'USERSTATE': this.userState[ch] = m.tags; break;
        case 'CLEARCHAT': this.h.onClear?.(ch, { user: m.trailing || null, tags: m.tags }); break;
        case 'CLEARMSG': this.h.onDelete?.(ch, m.tags['target-msg-id']); break;
      }
    }

    join(ch) {
      ch = ch.toLowerCase();
      if (this.channels.has(ch)) return;
      this.channels.add(ch);
      if (this.ws?.readyState === 1) this.ws.send('JOIN #' + ch);
    }

    part(ch) {
      ch = ch.toLowerCase();
      if (!this.channels.delete(ch)) return;
      if (this.ws?.readyState === 1) this.ws.send('PART #' + ch);
    }

    send(ch, text) {
      if (!this.auth || this.ws?.readyState !== 1) return false;
      text = text.replace(/[\r\n]+/g, ' ').trim();
      if (!text) return false;
      this.ws.send(`PRIVMSG #${ch} :${text}`);
      return true;
    }
  }

  // ---- Third-party emotes (7TV, BTTV, FFZ) --------------------------------
  const emoteCache = { global: null, rooms: new Map() };

  async function getJSON(url) {
    try {
      const r = await fetch(url);
      return r.ok ? r.json() : null;
    } catch { return null; }
  }

  function add7tv(map, set) {
    for (const e of set?.emotes || []) {
      const host = e.data?.host;
      if (host?.url) map.set(e.name, 'https:' + host.url + '/1x.webp');
    }
  }

  async function globalEmotes() {
    if (emoteCache.global) return emoteCache.global;
    const map = new Map();
    const [stv, bttv] = await Promise.all([
      getJSON('https://7tv.io/v3/emote-sets/global'),
      getJSON('https://api.betterttv.net/3/cached/emotes/global')
    ]);
    add7tv(map, stv);
    for (const e of bttv || []) map.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/1x`);
    emoteCache.global = map;
    return map;
  }

  async function roomEmotes(roomId) {
    if (emoteCache.rooms.has(roomId)) return emoteCache.rooms.get(roomId);
    const map = new Map();
    emoteCache.rooms.set(roomId, map);
    const [stv, bttv, ffz] = await Promise.all([
      getJSON(`https://7tv.io/v3/users/twitch/${roomId}`),
      getJSON(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`),
      getJSON(`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${roomId}`)
    ]);
    for (const e of ffz || []) if (e.images?.['1x']) map.set(e.code, e.images['1x']);
    for (const e of [...(bttv?.channelEmotes || []), ...(bttv?.sharedEmotes || [])]) map.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/1x`);
    add7tv(map, stv?.emote_set);
    return map;
  }

  // ---- Rendering ----------------------------------------------------------
  const BADGES = { broadcaster: 'LIVE', moderator: 'MOD', vip: 'VIP', subscriber: 'SUB', partner: '✓' };
  const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

  // Make names readable on a dark background.
  const colorCache = new Map();
  function readable(hex, nick) {
    if (!hex) {
      let h = 0;
      for (const c of nick) h = (h * 31 + c.charCodeAt(0)) % 360;
      return `hsl(${h} 70% 68%)`;
    }
    if (colorCache.has(hex)) return colorCache.get(hex);
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 110) {
      const k = 110 / Math.max(lum, 20);
      r = Math.min(255, r * k + 50); g = Math.min(255, g * k + 50); b = Math.min(255, b * k + 50);
    }
    const out = `rgb(${r | 0},${g | 0},${b | 0})`;
    colorCache.set(hex, out);
    return out;
  }

  function emoteImg(url, name) {
    const img = document.createElement('img');
    img.className = 'emote';
    img.src = url;
    img.alt = name;
    img.title = name;
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  // Twitch gives emote positions in code points: "25:0-4,6-10/1902:12-16".
  function renderText(container, text, emotesTag, extra, selfLogin) {
    const chars = Array.from(text);
    const ranges = [];
    if (emotesTag) {
      for (const group of emotesTag.split('/')) {
        const [id, pos] = group.split(':');
        if (!pos) continue;
        for (const p of pos.split(',')) {
          const [a, b] = p.split('-').map(Number);
          ranges.push({ a, b, id });
        }
      }
      ranges.sort((x, y) => x.a - y.a);
    }
    let mention = false;
    const pushWords = (str) => {
      const parts = str.split(/(\s+)/);
      let buf = '';
      const flush = () => { if (buf) { container.appendChild(document.createTextNode(buf)); buf = ''; } };
      for (const w of parts) {
        if (!w) continue;
        if (extra && extra(w)) { flush(); container.appendChild(emoteImg(extra(w), w)); continue; }
        if (URL_RE.test(w)) {
          flush();
          const a = document.createElement('a');
          a.textContent = w;
          a.href = '#';
          a.dataset.url = w.startsWith('http') ? w : 'https://' + w;
          container.appendChild(a);
          continue;
        }
        if (selfLogin && w.toLowerCase().replace(/[@,.!?:]/g, '') === selfLogin) mention = true;
        buf += w;
      }
      flush();
    };
    let i = 0;
    for (const r of ranges) {
      if (r.a < i) continue;
      pushWords(chars.slice(i, r.a).join(''));
      const name = chars.slice(r.a, r.b + 1).join('');
      container.appendChild(emoteImg(`https://static-cdn.jtvnw.net/emoticons/v2/${r.id}/default/dark/1.0`, name));
      i = r.b + 1;
    }
    pushWords(chars.slice(i).join(''));
    return mention;
  }

  function renderMessage({ tags, nick, text }, opts) {
    const el = document.createElement('div');
    el.className = 'msg';
    if (tags.id) el.dataset.id = tags.id;
    el.dataset.user = (tags.login || nick || '').toLowerCase();

    for (const b of (tags.badges || '').split(',')) {
      const key = b.split('/')[0];
      if (BADGES[key]) {
        const s = document.createElement('span');
        s.className = 'badge b-' + key;
        s.textContent = BADGES[key];
        el.appendChild(s);
      }
    }

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = tags['display-name'] || nick;
    name.style.color = readable(tags.color, nick || '');
    el.appendChild(name);

    let action = false;
    if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) {
      text = text.slice(8, -1);
      action = true;
    }
    el.appendChild(document.createTextNode(action ? ' ' : ': '));

    const body = document.createElement('span');
    body.className = 'text';
    if (action) body.style.color = name.style.color;
    const mention = renderText(body, text, tags.emotes, opts.extraEmote, opts.selfLogin);
    if (mention) el.classList.add('mention');
    el.appendChild(body);
    return el;
  }

  window.PrismChat = { TwitchChat, globalEmotes, roomEmotes, renderMessage };
})();
