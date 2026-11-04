const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('prism', {
  info: () => ipcRenderer.invoke('app:info'),
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
  twitchFollowing: () => ipcRenderer.invoke('twitch:following'),
  youtubeResolveLive: (url) => ipcRenderer.invoke('youtube:resolve-live', url),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
