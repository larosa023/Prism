// Turns whatever you type or paste into { platform, id }.
// Plain names are Twitch channels, since Twitch is the main platform.
(function () {
  const TWITCH_RESERVED = new Set([
    'directory', 'following', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet',
    'drops', 'search', 'downloads', 'jobs', 'turbo', 'p', 'u', 'login', 'signup', 'friends', 'messages'
  ]);
  const KICK_RESERVED = new Set(['categories', 'following', 'browse', 'search', 'dashboard', 'popout', 'video', 'clips', 'settings']);

  function parseStream(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;

    // Prefixes: tw:name, yt:id, kick:name
    const pre = s.match(/^(tw|twitch|yt|youtube|kick|k):\s*(.+)$/i);
    if (pre) {
      const p = pre[1].toLowerCase();
      const v = pre[2].trim();
      if (p.startsWith('t')) return twitch(v);
      if (p.startsWith('y')) return /^[\w-]{11}$/.test(v) ? { platform: 'youtube', id: v } : parseStream('https://www.youtube.com/@' + v.replace(/^@/, ''));
      return kick(v);
    }

    if (!/^https?:\/\//i.test(s) && /^[\w.-]+\.(tv|com|be)\//i.test(s)) s = 'https://' + s;

    let url;
    try { url = new URL(s); } catch { url = null; }

    if (url) {
      const host = url.hostname.replace(/^(www|m|go|player|clips)\./, '');
      const parts = url.pathname.split('/').filter(Boolean);

      // Past broadcasts and clips
      if (url.hostname.replace(/^www\./, '') === 'clips.twitch.tv' && parts[0] && parts[0] !== 'embed') return { platform: 'vod', type: 'clip', id: parts[0] };
      if (host === 'twitch.tv' && parts[0] === 'videos' && /^\d+$/.test(parts[1] || '')) return { platform: 'vod', type: 'vod', id: parts[1] };
      if (host === 'twitch.tv' && parts[1] === 'clip' && parts[2]) return { platform: 'vod', type: 'clip', id: parts[2], channel: parts[0].toLowerCase() };
      if (host === 'twitch.tv' && parts[1] === 'video' && /^\d+$/.test(parts[2] || '')) return { platform: 'vod', type: 'vod', id: parts[2], channel: parts[0].toLowerCase() };
      if (host === 'twitch.tv') {
        const ch = url.searchParams.get('channel') || (parts[0] === 'popout' ? parts[1] : parts[0]);
        return ch && !TWITCH_RESERVED.has(ch.toLowerCase()) ? twitch(ch) : null;
      }
      if (host === 'youtu.be' && parts[0]) return yt(parts[0]);
      if (host === 'youtube.com') {
        if (url.searchParams.get('v')) return yt(url.searchParams.get('v'));
        if (['live', 'embed', 'shorts'].includes(parts[0]) && parts[1]) return yt(parts[1]);
        if (parts[0] && (parts[0].startsWith('@') || ['channel', 'c', 'user'].includes(parts[0]))) {
          return { platform: 'youtube', resolve: 'https://www.youtube.com/' + parts.slice(0, parts[0].startsWith('@') ? 1 : 2).join('/') };
        }
        return null;
      }
      if (host === 'kick.com') {
        const slug = parts[0] === 'popout' ? parts[1] : parts[0];
        return slug && !KICK_RESERVED.has(slug.toLowerCase()) ? kick(slug) : null;
      }
      return null;
    }

    if (/^@[\w.-]+$/.test(s)) return parseStream('https://www.youtube.com/' + s);
    if (/^\w{2,25}$/.test(s)) return twitch(s);
    return null;
  }

  function twitch(v) {
    const id = String(v).toLowerCase().replace(/^#/, '');
    return /^\w{2,25}$/.test(id) ? { platform: 'twitch', id } : null;
  }
  function yt(v) {
    return /^[\w-]{11}$/.test(v) ? { platform: 'youtube', id: v } : null;
  }
  function kick(v) {
    const id = String(v).toLowerCase();
    return /^[\w-]{1,40}$/.test(id) ? { platform: 'kick', id } : null;
  }

  if (typeof window !== 'undefined') window.parseStream = parseStream;
  if (typeof module !== 'undefined') module.exports = { parseStream };
})();
