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
  const DEFAULT_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57',
    '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];
  const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

  // Make names readable on a dark background.
  const colorCache = new Map();
  const isLight = () => document.documentElement.dataset.theme === 'light';
  function readable(hex, nick) {
    const light = isLight();
    if (!hex) {
      // No color picked: Twitch gives these people one of its 15 defaults.
      let h = 0;
      for (const c of nick) h = (h + c.charCodeAt(0)) | 0;
      hex = DEFAULT_COLORS[Math.abs(h) % DEFAULT_COLORS.length];
    }
    const ck = hex + (light ? 'L' : 'D');
    if (colorCache.has(ck)) return colorCache.get(ck);
    // Like Twitch: keep the hue, but lighten (dark chat) or darken (light
    // chat) the color until it's easy to read on the background.
    const n = parseInt(hex.slice(1), 16);
    let [h, sat, l] = toHsl(n >> 16, (n >> 8) & 255, n & 255);
    const bg = light ? 1 : 0.0093; // relative luminance of #fff / #18181b
    const contrast = (lum) => (Math.max(lum, bg) + 0.05) / (Math.min(lum, bg) + 0.05);
    for (let i = 0; i < 20 && contrast(relLum(...fromHsl(h, sat, l))) < 4.5; i++) l = light ? l - 0.04 : l + 0.04;
    const [r, g, b] = fromHsl(h, sat, Math.max(0, Math.min(1, l)));
    const out = `rgb(${r},${g},${b})`;
    colorCache.set(ck, out);
    return out;
  }
  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function fromHsl(h, s, l) {
    if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  }
  function relLum(r, g, b) {
    const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  }
  // Re-tune an already-shown name color after a theme switch.
  function recolor(css) {
    const m = String(css).match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return css;
    const hex = '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
    return readable(hex, '');
  }

  function emoteImg(url, name) {
    const img = document.createElement('img');
    img.className = 'emote';
    img.src = url;
    if (url.endsWith('/1.0')) img.srcset = url.slice(0, -3) + '2.0 2x';
    img.alt = name;
    img.title = name;
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  // Twitch gives emote positions in code points: "25:0-4,6-10/1902:12-16".
  function renderText(container, text, emotesTag, extra, selfLogin, cheer) {
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
        if (cheer) { const c = cheer(w); if (c) { flush(); container.appendChild(c); continue; } }
        if (w[0] === '@' && w.length > 1) {
          flush();
          const m = document.createElement('span');
          m.className = 'mention-frag';
          m.textContent = w;
          if (selfLogin && w.slice(1).toLowerCase().replace(/[,.!?:]/g, '') === selfLogin) { m.classList.add('me'); mention = true; }
          container.appendChild(m);
          continue;
        }
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

  // "Cheer100" in a message with bits: the cheer picture and the amount, in
  // the tier's color, like on Twitch.
  function cheerMaker(opts) {
    const cheers = opts.cheers;
    if (!cheers) return null;
    return (w) => {
      const m = /^([a-z][a-z0-9]*?)(\d+)$/i.exec(w);
      const c = m && cheers[m[1].toLowerCase()];
      if (!c) return null;
      const bits = Number(m[2]);
      if (!bits) return null;
      let tier = c.tiers[0] || 1;
      for (const t of c.tiers) if (bits >= t) tier = t;
      let color = '';
      for (const [b, col] of opts.cheerColors || []) if (tier >= b) color = col;
      const url = (scale) => c.t.replace('PREFIX', c.p.toLowerCase()).replace('BACKGROUND', opts.light ? 'light' : 'dark')
        .replace('ANIMATION', 'animated').replace('TIER', tier).replace('SCALE', scale).replace('EXTENSION', 'gif');
      const wrap = document.createElement('span');
      wrap.className = 'cheer';
      const img = emoteImg(url('1'), w);
      img.srcset = url('2') + ' 2x';
      const n = document.createElement('span');
      n.className = 'cheer-n';
      n.textContent = bits;
      if (color) n.style.color = color;
      wrap.append(img, n);
      return wrap;
    };
  }

  function renderMessage({ tags, nick, text }, opts) {
    const el = document.createElement('div');
    el.className = 'msg';
    const kind = tags['msg-id'];
    if (kind === 'highlighted-message') el.classList.add('highlighted');
    if (kind === 'gigantified-emote-message') el.classList.add('giant');
    if (tags.id) el.dataset.id = tags.id;
    el.dataset.user = (tags.login || nick || '').toLowerCase();

    // A reply: show who and what it answers above the message, and drop the
    // "@name " Twitch puts at the start (its emote positions shift with it).
    const parentName = tags['reply-parent-display-name'] || tags['reply-parent-user-login'];
    let emotes = tags.emotes;
    if (parentName) {
      const ref = document.createElement('div');
      ref.className = 'reply-ref';
      const who = document.createElement('span');
      who.className = 'reply-who';
      who.textContent = '@' + parentName;
      const what = document.createElement('span');
      what.className = 'reply-body';
      what.textContent = tags['reply-parent-msg-body'] || '';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 20 20');
      icon.setAttribute('class', 'reply-icon');
      icon.innerHTML = '<path fill="currentColor" d="M8.5 5.5 7.086 4.086 2 9.172V10l5.086 5.086L8.5 13.672 5.828 11H12a4 4 0 0 1 4 4v1h2v-1a6 6 0 0 0-6-6H5.828L8.5 5.5Z"/>';
      ref.append(icon, 'Replying to ', who, what.textContent ? ': ' : '', what);
      ref.title = `@${parentName}: ${tags['reply-parent-msg-body'] || ''}`;
      if (tags['reply-parent-msg-id']) ref.dataset.parent = tags['reply-parent-msg-id'];
      ref.dataset.login = String(tags['reply-parent-user-login'] || parentName).toLowerCase();
      el.appendChild(ref);
      el.classList.add('reply');
      const m = text.match(/^@(\S+)\s+/);
      if (m && m[1].toLowerCase() === String(tags['reply-parent-user-login'] || parentName).toLowerCase()) {
        const cut = [...m[0]].length;
        text = text.slice(m[0].length);
        if (emotes) emotes = emotes.split('/').map((grp) => {
          const [id, pos] = grp.split(':');
          const kept = (pos || '').split(',').map((r) => r.split('-').map(Number)).filter(([a]) => a >= cut).map(([a, b]) => `${a - cut}-${b - cut}`);
          return kept.length ? id + ':' + kept.join(',') : '';
        }).filter(Boolean).join('/');
      }
      if (opts.selfLogin && String(tags['reply-parent-user-login'] || '').toLowerCase() === opts.selfLogin) el.classList.add('mention');
    }

    const info = {};
    for (const x of (tags['badge-info'] || '').split(',')) { const [k, v] = x.split('/'); if (k) info[k] = v; }
    for (const b of (tags.badges || '').split(',')) {
      if (!b) continue;
      const key = b.split('/')[0];
      const real = opts.badge && opts.badge(b);
      if (real) {
        const img = document.createElement('img');
        img.className = 'badge-img';
        img.src = real[0] + '1';
        img.srcset = real[0] + '2 2x';
        img.alt = real[1];
        img.title = key === 'subscriber' && info.subscriber ? `${real[1]} (${info.subscriber} months)` : real[1];
        img.decoding = 'async';
        el.appendChild(img);
      } else if (BADGES[key]) {
        const s = document.createElement('span');
        s.className = 'badge b-' + key;
        s.textContent = BADGES[key];
        el.appendChild(s);
      }
    }

    const name = document.createElement('span');
    name.className = 'name';
    const display = tags['display-name'] || nick;
    const login = tags.login || nick || '';
    // Names in other alphabets get the login after them, like on Twitch.
    name.textContent = display && login && display.toLowerCase() !== login.toLowerCase() && /[^\x00-\x7f]/.test(display) ? `${display} (${login})` : display;
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
    const mention = renderText(body, text, emotes, opts.extraEmote, opts.selfLogin, tags.bits ? cheerMaker(opts) : null);
    if (mention) el.classList.add('mention');
    el.appendChild(body);
    return el;
  }

  window.PrismChat = { TwitchChat, globalEmotes, roomEmotes, renderMessage, parseLine, recolor };
})();
