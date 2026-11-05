const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('prism', {
  info: () => ipcRenderer.invoke('app:info'),
  setTheme: (name) => ipcRenderer.invoke('theme:set', name),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  adblock: {
    lists: () => ipcRenderer.invoke('adblock:lists'),
    status: () => ipcRenderer.invoke('adblock:status'),
    update: () => ipcRenderer.invoke('adblock:update'),
    onStatus: on('adblock:status')
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    state: () => ipcRenderer.invoke('updater:state'),
    onState: on('updater:state')
  },
  accounts: {
    status: () => ipcRenderer.invoke('accounts:status'),
    signOut: (platform) => ipcRenderer.invoke('accounts:signout', platform)
  },
  twitchChatAuth: () => ipcRenderer.invoke('twitch:chat-auth'),
  twitchAdScript: {
    status: () => ipcRenderer.invoke('twitch:adscript-status'),
    refresh: () => ipcRenderer.invoke('twitch:adscript-refresh'),
    onStatus: on('twitch:adscript-status')
  },
  twitchStream: {
    master: (login) => ipcRenderer.invoke('twitch:stream-master', login),
    playlist: (login, url) => ipcRenderer.invoke('twitch:stream-playlist', login, url),
    forget: (login) => ipcRenderer.send('twitch:stream-forget', login)
  },
  twitchSearch: (q) => ipcRenderer.invoke('twitch:search', q),
  twitchFollowing: () => ipcRenderer.invoke('twitch:following'),
  onFollowingUpdate: on('twitch:following-update'),
  twitchStreamInfo: (logins) => ipcRenderer.invoke('twitch:stream-info', logins),
  twitchCategoryStreams: (game, force) => ipcRenderer.invoke('twitch:category-streams', game, force),
  nopixelStreams: (force) => ipcRenderer.invoke('nopixel:streams', force),
  onAddStream: on('stream:add'),
  kick: { playback: (slug) => ipcRenderer.invoke('kick:playback', slug) },
  points: {
    get: (login) => ipcRenderer.invoke('twitch:points', login),
    claim: (channelId, claimId) => ipcRenderer.invoke('twitch:points-claim', channelId, claimId)
  },
  mini: {
    open: (stream) => ipcRenderer.invoke('mini:open', stream),
    close: () => ipcRenderer.invoke('mini:close'),
    backToMultiview: (key) => ipcRenderer.invoke('mini:return', key),
    onClosed: on('mini:closed'),
    onReturn: on('mini:return')
  },
  youtubeResolveLive: (url) => ipcRenderer.invoke('youtube:resolve-live', url),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
