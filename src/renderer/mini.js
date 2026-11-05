/* global prism, NativeTwitchPlayer, Hls */
// Pop-out mini player: one stream in a small always-on-top window.
(async function () {
  const $ = (s) => document.querySelector(s);
  const stream = JSON.parse(new URLSearchParams(location.search).get('s') || '{}');
  const key = stream.platform + ':' + stream.id;
  const S = await prism.settings.get();
  const info = await prism.info();
  $('#name').textContent = stream.label || stream.id;
  document.title = `${stream.label || stream.id} · Prism`;

  let muted = false;
  let volume = stream.volume ?? 1;
  let setAudio = () => {};
  let setVol = () => {};

  const native = window.Hls?.isSupported() && stream.player !== 'embed' && (
    (stream.platform === 'twitch' && S.twitchPlayer !== 'embed') ||
    (stream.platform === 'kick' && S.kickPlayer !== 'embed'));

  if (native) {
    const status = $('#status');
    const player = new NativeTwitchPlayer(stream.id, {
      kind: stream.platform,
      onStatus: (m) => { status.textContent = m; status.hidden = !m; },
      onFatal: (why) => { status.textContent = `Couldn't play this stream (${why}).`; status.hidden = false; }
    });
    player.setQuality(stream.quality && stream.quality !== 'auto' ? stream.quality : 'auto');
    player.video.addEventListener('dblclick', () => prism.mini.backToMultiview(key));
    $('#media').append(player.video);
    setAudio = (m) => player.setMuted(m);
    setVol = (v) => player.setVolume(v);
    player.setMuted(false);
    player.setVolume(volume);
    player.start();
    window.addEventListener('beforeunload', () => player.destroy());
  } else {
    $('#grip').hidden = true; // let clicks reach the site's own player
    const urls = {
      twitch: `https://player.twitch.tv/?channel=${encodeURIComponent(stream.id)}&parent=twitch.tv&autoplay=true&muted=false`,
      youtube: `https://www.youtube.com/embed/${encodeURIComponent(stream.id)}?autoplay=1&playsinline=1&rel=0`,
      kick: `https://player.kick.com/${encodeURIComponent(stream.id)}?autoplay=true&muted=false`
    };
    const wv = document.createElement('webview');
    wv.setAttribute('partition', info.platforms[stream.platform].partition);
    if (stream.platform === 'twitch') wv.setAttribute('preload', info.twitchPreload);
    if (stream.platform === 'youtube') wv.setAttribute('httpreferrer', 'https://www.youtube.com/');
    wv.setAttribute('src', urls[stream.platform]);
    let ready = false;
    wv.addEventListener('dom-ready', () => { ready = true; wv.setAudioMuted(muted); });
    $('#media').append(wv);
    setAudio = (m) => { if (ready) wv.setAudioMuted(m); };
    $('#vol').hidden = true; // the site's player has its own volume
  }

  const vol = $('#vol');
  vol.value = volume;
  vol.addEventListener('input', () => { volume = Number(vol.value); setVol(volume); if (muted && volume > 0) toggleMute(false); });
  function toggleMute(m = !muted) {
    muted = m;
    setAudio(muted);
    $('#mute').textContent = muted ? '🔇' : '🔊';
  }
  $('#mute').addEventListener('click', () => toggleMute());
  $('#back').addEventListener('click', () => prism.mini.backToMultiview(key));
  $('#close').addEventListener('click', () => prism.mini.close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') prism.mini.close();
    if (e.key.toLowerCase() === 'm') toggleMute();
  });
})();
