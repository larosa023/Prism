// What's new in each version, newest first. Shown in the "What's new" window.
window.PRISM_CHANGELOG = [
  {
    version: '0.17.6',
    date: 'Nov 21, 2026',
    items: [
      'Another go at "Sign in with Google" on Kick: on Google\'s sign-in pages Prism now presents itself as regular Google Chrome (it runs on Chrome\'s engine), filling in the few things Chrome has that apps built like Prism leave out, instead of pretending to be Firefox.',
      'If Google still refuses sign-in, Prism now says what else works: signing in to that site with email and password ("Forgot password" sets one for an account made with Google).'
    ]
  },
  {
    version: '0.17.5',
    date: 'Nov 21, 2026',
    items: [
      'Fixed "Sign in with Google" on Kick (and made Google sign-in on YouTube sturdier): Google said "This browser or app may not be secure". On Google\'s sign-in pages Prism now looks like a regular Firefox browser all the way through, including the extra files and security check the page loads, instead of a mix of Firefox and Chrome that Google refused.'
    ]
  },
  {
    version: '0.17.4',
    date: 'Nov 20, 2026',
    items: [
      'Fixed streams showing "Reconnecting…", stuttering and coming back blurry since 0.17.3. The early "prefetch" video that 0.17.3 used doesn\'t work reliably outside Twitch\'s own player, so it\'s gone. Streams still play much closer to live than before 0.17.3 (about 6 seconds of cushion instead of ~18).',
      'Catching up to live no longer jumps ahead into video that hasn\'t downloaded yet (which caused short stops). It only skips through video that\'s already there.',
      'After a reconnect, the stream starts at the quality you picked instead of a blurry low one.'
    ]
  },
  {
    version: '0.17.3',
    date: 'Nov 20, 2026',
    items: [
      'Twitch streams play much closer to live, about where twitch.tv is (they could run 20–30 seconds behind). Prism now picks up Twitch\'s early "prefetch" video like Twitch\'s own player does, and keeps about 5 seconds of cushion instead of ~18.',
      'If a stream falls behind (after a stall or a slow network moment), it speeds up very slightly to catch up, and jumps back to live if it\'s more than a few seconds behind for 8 seconds. Streams you rewound on purpose are left alone.',
      'After an ad break, the stream also jumps back to live (the ad-free backup can run a little behind).',
      'New setting "Low latency" (on by default). If streams pause to load a lot on a slow connection, turn it off for a bigger cushion.'
    ]
  },
  {
    version: '0.17.2',
    date: 'Nov 20, 2026',
    items: [
      'Fixed streams set to 1080p dropping to a lower picture (while the menu still said 1080p) until you switched to Source and back. During an ad break Prism plays Twitch\'s ad-free backup stream, which is usually 480p at most. Now the stream reloads at your quality as soon as the ad break ends.',
      'If a stream\'s picture ever stays well below the quality you picked for 15 seconds, Prism reloads it at that quality by itself.'
    ]
  },
  {
    version: '0.17.1',
    date: 'Nov 20, 2026',
    items: [
      'Fixed TikTok messages: names and profile pictures were missing and conversations wouldn\'t open, because the privacy filter lists were blocking some of TikTok\'s own servers (including the one that keeps you signed in). TikTok\'s own servers are no longer blocked; ads in the TikTok feed and other companies\' trackers still are.'
    ]
  },
  {
    version: '0.17.0',
    date: 'Nov 20, 2026',
    items: [
      'Predictions in chat: when a streamer starts a prediction it shows at the top of their chat with each side\'s percent, points, people, payout ratio and top predictor, plus a countdown. Pick an amount (10, 100, 1K, 5K, All or your own) and press Predict. You can add more later, and you\'ll see what you won or lost.',
      'Polls in chat: vote with one click and watch the results fill in.',
      'Prediction and poll cards fold to one line (click the header) and fold by themselves once you\'ve predicted or voted.',
      'Mod tools: in channels you moderate, each message has delete, 10-minute time out and ban buttons, like on Twitch. Time outs and bans can be undone from the message that pops up. The name card has 1m, 10m, 1h, 1d and 1w time outs, Ban, Unban, and a delete button on each of their messages. (Settings → Chat to turn the buttons off.)',
      'NoPixel map trails: see where a streamer has been in the last hour. Hover anyone on the map or in the list to see their trail, or turn on "Trails" to see everyone\'s. The watch card lists their last few areas too.',
      'NoPixel "together" alerts: get a notification when two or more NoPixel streamers you follow are live in the same area. Click it to jump to them on the map. (Settings → NoPixel to turn it off.)'
    ]
  },
  {
    version: '0.16.2',
    date: 'Nov 17, 2026',
    items: [
      'Streams now open at their highest quality (Source) instead of "Auto (fit tile)". To save your graphics card on small tiles, set "Stream quality when opened" to "Fit tile" in Settings. You can still pick a quality on each stream, and Prism remembers it.'
    ]
  },
  {
    version: '0.16.1',
    date: 'Nov 16, 2026',
    items: [
      'The Twitch-style chat now uses your theme\'s colors (Midnight, OLED, Slate, Forest, Sunset, Rose or Light) for its background, text, message box and Chat button, instead of Twitch\'s fixed grey.'
    ]
  },
  {
    version: '0.16.0',
    date: 'Nov 16, 2026',
    items: [
      'Twitch chat now looks like Twitch\'s own chat: the real badge pictures (sub badges with months, mod, VIP, bits, event badges and more), Twitch\'s Inter font, spacing, colors and emote sizes, in dark and light themes.',
      'Name colors are adjusted the way Twitch does it, so dark names (black, navy) are readable, and people without a color get one of Twitch\'s defaults.',
      'Subs, gift subs and raids show with Twitch\'s colored edge, announcements in their colored box, "Highlight my message" in purple, and cheers with the cheer picture and the bits amount.',
      'Replies show "Replying to @name" like on Twitch, @mentions are bold, deleted messages read "<message deleted>", and names in other alphabets show the login after them.',
      'The message box looks like Twitch\'s, with a purple Chat button and your channel points under it.',
      'Prefer the old compact chat? Settings → Chat → Chat look → Prism.'
    ]
  },
  {
    version: '0.15.0',
    date: 'Nov 16, 2026',
    items: [
      'Streams start muted: when Prism opens and when you add a stream, nothing plays sound until you click a stream\'s speaker. (Turn this off with "Streams start muted" in Settings.)',
      'TikTok starts muted, with a new speaker button at the top of the TikTok tab to turn sound on. Every Browse tab (Twitch, YouTube, Kick) has the same button to mute that tab.',
      'Lighter chat: chats you aren\'t looking at are no longer drawn in the background. Their newest messages wait and appear the moment you switch to them, so several streams with busy chats use much less CPU and memory.',
      'Chat pauses while your mouse is over it, so you can read and click names without the chat running away ("Chat paused · 12 new"). It catches up as soon as you move the mouse away.',
      'Chat bots (Nightbot, StreamElements, Streamlabs, Moobot, Fossabot and others) are hidden by default.',
      'New in Settings → Chat: the time on each message, words to highlight (your character, your crew), words to hide, and people to hide. "Hide in chat" on someone\'s name card hides them in one click.',
      'Someone\'s first message in a chat is marked with a green edge.',
      'Even out volume (in Settings): loud and quiet Twitch streams sound about the same level.',
      'NoPixel map: zoom in a bit and streamers\' character names appear under their pictures.'
    ]
  },
  {
    version: '0.14.1',
    date: 'Nov 12, 2026',
    items: [
      'Chat keeps up again: it stays on the newest message unless you scroll up yourself. Emotes loading, old lines being removed or the pinned message appearing no longer make it think you scrolled away and get stuck.',
      'While you\'re scrolled up reading, what you\'re looking at stays put as new messages come in. "New messages below" takes you back down.'
    ]
  },
  {
    version: '0.14.0',
    date: 'Nov 11, 2026',
    items: [
      'NoPixel map has a new light "Atlas" look, styled like the game\'s own map: shallow water that lightens toward the coast, grassland, forest on the hills (darker on the high ground), desert sand around Sandy Shores, beaches, the golf course, lakes and rivers, built-up towns in white, and hill shading over all of it.',
      'Roads are drawn in blue-grey like the game\'s map (freeways thickest), the railway in purple, and labels in dark text that\'s easy to read on the light map.',
      'Prefer the old look? "Dark map" on the map switches back (and "Light map" returns). Prism remembers which you picked.'
    ]
  },
  {
    version: '0.13.0',
    date: 'Nov 11, 2026',
    items: [
      'NoPixel map: streamers show as their Twitch pictures on the map (up to three stacked when they\'re in the same spot, with a count), ringed in their group\'s color.',
      'A live list beside the map: everyone live with a preview, character and street, busiest first. Hover a row to light them up on the map, or a picture to find them in the list.',
      'Click a streamer (on the map or in the list) to open a small live player right there, muted to start: turn the sound on, add them to multi-view, or see who else is in the same spot.',
      'Groups: streamers are sorted into Police, EMS & doctors, Lawyers & city, Mechanics, Business & jobs, crews named in two or more titles, and your own groups. Click a group above the map to show only them.'
    ]
  },
  {
    version: '0.12.0',
    date: 'Nov 10, 2026',
    items: [
      'NoPixel map, much more detail: city blocks between the streets, parks, farm fields, docks, quarries and the airport grounds, rivers and the Vespucci canals, ATMs, bus stops and oil fields up close, and street names placed about twice as often.',
      'Smoother map: while you drag or zoom, the map moves instantly and redraws sharply the moment you stop. Only the part of the map on screen is drawn in full detail, and hovering no longer does heavy work on every mouse move.',
      'Less memory in long sessions: chat keeps a much smaller copy of each message for the "click a name" history (about a third of the size), with a limit per channel, so busy chats no longer pile up memory over hours.',
      'The video player library now loads when the first stream starts, not when Prism opens.'
    ]
  },
  {
    version: '0.11.0',
    date: 'Nov 10, 2026',
    items: [
      'Quick search: press Ctrl + K anywhere to jump to a page, give a stream the sound, open past broadcasts, or add any live follow or live NoPixel streamer (with their area) to multi-view. Type a channel name to add it.',
      'NoPixel map: a Find box (find a streamer, street, place or area and the map glides there), height lines on the hills, land colored by what it is (desert, forest, farmland, beach, city), and street and place names showing earlier as you zoom in.',
      'Smoother NoPixel tab: when an area is read, only that streamer\'s card updates instead of the whole list being rebuilt, which removes most of the stutter while areas load.',
      'Lighter pages: cards, chat messages and lists that are off screen aren\'t drawn until you scroll to them.'
    ]
  },
  {
    version: '0.10.3',
    date: 'Nov 10, 2026',
    items: [
      'NoPixel map, zoomed out: every road and dirt track shows (thin), area names fill in as space allows, places show as small colored dots (hover for the name), and the area borders are clearer.',
      'No more flash when you click a dot or an area on the map.',
      'Removed the stray roads in the bottom corner of the map (they belonged to North Yankton).'
    ]
  },
  {
    version: '0.10.2',
    date: 'Nov 10, 2026',
    items: [
      'The NoPixel map is much more detailed: hills and mountains, street names along the roads, railways, and over 140 places (police stations, hospitals, banks, 24/7s, gas stations, Ammu-Nation, clothing, barbers, tattoo shops, mechanics, bars and more), all from GTA V\'s game data. Turn kinds of places on or off with Places ▾.',
      'More shows the closer you zoom: small roads, dirt tracks, place names and street names. Up close, roads are drawn at their real width. Hover anything to see its name, or click an area to see who\'s there.',
      'Streamers are placed on their street, not just their area: the street is read from their HUD too. Dots with a dashed edge are ones where only the area could be read.',
      'Much faster: the map is drawn once and reused, and moving or zooming redraws only what changed, so it stays smooth.'
    ]
  },
  {
    version: '0.10.1',
    date: 'Nov 10, 2026',
    items: [
      'The NoPixel map is now built from GTA V\'s own game data: the real coastline, the Alamo Sea, every road (freeways highlighted), and the outline of every area as the game defines it. Streamer dots sit in the right spot for each area.',
      'Area names appear as you zoom in (the big ones always show), dots and text stay the same size at any zoom, and the area you pick is outlined.',
      'Zoom buttons, plus quick jumps to Los Santos, Blaine County and Paleto. Double-click to zoom in.',
      'A few more areas are recognized from the HUD: Bolingbroke Penitentiary, Braddock Tunnel, Baytree Canyon, Galileo Park and Galileo Observatory.'
    ]
  },
  {
    version: '0.10.0',
    date: 'Nov 10, 2026',
    items: [
      'Raids: when a streamer in multi-view raids someone, their tile shows it during the countdown, then switches to the raided channel in the same spot (with Undo). Choose Follow, Ask me or Do nothing in Settings → Performance.',
      'Pinned messages and Hype Trains show at the top of chat: the train\'s level, progress and time left, and the pinned message (click to read all of it, ✕ to hide it).',
      'Past broadcasts & clips: ⋯ → Past broadcasts & clips on any Twitch stream (or the button on an offline stream) lists their broadcasts, highlights and clips. They play in multi-view in the lightweight player, ads skipped, with a seek bar, Space to pause and ← → to skip. Broadcasts pick up where you left off. You can also paste a twitch.tv/videos or clip link into the Add box.',
      'Theater mode: the Theater button (or T) goes full screen with only the streams. Move the mouse to the top for the exit button, or press T or Esc.',
      'NoPixel map: a new Map view in the NoPixel tab shows a dot for each area with streamers in it, sized by how many are there, updating live. Click a dot to see who\'s there and Watch all. Scroll to zoom and drag to move. (A drawn sketch of the map, so positions are approximate.)'
    ]
  },
  {
    version: '0.9.1',
    date: 'Nov 9, 2026',
    items: [
      'Frozen streams fix themselves: each stream in multi-view is watched, and if its picture stops moving it\'s nudged back to live after 6 seconds, reset after 12, and reloaded after 20. Requests to Twitch that never answer now time out instead of leaving a stream stuck.',
      'Offline is obvious: an offline stream shows a big OFFLINE card with the streamer\'s name (instead of a black or frozen picture), its name is greyed out in the tile, chat tabs and Mixer, and you get a notice when someone goes offline and when they\'re live again. Prism checks every 30 seconds and starts the stream by itself when they come back.',
      'Update checks: when GitHub doesn\'t respond, Prism says so in one line and tries again by itself after 1, 3, 10 and 30 minutes.'
    ]
  },
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
