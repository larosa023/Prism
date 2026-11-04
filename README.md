# Prism

A lightweight, ad-light stream client for Windows. Twitch comes first, with YouTube, TikTok, and (optionally) Kick alongside.

## Features

- **Multi-view**: watch several streams at once in a Grid or Focus layout (one big, the rest stacked). Mute, focus, reload, or remove each one from its hover bar. *One stream with sound* keeps audio from piling up.
- **Lean Twitch chat**: a native chat that uses one connection for every channel, keeps a capped history, and shows Twitch, 7TV, BTTV and FFZ emotes. It's much lighter than loading twitch.tv's chat page per stream. If you're signed in, you can chat from it.
- **Following**: see which Twitch channels you follow are live and add them with one click.
- **Built-in ad blocking**: uBlock Origin's filter lists (Ads, Badware, Privacy, Quick fixes, Unbreak) plus EasyList and EasyPrivacy. You can turn lists on or off, allow specific sites, and add your own rules in uBO syntax.
- **Twitch ad skipping (experimental)**: removes the ads Twitch stitches into the video. During an ad break you may see a short pause instead.
- **Stays signed in**: each platform has its own saved session. You sign in on that platform's tab, and you can sign out from Settings.
- **Platform tabs**: full Twitch, YouTube, TikTok and Kick sites. Use **+ Multi-view** on any channel or video page. Idle tabs unload after 2 minutes to free memory, unless they're playing sound.
- **Kick toggle**: Kick stays hidden until you turn on *Settings → Platforms → Show Kick*.
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
