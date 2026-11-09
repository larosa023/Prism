// Electron allows one onBeforeSendHeaders listener per session, so features
// that need to see or adjust outgoing request headers register here instead.
// Each hook says which addresses it cares about; only those requests make the
// trip through Prism (a video's many segment downloads don't, for example).
const hooks = new WeakMap(); // session -> { list: [{ fn, urls }], urls: Set }

function onBeforeSendHeaders(ses, urls, fn) {
  if (typeof urls === 'function') { fn = urls; urls = ['<all_urls>']; }
  let entry = hooks.get(ses);
  if (!entry) { entry = { list: [], urls: new Set() }; hooks.set(ses, entry); }
  entry.list.push({ fn, urls });
  for (const u of urls) entry.urls.add(u);
  const all = entry.urls.has('<all_urls>') ? ['<all_urls>'] : [...entry.urls];
  ses.webRequest.onBeforeSendHeaders({ urls: all }, (details, cb) => {
    const headers = { ...details.requestHeaders };
    for (const h of entry.list) { try { h.fn(details, headers); } catch {} }
    cb({ requestHeaders: headers });
  });
}

module.exports = { onBeforeSendHeaders };
