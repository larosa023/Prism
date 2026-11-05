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

  // Site icons: each platform's own favicon (as shown on its browser tab).
  // Uses the icon the site itself reports once its tab has loaded, and a
  // favicon lookup before that. Falls back to the short text if offline.
  const SITE_DOMAINS = { twitch: 'twitch.tv', youtube: 'youtube.com', tiktok: 'tiktok.com', kick: 'kick.com' };
  const FALLBACK_TEXT = { twitch: 'TW', youtube: 'YT', tiktok: 'TT', kick: 'K' };
  const iconUrl = (p) => (S.favicons || {})[p] || `https://www.google.com/s2/favicons?domain=${SITE_DOMAINS[p]}&sz=64`;
  function siteIcon(p, cls = 'fav') {
    const img = h('img', { class: cls, src: iconUrl(p), alt: PLAT_NAMES[p], 'data-fav-img': p, draggable: 'false' });
    img.addEventListener('error', () => {
      const t = h('span', { class: cls + ' fav-text p-' + p, text: FALLBACK_TEXT[p] });
      img.replaceWith(t);
    }, { once: true });
    return img;
  }
  function paintSidebarIcons() {
    for (const el of $$('.ic[data-fav]')) {
      el.textContent = '';
      el.append(siteIcon(el.dataset.fav));
    }
  }
  function rememberFavicon(p, url) {
    if (!/^https:\/\//.test(url) || (S.favicons || {})[p] === url) return;
    S.favicons = { ...(S.favicons || {}), [p]: url };
    save({ favicons: S.favicons });
    for (const img of $$(`img[data-fav-img="${p}"]`)) img.src = url;
  }
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
    $('#add-form').style.visibility = name === 'multiview' || name === 'rp' ? 'visible' : 'hidden';
    if (Browse[name]) Browse[name].show();
    if (prev && Browse[prev]) Browse[prev].hide();
    if (name === 'settings') renderSettings();
    if (name === 'rp') RP.show(); else RP.hide();
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
      wv.addEventListener('page-favicon-updated', (e) => {
        const url = (e.favicons || []).find((u) => /^https:/.test(u) && !/\.svg(\?|$)/i.test(u)) || (e.favicons || [])[0];
        if (url) rememberFavicon(platform, url);
      });
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
  const persistStreams = () => save({ streams: streams.map(({ forceEmbed, popped, ...rest }) => rest) });

  function playerUrl(s) {
    if (s.platform === 'twitch') return `https://player.twitch.tv/?channel=${encodeURIComponent(s.id)}&parent=twitch.tv&autoplay=true&muted=false`;
    if (s.platform === 'youtube') return `https://www.youtube.com/embed/${encodeURIComponent(s.id)}?autoplay=1&playsinline=1&rel=0`;
    if (s.platform === 'kick') return `https://player.kick.com/${encodeURIComponent(s.id)}?autoplay=true&muted=false`;
  }

  const useNative = (s) => !s.forceEmbed && s.player !== 'embed' && window.NativeTwitchPlayer && window.Hls?.isSupported() &&
    ((s.platform === 'twitch' && S.twitchPlayer !== 'embed') || (s.platform === 'kick' && S.kickPlayer !== 'embed'));
  // Streams shown in the grid (popped-out ones play in their own window).
  const stageStreams = () => visibleStreams().filter((s) => !s.popped);

  function makeTile(s) {
    const key = keyOf(s);
    const muteBtn = h('button', { class: 'tile-btn', title: 'Sound', onclick: () => setMuted(key, !s.muted) });
    const mutedTag = h('div', { class: 'tile-muted', text: 'Muted' });
    const statusEl = h('div', { class: 'tile-status', hidden: true });
    const infoEl = h('div', { class: 'tile-info' });
    const extra = h('div', { class: 'tile-extra' });
    const t = { el: null, stream: s, ready: false, muteBtn, mutedTag, statusEl, infoEl };

    let media;
    if (useNative(s)) {
      // Lightweight player: a <video> in this window, no extra browser process.
      const player = new NativeTwitchPlayer(s.id, {
        kind: s.platform,
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
          toast(`Switched ${s.label || s.id} to ${PLAT_NAMES[s.platform]}'s player (${why}).`);
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
      h('span', { class: 'tile-grip', title: 'Drag to move' , text: '⠿' }),
      h('span', { class: 'tile-label', title: PLAT_NAMES[s.platform] }, siteIcon(s.platform, 'fav fav-sm'), s.label || s.id),
      h('div', { class: 'grow' }),
      extra,
      muteBtn,
      h('button', { class: 'tile-btn', title: 'More', text: '⋯', onclick: (e) => openTileMenu(e, key) }),
      h('button', { class: 'tile-btn', title: 'Make main (Focus layout)', text: '⤢', onclick: () => { focusKey = key; if (S.layout !== 'focus') setLayout('focus'); else layout(); } }),
      h('button', { class: 'tile-btn', title: 'Show this chat', text: 'Chat', onclick: () => setChat(key) }),
      h('button', { class: 'tile-btn', title: 'Reload', text: '⟳', onclick: () => t.reload() }),
      h('button', { class: 'tile-btn', title: 'Remove', text: '✕', onclick: () => removeStream(key) })
    );
    t.el = h('div', { class: 'tile', 'data-key': key }, media, bar, infoEl, statusEl, mutedTag);
    t.el.addEventListener('mouseenter', () => (hoveredKey = key));
    t.el.addEventListener('mouseleave', () => { if (hoveredKey === key) hoveredKey = null; });
    // Drag to move: anywhere on a lightweight player's video, or by the name / ⠿ handle.
    bar.querySelector('.tile-label').addEventListener('pointerdown', (e) => startTileDrag(e, key));
    bar.querySelector('.tile-grip').addEventListener('pointerdown', (e) => startTileDrag(e, key));
    if (media.tagName === 'VIDEO') {
      media.draggable = false;
      media.addEventListener('pointerdown', (e) => startTileDrag(e, key));
    }
    paintTileInfo(t);
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
    const vis = stageStreams();
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
    const vis = stageStreams().filter((s) => tiles.has(keyOf(s)));
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
    if (s.platform === 'twitch') joinChat(s.id);
    renderStage();
    setChat(key);
    if (s.platform !== 'youtube') refreshStreamInfo();
    markLive();
  }

  function removeStream(key) {
    const s = streams.find((x) => keyOf(x) === key);
    if (!s) return;
    streams = streams.filter((x) => x !== s);
    persistStreams();
    if (s.platform === 'twitch') { chat.part(s.id); dropChatPane('twitch:' + s.id); userLogs.delete(s.id); }
    dropChatPane(key);
    if (chatKey === key) chatKey = null;
    renderStage();
    markLive();
  }

  // ---- Drag a tile's name to move it -------------------------------------
  let hoveredKey = null;
  function startTileDrag(e, key) {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, select') && !e.target.closest('.tile-grip')) return;
    if (visibleStreams().filter((x) => !x.popped).length < 2) return; // nothing to swap with
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, target = null, shield = null, ghost = null;
    const src = tiles.get(key);
    const move = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        dragging = true;
        shield = h('div', { class: 'drag-shield move' });
        ghost = h('div', { class: 'drag-ghost', text: src.stream.label || src.stream.id });
        document.body.append(shield, ghost);
        src.el.classList.add('dragging');
      }
      ghost.style.left = ev.clientX + 12 + 'px';
      ghost.style.top = ev.clientY + 12 + 'px';
      let found = null;
      for (const [k, t] of tiles) {
        if (k === key) continue;
        const r = t.el.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) found = k;
      }
      if (found !== target) {
        if (target) tiles.get(target)?.el.classList.remove('drop-target');
        target = found;
        if (target) tiles.get(target).el.classList.add('drop-target');
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragging) return;
      shield.remove(); ghost.remove();
      src.el.classList.remove('dragging');
      if (target) {
        tiles.get(target)?.el.classList.remove('drop-target');
        if (S.layout === 'focus' && target === focusKey) focusKey = key; // dropped on the big one
        else {
          const a = streams.findIndex((s) => keyOf(s) === key);
          const b = streams.findIndex((s) => keyOf(s) === target);
          [streams[a], streams[b]] = [streams[b], streams[a]];
        }
        persistStreams();
        renderStage();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---- Tile menu: pop out, choose the player ------------------------------
  const tileMenu = h('div', { class: 'tile-menu', hidden: true });
  document.body.append(tileMenu);
  document.addEventListener('click', (e) => { if (!tileMenu.hidden && !tileMenu.contains(e.target)) tileMenu.hidden = true; });
  function openTileMenu(e, key) {
    e.stopPropagation();
    const s = streams.find((x) => keyOf(x) === key);
    if (!s) return;
    tileMenu.textContent = '';
    const item = (label, sub, fn) => tileMenu.append(h('button', { class: 'tm-item', onclick: () => { tileMenu.hidden = true; fn(); } },
      h('span', { text: label }), sub ? h('small', { text: sub }) : null));
    item('Pop out', 'Always-on-top mini player  ·  P', () => popOut(key));
    if (s.platform === 'twitch' || s.platform === 'kick') {
      const site = PLAT_NAMES[s.platform];
      const globalEmbed = (s.platform === 'twitch' ? S.twitchPlayer : S.kickPlayer) === 'embed';
      if (!globalEmbed) {
        if (s.player === 'embed' || s.forceEmbed) item('Use the lightweight player', 'Less memory', () => setStreamPlayer(key, 'native'));
        else item(`Use ${site}'s player`, s.platform === 'twitch' ? 'Earns channel points and watch time' : 'The official player', () => setStreamPlayer(key, 'embed'));
      }
    }
    item('Open on ' + PLAT_NAMES[s.platform], '', () => prism.openExternal(
      s.platform === 'twitch' ? `https://www.twitch.tv/${s.id}` : s.platform === 'kick' ? `https://kick.com/${s.id}` : `https://www.youtube.com/watch?v=${s.id}`));
    const r = e.target.getBoundingClientRect();
    tileMenu.hidden = false;
    tileMenu.style.left = Math.min(r.left, window.innerWidth - tileMenu.offsetWidth - 8) + 'px';
    tileMenu.style.top = r.bottom + 4 + 'px';
  }
  function setStreamPlayer(key, which) {
    const s = streams.find((x) => keyOf(x) === key);
    if (!s) return;
    if (which === 'embed') s.player = 'embed'; else { delete s.player; delete s.forceEmbed; }
    persistStreams();
    const t = tiles.get(key);
    if (t) { t.destroy(); tiles.delete(key); }
    renderStage();
  }
  function popOut(key) {
    const s = streams.find((x) => keyOf(x) === key);
    if (!s || s.popped) return;
    s.popped = true;
    const { forceEmbed, popped, ...plain } = s;
    prism.mini.open({ ...plain, player: forceEmbed ? 'embed' : s.player });
    renderStage();
  }
  prism.mini.onClosed((key) => {
    const s = streams.find((x) => keyOf(x) === key);
    if (s && s.popped) { s.popped = false; renderStage(); }
  });
  prism.mini.onReturn(() => { if (currentView !== 'multiview') showView('multiview'); });

  // ---- Saved layouts --------------------------------------------------------
  const layoutsPanel = $('#layouts-panel');
  $('#layouts-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    layoutsPanel.hidden = !layoutsPanel.hidden;
    if (!layoutsPanel.hidden) { renderPresets(); $('#preset-name').focus(); }
  });
  document.addEventListener('click', (e) => { if (!layoutsPanel.hidden && !e.target.closest('.layouts-wrap')) layoutsPanel.hidden = true; });

  function renderPresets() {
    const list = $('#preset-list');
    list.textContent = '';
    const presets = S.presets || [];
    if (!presets.length) { list.append(h('div', { class: 'sug-hint', text: 'No saved layouts yet. Set up your streams, name it above and Save.' })); return; }
    presets.forEach((p, i) => {
      const names = p.streams.map((s) => s.label || s.id);
      list.append(h('div', { class: 'preset' },
        h('div', { class: 'preset-main', title: 'Open this layout', onclick: () => loadPreset(i) },
          h('b', { text: p.name }),
          h('span', { text: `${p.streams.length} stream${p.streams.length === 1 ? '' : 's'} · ${p.layout === 'focus' ? 'Focus' : 'Grid'} · ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}` })),
        h('button', { class: 'icon-btn', title: 'Update with what\'s on screen now', text: '⟲', onclick: () => savePreset(p.name, i) }),
        h('button', { class: 'icon-btn', title: 'Delete', text: '✕', onclick: () => {
          S.presets = presets.filter((_, j) => j !== i);
          save({ presets: S.presets });
          renderPresets();
        } })));
    });
  }
  function savePreset(name, index) {
    if (!streams.length) return toast('Add some streams first.');
    const preset = {
      name,
      streams: streams.map(({ platform, id, label, muted, volume, quality, chatOff }) => ({ platform, id, label, muted, volume, quality, chatOff })),
      layout: S.layout,
      focus: focusKey
    };
    const presets = [...(S.presets || [])];
    const existing = index ?? presets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) presets[existing] = preset; else presets.push(preset);
    S.presets = presets;
    save({ presets });
    renderPresets();
    toast(existing >= 0 ? `Updated "${name}".` : `Saved "${name}".`);
  }
  $('#preset-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#preset-name').value.trim();
    if (!name) return $('#preset-name').focus();
    savePreset(name);
    $('#preset-name').value = '';
  });
  function loadPreset(i) {
    const p = (S.presets || [])[i];
    if (!p) return;
    for (const s of [...streams]) removeStream(keyOf(s));
    streams = p.streams.map((s) => ({ ...s }));
    focusKey = p.focus || null;
    persistStreams();
    for (const s of streams) if (s.platform === 'twitch' && !s.chatOff) joinChat(s.id);
    if (p.layout && p.layout !== S.layout) setLayout(p.layout);
    renderStage();
    refreshStreamInfo();
    layoutsPanel.hidden = true;
    toast(`Opened "${p.name}".`);
  }

  // ---- Hotkeys ---------------------------------------------------------------
  let lastSoundKey = null;
  document.addEventListener('keydown', (e) => {
    if (currentView !== 'multiview' || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const vis = stageStreams();
    const k = e.key.toLowerCase();
    if (/^[1-9]$/.test(k)) {
      const s = vis[Number(k) - 1];
      if (!s) return;
      for (const x of streams) x.muted = keyOf(x) !== keyOf(s);
      for (const t of tiles.values()) applyMute(t);
      persistStreams();
      toast(`Sound: ${s.label || s.id}`);
    } else if (k === 'm') {
      const playing = vis.find((s) => !s.muted);
      if (playing) { lastSoundKey = keyOf(playing); for (const x of streams) x.muted = true; toast('Muted'); }
      else {
        const back = vis.find((s) => keyOf(s) === lastSoundKey) || vis[0];
        if (back) { back.muted = false; toast(`Sound: ${back.label || back.id}`); }
      }
      for (const t of tiles.values()) applyMute(t);
      persistStreams();
    } else if (k === 'f') {
      if (S.layout === 'focus' && (!hoveredKey || hoveredKey === focusKey)) setLayout('grid');
      else { if (hoveredKey) focusKey = hoveredKey; setLayout('focus'); }
    } else if (k === 'g') {
      setLayout(S.layout === 'focus' ? 'grid' : 'focus');
    } else if (k === 'c') {
      $('#toggle-chat').click();
    } else if (k === 'p') {
      if (hoveredKey) popOut(hoveredKey);
    } else if (k === 'r') {
      if (hoveredKey) tiles.get(hoveredKey)?.reload();
    } else if (k === 'escape') {
      layoutsPanel.hidden = true;
    } else return;
    e.preventDefault();
  });

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
    onMessage: (ch, m) => { logUserMessage(ch, m); learnEmotes(m); checkMention(m); queue('twitch:' + ch, () => PrismChat.renderMessage(m, msgOpts(ch))); },
    onNotice: (ch, m) => queue('twitch:' + ch, () => {
      const el = h('div', { class: 'msg notice' }, h('div', { text: m.tags['system-msg'] || '' }));
      if (m.text) {
        logUserMessage(ch, { tags: m.tags, nick: m.tags.login, text: m.text });
        el.append(PrismChat.renderMessage({ tags: m.tags, nick: m.tags.login, text: m.text }, msgOpts(ch)));
      }
      return el;
    }),
    onSystem: (ch, text) => ch && queue('twitch:' + ch, () => h('div', { class: 'msg system', text })),
    onRoom: (ch, roomId) => {
      const p = twitchPane(ch);
      p.roomId = roomId;
      if (S.thirdPartyEmotes) PrismChat.roomEmotes(roomId).then((m) => (p.emotes = m));
    },
    onClear: (ch, { user }) => {
      if (user) markUserLog(ch, user, () => true);
      const p = panes.get('twitch:' + ch);
      if (!p) return;
      if (user) $$(`.msg[data-user="${CSS.escape(user)}"]`, p.el).forEach((m) => m.classList.add('deleted'));
      else queue('twitch:' + ch, () => h('div', { class: 'msg system', text: 'Chat was cleared by a moderator.' }));
    },
    onDelete: (ch, id) => {
      markMessageLog(ch, id);
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

  function joinChat(ch) {
    if (chat.channels.has(ch)) return;
    chat.join(ch);
    loadHistory(ch);
  }

  // Recent chat on join: the last messages from before you opened the stream,
  // from the public recent-messages service (Twitch itself doesn't provide them).
  async function loadHistory(ch) {
    if (!S.recentMessages) return;
    let lines = [];
    try {
      const r = await fetch(`https://recent-messages.robotty.de/api/v2/recent-messages/${encodeURIComponent(ch)}?limit=60`);
      if (r.ok) lines = (await r.json()).messages || [];
    } catch { return; }
    if (!chat.channels.has(ch) || !lines.length) return;
    const p = twitchPane(ch);
    const seen = new Set([...p.el.querySelectorAll('.msg[data-id]')].map((m) => m.dataset.id));
    const items = [];
    for (const raw of lines) {
      const m = PrismChat.parseLine(raw);
      const at = Number(m.tags['rm-received-ts']) || Date.now();
      if (m.command === 'PRIVMSG') {
        if (m.tags.id && seen.has(m.tags.id)) continue;
        items.push({ at, msg: { tags: m.tags, nick: m.nick, text: m.trailing || '' }, deleted: m.tags['rm-deleted'] === '1' });
      } else if (m.command === 'USERNOTICE' && m.tags['system-msg']) {
        items.push({ at, notice: m.tags['system-msg'] });
      }
    }
    if (!items.length) return;
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const el = it.notice ? h('div', { class: 'msg notice', text: it.notice }) : PrismChat.renderMessage(it.msg, msgOpts(ch));
      el.classList.add('history');
      if (it.deleted) el.classList.add('deleted');
      frag.append(el);
    }
    frag.append(h('div', { class: 'history-sep', text: 'Earlier messages above · live chat below' }));
    p.el.querySelector('.chat-empty')?.remove();
    p.el.prepend(frag);
    const max = Number(S.chatMaxLines) || 250;
    while (p.el.childElementCount > max + 1) p.el.firstElementChild.remove();
    if (p.stick) p.el.scrollTop = p.el.scrollHeight;
    // Add them to the name cards too, oldest first, ahead of anything said live.
    for (const it of items.filter((x) => x.msg).reverse()) logUserMessage(ch, it.msg, { at: it.at, history: true, deleted: it.deleted });
  }

  function twitchPane(ch) {
    const key = 'twitch:' + ch;
    let p = panes.get(key);
    if (p) return p;
    const el = h('div', { class: 'chat-pane', 'data-ch': ch }, h('div', { class: 'chat-empty', text: `Joined #${ch}` }));
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
    const name = e.target.closest('.msg .name');
    if (name) {
      const msg = name.closest('.msg');
      const pane = name.closest('.chat-pane');
      if (msg?.dataset.user && pane?.dataset.ch) { e.stopPropagation(); openUserCard(pane.dataset.ch, msg.dataset.user); }
      return;
    }
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); prism.openExternal(a.dataset.url); }
  });

  // ---- Per-user message history (click a name to see everything they said)
  // Kept separately from the visible chat so it survives the chat's line cap.
  const USER_LOG_MAX = 100;       // messages kept per person
  const USER_LOG_USERS = 1500;    // people kept per channel (least recent dropped)
  const userLogs = new Map();     // channel -> Map(login -> { name, color, badges, msgs: [] })
  let userCard = null;            // { ch, login }

  function logUserMessage(ch, m, opt = {}) {
    const login = (m.tags.login || m.nick || '').toLowerCase();
    if (!login) return;
    let byUser = userLogs.get(ch);
    if (!byUser) { byUser = new Map(); userLogs.set(ch, byUser); }
    let u = byUser.get(login);
    if (opt.history) {
      // Older messages go in front, and don't count as recent activity.
      if (!u) { u = { msgs: [] }; byUser.set(login, u); }
      u.name = u.name || m.tags['display-name'] || m.nick || login;
      u.color = u.color || m.tags.color;
      u.badges = u.badges || m.tags.badges;
      if (u.msgs.length < USER_LOG_MAX) u.msgs.unshift({ at: opt.at, m, deleted: !!opt.deleted, history: true });
      if (userCard && userCard.ch === ch && userCard.login === login) renderUserCard(false);
      return;
    }
    if (u) byUser.delete(login); // re-insert: most recent last
    else u = { msgs: [] };
    u.name = m.tags['display-name'] || m.nick || login;
    u.color = m.tags.color;
    u.badges = m.tags.badges;
    u.msgs.push({ at: Date.now(), m, deleted: false });
    if (u.msgs.length > USER_LOG_MAX) u.msgs.shift();
    byUser.set(login, u);
    if (byUser.size > USER_LOG_USERS) byUser.delete(byUser.keys().next().value);
    if (userCard && userCard.ch === ch && userCard.login === login) renderUserCard(true);
  }
  function markUserLog(ch, login, test) {
    const u = userLogs.get(ch)?.get(String(login).toLowerCase());
    if (!u) return;
    for (const x of u.msgs) if (test(x)) x.deleted = true;
    if (userCard && userCard.ch === ch && userCard.login === String(login).toLowerCase()) renderUserCard(false);
  }
  function markMessageLog(ch, id) {
    if (!id) return;
    for (const [login, u] of userLogs.get(ch) || []) {
      if (u.msgs.some((x) => x.m.tags.id === id)) { markUserLog(ch, login, (x) => x.m.tags.id === id); return; }
    }
  }

  const cardEl = h('div', { class: 'user-card', hidden: true });
  $('#chat').append(cardEl);

  function openUserCard(ch, login) {
    userCard = { ch, login: login.toLowerCase() };
    renderUserCard(false, true);
  }
  function closeUserCard() { userCard = null; cardEl.hidden = true; cardEl.textContent = ''; }

  function renderUserCard(appendOnly, scrollToEnd) {
    if (!userCard) return;
    const { ch, login } = userCard;
    const u = userLogs.get(ch)?.get(login);
    const list = cardEl.querySelector('.uc-list');
    const nearBottom = list ? list.scrollTop + list.clientHeight >= list.scrollHeight - 30 : true;
    const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const row = (x) => {
      const line = PrismChat.renderMessage(x.m, msgOpts(ch));
      line.querySelector('.name')?.remove();
      line.querySelectorAll('.badge').forEach((b) => b.remove());
      if (line.firstChild?.nodeType === 3) line.firstChild.remove(); // the ": " after the name
      line.prepend(h('span', { class: 'uc-time', text: fmtTime(x.at) }));
      if (x.history) line.classList.add('history');
      if (x.deleted) line.classList.add('deleted');
      return line;
    };

    if (appendOnly && list && u) {
      list.querySelector('.chat-empty')?.remove();
      list.append(row(u.msgs[u.msgs.length - 1]));
      while (list.childElementCount > USER_LOG_MAX) list.firstElementChild.remove();
      cardEl.querySelector('.uc-count').textContent = countText(u);
      if (nearBottom) list.scrollTop = list.scrollHeight;
      return;
    }

    cardEl.textContent = '';
    const name = u?.name || login;
    const badges = h('span', { class: 'uc-badges' });
    for (const b of (u?.badges || '').split(',')) {
      const key = b.split('/')[0];
      const label = { broadcaster: 'LIVE', moderator: 'MOD', vip: 'VIP', subscriber: 'SUB', partner: '✓' }[key];
      if (label) badges.append(h('span', { class: 'badge b-' + key, text: label }));
    }
    const nameEl = h('b', { class: 'uc-name', text: name });
    const sample = PrismChat.renderMessage({ tags: { color: u?.color || '' }, nick: login, text: '' }, {});
    nameEl.style.color = sample.querySelector('.name').style.color;

    const newList = h('div', { class: 'uc-list' });
    if (u?.msgs.length) for (const x of u.msgs) newList.append(row(x));
    else newList.append(h('div', { class: 'chat-empty', text: `No recent messages from ${name} in #${ch}.` }));

    cardEl.append(
      h('div', { class: 'uc-head' },
        h('div', { class: 'uc-who' }, badges, nameEl, h('span', { class: 'uc-count', text: u ? countText(u) : '' })),
        h('button', { class: 'icon-btn', title: 'Close', text: '✕', onclick: closeUserCard })),
      newList,
      h('div', { class: 'uc-actions' },
        h('button', { class: 'btn', text: '@ Mention', hidden: !chat.signedIn, onclick: () => {
          const input = $('#chat-input');
          input.value = (input.value ? input.value.replace(/\s*$/, ' ') : '') + '@' + name + ' ';
          closeUserCard();
          input.focus();
        } }),
        h('button', { class: 'btn', text: 'Twitch profile', onclick: () => prism.openExternal(`https://www.twitch.tv/${login}`) }),
        h('span', { class: 'uc-ch muted', text: '#' + ch })));
    // Sit between the (possibly wrapped) tabs and the message box.
    const footer = [$('#chat-form'), $('#chat-signin')].find((el) => !el.hidden);
    cardEl.style.top = ($('#chat-tabs').offsetHeight + 6) + 'px';
    cardEl.style.bottom = ((footer ? footer.offsetHeight : 0) + 6) + 'px';
    cardEl.hidden = false;
    if (scrollToEnd || nearBottom) newList.scrollTop = newList.scrollHeight;
  }
  function countText(u) {
    const n = u.msgs.length;
    return `${n}${n >= USER_LOG_MAX ? '+' : ''} message${n === 1 ? '' : 's'}`;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && userCard) closeUserCard(); });
  document.addEventListener('click', (e) => { if (userCard && !cardEl.contains(e.target)) closeUserCard(); });

  // ---- Chat typing helpers ---------------------------------------------------
  // Twitch emotes seen in chat (their names come with each message).
  const seenTwitchEmotes = new Map(); // name -> url
  function learnEmotes(m) {
    const tag = m.tags.emotes;
    if (!tag) return;
    const chars = Array.from(m.text);
    for (const group of tag.split('/')) {
      const [id, pos] = group.split(':');
      if (!pos) continue;
      const [a, b] = pos.split(',')[0].split('-').map(Number);
      const name = chars.slice(a, b + 1).join('');
      if (!name || seenTwitchEmotes.has(name)) continue;
      seenTwitchEmotes.set(name, `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`);
      if (seenTwitchEmotes.size > 800) seenTwitchEmotes.delete(seenTwitchEmotes.keys().next().value);
    }
  }

  // @mention chime
  let audioCtx = null, lastChime = 0;
  function checkMention(m) {
    if (!S.mentionSound || !selfLogin) return;
    if ((m.tags.login || m.nick || '').toLowerCase() === selfLogin) return;
    if (!new RegExp(`(^|[^\\w])@?${selfLogin}([^\\w]|$)`, 'i').test(m.text)) return;
    if (Date.now() - lastChime < 3000) return;
    lastChime = Date.now();
    try {
      audioCtx = audioCtx || new AudioContext();
      const t0 = audioCtx.currentTime;
      for (const [f, at] of [[880, 0], [1320, 0.12]]) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.25);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + at); o.stop(t0 + at + 0.3);
      }
    } catch {}
  }

  function currentTwitchChannel() {
    const s = chatStreams().find((x) => keyOf(x) === chatKey);
    return s?.platform === 'twitch' ? s.id : null;
  }
  // Emotes you can use in this chat: channel (7TV/BTTV/FFZ), global, and Twitch ones seen in chat.
  function emoteSets(ch) {
    const sets = [];
    const room = panes.get('twitch:' + ch)?.emotes;
    if (S.thirdPartyEmotes && room?.size) sets.push(['This channel', room]);
    if (seenTwitchEmotes.size) sets.push(['Twitch (seen in chat)', seenTwitchEmotes]);
    if (S.thirdPartyEmotes && globalEmotes.size) sets.push(['Global 7TV / BTTV', globalEmotes]);
    return sets;
  }

  // Tab completion: emotes and recent chatters (start with @ for names only).
  const chatInput = $('#chat-input');
  let completion = null; // { start, end, list, i }
  for (const ev of ['input', 'blur', 'mousedown']) chatInput.addEventListener(ev, () => (completion = null));
  chatInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') { if (e.key !== 'Shift') completion = null; return; }
    e.preventDefault();
    const ch = currentTwitchChannel();
    if (!ch) return;
    if (!completion) {
      const caret = chatInput.selectionStart;
      const before = chatInput.value.slice(0, caret);
      const m = before.match(/(\S+)$/);
      if (!m) return;
      const word = m[1];
      const start = caret - word.length;
      const atName = word.startsWith('@');
      const q = (atName ? word.slice(1) : word).toLowerCase();
      const list = [];
      const seen = new Set();
      const push = (v) => { const k = v.toLowerCase(); if (!seen.has(k) && k.startsWith(q) && k !== q) { seen.add(k); list.push(v); } };
      if (!atName) for (const [, set] of emoteSets(ch)) for (const name of set.keys()) push(name);
      // Recent chatters, most recent first.
      const emoteCount = list.length;
      const users = [...(userLogs.get(ch) || new Map()).values()].reverse();
      for (const u of users) push(u.name);
      // Emotes sorted shortest-first; names keep most-recent-first order.
      const emotes = list.slice(0, emoteCount).sort((a, b) => a.length - b.length || a.localeCompare(b));
      const names = list.slice(emoteCount).map((n) => (atName ? '@' + n : n));
      const all = [...emotes, ...names];
      if (!all.length) return;
      completion = { start, end: caret, list: all, i: -1 };
    }
    const c = completion;
    c.i = (c.i + (e.shiftKey ? -1 : 1) + c.list.length) % c.list.length;
    const pick = c.list[c.i] + ' ';
    chatInput.value = chatInput.value.slice(0, c.start) + pick + chatInput.value.slice(c.end);
    c.end = c.start + pick.length;
    chatInput.setSelectionRange(c.end, c.end);
  });

  // Emote picker
  const picker = $('#emote-picker');
  $('#emote-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    picker.hidden = !picker.hidden;
    if (!picker.hidden) { $('#emote-search').value = ''; renderEmotePicker(); $('#emote-search').focus(); }
  });
  $('#emote-search').addEventListener('input', renderEmotePicker);
  $('#emote-search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { picker.hidden = true; chatInput.focus(); }
    if (e.key === 'Enter') { e.preventDefault(); $('#emote-grid .eg-emote')?.click(); } // Enter picks the first match
  });
  document.addEventListener('click', (e) => { if (!picker.hidden && !picker.contains(e.target)) picker.hidden = true; });
  function renderEmotePicker() {
    const grid = $('#emote-grid');
    grid.textContent = '';
    const ch = currentTwitchChannel();
    const q = $('#emote-search').value.trim().toLowerCase();
    let shown = 0;
    for (const [title, set] of emoteSets(ch)) {
      const names = [...set.keys()].filter((n) => !q || n.toLowerCase().includes(q)).slice(0, 300);
      if (!names.length) continue;
      grid.append(h('div', { class: 'eg-title', text: `${title} · ${names.length}` }));
      const row = h('div', { class: 'eg-set' });
      for (const name of names) {
        row.append(h('button', { type: 'button', class: 'eg-emote', title: name, onclick: () => {
          const v = chatInput.value;
          chatInput.value = v + (v && !v.endsWith(' ') ? ' ' : '') + name + ' ';
          chatInput.focus();
        } }, h('img', { src: set.get(name), alt: name, loading: 'lazy' })));
        shown++;
      }
      grid.append(row);
    }
    if (!shown) grid.append(h('div', { class: 'sug-hint', text: q ? 'No emotes match.' : 'Emotes show up here once the chat has loaded.' }));
  }

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
    if (userCard) closeUserCard();
    for (const [k, p] of panes) {
      if (p.kind === 'web' && k !== key) dropChatPane(k);
    }
    const p = s.platform === 'twitch' ? twitchPane(s.id) : webPane(key, s);
    for (const x of panes.values()) x.el.classList.toggle('on', x === p);
    if (p.kind === 'twitch' && p.stick) p.el.scrollTop = p.el.scrollHeight;
    $('#chat-more').hidden = true;
    renderChatTabs();
    updateChatInput();
    paintPoints();
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
      if (off) { chat.part(s.id); dropChatPane('twitch:' + s.id); userLogs.delete(s.id); } else joinChat(s.id);
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
        h('span', { class: 'p', title: PLAT_NAMES[s.platform] }, siteIcon(s.platform, 'fav fav-sm'))));
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
      const mine = { tags: { ...us, emotes: '', 'display-name': us['display-name'] || selfLogin, login: selfLogin }, nick: selfLogin, text };
      logUserMessage(s.id, mine);
      queue('twitch:' + s.id, () => PrismChat.renderMessage(mine, msgOpts(s.id)));
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
    setTimeout(refreshPoints, 1500);
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
      if (res.error) list.append(h('div', { class: 'err-detail', text: res.error }));
      list.append(h('div', { class: 'chat-empty' }, 'Sign in on the ',
        h('a', { href: '#', text: 'Twitch tab', onclick: (e) => { e.preventDefault(); livePanel.hidden = true; showView('twitch'); } }),
        ' to see who you follow.'));
      return;
    }
    if (!res.live.length) {
      list.append(h('div', { class: 'chat-empty' },
        res.error ? "Couldn't load your follows from Twitch. Try Refresh." : 'Nobody you follow is live right now.',
        res.error ? h('div', { class: 'err-detail', text: 'Twitch said: ' + res.error }) : null));
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

  // ---- Themes ---------------------------------------------------------------
  const THEMES = [
    ['midnight', 'Midnight', ['#0e0e12', '#15151b', '#9b6bff']],
    ['oled', 'OLED black', ['#000000', '#0a0a0c', '#9b6bff']],
    ['slate', 'Slate', ['#11151c', '#171c25', '#4f8cff']],
    ['forest', 'Forest', ['#0d1210', '#131a17', '#34b878']],
    ['sunset', 'Sunset', ['#140f0e', '#1c1514', '#ff7a45']],
    ['rose', 'Rose', ['#130e13', '#1b141b', '#ff5fa8']],
    ['light', 'Light', ['#f4f3f8', '#ffffff', '#7c4dff']]
  ];
  function renderThemes() {
    const box = $('#themes');
    box.textContent = '';
    for (const [id, name, [bg, panel, accent]] of THEMES) {
      box.append(h('button', { class: 'theme-opt' + ((S.theme || 'midnight') === id ? ' on' : ''), title: name, onclick: () => setTheme(id) },
        (() => {
          const prev = h('span', { class: 'theme-prev' });
          prev.style.background = bg;
          const side = h('i'); side.style.background = panel;
          const main = h('i'); main.style.background = panel; main.style.boxShadow = `inset 0 -10px 0 ${accent}`;
          const chat = h('i'); chat.style.background = panel;
          prev.append(side, main, chat);
          return prev;
        })(),
        h('span', { class: 'theme-name', text: name })));
    }
  }
  async function setTheme(id) {
    S.theme = id;
    document.documentElement.dataset.theme = id;
    await prism.setTheme(id);
    renderThemes();
    // Chat name colors are tuned for the background, so repaint visible names.
    for (const el of $$('.msg .name')) el.style.color = PrismChat.recolor(el.style.color);
  }

  function renderSettings() {
    renderThemes();
    $$('[data-setting]').forEach((el) => {
      const v = S[el.dataset.setting];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    $$('[data-list]').forEach((el) => (el.checked = !!S.filterLists[el.dataset.list]));
    $('#allowlist').value = (S.allowlist || []).join('\n');
    $('#auto-add').value = (S.autoAddChannels || []).join('\n');
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
    if (k === 'liveAlerts') paintBell();
    if (k === 'chatFontSize') document.documentElement.style.setProperty('--chat-font', S.chatFontSize + 'px');
    if (k === 'twitchPlayer' || k === 'kickPlayer') {
      const plat = k === 'twitchPlayer' ? 'twitch' : 'kick';
      for (const [key, t] of tiles) if (t.stream.platform === plat) { delete t.stream.forceEmbed; t.destroy(); tiles.delete(key); }
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

  $('#save-auto-add').addEventListener('click', async () => {
    const list = $('#auto-add').value.split(/[\s,]+/).map((v) => (parseStream(v)?.platform === 'twitch' ? parseStream(v).id : null)).filter(Boolean);
    await save({ autoAddChannels: [...new Set(list)] });
    $('#auto-add').value = S.autoAddChannels.join('\n');
    toast(S.autoAddChannels.length ? `Auto-add saved for ${S.autoAddChannels.length} channel${S.autoAddChannels.length > 1 ? 's' : ''}.` : 'Auto-add cleared.');
  });
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
  // Stream info on tiles (title, game, viewers, uptime)
  // =========================================================================
  const streamInfo = new Map(); // login -> info
  const fmtUptime = (iso) => {
    if (!iso) return '';
    const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
  };
  function paintTileInfo(t) {
    const el = t.infoEl;
    if (!el) return;
    el.textContent = '';
    if (t.stream.platform === 'youtube') { el.hidden = true; return; }
    const i = streamInfo.get(t.stream.platform === 'kick' ? 'kick:' + t.stream.id : t.stream.id);
    if (!i) { el.hidden = true; return; }
    el.hidden = false;
    if (!i.live) { el.append(h('div', { class: 'ti-meta', text: 'Offline' })); return; }
    el.append(
      h('div', { class: 'ti-title', text: i.title || '', title: i.title || '' }),
      h('div', { class: 'ti-meta' },
        i.game ? h('span', { text: i.game }) : null,
        h('span', { class: 'ti-viewers', text: fmtViewers(i.viewers) + ' viewers' }),
        i.startedAt ? h('span', { text: 'Live ' + fmtUptime(i.startedAt) }) : null));
  }
  function paintAllTileInfo() { for (const t of tiles.values()) paintTileInfo(t); }
  function absorbInfo(list) {
    for (const c of list || []) {
      const prev = streamInfo.get(c.login) || {};
      streamInfo.set(c.login, { ...prev, live: true, title: c.title, viewers: c.viewers, game: c.game, startedAt: c.startedAt || prev.startedAt, name: c.name, avatar: c.avatar });
    }
  }
  async function refreshStreamInfo() {
    const logins = streams.filter((s) => s.platform === 'twitch').map((s) => s.id);
    if (logins.length) {
      const res = await prism.twitchStreamInfo(logins).catch(() => ({}));
      for (const [login, i] of Object.entries(res)) streamInfo.set(login, i);
    }
    for (const s of streams.filter((x) => x.platform === 'kick' && S.showKick)) {
      const r = await prism.kick.playback(s.id).catch(() => null);
      if (r && !r.error) streamInfo.set('kick:' + s.id, { live: !r.offline, title: r.title, viewers: r.viewers, game: r.game, startedAt: r.startedAt });
    }
    paintAllTileInfo();
  }
  setInterval(refreshStreamInfo, 60000);
  setInterval(paintAllTileInfo, 30000); // keep uptime ticking

  // Follow list pushed from the main process (also drives go-live alerts).
  prism.onFollowingUpdate((r) => {
    followingCache = r.live || [];
    absorbInfo(followingCache);
    renderSideLive();
    paintAllTileInfo();
    markLive();
  });
  // A go-live alert was clicked, or an auto-add channel went live.
  prism.onAddStream((p) => {
    const key = p.platform + ':' + p.id;
    if (p.auto && streams.some((s) => keyOf(s) === key)) return;
    addStream({ platform: p.platform, id: p.id, label: p.label });
    if (currentView !== 'multiview') showView('multiview');
    if (p.auto) toast(`${p.label} went live and was added to multi-view.`);
  });

  // =========================================================================
  // Channel points (balance for the open chat, bonus auto-claim)
  // =========================================================================
  const pointsEl = $('#points');
  const points = new Map(); // login -> { balance, channelId, claimId }
  let claimBlockedNotified = false;
  const fmtPoints = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'K' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n));
  function paintPoints() {
    const ch = currentTwitchChannel();
    const p = ch && points.get(ch);
    if (!p || p.balance == null) { pointsEl.hidden = true; return; }
    const s = streams.find((x) => x.platform === 'twitch' && x.id === ch);
    const lightweight = s && useNative(s);
    pointsEl.hidden = false;
    pointsEl.textContent = '◆ ' + fmtPoints(p.balance);
    pointsEl.classList.toggle('warn', !!lightweight);
    pointsEl.title = `${p.balance.toLocaleString()} channel points in #${ch}` +
      (lightweight ? `\nThe lightweight player doesn't earn points. Use "${PLAT_NAMES.twitch}'s player" from the stream's ⋯ menu to earn them.` : '');
  }
  pointsEl.addEventListener('click', () => {
    const ch = currentTwitchChannel();
    const s = streams.find((x) => x.platform === 'twitch' && x.id === ch);
    if (s && useNative(s)) setStreamPlayer(keyOf(s), 'embed'), toast(`${s.label || s.id} now uses Twitch's player and earns points.`);
  });
  async function refreshPoints() {
    if (!chat.signedIn) { pointsEl.hidden = true; return; }
    for (const s of streams.filter((x) => x.platform === 'twitch')) {
      const r = await prism.points.get(s.id).catch(() => null);
      if (!r || !r.signedIn || r.unavailable || r.error) continue;
      points.set(s.id, r);
      if (r.claimId && S.autoClaimPoints && !r.claimBlocked) {
        const c = await prism.points.claim(r.channelId, r.claimId).catch(() => null);
        if (c?.ok) { r.balance = c.balance; r.claimId = null; }
        else if (c?.blocked && !claimBlockedNotified) {
          claimBlockedNotified = true;
          toast("Twitch didn't allow an automatic points claim here. Claim the bonus on twitch.tv instead.");
        }
      }
    }
    paintPoints();
  }
  setInterval(refreshPoints, 60000);

  // =========================================================================
  // NoPixel tab: every NoPixel streamer. Live ones are found across Twitch's
  // whole GTA V directory by "NoPixel" in their title or tags; offline ones
  // come from Prism's roster of everyone it has seen live on NoPixel.
  // =========================================================================
  const RP = (() => {
    let live = [], offline = [], fetchedAt = 0, timer = null, loading = false, error = '';
    let view = 'streamers';
    const locations = new Map(); // login -> { area, region, at, stale }
    const NP = /no\s*pixel|\bnp\s*(?:v|5\.0|4\.0|wl|public)\b|\[np\]|\|\s*np\b/i;
    const REGION_ORDER = ['Los Santos', 'Vinewood Hills & west coast', 'Blaine County', 'Paleto & north', 'At sea'];

    // "Swan DeLeur | NoPixel V | !socials" -> "Swan DeLeur"
    function character(title, login) {
      const parts = String(title || '').split(/\s[|•·—–-]\s|\s*\|\s*/).map((p) => p.replace(/[\[\]()]/g, '').trim()).filter(Boolean);
      for (const p of parts) {
        if (NP.test(p)) continue;
        if (/[!@#]|https?:|\b(day|ep|episode|sub|giveaway|drops|rp|gta|nopixel|stream|live)\b/i.test(p)) continue;
        if (p.length > 28 || p.split(/\s+/).length > 4 || !/^[\p{Lu}]/u.test(p)) continue;
        if (p.toLowerCase().replace(/\s+/g, '') === login) continue;
        return p;
      }
      return '';
    }
    const ago = (t) => {
      if (!t) return 'not seen live yet';
      const m = Math.floor((Date.now() - t) / 60000);
      if (m < 60) return `${Math.max(1, m)}m ago`;
      const hrs = Math.floor(m / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const d = Math.floor(hrs / 24);
      return d === 1 ? 'yesterday' : `${d} days ago`;
    };
    const matches = (x, q) => !q || x.login.includes(q) || (x.name || '').toLowerCase().includes(q) ||
      (x.title || x.lastTitle || '').toLowerCase().includes(q) || (x.char || '').toLowerCase().includes(q) ||
      (locations.get(x.login)?.area || '').toLowerCase().includes(q);
    const groups = () => S.npGroups || [];
    const saveGroups = (g) => { S.npGroups = g; save({ npGroups: g }); };
    const liveSet = () => new Set(live.map((x) => x.login));
    const inMultiview = () => new Set(streams.filter((x) => x.platform === 'twitch').map((x) => x.id));
    function watchAll(logins, label) {
      const on = live.filter((x) => logins.includes(x.login));
      if (!on.length) return toast('Nobody there is live right now.');
      for (const x of on) addStream({ platform: 'twitch', id: x.login, label: x.name });
      toast(`Added ${on.length} stream${on.length > 1 ? 's' : ''}${label ? ' from ' + label : ''} to multi-view.`);
      showView('multiview');
    }

    // ---- Card menu: groups, remove ------------------------------------------
    const menu = $('#rp-menu');
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
    function openMenu(e, x) {
      e.stopPropagation();
      menu.textContent = '';
      const item = (label, sub, fn) => menu.append(h('button', { class: 'tm-item', onclick: (ev) => { ev.stopPropagation(); fn(); } },
        h('span', { text: label }), sub ? h('small', { text: sub }) : null));
      menu.append(h('div', { class: 'tm-head', text: x.name }));
      for (const g of groups()) {
        const has = g.members.includes(x.login);
        item((has ? '✓ ' : '+ ') + g.name, has ? 'In this group (click to take out)' : 'Add to this group', () => {
          saveGroups(groups().map((y) => y.id !== g.id ? y : { ...y, members: has ? y.members.filter((l) => l !== x.login) : [...y.members, x.login] }));
          menu.hidden = true; render();
        });
      }
      const nameInput = h('input', { class: 'tm-input', placeholder: 'New group name, then Enter', maxlength: 30 });
      nameInput.addEventListener('click', (ev) => ev.stopPropagation());
      nameInput.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' || !nameInput.value.trim()) return;
        saveGroups([...groups(), { id: 'g' + Date.now(), name: nameInput.value.trim(), members: [x.login] }]);
        menu.hidden = true; render();
      });
      menu.append(nameInput);
      item('Open on Twitch', '', () => { menu.hidden = true; prism.openExternal(`https://www.twitch.tv/${x.login}`); });
      item('Not on NoPixel', 'Take them off this list', async () => {
        menu.hidden = true;
        await prism.nopixelRemove(x.login);
        live = live.filter((y) => y.login !== x.login); offline = offline.filter((y) => y.login !== x.login);
        render(); toast(`Took ${x.name} off the NoPixel list.`);
      });
      const r = e.target.getBoundingClientRect();
      menu.hidden = false;
      menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
      menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
    }

    const areaChip = (login) => {
      const l = locations.get(login);
      if (!l?.area) return null;
      return h('span', { class: 'rp-area' + (l.stale ? ' stale' : ''), title: `Read from their stream ${ago(l.at)}`, text: '📍 ' + l.area });
    };

    // ---- Groups --------------------------------------------------------------
    function renderGroups(body, q) {
      const gs = groups();
      if (!gs.length) return;
      const ls = liveSet();
      body.append(h('h2', { class: 'rp-section', text: `Groups · ${gs.length}` }));
      const row = h('div', { class: 'rp-groups' });
      for (const g of gs) {
        if (q && !g.name.toLowerCase().includes(q) && !g.members.some((m) => m.includes(q))) continue;
        const online = g.members.filter((m) => ls.has(m));
        const avatars = h('div', { class: 'rp-g-av' });
        for (const m of online.slice(0, 8)) {
          const x = live.find((y) => y.login === m);
          avatars.append(x?.avatar ? h('img', { src: x.avatar, title: x.name, alt: '' }) : h('span', { title: m }));
        }
        if (online.length > 8) avatars.append(h('em', { text: '+' + (online.length - 8) }));
        row.append(h('div', { class: 'rp-group' + (online.length ? '' : ' off') },
          h('div', { class: 'rp-g-top' }, h('b', { text: g.name }), h('span', { class: 'muted small', text: `${online.length} of ${g.members.length} online` }),
            h('button', { class: 'icon-btn', title: 'Delete group', text: '✕', onclick: () => { saveGroups(gs.filter((y) => y.id !== g.id)); render(); } })),
          avatars,
          h('div', { class: 'rp-g-act' },
            h('button', { class: 'btn btn-accent', text: 'Watch all', disabled: !online.length, onclick: () => watchAll(online, g.name) }))));
      }
      body.append(row);
    }

    // ---- Live cards ----------------------------------------------------------
    function liveCard(x, followed, added, bust) {
      const card = h('div', { class: 'rp-card' + (added ? ' added' : ''), title: x.title },
        h('div', { class: 'rp-thumb' },
          h('img', { src: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${x.login}-440x248.jpg?t=${bust}`, alt: '', loading: 'lazy' }),
          h('span', { class: 'rp-live', text: fmtViewers(x.viewers) }),
          x.startedAt ? h('span', { class: 'rp-up', text: fmtUptime(x.startedAt) }) : null,
          h('span', { class: 'rp-add', text: added ? '✓ In multi-view' : '+ Multi-view' })),
        h('div', { class: 'rp-meta' },
          x.avatar ? h('img', { class: 'rp-av', src: x.avatar, alt: '', loading: 'lazy' }) : h('span', { class: 'rp-av' }),
          h('div', { class: 'rp-text' },
            h('div', { class: 'rp-who' }, h('b', { text: x.name }), followed ? h('span', { class: 'rp-fol', text: 'Following' }) : null),
            x.char ? h('div', { class: 'rp-char', text: 'as ' + x.char }) : null,
            areaChip(x.login),
            h('div', { class: 'rp-t', text: x.title })),
          h('button', { class: 'icon-btn rp-more', title: 'Groups and more', text: '⋯', onclick: (e) => openMenu(e, x) })));
      card.addEventListener('click', (e) => {
        if (e.target.closest('.rp-more')) return;
        if (added) { setChat('twitch:' + x.login); showView('multiview'); return; }
        addStream({ platform: 'twitch', id: x.login, label: x.name });
        toast(`Added ${x.name} to multi-view.`);
        render();
      });
      return card;
    }

    function sorted(L) {
      const sort = $('#rp-sort').value;
      const t = (x) => (x.startedAt ? new Date(x.startedAt).getTime() : 0);
      return L.sort(sort === 'newest' ? (a, b) => t(b) - t(a) : sort === 'longest' ? (a, b) => t(a) - t(b)
        : sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.viewers - a.viewers);
    }

    function render() {
      const body = $('#rp-body');
      const keepScroll = $('#view-rp').scrollTop;
      body.textContent = '';
      $$('#rp-view button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
      $('#rp-updated').textContent = loading ? (fetchedAt ? 'Updating…' : 'Searching Twitch…') : fetchedAt ? 'Updated ' + new Date(fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      if (error && !live.length && !offline.length) {
        body.append(h('div', { class: 'rp-empty' }, "Couldn't load live streams from Twitch.", h('div', { class: 'err-detail', text: 'Twitch said: ' + error })));
        return;
      }
      if (!fetchedAt) { body.append(h('div', { class: 'rp-empty', text: 'Finding everyone live on NoPixel…' })); return; }

      const q = $('#rp-search').value.trim().toLowerCase();
      const onlyFollowing = $('#rp-following').checked;
      const followed = new Set(followingCache.map((c) => c.login.toLowerCase()));
      const added = inMultiview();
      const located = live.filter((x) => locations.get(x.login)?.area).length;
      $('#rp-stats').textContent = `${live.length} live · ${fmtViewers(live.reduce((a, x) => a + x.viewers, 0))} watching` +
        (offline.length ? ` · ${offline.length} offline` : '') + (located ? ` · ${located} located` : '');
      const L = sorted(live.map((x) => ({ ...x, char: character(x.title, x.login) })).filter((x) => matches(x, q) && (!onlyFollowing || followed.has(x.login))));
      const bust = Math.floor(Date.now() / 120000);

      if (view === 'areas') {
        renderAreas(body, L, added);
      } else {
        renderGroups(body, q);
        body.append(h('h2', { class: 'rp-section', text: `Live now · ${L.length}` }));
        const grid = h('div', { class: 'rp-grid' });
        if (!L.length) grid.append(h('div', { class: 'rp-empty', text: live.length ? 'No live streams match your filters.' : 'Nobody is live on NoPixel right now.' }));
        for (const x of L) grid.append(liveCard(x, followed.has(x.login), added.has(x.login), bust));
        body.append(grid);

        if ($('#rp-offline').checked) {
          const O = offline.map((x) => ({ ...x, char: character(x.lastTitle, x.login) }))
            .filter((x) => matches(x, q) && (!onlyFollowing || followed.has(x.login)))
            .sort($('#rp-sort').value === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.lastSeen - a.lastSeen);
          body.append(h('h2', { class: 'rp-section', text: `Offline · ${O.length}` }));
          const list = h('div', { class: 'rp-offline' });
          if (!O.length) list.append(h('div', { class: 'rp-empty small', text: offline.length ? 'No offline streamers match your filters.'
            : 'Streamers show up here after Prism has seen them live on NoPixel. The list grows each time this tab updates.' }));
          for (const x of O) {
            list.append(h('div', { class: 'rp-off', title: x.lastTitle || '', onclick: () => prism.openExternal(`https://www.twitch.tv/${x.login}`) },
              x.avatar ? h('img', { class: 'rp-av', src: x.avatar, alt: '', loading: 'lazy' }) : h('span', { class: 'rp-av' }),
              h('div', { class: 'rp-text' },
                h('div', { class: 'rp-who' }, h('b', { text: x.name }), followed.has(x.login) ? h('span', { class: 'rp-fol', text: 'Following' }) : null),
                x.char ? h('div', { class: 'rp-char', text: x.char }) : null,
                h('div', { class: 'rp-t', text: 'Last live ' + ago(x.lastSeen) })),
              h('button', { class: 'icon-btn rp-more', title: 'Groups and more', text: '⋯', onclick: (e) => { e.stopPropagation(); openMenu(e, x); } })));
          }
          body.append(list);
        }
      }
      $('#view-rp').scrollTop = keepScroll;
    }

    // ---- Areas board: who's where, by part of the map -------------------------
    function renderAreas(body, L, added) {
      const byArea = new Map();
      const unknown = [];
      for (const x of L) {
        const l = locations.get(x.login);
        if (!l?.area) { unknown.push(x); continue; }
        const key = l.region + '|' + l.area;
        if (!byArea.has(key)) byArea.set(key, { region: l.region, area: l.area, people: [] });
        byArea.get(key).people.push(x);
      }
      body.append(h('p', { class: 'muted small rp-note', text: "Areas are read from each stream's HUD (the street name by the minimap) in its Twitch preview, which updates every few minutes. They're estimates, and streams with the HUD hidden show as unknown." }));
      for (const region of REGION_ORDER) {
        const areas = [...byArea.values()].filter((a) => a.region === region).sort((a, b) => b.people.length - a.people.length);
        if (!areas.length) continue;
        body.append(h('h2', { class: 'rp-section', text: `${region} · ${areas.reduce((n, a) => n + a.people.length, 0)}` }));
        const grid = h('div', { class: 'rp-areas' });
        for (const a of areas) {
          const list = h('div', { class: 'rp-a-list' });
          for (const x of a.people.sort((p, q) => q.viewers - p.viewers)) {
            list.append(h('div', { class: 'rp-a-who' + (added.has(x.login) ? ' added' : ''), title: x.title, onclick: () => {
              if (!added.has(x.login)) { addStream({ platform: 'twitch', id: x.login, label: x.name }); toast(`Added ${x.name} to multi-view.`); render(); }
            } },
              x.avatar ? h('img', { src: x.avatar, alt: '' }) : h('span', { class: 'ph' }),
              h('span', { class: 'n', text: x.name }), x.char ? h('span', { class: 'c', text: x.char }) : null,
              h('span', { class: 'v', text: fmtViewers(x.viewers) })));
          }
          grid.append(h('div', { class: 'rp-a' },
            h('div', { class: 'rp-a-top' }, h('b', { text: a.area }), h('span', { class: 'muted small', text: `${a.people.length} here` }),
              h('button', { class: 'btn', text: 'Watch all', onclick: () => watchAll(a.people.map((p) => p.login), a.area) })),
            list));
        }
        body.append(grid);
      }
      if (unknown.length) {
        body.append(h('h2', { class: 'rp-section', text: `Location unknown · ${unknown.length}` }));
        body.append(h('div', { class: 'rp-unknown' }, ...unknown.map((x) => h('span', { title: x.title, text: x.name }))));
      }
      if (!byArea.size) body.append(h('div', { class: 'rp-empty', text: 'Reading where everyone is… this takes a minute or two the first time.' }));
    }

    async function load(force) {
      if (loading) return;
      loading = true;
      render();
      const r = await prism.nopixelStreams(force).catch((e) => ({ live: [], offline: [], error: String(e) }));
      loading = false;
      error = r.error || '';
      if (r.live?.length || r.offline?.length || !fetchedAt) { live = r.live || []; offline = r.offline || []; fetchedAt = r.at || Date.now(); }
      render();
      // Read everyone's area in the background, biggest streams first.
      const known = await prism.nopixelLocate([...live].sort((a, b) => b.viewers - a.viewers).map((x) => x.login)).catch(() => ({}));
      for (const [l, v] of Object.entries(known || {})) locations.set(l, v);
      render();
    }

    let renderTimer = null;
    prism.onNopixelLocation((d) => {
      locations.set(d.login, d);
      if (currentView !== 'rp') return;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 400);
    });

    $('#rp-search').addEventListener('input', render);
    $('#rp-sort').addEventListener('change', () => { save({ rpSort: $('#rp-sort').value }); render(); });
    $('#rp-following').addEventListener('change', render);
    $('#rp-offline').addEventListener('change', render);
    $('#rp-refresh').addEventListener('click', () => load(true));
    $$('#rp-view button').forEach((b) => b.addEventListener('click', () => { view = b.dataset.v; render(); }));
    $('#rp-add-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.textContent = '';
      const input = h('input', { class: 'tm-input', placeholder: 'Twitch name or link, then Enter' });
      input.addEventListener('click', (ev) => ev.stopPropagation());
      input.addEventListener('keydown', async (ev) => {
        if (ev.key !== 'Enter') return;
        const p = parseStream(input.value);
        if (!p || p.platform !== 'twitch') return toast('Enter a Twitch name or link.');
        await prism.nopixelAdd(p.id);
        menu.hidden = true;
        toast(`Added ${p.id} to the NoPixel list.`);
        load(true);
      });
      menu.append(h('div', { class: 'tm-head', text: 'Add someone who plays on NoPixel' }), input);
      const r = e.target.getBoundingClientRect();
      menu.hidden = false;
      menu.style.left = Math.min(r.left, window.innerWidth - 280) + 'px';
      menu.style.top = r.bottom + 4 + 'px';
      input.focus();
    });

    return {
      show() {
        $('#rp-sort').value = S.rpSort || 'viewers';
        if (Date.now() - fetchedAt > 60000) load(false); else render();
        clearInterval(timer);
        timer = setInterval(() => load(true), 120000); // refresh every 2 minutes while open
      },
      hide() { clearInterval(timer); timer = null; }
    };
  })();

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
      absorbInfo(followingCache);
      paintAllTileInfo();
    } catch {}
    renderSideLive();
  }
  setInterval(refreshFollowing, 120000);

  // =========================================================================
  // Notifications bell (quick on/off)
  // =========================================================================
  const BELL_ON = '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
  const BELL_OFF = '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M4 4l16 16"/></svg>';
  function paintBell() {
    const b = $('#bell-btn');
    b.innerHTML = S.liveAlerts ? BELL_ON : BELL_OFF;
    b.classList.toggle('off', !S.liveAlerts);
    b.title = S.liveAlerts ? 'Go-live notifications are on (click to turn off)' : 'Go-live notifications are off (click to turn on)';
  }
  $('#bell-btn').addEventListener('click', async () => {
    await save({ liveAlerts: !S.liveAlerts });
    paintBell();
    if (currentView === 'settings') renderSettings();
    toast(S.liveAlerts ? 'Notifications on.' : 'Notifications off.');
  });

  // =========================================================================
  // Drag sidebar tabs to rearrange them
  // =========================================================================
  const navTabs = $('#nav-tabs');
  function applyNavOrder() {
    const order = S.navOrder || [];
    const btns = [...navTabs.children];
    btns.sort((a, b) => {
      const ia = order.indexOf(a.dataset.view), ib = order.indexOf(b.dataset.view);
      return (ia < 0 ? 99 + btns.indexOf(a) : ia) - (ib < 0 ? 99 + btns.indexOf(b) : ib);
    });
    for (const b of btns) navTabs.append(b);
  }
  let dragBtn = null;
  for (const b of navTabs.children) {
    b.draggable = true;
    b.addEventListener('dragstart', (e) => { dragBtn = b; b.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.dataset.view); });
    b.addEventListener('dragend', () => {
      b.classList.remove('dragging');
      dragBtn = null;
      save({ navOrder: [...navTabs.children].map((x) => x.dataset.view) });
    });
  }
  navTabs.addEventListener('dragover', (e) => {
    if (!dragBtn) return;
    e.preventDefault();
    const after = [...navTabs.children].filter((x) => x !== dragBtn && !x.hidden).find((x) => {
      const r = x.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (after) navTabs.insertBefore(dragBtn, after); else navTabs.append(dragBtn);
  });
  navTabs.addEventListener('drop', (e) => e.preventDefault());

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
  for (const s of streams) if (s.platform === 'twitch' && !s.chatOff) joinChat(s.id);
  renderStage();
  showView(S.lastView && S.lastView !== 'settings' ? S.lastView : 'multiview');
  refreshChatAuth();
  if (S.thirdPartyEmotes) loadEmotes();
  paintSidebarIcons();
  applyNavOrder();
  paintBell();
  applyPanelSizes();
  refreshFollowing();
  refreshStreamInfo();
  prism.updater.state().then(showUpdater);
})();
