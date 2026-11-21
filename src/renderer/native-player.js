/* global Hls, prism */ // Hls is loaded on demand (loadHls)
// Lightweight Twitch player: a <video> + hls.js in the main window, instead of
// a separate player.twitch.tv web page (and browser process) per stream.
(function () {
  const MASTER_PREFIX = 'prism-twitch://';

  function emptyStats() {
    const now = performance.now();
    return {
      aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
      loading: { start: now, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 }
    };
  }

  // Playlists (master + media) load through Prism's backend, which handles
  // tokens and ads. Video segments load directly.
  // Seconds behind the newest video to play at, and to jump back from.
  // Kick (Amazon IVS) makes short, steady segments and its own site plays ~3 s
  // behind, so Kick can sit closer than Twitch.
  const liveSync = (kind) => {
    const low = window.PRISM_LOW_LATENCY !== false;
    if (kind === 'kick') return low ? 3.5 : 8;
    return low ? 6 : 9;
  };
  const LIVE_MAX_BEHIND = 16;

  function makePlaylistLoader(login, onAd) {
    return class PrismPlaylistLoader {
      constructor() { this.stats = emptyStats(); this.context = null; this.aborted = false; }
      destroy() { this.aborted = true; }
      abort() { this.aborted = true; this.stats.aborted = true; }
      load(context, _config, callbacks) {
        this.context = context;
        const stats = this.stats;
        stats.loading.start = performance.now();
        // If the backend never answers, report a timeout so hls.js asks again
        // (otherwise the stream would sit frozen waiting forever).
        let settled = false;
        const timer = setTimeout(() => {
          if (settled || this.aborted) return;
          settled = true;
          callbacks.onTimeout ? callbacks.onTimeout(stats, context, null) : callbacks.onError({ code: 0, text: 'timeout' }, context, null, stats);
        }, 12000);
        const job = context.url.startsWith(MASTER_PREFIX)
          ? prism.twitchStream.master(login).then((r) => (r.master ? { text: r.master } : r))
          : prism.twitchStream.playlist(login, context.url);
        job.then((r) => {
          clearTimeout(timer);
          if (this.aborted || settled) return;
          settled = true;
          stats.loading.first = stats.loading.end = performance.now();
          if (r.offline) return callbacks.onError({ code: 404, text: 'offline' }, context, null, stats);
          if (!r.text) return callbacks.onError({ code: r.status || 0, text: r.error || 'failed' }, context, null, stats);
          if (r.ad) onAd(r.ad);
          else if (r.adEnded) onAd('ended');
          stats.loaded = stats.total = r.text.length;
          callbacks.onSuccess({ url: context.url, data: r.text }, stats, context, null);
        }).catch((e) => {
          clearTimeout(timer);
          if (this.aborted || settled) return;
          settled = true;
          callbacks.onError({ code: 0, text: String(e) }, context, null, stats);
        });
      }
    };
  }

  // The video library is loaded the first time a stream plays, not at start-up.
  let hlsJob = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    return (hlsJob ||= new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = '../../node_modules/hls.js/dist/hls.light.min.js';
      el.onload = resolve;
      el.onerror = () => { hlsJob = null; reject(new Error("couldn't load the video player")); };
      document.head.append(el);
    }));
  }

  // Past broadcasts: the playlist comes from Prism's backend (it needs a
  // token); the rest loads directly like any web video.
  function makeVodLoader(id) {
    const Base = Hls.DefaultConfig.loader;
    return class PrismVodLoader extends Base {
      load(context, config, callbacks) {
        if (!context.url.startsWith('prism-vod://')) return super.load(context, config, callbacks);
        const stats = this.stats || emptyStats();
        stats.loading.start = performance.now();
        prism.twitchVodMaster(id).then((r) => {
          stats.loading.first = stats.loading.end = performance.now();
          if (!r.master) return callbacks.onError({ code: 0, text: r.error || 'failed' }, context, null, stats);
          stats.loaded = stats.total = r.master.length;
          callbacks.onSuccess({ url: context.url, data: r.master }, stats, context, null);
        }).catch((e) => callbacks.onError({ code: 0, text: String(e) }, context, null, stats));
      }
    };
  }

  // Plays Twitch (kind 'twitch', playlists through Prism's backend for tokens
  // and ad handling) or Kick (kind 'kick', direct playback URL).
  class NativeTwitchPlayer {
    constructor(login, { onStatus, onFatal, onLevels, onLive, kind = 'twitch', rewindSeconds = 60, startAt = 0 } = {}) {
      this.startAt = startAt;
      this.onLive = onLive || (() => {});
      this.live = null; // true / false once known
      this.rewindSeconds = rewindSeconds;
      this.login = login;
      this.kind = kind;
      this.onStatus = onStatus || (() => {});
      this.onFatal = onFatal || (() => {});
      this.onLevels = onLevels || (() => {});
      this.video = document.createElement('video');
      this.video.playsInline = true;
      this.video.autoplay = true;
      this.video.muted = true;
      this.hls = null;
      this.retryTimer = null;
      this.fatalCount = 0;
      this.quality = 'auto';
      this.adTimer = null;
      this.destroyed = false;
    }

    async start() {
      if (this.destroyed || this.suspended) return;
      this.stopHls();
      this.onStatus('Loading…');
      if (this.kind !== 'clip') {
        try { await loadHls(); } catch (e) { return this.onFatal(e.message); }
        if (this.destroyed || this.suspended) return;
      }
      let source = MASTER_PREFIX + this.login;
      if (this.kind === 'clip') return this.startClip();
      if (this.kind === 'kick') {
        const r = await prism.kick.playback(this.login).catch((e) => ({ error: String(e) }));
        if (this.destroyed) return;
        if (r.offline) return this.wentOffline();
        if (!r.url) return this.onFatal(r.error || "couldn't get the Kick stream");
        source = r.url;
      }
      if (this.kind === 'vod') source = 'prism-vod://' + this.login;
      const vod = this.kind === 'vod';
      const hls = new Hls({
        ...(this.kind === 'twitch' ? { pLoader: makePlaylistLoader(this.login, (kind) => this.adNotice(kind)) } : {}),
        ...(vod ? { loader: makeVodLoader(this.login), startPosition: this.startAt || -1 } : {}),
        enableWorker: true,
        // Low latency: lets the player speed up a touch to stay near live.
        lowLatencyMode: (this.kind === 'twitch' || this.kind === 'kick') && window.PRISM_LOW_LATENCY !== false,
        // Keep only a few seconds of video in memory per stream.
        maxBufferLength: vod ? 20 : 8,
        maxMaxBufferLength: vod ? 30 : 16,
        maxBufferSize: 16 * 1000 * 1000,
        // Video kept behind the playhead, so you can rewind (0 = no rewind).
        backBufferLength: vod ? 10 : this.rewindSeconds,
        // How far behind live to play, in seconds. (Not in "segments": Twitch
        // says its segments are up to 6 s long though they're 2 s, which used
        // to put Prism ~18 s behind and only catch up at ~48 s.)
        ...(vod ? {} : { liveSyncDuration: liveSync(this.kind), liveMaxLatencyDuration: LIVE_MAX_BEHIND }),
        // Drifted behind (after a stall): play a little faster to catch up,
        // or jump ahead if it's more than LIVE_MAX_BEHIND.
        maxLiveSyncPlaybackRate: 1.05,
        // Pick a quality that fits the tile, so small tiles don't decode 1080p.
        capLevelToPlayerSize: this.quality === 'auto',
        startLevel: -1,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6
      });
      this.hls = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        this.fatalCount = 0;
        this.setLive(true);
        this.onStatus('');
        this.onLevels(data.levels.map((l, i) => ({ i, height: l.height, fps: Math.round(l.frameRate || 0), name: l.name })));
        // Start at the picked quality (not a low guess that looks blurry at first).
        if (this.quality !== 'auto') { try { hls.startLevel = this.wantedLevel(); } catch {} }
        this.applyQuality();
        this.video.play().catch(() => {});
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { if (this.fatalCount) this.fatalCount = 0; });
      // The stream ended (the playlist stopped being live): check whether
      // they're offline now.
      hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
        if (this.isLive() && data.details && data.details.live === false && !this.endCheck) {
          this.endCheck = setTimeout(() => { this.endCheck = null; this.start(); }, 4000);
        }
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.response && data.response.text === 'offline') return this.wentOffline();
        if (vod && data.fatal && data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) return this.onFatalVod(data.response?.text);
        if (!data.fatal) return;
        this.fatalCount++;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.fatalCount <= 2) { hls.recoverMediaError(); return; }
        // Network trouble: keep reconnecting (a stream ending looks like this
        // too; the reconnect finds out they went offline). Only odd media
        // problems hand the stream to the site's own player.
        if (this.fatalCount <= 3 || data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          this.onStatus('Reconnecting…');
          this.retryTimer = setTimeout(() => this.start(), Math.min(15000, 2000 * this.fatalCount));
          return;
        }
        this.onFatal(data.details || data.type);
      });
      hls.loadSource(source);
      hls.attachMedia(this.video);
      this.watch();
    }

    isLive() { return this.kind === 'twitch' || this.kind === 'kick'; }

    // A clip is a plain video file.
    async startClip() {
      const r = await prism.twitchClipUrl(this.login).catch((e) => ({ error: String(e) }));
      if (this.destroyed) return;
      if (!r.url) { this.onStatus(r.error || "Couldn't open that clip"); return; }
      this.onStatus('');
      this.video.loop = true;
      this.video.src = r.url;
      this.video.play().catch(() => {});
      this.setLive(true);
    }
    onFatalVod(text) {
      this.stopHls();
      this.onStatus(text || "Couldn't play this broadcast");
    }
    // Past broadcasts and clips: position and length.
    position() { return this.video.currentTime || 0; }
    duration() { return isFinite(this.video.duration) ? this.video.duration : 0; }
    seekTo(sec) { this.video.currentTime = Math.max(0, Math.min(this.duration() || sec, sec)); }
    togglePause() { if (this.video.paused) this.video.play().catch(() => {}); else this.video.pause(); return this.video.paused; }

    setLive(live) {
      if (this.live === live) return;
      this.live = live;
      this.onLive(live);
    }

    wentOffline() {
      this.stopHls();
      // Clear the picture so the last frame doesn't look like a frozen stream.
      this.video.removeAttribute('src');
      try { this.video.load(); } catch {}
      this.setLive(false);
      this.onStatus('');
      this.retryTimer = setTimeout(() => this.start(), 30000); // checks again every 30 s
    }

    // ---- Freeze watchdog --------------------------------------------------
    // Every 2 seconds: is the picture still moving? If a stream has been stuck
    // for 6 s it's nudged to the live edge, at 12 s the decoder is reset, and
    // at 20 s the stream is reloaded.
    watch() {
      clearInterval(this.watchTimer);
      this.stuckSince = 0;
      this.lastPos = -1;
      this.lastFrames = -1;
      this.nudged = 0;
      this.watchTimer = setInterval(() => { this.checkFrozen(); this.checkQuality(); this.checkDrift(); }, 2000);
    }
    checkFrozen() {
      const v = this.video;
      if (!this.hls || this.destroyed || this.suspended || this.live === false || !v.isConnected || (!this.isLive() && (v.paused || v.ended))) { this.stuckSince = 0; return; }
      const visible = document.visibilityState === 'visible' && v.offsetParent !== null;
      const frames = visible && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : -1;
      const pos = v.currentTime;
      // Moving if time advanced and (when we can see it) new frames were drawn.
      const moving = pos !== this.lastPos && (frames < 0 || this.lastFrames < 0 || frames !== this.lastFrames);
      this.lastPos = pos;
      this.lastFrames = frames;
      if (moving) { this.stuckSince = 0; this.nudged = 0; return; }
      if (!this.stuckSince) { this.stuckSince = Date.now(); return; }
      const stuck = Date.now() - this.stuckSince;
      if (stuck >= 20000) {
        this.onStatus('Stream froze, reloading…');
        this.stuckSince = 0;
        if (!this.isLive()) this.startAt = v.currentTime;
        this.start();
      } else if (stuck >= 12000 && this.nudged < 2) {
        this.nudged = 2;
        try { this.hls.recoverMediaError(); } catch {}
        v.play().catch(() => {});
      } else if (stuck >= 6000 && this.nudged < 1) {
        this.nudged = 1;
        if (this.isLive()) this.goLive(); else v.currentTime += 0.2;
        try { this.hls.startLoad(-1); } catch {}
      }
    }

    // Fell behind live without you rewinding (after a stall): skip ahead,
    // but only through video that's already downloaded, so it never has to
    // stop and load. (Much further behind, the player jumps by itself.)
    checkDrift() {
      const v = this.video;
      if (!this.hls || !this.isLive() || this.rewound || this.suspended || v.paused || this.destroyed) { this.driftSince = 0; return; }
      if (this.adUntil && Date.now() < this.adUntil) { this.driftSince = 0; return; }
      if (this.behind() < 6) { this.driftSince = 0; return; }
      if (!this.driftSince) { this.driftSince = Date.now(); return; }
      if (Date.now() - this.driftSince < 10000) return;
      this.driftSince = 0;
      const b = v.buffered;
      const end = b.length ? b.end(b.length - 1) : 0;
      const target = Math.min(this.liveEdge(), end - 2);
      if (target > v.currentTime + 2) v.currentTime = target;
    }

    adNotice(kind) {
      if (kind === 'ended') {
        // The ad-free backup stream is usually 480p at best. Once the ad
        // break is over, reload at the quality you picked (otherwise the
        // picture could stay low while the menu still says 1080p).
        this.adUntil = 0;
        clearTimeout(this.adTimer);
        this.onStatus('');
        // (and back at live: the backup stream can run a little behind).
        setTimeout(() => { if (!this.destroyed) { this.applyQuality(); if (!this.rewound) setTimeout(() => this.goLive(), 800); } }, 1500);
        return;
      }
      this.adUntil = Date.now() + 12000;
      this.onStatus(kind === 'swapped' ? 'Ad break: playing an ad-free backup stream' : 'Ad break: ads removed, stream resumes shortly');
      clearTimeout(this.adTimer);
      this.adTimer = setTimeout(() => this.onStatus(''), 6000);
    }

    setQuality(q) { this.quality = q; this.lowSince = 0; this.applyQuality(); }

    // A picked quality that quietly slipped (after an ad break or a network
    // hiccup): if the picture stays well below it for 15 seconds, reload at
    // the picked quality, like switching to Source and back by hand.
    checkQuality() {
      const hls = this.hls;
      if (!hls || this.quality === 'auto' || !this.isLive() || this.video.paused || this.suspended) { this.lowSince = 0; return; }
      if (this.adUntil && Date.now() < this.adUntil) { this.lowSince = 0; return; }
      const want = this.wantedLevel();
      const lvl = want >= 0 ? hls.levels[want] : null;
      const h = this.video.videoHeight;
      const slipped = (hls.currentLevel !== want && hls.loadLevel !== want) || (lvl?.height && h && h < lvl.height * 0.8);
      if (!slipped) { this.lowSince = 0; return; }
      if (!this.lowSince) { this.lowSince = Date.now(); return; }
      if (Date.now() - this.lowSince < 15000 || Date.now() - (this.lastRelock || 0) < 60000) return;
      this.lowSince = 0;
      this.lastRelock = Date.now();
      this.applyQuality();
    }
    wantedLevel() {
      const hls = this.hls;
      if (!hls || !hls.levels.length || this.quality === 'auto') return -1;
      if (this.quality === 'source') return hls.levels.reduce((b, l, i) => (l.bitrate > hls.levels[b].bitrate ? i : b), 0);
      const want = Number(this.quality);
      return hls.levels.reduce((b, l, i) => (Math.abs(l.height - want) < Math.abs(hls.levels[b].height - want) ? i : b), 0);
    }
    applyQuality() {
      const hls = this.hls;
      if (!hls || !hls.levels.length) return;
      if (this.quality === 'auto') {
        hls.capLevelToPlayerSize = true;
        hls.currentLevel = -1;
        return;
      }
      hls.capLevelToPlayerSize = false;
      hls.currentLevel = this.wantedLevel();
    }

    // ---- Rewind ----------------------------------------------------------
    liveEdge() { return this.hls?.liveSyncPosition ?? (this.video.buffered.length ? this.video.buffered.end(this.video.buffered.length - 1) : 0); }
    earliest() { return this.video.buffered.length ? this.video.buffered.start(0) : this.video.currentTime; }
    behind() { return this.isLive() ? Math.max(0, this.liveEdge() - this.video.currentTime) : 0; }
    seekBy(sec) {
      if (!this.isLive()) { this.seekTo(this.video.currentTime + sec); return 0; }
      if (!this.hls) return 0;
      const target = Math.max(this.earliest() + 0.5, Math.min(this.liveEdge(), this.video.currentTime + sec));
      // While rewound, don't let the player jump back to live by itself.
      this.hls.config.liveMaxLatencyDuration = Infinity;
      this.rewound = true;
      this.video.currentTime = target;
      this.video.play().catch(() => {});
      if (this.behind() < 2) this.goLive();
      return this.behind();
    }
    goLive() {
      if (!this.hls || !this.isLive()) return;
      this.hls.config.liveMaxLatencyDuration = LIVE_MAX_BEHIND;
      this.rewound = false;
      this.driftSince = 0;
      const edge = this.hls.liveSyncPosition;
      if (edge) this.video.currentTime = edge;
      this.video.play().catch(() => {});
    }
    // How much video to keep behind the playhead (can change while playing).
    setBackBuffer(sec) {
      this.rewindSeconds = sec;
      if (this.hls) this.hls.config.backBufferLength = sec;
    }
    canRewind() { return this.rewindSeconds > 0 && this.video.currentTime - this.earliest() > 3; }

    // Stop downloading and decoding while nobody can see or hear it (multi-view
    // is in the background); pick up again at live when it's back.
    suspend() {
      if (this.suspended || this.destroyed) return;
      this.suspended = Date.now();
      clearTimeout(this.retryTimer);
      if (this.hls) { try { this.hls.stopLoad(); } catch {} }
      this.video.pause();
    }
    resume() {
      if (!this.suspended || this.destroyed) return;
      const away = Date.now() - this.suspended;
      this.suspended = 0;
      // Briefly away: carry on from where the download stopped. Longer: reload
      // at live (the old position is long gone from Twitch's playlist).
      if (!this.isLive()) { if (this.hls) try { this.hls.startLoad(); } catch {} this.video.play().catch(() => {}); this.watch(); return; }
      if (!this.hls || away > 20000) return this.start();
      try { this.hls.startLoad(-1); } catch {}
      this.goLive();
      this.watch();
    }

    setMuted(m) { this.video.muted = m; }
    setVolume(v) {
      this.vol = Math.max(0, Math.min(1, v));
      if (this.audio) { this.video.volume = 1; this.audio.gain.gain.value = this.vol; }
      else this.video.volume = this.vol;
    }

    // "Even out volume": a gentle compressor so loud streams and quiet
    // streams sit at about the same level. Built only when turned on.
    setEven(on) {
      if (!on && !this.audio) return;
      if (!this.audio) {
        const ctx = NativeTwitchPlayer.audioCtx || (NativeTwitchPlayer.audioCtx = new AudioContext());
        const src = ctx.createMediaElementSource(this.video);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -28; comp.knee.value = 24; comp.ratio.value = 4;
        comp.attack.value = 0.01; comp.release.value = 0.3;
        const makeup = ctx.createGain(); makeup.gain.value = 1.6;
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        this.audio = { ctx, src, comp, makeup, gain, on: null };
        this.setVolume(this.vol ?? this.video.volume);
      }
      const a = this.audio;
      if (a.on === on) return;
      a.on = on;
      try { a.src.disconnect(); a.comp.disconnect(); a.makeup.disconnect(); } catch {}
      if (on) { a.src.connect(a.comp); a.comp.connect(a.makeup); a.makeup.connect(a.gain); }
      else a.src.connect(a.gain);
      if (a.ctx.state === 'suspended') a.ctx.resume().catch(() => {});
    }

    stopHls() {
      clearTimeout(this.retryTimer);
      clearTimeout(this.endCheck); this.endCheck = null;
      clearInterval(this.watchTimer);
      if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
    }

    destroy() {
      this.destroyed = true;
      clearTimeout(this.adTimer);
      this.stopHls();
      if (this.audio) { try { this.audio.src.disconnect(); this.audio.gain.disconnect(); } catch {} this.audio = null; }
      this.video.removeAttribute('src');
      try { this.video.load(); } catch {}
      if (this.kind === 'twitch') prism.twitchStream.forget(this.login);
    }
  }

  window.NativeTwitchPlayer = NativeTwitchPlayer;
})();
