# Prism

A lightweight, ad-light stream client for Windows. Twitch comes first, with YouTube, TikTok, and (optionally) Kick alongside.

## Features

- **Lightweight Twitch player**: Twitch streams play in Prism's own video player (hls.js) instead of a separate player.twitch.tv page per stream, so several streams use a fraction of the memory. Quality fits the tile size automatically (or pick one per stream), only a few seconds of video are buffered, and ad breaks switch to Twitch's ad-free backup stream. If a stream won't play, that tile falls back to Twitch's own player. *Settings → Performance → Twitch player* switches back to Twitch's player for all streams.
- **Multi-view**: watch several streams at once in a Grid or Focus layout (one big, the rest stacked). Mute, focus, reload, or remove each one from its hover bar. *One stream with sound* keeps audio from piling up.
- **Lean Twitch chat**: a native chat that uses one connection for every channel, keeps a capped history, and shows Twitch, 7TV, BTTV and FFZ emotes. It's much lighter than loading twitch.tv's chat page per stream. If you're signed in, you can chat from it.
- **Following**: see which Twitch channels you follow are live (in the sidebar and the Following panel) and add them with one click.
- **RP servers tab**: everyone live on NoPixel right now (or ONX, Prodigy, Eclipse, or your own words), with thumbnails, viewers, uptime and the character they're playing. Search, sort, filter to people you follow, and click a stream to add it to multi-view.
- **Go-live alerts**: a Windows notification when someone you follow goes live; click it to watch. Channels on your auto-add list join multi-view by themselves.
- **Stream info on tiles**: hover a Twitch tile for its title, game, viewers and uptime.
- **Saved layouts**: save a set of streams and its layout under a name and reopen it in one click.
- **Drag to rearrange**: grab a stream (anywhere on the video, or its ⠿ handle) and drop it on another tile to swap them (onto the big one in Focus to make it the main stream).
- **Pop-out mini player**: pop any stream into a small always-on-top window (⋯ menu or `P`); drag it anywhere, close it to put it back.
- **Channel points**: your balance next to the chat box, with bonus auto-claim when Twitch allows it. Twitch only counts points and watch time in its own player, so switch a stream to "Twitch's player" from its ⋯ menu to earn them.
- **Lightweight Kick player**: Kick streams use the same light player as Twitch (when Kick is on).
- **Hotkeys**: `1`–`9` sound for that stream, `M` mute, `F` focus, `G` grid/focus, `C` chat, `R` reload, `P` pop out.
- **Chat extras**: recent messages when a chat opens, click a name to see everything they said, Tab completion for emotes and @names, an emote picker, and a chime when you're @mentioned.
- **Built-in ad blocking**: uBlock Origin's filter lists (Ads, Badware, Privacy, Quick fixes, Unbreak) plus EasyList and EasyPrivacy. You can turn lists on or off, allow specific sites, and add your own rules in uBO syntax.
- **Twitch ads**: by default Prism runs pixeltris's [TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions) `video-swap-new` script on every Twitch page and player. It's the same script uBlock Origin loads with `userResourcesLocation` + `twitch.tv##+js(twitch-videoad)`. You can point it at another script (such as `vaft`), switch to Prism's simple built-in method, or turn it off.
- **Twitch sidebar previews**: hover a live channel in Twitch's left sidebar to see a live video or thumbnail preview.
- **YouTube videos per row**: a built-in YouTube Row Fixer for the home and subscriptions pages.
- **Stays signed in**: each platform has its own saved session. You sign in on that platform's tab, and you can sign out from Settings.
- **Platform tabs**: full Twitch, YouTube, TikTok and Kick sites. Use **+ Multi-view** on any channel or video page. Idle tabs unload after 2 minutes to free memory, unless they're playing sound.
- **Kick toggle**: Kick stays hidden until you turn on *Settings → Platforms → Show Kick*.
- **Themes**: Midnight, OLED black, Slate, Forest, Sunset, Rose and Light (*Settings → Theme*). Chat name colors adjust so they stay readable.
- **Built-in updater**: checks GitHub Releases, downloads in the background, and installs on restart.

## Adding streams

Type into the bar at the top (or press `Ctrl+L`):

| You type | Opens |
|---|---|
| `xqc` or `twitch.tv/xqc` | Twitch channel |
| `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/live/…` | YouTube video or live stream |
| `youtube.com/@handle` or `@handle` | That channel's current live stream |
| `kick.com/name` or `kick:name` | Kick channel (when Kick is on) |

## Develop

```bash
npm install
npm start
```

## Release a new version

1. Bump `version` in `package.json` (for example `0.1.1`) and commit.
2. Tag and push: `git tag v0.1.1 && git push origin main --tags`.
3. GitHub Actions builds `Prism-Setup-0.1.1.exe` and publishes the release. Installed copies update themselves.

To build locally without publishing, run `npm run dist`; the installer lands in `dist/`.
