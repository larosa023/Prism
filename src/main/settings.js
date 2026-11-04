// Tiny JSON settings store kept in the user's AppData folder.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Platforms
  showKick: false,          // Kick is hidden until turned on in Settings

  // Ad blocking (uBlock Origin filter lists)
  adblockEnabled: true,
  twitchAdMethod: 'tas',    // 'tas' = TwitchAdSolutions script, 'builtin' = Prism's own, 'off'
  twitchAdScriptUrl: 'https://raw.githubusercontent.com/pixeltris/TwitchAdSolutions/master/video-swap-new/video-swap-new-ublock-origin.js',
  filterLists: {
    'ubo-filters': true,
    'ubo-badware': true,
    'ubo-privacy': true,
    'ubo-quick-fixes': true,
    'ubo-unbreak': true,
    easylist: true,
    easyprivacy: true,
    'peter-lowe': false
  },
  customFilters: '',        // user's own filter rules, one per line (uBO syntax)
  allowlist: [],            // sites where ad blocking is turned off

  // Site tweaks (built-in versions of popular extensions)
  twitchPreviews: 'video',  // hover previews in Twitch's sidebar: 'video' | 'image' | 'off'
  youtubeRowCount: 5,       // videos per row on YouTube (0 = YouTube's default)

  // Performance
  twitchPlayer: 'native',   // 'native' = Prism's lightweight player, 'embed' = Twitch's own player
  unloadInactiveTabs: true, // free RAM from browse tabs you're not looking at
  singleAudio: true,        // only one multi-view stream plays sound at a time
  chatMaxLines: 250,
  chatFontSize: 13,
  thirdPartyEmotes: true,   // 7TV + BTTV emotes in Twitch chat

  // Updates
  autoUpdate: true,

  // Saved multi-view
  streams: [],              // [{ platform, id, label }]
  layout: 'grid',           // 'grid' | 'focus'
  chatVisible: true,
  chatWidth: 340,           // px, drag the chat panel's edge
  sidebarWidth: 56,         // px, drag the sidebar's edge (wider shows names + live list)
  lastView: 'multiview',
  favicons: {}              // each site's own icon, picked up from its tab
};

let file;
let data = null;

function load() {
  file = path.join(app.getPath('userData'), 'settings.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { ...DEFAULTS, ...raw, filterLists: { ...DEFAULTS.filterLists, ...(raw.filterLists || {}) } };
    // 0.1.x had an on/off switch; carry "off" over.
    if (raw.twitchAdSkip === false && !raw.twitchAdMethod) data.twitchAdMethod = 'off';
    delete data.twitchAdSkip;
  } catch {
    data = structuredClone(DEFAULTS);
  }
  return data;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
      fs.renameSync(file + '.tmp', file);
    } catch (e) {
      console.error('settings save failed', e);
    }
  }, 150);
}

function get() {
  return data || load();
}

function set(patch) {
  get();
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS)) continue;
    data[k] = k === 'filterLists' ? { ...data.filterLists, ...v } : v;
  }
  save();
  return data;
}

module.exports = { get, set, load, DEFAULTS };
