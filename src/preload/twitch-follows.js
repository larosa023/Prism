// Loaded only into the hidden twitch.tv window Prism uses to read your
// follows. It passes along the answers Twitch's own page gets from
// gql.twitch.tv so Prism can read the live list. Nothing else.
const { webFrame, ipcRenderer } = require('electron');

window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.__prismGql) ipcRenderer.send('twitch:follows-data', e.data.text);
});

webFrame.executeJavaScript(`(() => {
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const p = realFetch.apply(this, arguments);
    if (url.includes('gql.twitch.tv')) {
      p.then((res) => res.clone().text()).then((text) => {
        if (/followedLiveUsers|personalSections/.test(text)) window.postMessage({ __prismGql: true, text }, '*');
      }).catch(() => {});
    }
    return p;
  };
})();`).catch(() => {});
