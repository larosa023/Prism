// The NoPixel tab's map of Los Santos and Blaine County, drawn on a canvas.
// Everything on it comes from GTA V's own game data (see scripts/map): the
// coastline, hills, every road and street name, railways, the game's area
// boundaries, and places like police stations, hospitals and stores.
// Positions are game-world metres; "map space" is (x, -y) so north is up.
(function () {
  const key = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '');

  // Places Prism can read from a HUD that aren't zones of their own.
  const LANDMARKS = {
    'Diamond Casino': [925, 46], 'Vinewood Bowl': [686, 577], 'Del Perro Pier': [-1650, -1080], 'Puerto Del Sol': [-860, -1340],
    'Cypress Flats Port': [1000, -2500], 'Sandy Shores Airfield': [1730, 3290], 'McKenzie Field': [2120, 4805],
    'Thomson Scrapyard': [2400, 3100], 'Procopio Promenade': [1450, 6480], 'Mount Haan': [900, 1350], 'Rogers Salvage & Scrap': [-460, -1700],
    'Noose Headquarters': [2520, -380], 'Tataviam': [2500, -400]
  };
  const ALIASES = { noose: 'N.O.O.S.E', nooseheadquarters: 'N.O.O.S.E', bolingbroke: 'Bolingbroke Penitentiary' };

  // How each kind of place is drawn: a colored badge with a short glyph.
  const POI_STYLE = {
    police: ['#3b82f6', '★'], hospital: ['#ef4444', '+'], fire: ['#f97316', '▲'], bank: ['#22c55e', '$'], store: ['#eab308', '◆'],
    gas: ['#a3a3a3', '⛽'], gun: ['#dc2626', '✚'], clothes: ['#ec4899', '◼'], barber: ['#a78bfa', '✂'], tattoo: ['#8b5cf6', '✒'],
    mechanic: ['#f59e0b', '⚙'], cars: ['#06b6d4', '◉'], bar: ['#d946ef', '♪'], fun: ['#14b8a6', '●'], shop: ['#facc15', '◆'],
    gov: ['#64748b', '■'], home: ['#94a3b8', '⌂'], work: ['#78716c', '■']
  };
  const POI_NAMES = {
    police: 'Police', hospital: 'Hospitals', fire: 'Fire', bank: 'Banks', store: 'Stores', gas: 'Gas', gun: 'Ammu-Nation', clothes: 'Clothing',
    barber: 'Barbers', tattoo: 'Tattoos', mechanic: 'Mechanics', cars: 'Car dealer', bar: 'Bars & clubs', fun: 'Fun', shop: 'Shops', gov: 'Government',
    home: 'Motels', work: 'Work'
  };

  const REGION_FILL = { city: 'rgba(150,120,210,.10)', hills: 'rgba(110,170,120,.06)', blaine: 'rgba(210,175,100,.07)', north: 'rgba(90,170,180,.08)' };
  const regionOf = (name) => {
    const z = name.toLowerCase();
    if (/paleto|procopio/.test(z)) return 'north';
    if (/alamo|sandy|senora|harmony|grapeseed|stab|zancudo|redwood|raton|cassidy|josiah|chumash|braddock|galilee|humane|chiliad|calafia|gordo|bolingbroke|davis quartz|lago/.test(z)) return 'blaine';
    if (/hills|richman|golf|bluffs|banham|tongva|chaparral|land act|tataviam|palomino|wind|power|chianski|n\.o\.o\.s\.e|baytree|galileo/.test(z)) return 'hills';
    return 'city';
  };

  // ---- Data (loaded the first time the map opens) ----------------------------
  let data = null, loading = null, P = null, relief = null;
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'np-map-data.js';
      s.onload = () => {
        data = window.NP_MAP_DATA;
        delete window.NP_MAP_DATA;
        // Build the drawing paths once.
        P = {
          land: new Path2D(data.land),
          zones: data.zones.filter((z) => !z.water).map((z) => ({ z, path: new Path2D(z.path), fill: REGION_FILL[regionOf(z.name)] })),
          freeway: new Path2D(data.roads.freeway), major: new Path2D(data.roads.major),
          minor: new Path2D(data.roads.minor), dirt: new Path2D(data.roads.dirt), rails: new Path2D(data.rails)
        };
        relief = new Image();
        relief.src = 'np-map-shade.webp';
        relief.onload = () => view?.draw();
        resolve(data);
      };
      s.onerror = () => { loading = null; reject(new Error('map data missing')); };
      document.head.append(s);
    });
    return loading;
  }

  let zoneByKey = null;
  function zoneFor(area) {
    if (!data) return null;
    if (!zoneByKey) zoneByKey = new Map(data.zones.map((z) => [key(z.name), z]));
    const k = key(area);
    return zoneByKey.get(k) || zoneByKey.get(key(ALIASES[k] || '')) || null;
  }
  // Where an area (and, if known, street) is: [x, y] in world metres, or null.
  function place(area, street) {
    const z = zoneFor(area);
    if (street && data?.streetZone?.[street]) {
      const byZone = data.streetZone[street];
      const p = (z && byZone[z.name]) || null;
      if (p) return p;
    }
    if (z) return [z.x, z.y];
    const lm = Object.entries(LANDMARKS).find(([n]) => key(n) === key(area));
    return lm ? lm[1] : null;
  }

  // ---- The view ---------------------------------------------------------------
  let view = null; // one map, reused every time the tab redraws
  class MapView {
    constructor() {
      this.el = document.createElement('div');
      this.el.className = 'npm-map';
      this.canvas = document.createElement('canvas');
      this.dotsEl = document.createElement('div');
      this.dotsEl.className = 'npm-dots';
      this.tip = document.createElement('div');
      this.tip.className = 'npm-tip';
      this.tip.hidden = true;
      this.el.append(this.canvas, this.dotsEl, this.tip);
      this.cx = 200; this.cy = -1900; this.s = 0; // center (map space) and pixels per metre
      this.groups = []; this.selected = null; this.onSelect = () => {};
      this.hidden = new Set(); // place kinds turned off
      this.tools();
      this.events();
      new ResizeObserver(() => this.resize()).observe(this.el);
    }

    tools() {
      const bar = document.createElement('div');
      bar.className = 'npm-tools';
      const btn = (text, title, fn) => { const b = document.createElement('button'); b.className = 'npm-btn'; b.textContent = text; b.title = title; b.onclick = fn; bar.append(b); return b; };
      btn('+', 'Zoom in', () => this.zoomAt(this.w / 2, this.h / 2, 1.6));
      btn('−', 'Zoom out', () => this.zoomAt(this.w / 2, this.h / 2, 1 / 1.6));
      btn('Los Santos', 'Zoom to the city', () => this.fit(-2100, -3500, 1700, 700));
      btn('Blaine County', 'Sandy Shores, Grapeseed and around', () => this.fit(-500, 2300, 3700, 5300));
      btn('Paleto', 'Paleto Bay', () => this.fit(-1200, 5600, 1000, 7000));
      btn('Whole map', 'Show everything', () => this.fitAll());
      const placesBtn = btn('Places ▾', 'Choose which places show', () => { menu.hidden = !menu.hidden; });
      placesBtn.classList.add('npm-places-btn');
      const menu = document.createElement('div');
      menu.className = 'npm-places';
      menu.hidden = true;
      for (const [k, name] of Object.entries(POI_NAMES)) {
        const lab = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = true;
        cb.onchange = () => { cb.checked ? this.hidden.delete(k) : this.hidden.add(k); this.draw(); };
        const sw = document.createElement('span');
        sw.className = 'npm-sw'; sw.style.background = POI_STYLE[k][0]; sw.textContent = POI_STYLE[k][1];
        lab.append(cb, sw, ' ' + name);
        menu.append(lab);
      }
      bar.append(menu);
      this.el.append(bar);
      const hint = document.createElement('div');
      hint.className = 'npm-hint';
      hint.textContent = 'Scroll or double-click to zoom · drag to move · zoom in for streets and places';
      this.el.append(hint);
    }

    resize() {
      const r = this.el.getBoundingClientRect();
      if (!r.width || !r.height) return; // detached for a moment while the tab redraws
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
      this.w = r.width; this.h = r.height; this.dpr = dpr;
      // Setting a canvas's size wipes it, so only do that when the size really
      // changed, and redraw straight away (no blank frame = no flash).
      if (this.canvas.width !== cw || this.canvas.height !== ch) {
        this.canvas.width = cw; this.canvas.height = ch;
        this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
        if (!this.s) this.fit(-2400, -3700, 3900, 7300);
        cancelAnimationFrame(this.raf); this.raf = 0;
        this.paint();
      }
    }
    minScale() { return Math.min(this.w / 8800, this.h / 12400) * 0.9; }
    fit(x0, y0, x1, y1) {
      this.s = Math.min(this.w / (x1 - x0), this.h / (y1 - y0)) * 0.92;
      this.cx = (x0 + x1) / 2; this.cy = -(y0 + y1) / 2;
      this.draw();
    }
    fitAll() { this.fit(-3600, -3900, 4100, 7300); }
    toMap(px, py) { return [(px - this.w / 2) / this.s + this.cx, (py - this.h / 2) / this.s + this.cy]; }
    toScreen(mx, my) { return [(mx - this.cx) * this.s + this.w / 2, (my - this.cy) * this.s + this.h / 2]; }
    zoomAt(px, py, f) {
      const [mx, my] = this.toMap(px, py);
      this.s = Math.max(this.minScale(), Math.min(1.2, this.s * f));
      this.cx = mx - (px - this.w / 2) / this.s; this.cy = my - (py - this.h / 2) / this.s;
      this.draw();
    }

    events() {
      const c = this.el;
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0018, -e.deltaY));
      }, { passive: false });
      let drag = null;
      this.canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: false };
        this.canvas.setPointerCapture(e.pointerId);
      });
      this.canvas.addEventListener('pointermove', (e) => {
        if (drag) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
          if (drag.moved) { this.cx = drag.cx - dx / this.s; this.cy = drag.cy - dy / this.s; this.draw(); }
          this.tip.hidden = true;
          return;
        }
        this.hover(e);
      });
      this.canvas.addEventListener('pointerup', (e) => {
        if (drag && !drag.moved) {
          // A click on the map (not a dot): pick the area under it, or clear.
          const r = this.canvas.getBoundingClientRect();
          const z = this.zoneAt(e.clientX - r.left, e.clientY - r.top);
          const g = z && this.groups.find((a) => key(a.area) === key(z.name));
          this.onSelect(g ? g.area : null);
        }
        drag = null;
      });
      this.canvas.addEventListener('pointerleave', () => { this.tip.hidden = true; });
      this.canvas.addEventListener('dblclick', (e) => { const r = this.canvas.getBoundingClientRect(); this.zoomAt(e.clientX - r.left, e.clientY - r.top, 2); });
    }

    zoneAt(px, py) {
      if (!P) return null;
      const ctx = this.canvas.getContext('2d');
      const { s, dpr } = this;
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.w / 2 - this.cx * s), dpr * (this.h / 2 - this.cy * s));
      let hit = null;
      for (const z of P.zones) if (ctx.isPointInPath(z.path, px * dpr, py * dpr)) { if (!hit || z.z.area < hit.area) hit = z.z; }
      ctx.restore();
      return hit;
    }
    hover(e) {
      if (!data) return;
      const r = this.canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      let text = '';
      if (this.s >= 0.06) {
        const hit = this.s >= 0.33 ? 9 : 5;
        for (const p of data.pois) {
          if (this.hidden.has(p[0])) continue;
          const [sx, sy] = this.toScreen(p[2], -p[3]);
          if (Math.abs(sx - px) < hit && Math.abs(sy - py) < hit) { text = p[1]; break; }
        }
      }
      if (!text) { const z = this.zoneAt(px, py); if (z) text = z.name; }
      this.tip.hidden = !text;
      if (text) { this.tip.textContent = text; this.tip.style.transform = `translate(${px + 14}px, ${py + 12}px)`; }
    }

    setGroups(groups, selected, onSelect) {
      this.groups = groups; this.selected = selected; this.onSelect = onSelect;
      this.renderDots();
      this.draw();
    }
    // Streamer dots are HTML on top of the canvas (easy to click and hover).
    renderDots() {
      this.dotsEl.textContent = '';
      this.dots = [];
      for (const g of [...this.groups].sort((a, b) => a.people.length - b.people.length)) {
        const pos = place(g.area, g.street);
        if (!pos) continue;
        const n = g.people.length;
        const d = document.createElement('button');
        d.className = 'npm-dot' + (this.selected === g.area ? ' sel' : '') + (g.street ? '' : ' area');
        const size = Math.round(20 + 7 * Math.sqrt(n));
        d.style.width = d.style.height = size + 'px';
        d.style.marginLeft = d.style.marginTop = -size / 2 + 'px';
        d.textContent = n;
        d.title = `${g.street ? g.street + ', ' : ''}${g.area}\n${g.people.map((x) => x.name + (x.char ? ' (' + x.char + ')' : '')).join('\n')}`;
        d.onclick = (e) => { e.stopPropagation(); this.onSelect(g.area); };
        this.dotsEl.append(d);
        this.dots.push({ d, x: pos[0], y: -pos[1] });
      }
    }

    draw() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
    }
    paint() {
      if (!P || !this.w) return;
      const ctx = this.canvas.getContext('2d');
      const { s, dpr } = this;
      const px = 1 / s; // one screen pixel, in metres
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b1d2b';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.w / 2 - this.cx * s), dpr * (this.h / 2 - this.cy * s));
      // visible box (map space) for skipping work off screen
      const [vx0, vy0] = this.toMap(0, 0), [vx1, vy1] = this.toMap(this.w, this.h);
      const vis = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

      // Land with hills
      const [X0, Y0, X1, Y1] = data.bounds;
      if (relief?.complete && relief.naturalWidth) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(relief, X0, -Y1, X1 - X0, Y1 - Y0);
      } else { ctx.fillStyle = '#1e2a22'; ctx.fill(P.land); }
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(120,170,150,.45)'; ctx.lineWidth = 1.2 * px; ctx.stroke(P.land);

      // Areas
      const sel = this.selected && zoneFor(this.selected);
      for (const z of P.zones) { ctx.fillStyle = z.fill; ctx.fill(z.path); }
      ctx.strokeStyle = s < 0.2 ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.10)'; ctx.lineWidth = px;
      for (const z of P.zones) ctx.stroke(z.path);
      if (sel) {
        const zz = P.zones.find((z) => z.z === sel);
        if (zz) { ctx.fillStyle = 'rgba(145,70,255,.18)'; ctx.fill(zz.path); ctx.strokeStyle = '#9b6bff'; ctx.lineWidth = 2 * px; ctx.stroke(zz.path); }
      }

      // Roads: more of them as you zoom in. Up close they're drawn at their real
      // width, so the separate lanes of a freeway read as one road.
      const w = (minPx, metres) => Math.max(minPx * px, metres);
      const road = (path, color, width) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(path); };
      road(P.dirt, s >= 0.22 ? 'rgba(176,150,105,.5)' : 'rgba(176,150,105,.32)', w(s >= 0.6 ? 1.2 : s >= 0.22 ? 0.8 : 0.5, 4));
      // outlines first, then all the road surfaces on top, so joins are clean
      if (s >= 0.4) {
        if (s >= 0.14) road(P.minor, '#161b18', w(2.6, 11));
        road(P.major, '#161b18', w(3.4, 15));
      }
      road(P.freeway, 'rgba(60,40,10,.75)', w(s >= 0.5 ? 5.5 : 3.5, 30));
      const surface = s >= 0.4 ? '#a9b0ab' : null;
      road(P.minor, surface || (s >= 0.14 ? 'rgba(200,208,204,.55)' : 'rgba(200,208,204,.38)'), w(s >= 0.4 ? 1.2 : s >= 0.14 ? 0.8 : 0.55, 7.5));
      road(P.major, surface || 'rgba(236,236,232,.75)', w(s >= 0.3 ? 1.7 : 1, 11));
      {
        ctx.setLineDash(s >= 0.12 ? [5 * px, 4 * px] : [3 * px, 2 * px]);
        road(P.rails, 'rgba(200,170,140,.7)', 1.3 * px);
        ctx.setLineDash([]);
      }
      road(P.freeway, '#e0aa4a', w(s >= 0.5 ? 3.5 : 2, 22));

      // Text and icons in screen pixels from here on
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const taken = []; // label boxes already drawn, to avoid overlaps
      const free = (x0, y0, x1, y1) => {
        for (const b of taken) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false;
        taken.push([x0, y0, x1, y1]);
        return true;
      };
      for (const d of this.dots || []) { const [x, y] = this.toScreen(d.x, d.y); taken.push([x - 16, y - 16, x + 16, y + 16]); }

      // Places: small colored dots when zoomed out, badges closer in
      if (s < 0.33) {
        const r = s < 0.12 ? 2.2 : 3;
        for (const p of data.pois) {
          if (this.hidden.has(p[0]) || !vis(p[2], -p[3], 20)) continue;
          const [x, y] = this.toScreen(p[2], -p[3]);
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = (POI_STYLE[p[0]] || ['#888'])[0]; ctx.fill();
          ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
        }
      }
      if (s >= 0.33) {
        ctx.font = '11px "Segoe UI Symbol", "Segoe UI", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const p of data.pois) {
          if (this.hidden.has(p[0]) || !vis(p[2], -p[3], 50)) continue;
          const [x, y] = this.toScreen(p[2], -p[3]);
          const [color, glyph] = POI_STYLE[p[0]] || ['#888', '●'];
          ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.fillText(glyph, x, y + 0.5);
          taken.push([x - 9, y - 9, x + 9, y + 9]);
          if (s >= 0.9) {
            ctx.font = '600 10.5px "Segoe UI", sans-serif';
            const w = ctx.measureText(p[1]).width;
            if (free(x + 10, y - 7, x + 14 + w, y + 7)) {
              ctx.textAlign = 'left';
              ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,10,.85)'; ctx.strokeText(p[1], x + 12, y);
              ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText(p[1], x + 12, y);
              ctx.textAlign = 'center';
            }
            ctx.font = '11px "Segoe UI Symbol", "Segoe UI", sans-serif';
          }
        }
      }

      // Area names (big ones first; small ones as you zoom in)
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const zones = [...data.zones].sort((a, b) => b.area - a.area);
      for (const z of zones) {
        // show a name once its area is big enough on screen to hold it
        const onScreen = Math.sqrt(z.area) * s;
        if (onScreen < (z.water ? 30 : 42) || !vis(z.x, -z.y, 300)) continue;
        const size = onScreen > 150 ? 12.5 : onScreen > 80 ? 11.5 : 10.5;
        ctx.font = `700 ${size}px "Segoe UI", sans-serif`;
        const t = z.water ? z.name : z.name.toUpperCase();
        const w = ctx.measureText(t).width + (z.water ? 0 : t.length * 0.8);
        let [x, y] = this.toScreen(z.x, -z.y);
        const dot = (this.dots || []).find((d) => Math.abs(d.x - z.x) < 1 && Math.abs(d.y + z.y) < 1);
        if (dot) y += 24;
        if (!free(x - w / 2, y - size / 2 - 2, x + w / 2, y + size / 2 + 2)) continue;
        if (!z.water) ctx.letterSpacing = '0.8px';
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(8,12,10,.85)'; ctx.strokeText(t, x, y);
        ctx.fillStyle = z.water ? 'rgba(150,200,235,.85)' : 'rgba(255,255,255,.78)'; ctx.fillText(t, x, y);
        ctx.letterSpacing = '0px';
      }

      // Big region names when zoomed out
      if (s < 0.2) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const a = Math.min(1, (0.2 - s) / 0.06);
        for (const [t, x, y, size, color] of [['LOS SANTOS', 250, -1150, 22, '255,255,255'], ['BLAINE COUNTY', 1200, 3200, 20, '255,255,255'],
          ['PACIFIC OCEAN', -3300, 300, 16, '150,200,235'], ['SAN ANDREAS', 3600, -3300, 14, '150,200,235']]) {
          const [sx, sy] = this.toScreen(x, -y);
          ctx.font = `800 ${size}px "Segoe UI", sans-serif`;
          ctx.letterSpacing = '4px';
          const tw = ctx.measureText(t).width;
          if (!free(sx - tw / 2, sy - size / 2, sx + tw / 2, sy + size / 2)) { ctx.letterSpacing = '0px'; continue; }
          ctx.fillStyle = `rgba(${color},${0.16 * a})`;
          ctx.fillText(t, sx, sy);
          ctx.letterSpacing = '0px';
        }
      }

      // Street names along the streets
      if (s >= 0.55) {
        ctx.font = `600 ${s >= 1.2 ? 11.5 : 10.5}px "Segoe UI", sans-serif`;
        for (const st of data.streets) {
          for (const a of st.a) {
            if (!vis(a[0], a[1], 200)) continue;
            const [x, y] = this.toScreen(a[0], a[1]);
            const w = ctx.measureText(st.n).width;
            const ang = (a[2] * Math.PI) / 180;
            const hw = (Math.abs(Math.cos(ang)) * w + Math.abs(Math.sin(ang)) * 12) / 2;
            const hh = (Math.abs(Math.sin(ang)) * w + Math.abs(Math.cos(ang)) * 12) / 2;
            if (!free(x - hw, y - hh, x + hw, y + hh)) continue;
            ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(14,18,16,.9)'; ctx.strokeText(st.n, 0, 0);
            ctx.fillStyle = 'rgba(235,235,225,.92)'; ctx.fillText(st.n, 0, 0);
            ctx.restore();
          }
        }
      }

      // Move the streamer dots
      for (const d of this.dots || []) {
        const [x, y] = this.toScreen(d.x, d.y);
        d.d.style.transform = `translate(${x}px, ${y}px)`;
        d.d.style.display = x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40 ? 'none' : '';
      }
    }
  }

  // Shows the map in `host`. groups: [{ area, street, people }]. Returns the
  // groups that couldn't be placed.
  async function draw(host, groups, { selected, onSelect }) {
    // Once loaded, attach straight away (no waiting), so the map never blinks.
    if (!data) {
      try { await load(); } catch {
        host.textContent = "Couldn't load the map.";
        return [];
      }
    }
    if (!view) view = new MapView();
    if (view.el.parentNode !== host) host.append(view.el);
    view.resize();
    view.setGroups(groups, selected, onSelect);
    return groups.filter((g) => !place(g.area, g.street));
  }

  window.NPMap = { draw, place, load };
})();
