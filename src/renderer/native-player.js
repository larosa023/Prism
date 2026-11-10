/* global Hls, prism */
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
        lowLatencyMode: false,
        // Keep only a few seconds of video in memory per stream.
        maxBufferLength: vod ? 20 : 8,
        maxMaxBufferLength: vod ? 30 : 16,
        maxBufferSize: 16 * 1000 * 1000,
        // Video kept behind the playhead, so you can rewind (0 = no rewind).
        backBufferLength: vod ? 10 : this.rewindSeconds,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        // Pick a quality that fits the tile, so small tiles don't decode 1080p.
        capLevelToPlayerSize: true,
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
      this.watchTimer = setInterval(() => this.checkFrozen(), 2000);
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

    adNotice(kind) {
      this.onStatus(kind === 'swapped' ? 'Ad break: playing an ad-free backup stream' : 'Ad break: ads removed, stream resumes shortly');
      clearTimeout(this.adTimer);
      this.adTimer = setTimeout(() => this.onStatus(''), 6000);
    }

    setQuality(q) { this.quality = q; this.applyQuality(); }
    applyQuality() {
      const hls = this.hls;
      if (!hls || !hls.levels.length) return;
      if (this.quality === 'auto') {
        hls.capLevelToPlayerSize = true;
        hls.currentLevel = -1;
        return;
      }
      hls.capLevelToPlayerSize = false;
      let idx;
      if (this.quality === 'source') idx = hls.levels.reduce((b, l, i) => (l.bitrate > hls.levels[b].bitrate ? i : b), 0);
      else {
        const want = Number(this.quality);
        idx = hls.levels.reduce((b, l, i) => (Math.abs(l.height - want) < Math.abs(hls.levels[b].height - want) ? i : b), 0);
      }
      hls.currentLevel = idx;
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
      this.hls.config.liveMaxLatencyDurationCount = Infinity;
      this.hls.config.liveMaxLatencyDuration = undefined;
      this.video.currentTime = target;
      this.video.play().catch(() => {});
      if (this.behind() < 2) this.goLive();
      return this.behind();
    }
    goLive() {
      if (!this.hls || !this.isLive()) return;
      this.hls.config.liveMaxLatencyDurationCount = 8;
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
    setVolume(v) { this.video.volume = Math.max(0, Math.min(1, v)); }

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
      this.video.removeAttribute('src');
      try { this.video.load(); } catch {}
      if (this.kind === 'twitch') prism.twitchStream.forget(this.login);
    }
  }

  window.NativeTwitchPlayer = NativeTwitchPlayer;
})();
