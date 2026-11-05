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
        const job = context.url.startsWith(MASTER_PREFIX)
          ? prism.twitchStream.master(login).then((r) => (r.master ? { text: r.master } : r))
          : prism.twitchStream.playlist(login, context.url);
        job.then((r) => {
          if (this.aborted) return;
          stats.loading.first = stats.loading.end = performance.now();
          if (r.offline) return callbacks.onError({ code: 404, text: 'offline' }, context, null, stats);
          if (!r.text) return callbacks.onError({ code: r.status || 0, text: r.error || 'failed' }, context, null, stats);
          if (r.ad) onAd(r.ad);
          stats.loaded = stats.total = r.text.length;
          callbacks.onSuccess({ url: context.url, data: r.text }, stats, context, null);
        }).catch((e) => {
          if (!this.aborted) callbacks.onError({ code: 0, text: String(e) }, context, null, stats);
        });
      }
    };
  }

  // Plays Twitch (kind 'twitch', playlists through Prism's backend for tokens
  // and ad handling) or Kick (kind 'kick', direct playback URL).
  class NativeTwitchPlayer {
    constructor(login, { onStatus, onFatal, onLevels, kind = 'twitch', rewindSeconds = 60 } = {}) {
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
      if (this.destroyed) return;
      this.stopHls();
      this.onStatus('Loading…');
      let source = MASTER_PREFIX + this.login;
      if (this.kind === 'kick') {
        const r = await prism.kick.playback(this.login).catch((e) => ({ error: String(e) }));
        if (this.destroyed) return;
        if (r.offline) {
          this.onStatus(`${this.login} is offline. Checking again in a minute.`);
          this.retryTimer = setTimeout(() => this.start(), 60000);
          return;
        }
        if (!r.url) return this.onFatal(r.error || "couldn't get the Kick stream");
        source = r.url;
      }
      const hls = new Hls({
        ...(this.kind === 'twitch' ? { pLoader: makePlaylistLoader(this.login, (kind) => this.adNotice(kind)) } : {}),
        enableWorker: true,
        lowLatencyMode: false,
        // Keep only a few seconds of video in memory per stream.
        maxBufferLength: 8,
        maxMaxBufferLength: 16,
        maxBufferSize: 16 * 1000 * 1000,
        // Video kept behind the playhead, so you can rewind (0 = no rewind).
        backBufferLength: this.rewindSeconds,
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
        this.onStatus('');
        this.onLevels(data.levels.map((l, i) => ({ i, height: l.height, fps: Math.round(l.frameRate || 0), name: l.name })));
        this.applyQuality();
        this.video.play().catch(() => {});
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { if (this.fatalCount) this.fatalCount = 0; });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.response && data.response.text === 'offline') {
          this.onStatus(`${this.login} is offline. Checking again in a minute.`);
          this.stopHls();
          this.retryTimer = setTimeout(() => this.start(), 60000);
          return;
        }
        if (!data.fatal) return;
        this.fatalCount++;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.fatalCount <= 2) { hls.recoverMediaError(); return; }
        if (this.fatalCount <= 3) {
          this.onStatus('Reconnecting…');
          this.retryTimer = setTimeout(() => this.start(), 2000 * this.fatalCount);
          return;
        }
        this.onFatal(data.details || data.type);
      });
      hls.loadSource(source);
      hls.attachMedia(this.video);
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
    behind() { return Math.max(0, this.liveEdge() - this.video.currentTime); }
    seekBy(sec) {
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
      if (!this.hls) return;
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

    setMuted(m) { this.video.muted = m; }
    setVolume(v) { this.video.volume = Math.max(0, Math.min(1, v)); }

    stopHls() {
      clearTimeout(this.retryTimer);
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
