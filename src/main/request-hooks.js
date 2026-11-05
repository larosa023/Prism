// Electron allows one onBeforeSendHeaders listener per session, so features
// that need to see or adjust outgoing request headers register here instead.
const hooks = new WeakMap(); // session -> [fn(details, headers)]

function onBeforeSendHeaders(ses, fn) {
  let list = hooks.get(ses);
  if (!list) {
    list = [];
    hooks.set(ses, list);
    ses.webRequest.onBeforeSendHeaders((details, cb) => {
      const headers = { ...details.requestHeaders };
      for (const f of list) { try { f(details, headers); } catch {} }
      cb({ requestHeaders: headers });
    });
  }
  list.push(fn);
}

module.exports = { onBeforeSendHeaders };
