// What's new in each version, newest first. Shown in the "What's new" window.
window.PRISM_CHANGELOG = [
  {
    version: '0.9.0',
    date: 'Nov 9, 2026',
    items: [
      'YouTube ad blocking: ads are removed from videos before they load, ad boxes are hidden around the site, and any ad that still starts plays muted and is skipped right away. Also closes YouTube\'s "Ad blockers are not allowed" box. Works in multi-view YouTube tiles too. Settings → Ad blocking → YouTube ads.',
      'YouTube is faster: the ad blocker no longer watches every change on the page (on YouTube that ran constantly and piled up work the longer you browsed). YouTube is handled by Prism\'s own lighter ad blocker instead.',
      'Less work while a video plays: ambient mode\'s glow is off, and PCs whose graphics card can\'t play AV1 video get VP9 instead, so video isn\'t decoded on the CPU. Both are in Settings → Site tweaks, plus an "H.264 only" option for older PCs.',
      'While you\'re in another tab, muted multi-view streams stop downloading and playing, so they don\'t slow YouTube (or anything else) down. The stream you\'re listening to keeps playing, and the rest pick up at live when you go back.',
      'Video downloads no longer pass through Prism on their way in; only the few requests that need it do.'
    ]
  },
  {
    version: '0.8.5',
    date: 'Nov 5, 2026',
    items: ['Chat replies show who they\'re answering and what that person said ("↳ Replying to @name: …"). Click it to jump to the original message, or see that person\'s messages if it has scrolled away. Replies to you are highlighted like mentions.']
  },
  {
    version: '0.8.4',
    date: 'Nov 5, 2026',
    items: [
      'NoPixel tab now checks every live GTA V stream on Twitch (over 2,000 at a time), not just the first 100, so it finds everyone streaming NoPixel. It also looks at NoPixel tags, and the count at the top shows how many streams were checked.',
      'People whose title names another server (Prodigy, ONX and others) are left out, even if they were on NoPixel before.',
      'Areas load again in the installed app. A missing part of the text reader stopped them from ever showing up.',
      'Areas are read faster (the next preview downloads while one is being read), also pick up house addresses, and the Areas view shows progress ("12 of 49 checked") or what went wrong.',
      'Character names are guessed better: crew tags and server names in titles are skipped.'
    ]
  },
  {
    version: '0.8.3',
    date: 'Nov 5, 2026',
    items: [
      'Much faster start: the window opens in well under a second (it used to take around 6), and the app no longer freezes for a few seconds while it starts.',
      'Less memory: about 150 MB less right after launch. Ad blocking is prepared once and saved, instead of being rebuilt from the filter lists every time Prism opens.',
      'Muted streams keep 15 seconds of rewind; the stream you\'re listening to (or the priority one) keeps the full amount. That saves around 40 MB or more per muted stream.',
      'Streams start one after another, with the one you\'re listening to first, so it shows up sooner.',
      'The area-reading engine for the NoPixel tab shuts down when it\'s not needed, freeing about 50 MB.'
    ]
  },
  {
    version: '0.8.2',
    date: 'Nov 5, 2026',
    items: ['Volume sliders (in the Mixer and on each stream) now move smoothly, in fine 1% steps, with a filled track that shows the level.']
  },
  {
    version: '0.8.1',
    date: 'Nov 5, 2026',
    items: [
      'Channel-point bonuses are claimed automatically in the background, every minute, for the Twitch streams in multi-view. If Twitch refuses Prism\'s claim, it clicks "Claim Bonus" on Twitch\'s own chat page instead, so it keeps working.',
      'The points pill next to the chat box flashes +50 when a bonus is claimed, and its tooltip shows how much was claimed this session.'
    ]
  },
  {
    version: '0.8.0',
    date: 'Nov 4, 2026',
    items: [
      'Rewind: jump back on any stream with ⟲ (or ← and →, Shift for 30 seconds). A "Go live" button appears while you\'re behind; press L to jump back. Set how much to keep in Settings → Rewind & clips.',
      'Clips: ✂ on a Twitch stream (or K) saves the last minute as a video in Videos → Prism Clips.',
      'Scenes: when several NoPixel streamers are in the same area, the NoPixel tab shows the scene with Watch scene, and multi-view tiles show who else is there with a button to add them.',
      'Mixer: sliders for every stream, Solo, and Mute all. Choose whether the other streams are muted or quiet in the background when one has the sound.'
    ]
  },
  {
    version: '0.7.1',
    date: 'Nov 4, 2026',
    items: [
      'Ctrl + click a stream in multi-view to make it the priority: it goes big, gets the sound, and its chat opens. Ctrl + click it again to go back to the grid.',
      'This "What\'s new" window: it opens once after each update, and any time from the ✨ button at the top or Settings → Updates.'
    ]
  },
  {
    version: '0.7.0',
    date: 'Nov 4, 2026',
    items: [
      'NoPixel tab finds far more streamers: anyone seen on NoPixel before, your follows playing GTA V, and people you add with "+ Add streamer". Take anyone off with ⋯ → Not on NoPixel.',
      'Locations: each NoPixel streamer shows their area (read from the street name on their HUD every few minutes), and the Areas view groups everyone by part of the map.',
      'Groups: make your own groups from a streamer\'s ⋯ menu, see who\'s online, and Watch all.',
      'Signing in to YouTube with Google works inside Prism.',
      'Bell button at the top turns go-live notifications on or off.',
      'Drag the tabs on the left into any order.'
    ]
  },
  {
    version: '0.6.1',
    date: 'Nov 4, 2026',
    items: [
      'NoPixel tab: NoPixel only, searches every GTA V stream (down to 0 viewers), and lists offline streamers with their last character.'
    ]
  },
  {
    version: '0.6.0',
    date: 'Nov 4, 2026',
    items: ['New tab of who\'s live on NoPixel, with previews, viewers, uptime and the character each streamer is playing.']
  },
  {
    version: '0.5.4',
    date: 'Nov 4, 2026',
    items: ['Following works even when Twitch refuses Prism\'s own requests (it reads your Following page instead).']
  },
  {
    version: '0.5.3',
    date: 'Nov 4, 2026',
    items: ['Grab a stream anywhere on its video (or the ⠿ handle) and drop it on another tile to swap them.']
  },
  {
    version: '0.5.2',
    date: 'Nov 4, 2026',
    items: ['Themes: Midnight, OLED black, Slate, Forest, Sunset, Rose and Light.', 'New gear icon for Settings.']
  },
  {
    version: '0.5.0',
    date: 'Nov 4, 2026',
    items: [
      'Pop-out mini player: an always-on-top window for one stream (⋯ → Pop out, or P).',
      'Channel points balance next to the chat box, with bonus auto-claim when Twitch allows it.',
      'Kick streams use the lightweight player too.'
    ]
  },
  {
    version: '0.4.0',
    date: 'Nov 4, 2026',
    items: [
      'Go-live alerts, plus an auto-add list for channels that should join multi-view on their own.',
      'Hover a stream for its title, game, viewers and uptime.',
      'Chats open with recent messages.',
      'Saved layouts, drag to rearrange, and hotkeys (1–9, M, F, G, C, R).',
      'Tab completion for emotes and @names, an emote picker, and a chime when you\'re mentioned.'
    ]
  },
  {
    version: '0.3.4',
    date: 'Nov 4, 2026',
    items: ['Click a name in chat to see everything that person has said.']
  },
  {
    version: '0.3.2',
    date: 'Nov 4, 2026',
    items: ['Drag the sidebar and chat edges to resize them; a wide sidebar shows your live follows.', 'Chat tabs no longer cut off names, and each chat can be turned off.']
  },
  {
    version: '0.3.0',
    date: 'Nov 4, 2026',
    items: ['New lightweight Twitch player: far less memory with several streams open, and it skips ads.', 'Suggestions as you type a channel name.']
  },
  {
    version: '0.2.0',
    date: 'Nov 4, 2026',
    items: ['TwitchAdSolutions ad skipping built in.', 'Twitch sidebar hover previews and a YouTube videos-per-row setting.']
  },
  {
    version: '0.1.0',
    date: 'Nov 4, 2026',
    items: ['First release: multi-view, lean Twitch chat, built-in ad blocking, sign-in for each site, and the auto-updater.']
  }
];
