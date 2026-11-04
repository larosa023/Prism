/* global prism, parseStream, PrismChat */
(async function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids) if (kid != null) el.append(kid);
    return el;
  };

  const info = await prism.info();
  let S = await prism.settings.get();
  const PLAT_NAMES = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', kick: 'Kick' };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  const save = (patch) => prism.settings.set(patch).then((s) => (S = s));
  const keyOf = (s) => s.platform + ':' + s.id;

  // =========================================================================
  // Views
  // =========================================================================
  let currentView = null;
  function showView(name) {
    if (name === 'kick' && !S.showKick) name = 'multiview';
    if (currentView === name) return;
    const prev = currentView;
    currentView = name;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('#add-form').style.visibility = name === 'multiview' ? 'visible' : 'hidden';
    if (Browse[name]) Browse[name].show();
    if (prev && Browse[prev]) Browse[prev].hide();
    if (name === 'settings') renderSettings();
    if (prev === 'twitch') refreshChatAuth(); // you may have just signed in
    if (name === 'multiview') requestAnimationFrame(layout);
    save({ lastView: name === 'settings' ? S.lastView : name });
  }
  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  // =========================================================================
  // Browse tabs (full Twitch / YouTube / TikTok / Kick sites, signed in)
  // =========================================================================
  const Browse = {};
  for (const platform of ['twitch', 'youtube', 'tiktok', 'kick']) {
    const root = $('#view-' + platform);
    const p = info.platforms[platform];
    let wv = null;
    let lastUrl = p.home;
    let unloadTimer = null;

    const urlEl = h('div', { class: 'url' });
    const addBtn = h('button', { class: 'btn btn-accent', text: '+ Multi-view', hidden: true, onclick: () => {
      const parsed = parseStream(lastUrl);
      if (parsed) { addStream(parsed); showView('multiview'); }
    } });
    const bar = h('div', { class: 'browse-bar' },
      h('button', { class: 'icon-btn', title: 'Back', text: '←', onclick: () => wv?.canGoBack() && wv.goBack() }),
      h('button', { class: 'icon-btn', title: 'Forward', text: '→', onclick: () => wv?.canGoForward() && wv.goForward() }),
      h('button', { class: 'icon-btn', title: 'Reload', text: '⟳', onclick: () => wv?.reload() }),
      h('button', { class: 'icon-btn', title: 'Home', text: '⌂', onclick: () => wv?.loadURL(p.home) }),
      urlEl,
      platform === 'tiktok' ? null : addBtn
    );
    root.append(bar);

    const onNav = () => {
      if (!wv) return;
      lastUrl = wv.getURL();
      urlEl.textContent = lastUrl.replace(/^https?:\/\//, '');
      const parsed = parseStream(lastUrl);
      addBtn.hidden = !(parsed && parsed.platform === platform && (parsed.id || parsed.resolve));
    };

    function load() {
      if (wv) return;
      const attrs = { partition: p.partition, src: lastUrl, allowpopups: true, webpreferences: 'backgroundThrottling=yes' };
      if (platform === 'twitch') attrs.preload = info.twitchPreload; // ad handling on the full site too
      wv = h('webview', attrs);
      wv.addEventListener('did-navigate', onNav);
      wv.addEventListener('did-navigate-in-page', onNav);
      wv.addEventListener('dom-ready', onNav, { once: true });
      if (platform === 'youtube') wv.addEventListener('dom-ready', applyYouTubeRows);
      root.append(wv);
    }

    function unload() {
      if (!wv) return;
      if (wv.isCurrentlyAudible?.()) { unloadTimer = setTimeout(unload, 60000); return; }
      try { lastUrl = wv.getURL() || lastUrl; } catch {}
      wv.remove();
      wv = null;
    }

    // YouTube Row Fixer: choose how many videos sit in each row.
    let rowCssKey = null;
    async function applyYouTubeRows() {
      if (!wv || platform !== 'youtube') return;
      try {
        if (rowCssKey) { await wv.removeInsertedCSS(rowCssKey); rowCssKey = null; }
        const n = Number(S.youtubeRowCount) || 0;
        if (!n) return;
        rowCssKey = await wv.insertCSS(`
          ytd-rich-grid-renderer {
            --ytd-rich-grid-items-per-row: ${n} !important;
            --ytd-rich-grid-posts-per-row: ${n} !important;
            --ytd-rich-grid-slim-items-per-row: ${n + 1} !important;
            --ytd-rich-grid-game-cards-per-row: ${n + 1} !important;
          }
          ytd-rich-grid-row, ytd-rich-grid-row > #contents { display: contents !important; }
        `);
      } catch {}
    }

    Browse[platform] = {
      applyYouTubeRows,
      show() { clearTimeout(unloadTimer); load(); },
      hide() {
        clearTimeout(unloadTimer);
        if (S.unloadInactiveTabs) unloadTimer = setTimeout(unload, 120000);
      },
      reload() { if (wv) wv.reload(); },
      destroy() { clearTimeout(unloadTimer); lastUrl = p.home; if (wv) { wv.remove(); wv = null; } }
    };
  }

  // =========================================================================
  // Multi-view
  // =========================================================================
  const stage = $('#stage');
  const tiles = new Map(); // key -> { el, wv, stream, ready }
  let streams = Array.isArray(S.streams) ? S.streams : [];
  let focusKey = streams[0] ? keyOf(streams[0]) : null;
  let chatKey = null;

  const visibleStreams = () => streams.filter((s) => s.platform !== 'kick' || S.showKick);
  const chatStreams = () => visibleStreams().filter((s) => !s.chatOff);
  const persistStreams = () => save({ streams: streams.map(({ forceEmbed, ...rest }) => rest) });

  function playerUrl(s) {
    if (s.platform === 'twitch') return `https://player.twitch.tv/?channel=${encodeURIComponent(s.id)}&parent=twitch.tv&autoplay=true&muted=false`;
    if (s.platform === 'youtube') return `https://www.youtube.com/embed/${encodeURIComponent(s.id)}?autoplay=1&playsinline=1&rel=0`;
    if (s.platform === 'kick') return `https://player.kick.com/${encodeURIComponent(s.id)}?autoplay=true&muted=false`;
  }

  const useNative = (s) => s.platform === 'twitch' && S.twitchPlayer !== 'embed' && !s.forceEmbed && window.NativeTwitchPlayer && window.Hls?.isSupported();

  function makeTile(s) {
    const key = keyOf(s);
    const muteBtn = h('button', { class: 'tile-btn', title: 'Sound', onclick: () => setMuted(key, !s.muted) });
    const mutedTag = h('div', { class: 'tile-muted', text: 'Muted' });
    const statusEl = h('div', { class: 'tile-status', hidden: true });
    const extra = h('div', { class: 'tile-extra' });
    const t = { el: null, stream: s, ready: false, muteBtn, mutedTag, statusEl };

    let media;
    if (useNative(s)) {
      // Lightweight player: a <video> in this window, no extra browser process.
      const player = new NativeTwitchPlayer(s.id, {
        onStatus: (msg) => { statusEl.textContent = msg; statusEl.hidden = !msg; },
        onLevels: (levels) => {
          const opts = [['auto', 'Auto (fit tile)'], ['source', 'Source']];
          const seen = new Set();
          for (const l of levels.sort((a, b) => b.height - a.height)) {
            if (!l.height || seen.has(l.height)) continue;
            seen.add(l.height);
            opts.push([String(l.height), l.height + 'p' + (l.fps > 30 ? l.fps : '')]);
          }
          quality.textContent = '';
          for (const [v, label] of opts) quality.append(h('option', { value: v, text: label }));
          quality.value = opts.some(([v]) => v === (s.quality || 'auto')) ? (s.quality || 'auto') : 'auto';
        },
        onFatal: (why) => {
          // Fall back to Twitch's own player for this stream.
          toast(`Switched ${s.label || s.id} to Twitch's player (${why}).`);
          s.forceEmbed = true;
          t.destroy();
          tiles.delete(key);
          renderStage();
        }
      });
      const quality = h('select', { class: 'tile-select', title: 'Quality', onchange: () => {
        s.quality = quality.value; player.setQuality(s.quality); persistStreams();
      } }, h('option', { value: 'auto', text: 'Auto' }));
      const volume = h('input', { class: 'tile-volume', type: 'range', min: 0, max: 1, step: 0.05, value: s.volume ?? 1, title: 'Volume',
        oninput: () => { s.volume = Number(volume.value); player.setVolume(s.volume); if (s.muted && s.volume > 0) setMuted(key, false); },
        onchange: () => persistStreams() });
      extra.append(volume, quality);
      player.setQuality(s.quality || 'auto');
      player.setVolume(s.volume ?? 1);
      media = player.video;
      media.className = 'tile-video';
      media.addEventListener('dblclick', () => (document.fullscreenElement ? document.exitFullscreen() : t.el.requestFullscreen().catch(() => {})));
      t.ready = true;
      t.player = player;
      t.setAudio = (muted) => player.setMuted(muted);
      t.reload = () => player.start();
      t.destroy = () => { player.destroy(); t.el.remove(); };
      requestAnimationFrame(() => player.start());
    } else {
      const wvAttrs = { partition: info.platforms[s.platform].partition, src: playerUrl(s), webpreferences: 'backgroundThrottling=no' };
      if (s.platform === 'twitch') wvAttrs.preload = info.twitchPreload;
      if (s.platform === 'youtube') wvAttrs.httpreferrer = 'https://www.youtube.com/';
      const wv = h('webview', wvAttrs);
      media = wv;
      t.wv = wv;
      t.setAudio = (muted) => { if (t.ready) try { wv.setAudioMuted(muted); } catch {} };
      t.reload = () => wv.reload();
      t.destroy = () => t.el.remove();
      wv.addEventListener('dom-ready', () => { t.ready = true; applyMute(t); });
    }

    const bar = h('div', { class: 'tile-bar' },
      h('span', { class: 'tile-label' }, h('span', { class: 'p p-' + s.platform, text: PLAT_NAMES[s.platform].toUpperCase() }), s.label || s.id),
      h('div', { class: 'grow' }),
      extra,
      muteBtn,
      h('button', { class: 'tile-btn', title: 'Make main (Focus layout)', text: '⤢', onclick: () => { focusKey = key; if (S.layout !== 'focus') setLayout('focus'); else layout(); } }),
      h('button', { class: 'tile-btn', title: 'Show this chat', text: 'Chat', onclick: () => setChat(key) }),
      h('button', { class: 'tile-btn', title: 'Reload', text: '⟳', onclick: () => t.reload() }),
      h('button', { class: 'tile-btn', title: 'Remove', text: '✕', onclick: () => removeStream(key) })
    );
    t.el = h('div', { class: 'tile' }, media, bar, statusEl, mutedTag);
    tiles.set(key, t);
    applyMute(t);
    return t;
  }

  function applyMute(t) {
    t.muteBtn.textContent = t.stream.muted ? '🔇' : '🔊';
    t.mutedTag.hidden = !t.stream.muted;
    t.setAudio(!!t.stream.muted);
  }

  function setMuted(key, muted) {
    for (const s of streams) {
      if (keyOf(s) === key) s.muted = muted;
      else if (!muted && S.singleAudio) s.muted = true;
    }
    for (const t of tiles.values()) applyMute(t);
    persistStreams();
  }

  function renderStage() {
    const vis = visibleStreams();
    const keys = new Set(vis.map(keyOf));
    for (const [k, t] of tiles) if (!keys.has(k)) { t.destroy(); tiles.delete(k); }
    vis.forEach((s, i) => {
      const k = keyOf(s);
      let t = tiles.get(k);
      if (!t) { t = makeTile(s); stage.append(t.el); }
      t.el.style.order = i; // reorder with CSS so players never reload
    });
    if (!focusKey || !keys.has(focusKey)) focusKey = vis[0] ? keyOf(vis[0]) : null;
    $('#empty').hidden = vis.length > 0;
    $('#stage-count').textContent = vis.length ? `${vis.length} stream${vis.length > 1 ? 's' : ''}` : '';
    renderChatTabs();
    renderSideLive();
    layout();
  }

  function layout() {
    // Only lay out streams whose player tile exists (a resize can fire mid-update).
    const vis = visibleStreams().filter((s) => tiles.has(keyOf(s)));
    const n = vis.length;
    const W = stage.clientWidth - 20;
    const H = stage.clientHeight - 10;
    const gap = 6;
    stage.classList.toggle('focus', S.layout === 'focus' && n > 1);
    for (const t of tiles.values()) {
      t.el.classList.toggle('chat-target', keyOf(t.stream) === chatKey && n > 1);
      t.el.classList.remove('main');
      t.el.style.width = t.el.style.height = t.el.style.gridRow = t.el.style.gridColumn = '';
    }
    if (!n || W <= 0 || H <= 0) return;

    if (S.layout === 'focus' && n > 1) {
      const sideW = Math.max(220, Math.min(W * 0.24, 420));
      stage.style.gridTemplateColumns = `1fr ${sideW}px`;
      stage.style.gridTemplateRows = '';
      stage.style.alignContent = 'start';
      stage.style.overflowY = 'auto';
      let side = 0;
      vis.forEach((s) => {
        const t = tiles.get(keyOf(s));
        if (keyOf(s) === focusKey) {
          t.el.classList.add('main');
          t.el.style.gridColumn = '1';
          t.el.style.gridRow = `1 / span ${n - 1}`;
          t.el.style.height = H + 'px';
          t.el.style.order = -1;
        } else {
          t.el.style.gridColumn = '2';
          t.el.style.order = ++side;
        }
      });
      return;
    }

    // Grid: choose the column count that makes each 16:9 tile as big as possible.
    let best = { cols: 1, w: 0 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * 16 / 9);
      if (w > best.w) best = { cols, w };
    }
    stage.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.floor(best.w)}px)`;
    stage.style.gridTemplateRows = '';
    stage.style.alignContent = 'center';
    stage.style.overflowY = 'hidden';
    vis.forEach((s, i) => { tiles.get(keyOf(s)).el.style.order = i; });
  }
  new ResizeObserver(() => layout()).observe(stage);

  function setLayout(mode) {
    S.layout = mode;
    $$('#layout-seg button').forEach((b) => b.classList.toggle('on', b.dataset.layout === mode));
    save({ layout: mode });
    layout();
  }
  $$('#layout-seg button').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));

  async function addStream(parsed) {
    if (!parsed) return toast("That doesn't look like a Twitch name or a Twitch / YouTube / Kick link.");
    if (parsed.platform === 'kick' && !S.showKick) return toast('Turn on Kick in Settings to add Kick streams.');
    if (parsed.resolve) {
      toast('Finding the live stream…');
      const id = await prism.youtubeResolveLive(parsed.resolve);
      if (!id) return toast("That channel isn't live right now.");
      parsed = { platform: 'youtube', id, label: decodeURIComponent(parsed.resolve.split('/').pop()) };
    }
    const key = keyOf(parsed);
    if (streams.some((s) => keyOf(s) === key)) { setChat(key); return toast('Already in multi-view.'); }
    const anyUnmuted = streams.some((s) => !s.muted && (s.platform !== 'kick' || S.showKick));
    const s = { platform: parsed.platform, id: parsed.id, label: parsed.label || parsed.id, muted: S.singleAudio && anyUnmuted };
    streams.push(s);
    persistStreams();
    if (s.platform === 'twitch') chat.join(s.id);
    renderStage();
    setChat(key);
    markLive();
  }

  function removeStream(key) {
    const s = streams.find((x) => keyOf(x) === key);
    if (!s) return;
    streams = streams.filter((x) => x !== s);
    persistStreams();
    if (s.platform === 'twitch') { chat.part(s.id); dropChatPane('twitch:' + s.id); }
    dropChatPane(key);
    if (chatKey === key) chatKey = null;
    renderStage();
    markLive();
  }

  // ---- Add box with channel suggestions ----------------------------------
  const addInput = $('#add-input');
  const sugBox = $('#suggest');
  let sugItems = [];
  let sugIndex = -1;
  let sugTimer = null;
  let sugSeq = 0;
  let followingCache = [];
  const searchCache = new Map();

  const fmtViewers = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K' : String(n));
  const looksLikeLink = (v) => /[/:.]/.test(v) && !/^@/.test(v);

  function hideSuggest() { sugBox.hidden = true; sugItems = []; sugIndex = -1; }

  function renderSuggest(q, items, loading) {
    sugItems = items;
    if (sugIndex >= items.length) sugIndex = items.length - 1;
    sugBox.textContent = '';
    const added = new Set(streams.filter((s) => s.platform === 'twitch').map((s) => s.id));
    items.forEach((c, i) => {
      sugBox.append(h('div', { class: 'sug' + (i === sugIndex ? ' on' : ''),
        onmousedown: (e) => { e.preventDefault(); pickSuggestion(i); },
        onmouseenter: () => { sugIndex = i; $$('.sug', sugBox).forEach((el, j) => el.classList.toggle('on', j === i)); } },
        c.avatar ? h('img', { src: c.avatar, alt: '' }) : h('div', { class: 'ph' }),
        h('div', { class: 'meta' }, h('div', { class: 'n', text: c.name }), h('div', { class: 'g', text: c.live ? (c.game || 'Live') : c.login })),
        added.has(c.login) ? h('span', { class: 'added', text: 'In multi-view' })
          : c.live ? h('span', { class: 'v', text: fmtViewers(c.viewers) }) : h('span', { class: 'off', text: 'Offline' })));
    });
    if (!items.length) sugBox.append(h('div', { class: 'sug-hint', text: loading ? 'Searching…' : `No channels found. Press Enter to add "${q}" anyway.` }));
    else if (loading) sugBox.append(h('div', { class: 'sug-hint', text: 'Searching…' }));
    sugBox.hidden = false;
  }

  function localMatches(q) {
    const l = q.toLowerCase();
    return followingCache.filter((c) => c.login.includes(l) || c.name.toLowerCase().includes(l))
      .map((c) => ({ login: c.login.toLowerCase(), name: c.name, avatar: c.avatar, live: true, viewers: c.viewers, game: c.game }));
  }

  function merge(a, b) {
    const seen = new Set();
    return [...a, ...b].filter((c) => (seen.has(c.login) ? false : seen.add(c.login))).slice(0, 8);
  }

  addInput.addEventListener('input', () => {
    clearTimeout(sugTimer);
    const q = addInput.value.trim();
    sugIndex = -1;
    if (q.length < 2 || looksLikeLink(q)) return hideSuggest();
    const local = localMatches(q);
    if (searchCache.has(q.toLowerCase())) return renderSuggest(q, merge(local, searchCache.get(q.toLowerCase())), false);
    renderSuggest(q, local, true);
    const seq = ++sugSeq;
    sugTimer = setTimeout(async () => {
      const res = await prism.twitchSearch(q).catch(() => []);
      searchCache.set(q.toLowerCase(), res);
      if (seq !== sugSeq || addInput.value.trim() !== q) return;
      renderSuggest(q, merge(localMatches(q), res), false);
    }, 180);
  });

  addInput.addEventListener('keydown', (e) => {
    if (sugBox.hidden || !sugItems.length) { if (e.key === 'Escape') hideSuggest(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = sugItems.length;
      sugIndex = e.key === 'ArrowDown' ? (sugIndex + 1) % n : (sugIndex <= 0 ? n - 1 : sugIndex - 1);
      $$('.sug', sugBox).forEach((el, j) => el.classList.toggle('on', j === sugIndex));
    } else if (e.key === 'Tab' && sugIndex < 0) {
      e.preventDefault();
      sugIndex = 0;
      $$('.sug', sugBox).forEach((el, j) => el.classList.toggle('on', j === 0));
    } else if (e.key === 'Escape') {
      hideSuggest();
    }
  });
  addInput.addEventListener('blur', () => setTimeout(hideSuggest, 120));
  addInput.addEventListener('focus', () => { if (addInput.value.trim().length >= 2) addInput.dispatchEvent(new Event('input')); });

  function pickSuggestion(i) {
    const c = sugItems[i];
    if (!c) return;
    addStream({ platform: 'twitch', id: c.login, label: c.name });
    addInput.value = '';
    hideSuggest();
  }

  $('#add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!sugBox.hidden && sugIndex >= 0) return pickSuggestion(sugIndex);
    const v = addInput.value.trim();
    if (!v) return;
    addStream(parseStream(v));
    addInput.value = '';
    hideSuggest();
  });

  $('#toggle-chat').addEventListener('click', () => {
    S.chatVisible = !S.chatVisible;
    applyChatVisible();
    save({ chatVisible: S.chatVisible });
  });
  function applyChatVisible() {
    document.body.classList.toggle('hide-chat', !S.chatVisible);
    $('#toggle-chat').textContent = S.chatVisible ? 'Hide chat' : 'Show chat';
    requestAnimationFrame(layout);
  }

  // =========================================================================
  // Chat
  // =========================================================================
  const panes = new Map(); // key -> { el, kind, stick, queue, roomId }
  const chatBody = $('#chat-body');
  let globalEmotes = new Map();
  let selfLogin = null;

  const chat = new PrismChat.TwitchChat({
    onState: ({ signedIn }) => { if (signedIn !== undefined) updateChatInput(); },
    onAuthFailed: () => { selfLogin = null; updateChatInput(); },
    onMessage: (ch, m) => queue('twitch:' + ch, () => PrismChat.renderMessage(m, msgOpts(ch))),
    onNotice: (ch, m) => queue('twitch:' + ch, () => {
      const el = h('div', { class: 'msg notice' }, h('div', { text: m.tags['system-msg'] || '' }));
      if (m.text) el.append(PrismChat.renderMessage({ tags: m.tags, nick: m.tags.login, text: m.text }, msgOpts(ch)));
      return el;
    }),
    onSystem: (ch, text) => ch && queue('twitch:' + ch, () => h('div', { class: 'msg system', text })),
    onRoom: (ch, roomId) => {
      const p = twitchPane(ch);
      p.roomId = roomId;
      if (S.thirdPartyEmotes) PrismChat.roomEmotes(roomId).then((m) => (p.emotes = m));
    },
    onClear: (ch, { user }) => {
      const p = panes.get('twitch:' + ch);
      if (!p) return;
      if (user) $$(`.msg[data-user="${CSS.escape(user)}"]`, p.el).forEach((m) => m.classList.add('deleted'));
      else queue('twitch:' + ch, () => h('div', { class: 'msg system', text: 'Chat was cleared by a moderator.' }));
    },
    onDelete: (ch, id) => {
      const p = panes.get('twitch:' + ch);
      if (p && id) $(`.msg[data-id="${CSS.escape(id)}"]`, p.el)?.classList.add('deleted');
    }
  });

  function msgOpts(ch) {
    const p = panes.get('twitch:' + ch);
    return {
      selfLogin,
      extraEmote: S.thirdPartyEmotes ? (w) => p?.emotes?.get(w) || globalEmotes.get(w) : null
    };
  }

  function twitchPane(ch) {
    const key = 'twitch:' + ch;
    let p = panes.get(key);
    if (p) return p;
    const el = h('div', { class: 'chat-pane' }, h('div', { class: 'chat-empty', text: `Joined #${ch}` }));
    p = { el, kind: 'twitch', stick: true, queue: [], emotes: null };
    el.addEventListener('scroll', () => {
      p.stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
      if (p.stick && chatKey === key) $('#chat-more').hidden = true;
    });
    chatBody.append(el);
    panes.set(key, p);
    return p;
  }

  // Batch new messages once per frame so busy chats stay smooth.
  let flushScheduled = false;
  function queue(key, build) {
    if (key.startsWith('twitch:') && !chat.channels.has(key.slice(7))) return;
    const p = key.startsWith('twitch:') ? twitchPane(key.slice(7)) : panes.get(key);
    if (!p) return;
    p.queue.push(build);
    if (!flushScheduled) { flushScheduled = true; requestAnimationFrame(flush); }
  }
  function flush() {
    flushScheduled = false;
    const max = Number(S.chatMaxLines) || 250;
    for (const [key, p] of panes) {
      if (!p.queue.length) continue;
      const items = p.queue.splice(0, p.queue.length).slice(-max);
      const frag = document.createDocumentFragment();
      for (const b of items) frag.append(b());
      p.el.querySelector('.chat-empty')?.remove();
      p.el.append(frag);
      while (p.el.childElementCount > max) p.el.firstElementChild.remove();
      if (p.stick) p.el.scrollTop = p.el.scrollHeight;
      else if (key === chatKey) $('#chat-more').hidden = false;
    }
  }
  $('#chat-more').addEventListener('click', () => {
    const p = panes.get(chatKey);
    if (p) { p.stick = true; p.el.scrollTop = p.el.scrollHeight; }
    $('#chat-more').hidden = true;
  });

  chatBody.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); prism.openExternal(a.dataset.url); }
  });

  // YouTube and Kick chats are their own pages; only the one you're viewing stays loaded.
  function webChatUrl(s) {
    if (s.platform === 'youtube') return `https://www.youtube.com/live_chat?is_popout=1&dark_theme=1&v=${encodeURIComponent(s.id)}`;
    if (s.platform === 'kick') return `https://kick.com/popout/${encodeURIComponent(s.id)}/chat`;
  }
  function webPane(key, s) {
    let p = panes.get(key);
    if (p) return p;
    const el = h('div', { class: 'chat-pane web' },
      h('webview', { partition: info.platforms[s.platform].partition, src: webChatUrl(s), webpreferences: 'backgroundThrottling=yes' }));
    p = { el, kind: 'web', stick: true, queue: [] };
    chatBody.append(el);
    panes.set(key, p);
    return p;
  }
  function dropChatPane(key) {
    const p = panes.get(key);
    if (!p) return;
    p.el.remove();
    panes.delete(key);
  }

  function setChat(key) {
    const s = visibleStreams().find((x) => keyOf(x) === key);
    if (!s) return;
    if (s.chatOff) { setChatOff(key, false); return; }
    if (!S.chatVisible) { S.chatVisible = true; applyChatVisible(); save({ chatVisible: true }); }
    chatKey = key;
    for (const [k, p] of panes) {
      if (p.kind === 'web' && k !== key) dropChatPane(k);
    }
    const p = s.platform === 'twitch' ? twitchPane(s.id) : webPane(key, s);
    for (const x of panes.values()) x.el.classList.toggle('on', x === p);
    if (p.kind === 'twitch' && p.stick) p.el.scrollTop = p.el.scrollHeight;
    $('#chat-more').hidden = true;
    renderChatTabs();
    updateChatInput();
    layout();
  }

  function renderChatTabs() {
    const vis = visibleStreams();
    const on = chatStreams();
    const tabs = $('#chat-tabs');
    tabs.textContent = '';
    if (!on.length) {
      chatKey = null;
      chatBody.querySelectorAll('.chat-pane').forEach((p) => p.classList.remove('on'));
      $('#chat-form').hidden = true;
      $('#chat-signin').hidden = true;
      if (vis.length) tabs.append(h('button', { class: 'chat-tab more', text: 'All chats are off · turn some on', onclick: toggleChatManage }));
      return;
    }
    if (!chatKey || !on.some((s) => keyOf(s) === chatKey)) { setChat(keyOf(on[0])); return; }
    for (const s of on) {
      const k = keyOf(s);
      tabs.append(h('button', { class: 'chat-tab' + (k === chatKey ? ' on' : ''), title: `${s.label || s.id} · ${PLAT_NAMES[s.platform]}`, onclick: () => setChat(k) },
        h('span', { class: 'tl', text: s.label || s.id }),
        h('span', { class: 'x', text: '✕', title: 'Turn this chat off', onclick: (e) => { e.stopPropagation(); setChatOff(k, true); } })));
    }
    const off = vis.length - on.length;
    tabs.append(h('button', { class: 'chat-tab more', text: off ? `+${off} off` : '⋯', title: 'Choose which chats are on', onclick: toggleChatManage }));
  }

  // Turning a chat off leaves the channel and frees its memory.
  function setChatOff(key, off) {
    const s = streams.find((x) => keyOf(x) === key);
    if (!s) return;
    s.chatOff = off;
    if (s.platform === 'twitch') {
      if (off) { chat.part(s.id); dropChatPane('twitch:' + s.id); } else chat.join(s.id);
    } else if (off) dropChatPane(key);
    persistStreams();
    if (!off) { chatKey = key; setChat(key); }
    else { if (chatKey === key) chatKey = null; renderChatTabs(); updateChatInput(); }
    if (!$('#chat-manage').hidden) renderChatManage();
  }

  function renderChatManage() {
    const box = $('#chat-manage');
    box.textContent = '';
    box.append(h('div', { class: 'h', text: 'Chats shown' }));
    for (const s of visibleStreams()) {
      const k = keyOf(s);
      box.append(h('label', {},
        h('input', { type: 'checkbox', checked: !s.chatOff, onchange: (e) => setChatOff(k, !e.target.checked) }),
        s.label || s.id,
        h('span', { class: 'p p-' + s.platform, text: PLAT_NAMES[s.platform] })));
    }
  }
  function toggleChatManage(e) {
    e?.stopPropagation();
    const box = $('#chat-manage');
    box.hidden = !box.hidden;
    if (!box.hidden) renderChatManage();
  }
  document.addEventListener('click', (e) => {
    const box = $('#chat-manage');
    if (!box.hidden && !box.contains(e.target)) box.hidden = true;
  });

  function updateChatInput() {
    const s = chatStreams().find((x) => keyOf(x) === chatKey);
    const isTwitch = s?.platform === 'twitch';
    $('#chat-form').hidden = !(isTwitch && chat.signedIn);
    $('#chat-signin').hidden = !(isTwitch && !chat.signedIn);
    if (isTwitch) $('#chat-input').placeholder = `Send a message to #${s.id}` + (selfLogin ? ` as ${selfLogin}` : '');
  }

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const s = visibleStreams().find((x) => keyOf(x) === chatKey);
    if (!s || s.platform !== 'twitch') return;
    const text = input.value;
    if (chat.send(s.id, text)) {
      const us = chat.userState[s.id] || {};
      queue('twitch:' + s.id, () => PrismChat.renderMessage({ tags: { ...us, emotes: '', 'display-name': us['display-name'] || selfLogin }, nick: selfLogin, text }, msgOpts(s.id)));
      const p = panes.get('twitch:' + s.id);
      if (p) p.stick = true;
      input.value = '';
    }
  });

  let lastAuthToken = undefined;
  async function refreshChatAuth() {
    const auth = await prism.twitchChatAuth();
    const token = auth?.token || null;
    if (token === lastAuthToken) return;
    lastAuthToken = token;
    selfLogin = auth?.login?.toLowerCase() || null;
    chat.connect(auth);
    updateChatInput();
  }

  // =========================================================================
  // Following (live channels on Twitch)
  // =========================================================================
  const livePanel = $('#live-panel');
  $('#live-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    livePanel.hidden = !livePanel.hidden;
    if (!livePanel.hidden) loadFollowing();
  });
  $('#live-refresh').addEventListener('click', loadFollowing);
  document.addEventListener('click', (e) => { if (!livePanel.contains(e.target)) livePanel.hidden = true; });

  async function loadFollowing() {
    const list = $('#live-list');
    list.textContent = '';
    list.append(h('div', { class: 'chat-empty', text: 'Loading…' }));
    const res = await prism.twitchFollowing();
    followingCache = res.live || [];
    renderSideLive();
    list.textContent = '';
    if (!res.signedIn) {
      list.append(h('div', { class: 'chat-empty' }, 'Sign in on the ',
        h('a', { href: '#', text: 'Twitch tab', onclick: (e) => { e.preventDefault(); livePanel.hidden = true; showView('twitch'); } }),
        ' to see who you follow.'));
      return;
    }
    if (!res.live.length) {
      list.append(h('div', { class: 'chat-empty', text: res.error ? "Couldn't load your follows. Try Refresh." : 'Nobody you follow is live right now.' }));
      return;
    }
    for (const c of res.live) {
      list.append(h('div', { class: 'live-item', 'data-login': c.login, onclick: () => addStream({ platform: 'twitch', id: c.login.toLowerCase(), label: c.name }) },
        h('img', { src: c.avatar, alt: '' }),
        h('div', { class: 'meta' }, h('div', {}, h('b', { text: c.name }), c.game ? ' · ' + c.game : ''), h('div', { class: 't', text: c.title })),
        h('div', { class: 'v', text: c.viewers >= 1000 ? (c.viewers / 1000).toFixed(1) + 'K' : String(c.viewers) })));
    }
    markLive();
  }
  function markLive() {
    const added = new Set(streams.filter((s) => s.platform === 'twitch').map((s) => s.id));
    $$('.live-item').forEach((el) => el.classList.toggle('added', added.has(el.dataset.login.toLowerCase())));
  }

  // =========================================================================
  // Settings
  // =========================================================================
  const lists = await prism.adblock.lists();
  $('#filter-lists').append(...lists.map((l) =>
    h('label', {}, h('input', { type: 'checkbox', 'data-list': l.id }), l.name)));

  function renderSettings() {
    $$('[data-setting]').forEach((el) => {
      const v = S[el.dataset.setting];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    $$('[data-list]').forEach((el) => (el.checked = !!S.filterLists[el.dataset.list]));
    $('#allowlist').value = (S.allowlist || []).join('\n');
    $('#custom-filters').value = S.customFilters || '';
    $('#version').textContent = `Prism ${info.version}`;
    renderAccounts();
    renderAdScript();
    prism.adblock.status().then(showAdblockStatus);
    prism.updater.state().then(showUpdater);
  }

  $$('[data-setting]').forEach((el) => el.addEventListener('change', async () => {
    const k = el.dataset.setting;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if ('number' in el.dataset) v = Number(v);
    await save({ [k]: v });
    applySetting(k);
  }));
  $$('[data-list]').forEach((el) => el.addEventListener('change', () => {
    save({ filterLists: { [el.dataset.list]: el.checked } });
    $('#adblock-status').textContent = 'Rebuilding filters…';
  }));

  function applySetting(k) {
    if (k === 'showKick') { applyKick(); renderAccounts(); }
    if (k === 'chatFontSize') document.documentElement.style.setProperty('--chat-font', S.chatFontSize + 'px');
    if (k === 'twitchPlayer') {
      for (const [key, t] of tiles) if (t.stream.platform === 'twitch') { delete t.stream.forceEmbed; t.destroy(); tiles.delete(key); }
      renderStage();
    }
    if (k === 'youtubeRowCount') Browse.youtube.applyYouTubeRows();
    if (k === 'twitchPreviews') { Browse.twitch.reload(); toast('Twitch tab reloaded with the new preview setting.'); }
    if (k === 'twitchAdMethod') {
      reloadTwitch();
      toast({ tas: 'Using TwitchAdSolutions for Twitch ads.', builtin: "Using Prism's built-in Twitch ad skip.", off: 'Twitch ad skipping off.' }[S.twitchAdMethod]);
      renderAdScript();
    }
    if (k === 'thirdPartyEmotes' && S.thirdPartyEmotes) loadEmotes();
    if (k === 'adblockEnabled') { toast(S.adblockEnabled ? 'Ad blocking on.' : 'Ad blocking off.'); prism.adblock.status().then(showAdblockStatus); }
  }

  function reloadTwitch() {
    for (const t of tiles.values()) if (t.stream.platform === 'twitch' && t.wv) t.wv.reload();
    Browse.twitch.reload();
  }

  async function renderAdScript(st) {
    st = st || await prism.twitchAdScript.status();
    const urlBox = $('#ad-script-url');
    if (document.activeElement !== urlBox) urlBox.value = S.twitchAdScriptUrl || st.defaultUrl;
    $('#ad-script-box').hidden = S.twitchAdMethod !== 'tas';
    const el = $('#ad-script-status');
    if (st.error && !st.loaded) el.textContent = "Couldn't load the script: " + st.error;
    else if (st.loaded) el.textContent = `Loaded${st.version ? ' (script v' + st.version + ')' : ''} · updated ${new Date(st.updated).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` + (st.error ? ` · last update failed: ${st.error}` : '');
    else el.textContent = 'Downloading the script…';
  }
  prism.twitchAdScript.onStatus((st) => { renderAdScript(st); reloadTwitch(); });
  $('#ad-script-save').addEventListener('click', async () => {
    const v = $('#ad-script-url').value.trim();
    if (!/^https:\/\//.test(v)) return toast('The script address must start with https://');
    await save({ twitchAdScriptUrl: v });
    $('#ad-script-status').textContent = 'Downloading the script…';
  });
  $('#ad-script-reset').addEventListener('click', async () => {
    const st = await prism.twitchAdScript.status();
    $('#ad-script-url').value = st.defaultUrl;
    await save({ twitchAdScriptUrl: st.defaultUrl });
    $('#ad-script-status').textContent = 'Downloading the script…';
  });
  $('#ad-script-refresh').addEventListener('click', async () => {
    $('#ad-script-status').textContent = 'Downloading the script…';
    renderAdScript(await prism.twitchAdScript.refresh());
    reloadTwitch();
  });

  function applyKick() {
    $('.nav-btn.kick').hidden = !S.showKick;
    if (!S.showKick) {
      Browse.kick.destroy();
      for (const [k, p] of panes) if (k.startsWith('kick:')) dropChatPane(k);
      if (currentView === 'kick') showView('multiview');
    }
    renderStage();
  }

  $('#save-filters').addEventListener('click', async () => {
    const allow = $('#allowlist').value.split(/\s+/).map((d) => d.trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean);
    await save({ allowlist: [...new Set(allow)], customFilters: $('#custom-filters').value });
    $('#allowlist').value = S.allowlist.join('\n');
    $('#adblock-status').textContent = 'Rebuilding filters…';
  });
  $('#update-lists').addEventListener('click', async () => {
    $('#adblock-status').textContent = 'Downloading the latest lists…';
    showAdblockStatus(await prism.adblock.update());
  });

  function showAdblockStatus(st) {
    const el = $('#adblock-status');
    if (!st) return;
    if (st.error) el.textContent = 'Filter error: ' + st.error;
    else if (!st.ready) el.textContent = 'Loading filter lists…';
    else el.textContent = `${S.adblockEnabled ? 'Active' : 'Paused'} · ${st.rules.toLocaleString()} rules · updated ${new Date(st.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  prism.adblock.onStatus(showAdblockStatus);

  async function renderAccounts() {
    const st = await prism.accounts.status();
    const box = $('#accounts');
    box.textContent = '';
    for (const p of ['twitch', 'youtube', 'tiktok', 'kick']) {
      if (p === 'kick' && !S.showKick) continue;
      const on = st[p];
      const label = on ? (p === 'twitch' && st.twitchLogin ? `Signed in as ${st.twitchLogin}` : 'Signed in') : 'Not signed in';
      box.append(h('div', { class: 'account' },
        h('span', { class: 'name', text: PLAT_NAMES[p] }),
        h('span', { class: 'state' + (on ? ' on' : ''), text: label }),
        on
          ? h('button', { class: 'btn', text: 'Sign out', onclick: async () => {
              if (!confirm(`Sign out of ${PLAT_NAMES[p]} in Prism?`)) return;
              await prism.accounts.signOut(p);
              Browse[p].destroy();
              for (const t of tiles.values()) if (t.stream.platform === p) t.reload();
              if (p === 'twitch') refreshChatAuth();
              renderAccounts();
            } })
          : h('button', { class: 'btn btn-accent', text: 'Sign in', onclick: () => showView(p) })));
    }
  }

  // =========================================================================
  // Updates
  // =========================================================================
  function showUpdater(st) {
    const pill = $('#update-pill');
    const status = $('#update-status');
    const install = $('#install-update');
    install.hidden = st.status !== 'ready';
    pill.hidden = !['downloading', 'ready'].includes(st.status);
    if (st.status === 'downloading') pill.textContent = `Updating ${st.percent || 0}%`;
    if (st.status === 'ready') pill.textContent = `Restart for ${st.available}`;
    const text = {
      dev: 'Updates are checked in the installed app.',
      idle: '',
      checking: 'Checking…',
      'up-to-date': "You're on the latest version.",
      downloading: `Downloading ${st.available} (${st.percent || 0}%)…`,
      ready: `Version ${st.available} is ready.`,
      error: "Couldn't check for updates" + (st.error ? `: ${st.error}` : '.')
    }[st.status] || '';
    status.textContent = text;
  }
  prism.updater.onState(showUpdater);
  $('#check-updates').addEventListener('click', () => prism.updater.check());
  $('#install-update').addEventListener('click', () => prism.updater.install());
  $('#update-pill').addEventListener('click', () => {
    prism.updater.state().then((st) => (st.status === 'ready' ? prism.updater.install() : showView('settings')));
  });

  // =========================================================================
  // Resizable sidebar and chat
  // =========================================================================
  function applyPanelSizes() {
    const side = S.sidebarWidth || 56;
    document.body.style.setProperty('--sidebar', side + 'px');
    document.body.classList.toggle('side-wide', side >= 120);
    document.documentElement.style.setProperty('--chat-w', (S.chatWidth || 340) + 'px');
    renderSideLive();
    requestAnimationFrame(layout);
  }

  function makeResizer(el, { get, set, min, max, snap, dir }) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = get();
      // A shield keeps the drag going even when the pointer passes over a video page.
      const shield = h('div', { class: 'drag-shield' });
      document.body.append(shield);
      el.classList.add('dragging');
      const move = (ev) => {
        let w = startW + (ev.clientX - startX) * dir;
        w = Math.max(min, Math.min(max, w, Math.round(window.innerWidth * 0.6)));
        set(snap ? snap(w) : w, false);
      };
      const up = () => {
        shield.remove();
        el.classList.remove('dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        set(get(), true);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => set(null, true)); // double-click: back to default
  }

  makeResizer($('#side-resizer'), {
    get: () => S.sidebarWidth || 56,
    set: (w, done) => {
      S.sidebarWidth = w == null ? 56 : Math.round(w);
      applyPanelSizes();
      if (done) save({ sidebarWidth: S.sidebarWidth });
    },
    min: 56, max: 300, dir: 1,
    snap: (w) => (w < 110 ? 56 : w)   // in between snaps back to icons only
  });
  makeResizer($('#chat-resizer'), {
    get: () => S.chatWidth || 340,
    set: (w, done) => {
      S.chatWidth = w == null ? 340 : Math.round(w);
      applyPanelSizes();
      if (done) save({ chatWidth: S.chatWidth });
    },
    min: 240, max: 900, dir: -1
  });

  // Live channels you follow, in the sidebar (avatars when narrow, names when wide).
  function renderSideLive() {
    const box = $('#side-live');
    box.textContent = '';
    if (!followingCache.length) return;
    box.append(h('div', { class: 'head', text: 'Following · live' }));
    const inView = new Set(streams.filter((s) => s.platform === 'twitch').map((s) => s.id));
    for (const c of followingCache) {
      const login = c.login.toLowerCase();
      box.append(h('div', {
        class: 'live-ch' + (inView.has(login) ? ' in-view' : ''),
        title: `${c.name}${c.game ? ' · ' + c.game : ''} · ${fmtViewers(c.viewers)} viewers\n${c.title || ''}`,
        onclick: () => { addStream({ platform: 'twitch', id: login, label: c.name }); if (currentView !== 'multiview') showView('multiview'); }
      },
        c.avatar ? h('img', { src: c.avatar, alt: '' }) : h('div', { class: 'ph' }),
        h('span', { class: 'dot' }),
        h('div', { class: 'meta' }, h('b', { text: c.name }), h('span', { text: c.game || 'Live' })),
        h('span', { class: 'vc', text: fmtViewers(c.viewers) })));
    }
  }
  async function refreshFollowing() {
    try {
      const r = await prism.twitchFollowing();
      followingCache = r.live || [];
    } catch {}
    renderSideLive();
  }
  setInterval(refreshFollowing, 120000);

  // =========================================================================
  // Shortcuts & start-up
  // =========================================================================
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (a) { e.preventDefault(); showView(a.dataset.goto); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); showView('multiview'); $('#add-input').focus(); }
    if (e.key === 'Escape') livePanel.hidden = true;
  });

  async function loadEmotes() {
    globalEmotes = await PrismChat.globalEmotes();
    for (const p of panes.values()) if (p.roomId && !p.emotes) PrismChat.roomEmotes(p.roomId).then((m) => (p.emotes = m));
  }

  document.documentElement.style.setProperty('--chat-font', S.chatFontSize + 'px');
  $('.nav-btn.kick').hidden = !S.showKick;
  $$('#layout-seg button').forEach((b) => b.classList.toggle('on', b.dataset.layout === S.layout));
  applyChatVisible();
  for (const s of streams) if (s.platform === 'twitch' && !s.chatOff) chat.join(s.id);
  renderStage();
  showView(S.lastView && S.lastView !== 'settings' ? S.lastView : 'multiview');
  refreshChatAuth();
  if (S.thirdPartyEmotes) loadEmotes();
  applyPanelSizes();
  refreshFollowing();
  prism.updater.state().then(showUpdater);
})();
