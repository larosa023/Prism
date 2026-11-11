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
    gov: ['#64748b', '■'], home: ['#94a3b8', '⌂'], work: ['#78716c', '■'],
    atm: ['#16a34a', '$'], bus: ['#0ea5e9', 'B'], oil: ['#57534e', '⛽']
  };
  // Small things only show up close.
  const CLOSE_ONLY = new Set(['atm', 'bus']);
  const LANDUSE_FILL = { park: 'rgba(70,150,80,.35)', industry: 'rgba(120,120,135,.14)', quarry: 'rgba(170,140,100,.28)', farm: 'rgba(130,160,80,.18)', airport: 'rgba(140,140,150,.10)' };
  const POI_NAMES = {
    police: 'Police', hospital: 'Hospitals', fire: 'Fire', bank: 'Banks', store: 'Stores', gas: 'Gas', gun: 'Ammu-Nation', clothes: 'Clothing',
    barber: 'Barbers', tattoo: 'Tattoos', mechanic: 'Mechanics', cars: 'Car dealer', bar: 'Bars & clubs', fun: 'Fun', shop: 'Shops', gov: 'Government',
    home: 'Motels', work: 'Work', atm: 'ATMs', bus: 'Bus stops', oil: 'Oil fields'
  };

  const REGION_FILL = { city: 'rgba(150,120,210,.10)', hills: 'rgba(110,170,120,.06)', blaine: 'rgba(210,175,100,.07)', north: 'rgba(90,170,180,.08)' };
  const regionOf = (name) => {
    const z = name.toLowerCase();
    if (/paleto|procopio/.test(z)) return 'north';
    if (/alamo|sandy|senora|harmony|grapeseed|stab|zancudo|redwood|raton|cassidy|josiah|chumash|braddock|galilee|humane|chiliad|calafia|gordo|bolingbroke|davis quartz|lago/.test(z)) return 'blaine';
    if (/hills|richman|golf|bluffs|banham|tongva|chaparral|land act|tataviam|palomino|wind|power|chianski|n\.o\.o\.s\.e|baytree|galileo/.test(z)) return 'hills';
    return 'city';
  };

  // ---- Two looks: "Atlas" (light, like the game's own map) and "Dark" ----------
  const THEMES = {
    atlas: {
      sea: '#141a3c', bands: ['#2c5aab', '#5b8fdc', '#9ccaf4'], land: '#a3cfae', sand: '#e9dcb1', sand2: '#dcc791', forest: '#6da87c', forest2: '#56916a',
      golf: '#bfe4bb', fields: 'rgba(200,215,140,.85)', urban: '#f1f2f4', lakes: '#9ccaf4', rivers: '#8cbcf0', coast: 'rgba(60,110,170,.35)',
      landuse: { park: 'rgba(110,180,110,.55)', industry: 'rgba(200,205,214,.55)', quarry: 'rgba(205,180,140,.6)', farm: 'rgba(200,215,140,.5)', airport: 'rgba(214,218,226,.6)' },
      blocks: '#e0e3e9', blockLine: 'rgba(150,160,175,.35)', contour: '40,90,60', zoneLine: 'rgba(40,60,90,.10)', zoneLineFar: 'rgba(40,60,90,.16)',
      dirt: 'rgba(150,140,115,.55)', minorCase: '#9aa6ba', minor: '#c3cbd8', minorFar: 'rgba(120,135,160,.55)', majorCase: '#6f84aa', major: '#9fb1cf', majorFar: '#7f95ba',
      fwyCase: '#56709e', fwy: '#7a92bd', rails: '#7b3f8c', label: 'rgba(40,48,60,.85)', halo: 'rgba(255,255,255,.9)', water: 'rgba(40,90,170,.9)',
      street: 'rgba(30,36,48,.9)', streetHalo: 'rgba(255,255,255,.92)', poiText: 'rgba(20,24,30,.92)', poiHalo: 'rgba(255,255,255,.9)', region: '20,30,60'
    },
    dark: {
      landuse: LANDUSE_FILL, blocks: null, contour: '230,220,180', zoneLine: 'rgba(255,255,255,.10)', zoneLineFar: 'rgba(255,255,255,.16)',
      dirt: 'rgba(176,150,105,.5)', minorCase: '#161b18', minor: '#a9b0ab', minorFar: 'rgba(200,208,204,.5)', majorCase: '#161b18', major: '#a9b0ab', majorFar: 'rgba(236,236,232,.75)',
      fwyCase: 'rgba(60,40,10,.75)', fwy: '#e0aa4a', rails: 'rgba(200,170,140,.7)', label: 'rgba(255,255,255,.78)', halo: 'rgba(8,12,10,.85)', water: 'rgba(150,200,235,.85)',
      street: 'rgba(235,235,225,.92)', streetHalo: 'rgba(14,18,16,.9)', poiText: 'rgba(255,255,255,.9)', poiHalo: 'rgba(8,12,10,.85)', region: '255,255,255'
    }
  };
  const getStyle = () => { try { return localStorage.getItem('prism-np-map-style') || 'atlas'; } catch { return 'atlas'; } };
  const setStyle = (v) => { try { localStorage.setItem('prism-np-map-style', v); } catch {} };

  // ---- Data (loaded the first time the map opens) ----------------------------
  let data = null, loading = null, P = null, relief = null, greyRelief = null;
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'np-map-data.js';
      s.onload = () => {
        data = window.NP_MAP_DATA;
        delete window.NP_MAP_DATA;
        // Build the drawing paths once.
        // Build the big drawing paths once; the detailed per-square ones
        // (roads, city blocks) are built the first time they come on screen.
        const bbox = (d) => {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          const n = d.match(/-?\d+/g) || [];
          for (let i = 0; i + 1 < n.length; i += 2) { const x = +n[i], y = +n[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          return [x0, y0, x1, y1];
        };
        P = {
          land: new Path2D(data.land),
          zones: data.zones.filter((z) => !z.water).map((z) => ({ z, path: new Path2D(z.path), fill: REGION_FILL[regionOf(z.name)], box: bbox(z.path) })),
          lo: Object.fromEntries(Object.entries(data.roadsLo || {}).map(([k, d]) => [k, new Path2D(d)])),
          cells: {}, blockCells: new Map(),
          rails: new Path2D(data.rails), rivers: new Path2D(data.rivers || ''), fields: new Path2D(data.fields || ''),
          contour: new Path2D(data.contours?.[0] || ''), contourMajor: new Path2D(data.contours?.[1] || ''),
          atlas: Object.fromEntries(Object.entries(data.atlas || {}).map(([k, d]) => [k, new Path2D(d)]))
        };
        greyRelief = new Image();
        greyRelief.src = 'np-map-shade-grey.webp';
        greyRelief.onload = () => view?.draw();
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
      // While you drag or zoom, the last full drawing is moved and scaled
      // (instant), and the map is redrawn sharply once you stop.
      this.snap = document.createElement('canvas');
      this.snapView = null;
      this.lastMove = 0;
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
      this.style = getStyle();
      const styleBtn = btn(this.style === 'atlas' ? 'Dark map' : 'Light map', 'Switch between the light atlas look and the dark look', () => {
        this.style = this.style === 'atlas' ? 'dark' : 'atlas';
        setStyle(this.style);
        styleBtn.textContent = this.style === 'atlas' ? 'Dark map' : 'Light map';
        this.el.classList.toggle('atlas', this.style === 'atlas');
        this.lastMove = 0; this.draw();
      });
      this.el.classList.toggle('atlas', this.style === 'atlas');
      // Find a streamer or place on the map
      const find = document.createElement('input');
      find.className = 'npm-find'; find.placeholder = 'Find a streamer, street or place…'; find.spellcheck = false;
      const results = document.createElement('div');
      results.className = 'npm-results'; results.hidden = true;
      const go = (r) => { results.hidden = true; find.value = ''; find.blur(); this.flyTo(r.x, r.y, r.area, r.zoom); };
      const search = () => {
        const q = find.value.trim().toLowerCase();
        results.textContent = '';
        if (q.length < 2) { results.hidden = true; return; }
        const out = [];
        for (const g of this.groups) for (const p of g.people) {
          if ((p.name + ' ' + p.login + ' ' + (p.char || '')).toLowerCase().includes(q)) {
            const pos = place(g.area, g.street);
            if (pos) out.push({ label: p.name + (p.char ? ' · ' + p.char : ''), sub: (g.street ? g.street + ', ' : '') + g.area, x: pos[0], y: pos[1], area: g.area });
          }
        }
        for (const st of data?.streets || []) if (st.n.toLowerCase().includes(q) && st.a[0]) out.push({ label: st.n, sub: 'Street', x: st.a[0][0], y: -st.a[0][1], zoom: 0.7 });
        for (const p of data?.pois || []) if (p[1].toLowerCase().includes(q)) out.push({ label: p[1], sub: (POI_NAMES[p[0]] || 'Place'), x: p[2], y: p[3], zoom: 0.7 });
        for (const z of data?.zones || []) if (z.name.toLowerCase().includes(q)) out.push({ label: z.name, sub: 'Area', x: z.x, y: z.y, zoom: 0.35 });
        for (const r of out.slice(0, 12)) {
          const b = document.createElement('button');
          b.innerHTML = '<b></b><span></span>';
          b.firstChild.textContent = r.label; b.lastChild.textContent = r.sub;
          b.onclick = () => go(r);
          results.append(b);
        }
        if (!out.length) { const e = document.createElement('div'); e.className = 'npm-none'; e.textContent = 'Nothing found'; results.append(e); }
        results.hidden = false;
        this.firstResult = out[0];
      };
      find.addEventListener('input', search);
      find.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && this.firstResult) go(this.firstResult);
        if (e.key === 'Escape') { find.value = ''; results.hidden = true; find.blur(); }
        e.stopPropagation();
      });
      find.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));
      const findWrap = document.createElement('div');
      findWrap.className = 'npm-findwrap';
      findWrap.append(find, results);
      bar.append(findWrap);
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
    // Smoothly move to a spot (and pick its area, if streamers are there).
    flyTo(x, y, area, zoom) {
      const from = { cx: this.cx, cy: this.cy, s: this.s };
      const to = { cx: x, cy: -y, s: Math.max(this.s, zoom || 0.5) };
      const t0 = performance.now(), dur = 450;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        this.cx = from.cx + (to.cx - from.cx) * e; this.cy = from.cy + (to.cy - from.cy) * e;
        this.s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
        this.moved();
        if (k < 1) requestAnimationFrame(step);
        else if (area && !this.noSelectOnFly) this.onSelect(area);
      };
      requestAnimationFrame(step);
    }
    fitAll() { this.fit(-3600, -3900, 4100, 7300); }
    toMap(px, py) { return [(px - this.w / 2) / this.s + this.cx, (py - this.h / 2) / this.s + this.cy]; }
    toScreen(mx, my) { return [(mx - this.cx) * this.s + this.w / 2, (my - this.cy) * this.s + this.h / 2]; }
    zoomAt(px, py, f) {
      const [mx, my] = this.toMap(px, py);
      this.s = Math.max(this.minScale(), Math.min(1.3, this.s * f));
      this.cx = mx - (px - this.w / 2) / this.s; this.cy = my - (py - this.h / 2) / this.s;
      this.moved();
    }
    // Something is moving: draw quickly now, sharply when it settles.
    moved() {
      this.lastMove = performance.now();
      this.draw();
      clearTimeout(this.settle);
      this.settle = setTimeout(() => { this.lastMove = 0; this.draw(); }, 140);
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
          if (drag.moved) { this.cx = drag.cx - dx / this.s; this.cy = drag.cy - dy / this.s; this.moved(); }
          this.tip.hidden = true;
          return;
        }
        // hover work once per frame at most, and not while moving
        this.hoverEvt = e;
        if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(() => { this.hoverRaf = 0; if (!this.lastMove) this.hover(this.hoverEvt); });
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
      const [mx, my] = this.toMap(px, py);
      for (const z of P.zones) {
        const b = z.box;
        if (mx < b[0] || mx > b[2] || my < b[1] || my > b[3]) continue; // quick check first
        if (ctx.isPointInPath(z.path, px * dpr, py * dpr)) { if (!hit || z.z.area < hit.area) hit = z.z; }
      }
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
          if (this.hidden.has(p[0]) || (CLOSE_ONLY.has(p[0]) && this.s < 0.6)) continue;
          const [sx, sy] = this.toScreen(p[2], -p[3]);
          if (Math.abs(sx - px) < hit && Math.abs(sy - py) < hit) { text = p[1]; break; }
        }
      }
      if (!text) { const z = this.zoneAt(px, py); if (z) text = z.name; }
      this.tip.hidden = !text;
      if (text) { this.tip.textContent = text; this.tip.style.transform = `translate(${px + 14}px, ${py + 12}px)`; }
    }

    setGroups(groups, selected, onSelect, opts = {}) {
      this.groups = groups; this.selected = selected; this.onSelect = onSelect;
      this.onPick = opts.onPick || null; this.onHover = opts.onHover || null;
      this.renderDots();
      this.draw();
    }
    // Streamers on the map: their Twitch pictures (up to three stacked when
    // they're in the same spot), ringed in their group's color.
    renderDots() {
      this.dotsEl.textContent = '';
      this.dots = [];
      for (const g of [...this.groups].sort((a, b) => a.people.length - b.people.length)) {
        const pos = place(g.area, g.street);
        if (!pos) continue;
        const people = [...g.people].sort((a, b) => b.viewers - a.viewers);
        const n = people.length;
        const d = document.createElement('button');
        d.className = 'npm-mk' + (this.selected === g.area ? ' sel' : '') + (g.street ? '' : ' area');
        const shown = people.slice(0, 3);
        const size = 34;
        d.style.width = (size + (shown.length - 1) * 14) + 'px';
        d.style.height = size + 'px';
        d.style.marginLeft = -(size + (shown.length - 1) * 14) / 2 + 'px';
        d.style.marginTop = -size / 2 + 'px';
        shown.forEach((p, i) => {
          const im = document.createElement(p.avatar ? 'img' : 'span');
          im.className = 'npm-av';
          if (p.avatar) { im.src = p.avatar; im.alt = ''; im.loading = 'lazy'; } else im.textContent = (p.name || '?')[0];
          im.style.left = i * 14 + 'px';
          im.style.zIndex = 3 - i;
          im.style.borderColor = p.color || '#9b6bff';
          im.dataset.login = p.login;
          d.append(im);
        });
        if (n > 1) { const b = document.createElement('span'); b.className = 'npm-count'; b.textContent = n; d.append(b); }
        d.title = `${g.street ? g.street + ', ' : ''}${g.area}\n${people.map((x) => x.name + (x.char ? ' (' + x.char + ')' : '')).join('\n')}`;
        d.onclick = (e) => {
          e.stopPropagation();
          // a click on one of the pictures picks that streamer
          const login = e.target.dataset?.login;
          const person = (login && people.find((p) => p.login === login)) || people[0];
          if (this.onPick) this.onPick(g, person, pos); else this.onSelect(g.area);
        };
        d.onmouseenter = () => this.onHover?.(people.map((p) => p.login), true);
        d.onmouseleave = () => this.onHover?.(people.map((p) => p.login), false);
        this.dotsEl.append(d);
        this.dots.push({ d, x: pos[0], y: -pos[1], size, logins: people.map((p) => p.login) });
      }
    }
    // Light up the marker(s) for these streamers (from hovering the list).
    highlight(logins, on) {
      for (const m of this.dots || []) if (m.logins.some((l) => logins.includes(l))) m.d.classList.toggle('hl', on);
    }
    // A card pinned to a spot on the map; it moves with the map.
    setPopup(el, pos) {
      if (this.popup?.el && this.popup.el !== el) this.popup.el.remove();
      this.popup = el ? { el, x: pos[0], y: -pos[1] } : null;
      if (el && el.parentNode !== this.el) this.el.append(el);
      this.moveDots();
    }
    // Where a streamer is, for flying the map there.
    find(login) {
      for (const g of this.groups) if (g.people.some((p) => p.login === login)) return { g, pos: place(g.area, g.street) };
      return null;
    }

    draw() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
    }
    moveDots() {
      for (const d of this.dots || []) {
        const [x, y] = this.toScreen(d.x, d.y);
        d.d.style.transform = `translate(${x}px, ${y}px)`;
        d.d.style.display = x < -60 || y < -40 || x > this.w + 60 || y > this.h + 40 ? 'none' : '';
      }
      if (this.popup) {
        const [x, y] = this.toScreen(this.popup.x, this.popup.y);
        // keep the card inside the map
        const pw = this.popup.el.offsetWidth || 320, ph = this.popup.el.offsetHeight || 260;
        const left = Math.max(8, Math.min(this.w - pw - 8, x - pw / 2));
        const top = y - ph - 26 > 8 ? y - ph - 26 : Math.min(this.h - ph - 8, y + 26);
        this.popup.el.style.transform = `translate(${left}px, ${top}px)`;
      }
    }
    // Paths for one road class (or city blocks) in the squares on screen.
    eachCell(kind, fn) {
      const src = kind === 'blocks' ? data.blocks : data.roads[kind];
      if (!src) return;
      const cache = kind === 'blocks' ? P.blockCells : (P.cells[kind] ||= new Map());
      const C = data.cell || 1000, [X0, , , Y1] = data.bounds;
      const [vx0, vy0] = this.toMap(0, 0), [vx1, vy1] = this.toMap(this.w, this.h);
      const c0 = Math.floor((vx0 - X0) / C) - 1, c1 = Math.floor((vx1 - X0) / C) + 1;
      const r0 = Math.floor((Y1 + vy0) / C) - 1, r1 = Math.floor((Y1 + vy1) / C) + 1;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = c + ',' + r;
        let p = cache.get(k);
        if (p === undefined) { p = src[k] ? new Path2D(src[k]) : null; cache.set(k, p); }
        if (p) fn(p);
      }
    }
    paint() {
      if (!P || !this.w) return;
      const ctx = this.canvas.getContext('2d');
      const { s, dpr } = this;
      const px = 1 / s; // one screen pixel, in metres
      const T = THEMES[this.style] || THEMES.atlas;
      const atlas = this.style === 'atlas' && P.atlas.band1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = atlas ? T.sea : '#0b1d2b';
      ctx.fillRect(0, 0, this.w, this.h);
      const [X0, Y0, X1, Y1] = data.bounds;
      // Quick frame while moving: the last sharp drawing, moved and scaled.
      const sv = this.snapView;
      if (this.lastMove && sv && s / sv.s > 0.35 && s / sv.s < 3) {
        ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.w / 2 - this.cx * s), dpr * (this.h / 2 - this.cy * s));
        if (atlas) { ctx.fillStyle = T.land; ctx.fill(P.land, 'evenodd'); }
        else if (relief?.complete && relief.naturalWidth) ctx.drawImage(relief, X0, -Y1, X1 - X0, Y1 - Y0);
        const k = s / sv.s;
        ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (this.w / 2 * (1 - k) + (sv.cx - this.cx) * s), dpr * (this.h / 2 * (1 - k) + (sv.cy - this.cy) * s));
        ctx.imageSmoothingQuality = 'low';
        ctx.drawImage(this.snap, 0, 0, sv.w, sv.h);
        this.moveDots();
        return;
      }
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.w / 2 - this.cx * s), dpr * (this.h / 2 - this.cy * s));
      // visible box (map space) for skipping work off screen
      const [vx0, vy0] = this.toMap(0, 0), [vx1, vy1] = this.toMap(this.w, this.h);
      const vis = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (atlas) {
        // Sea: shallows lighten toward the coast
        const A = P.atlas;
        for (let i = 0; i < 3; i++) { ctx.fillStyle = T.bands[i]; ctx.fill(A['band' + (3 - i)], 'evenodd'); }
        // Land cover: grass, sand and desert, forest on the hills, golf, towns
        ctx.fillStyle = T.land; ctx.fill(P.land, 'evenodd');
        ctx.fillStyle = T.sand; ctx.fill(A.sand, 'evenodd');
        ctx.fillStyle = T.sand2; ctx.fill(A.sand2, 'evenodd');
        ctx.fillStyle = T.forest; ctx.fill(A.forest, 'evenodd');
        ctx.fillStyle = T.forest2; ctx.fill(A.forest2, 'evenodd');
        ctx.fillStyle = T.golf; ctx.fill(A.golf, 'evenodd');
        ctx.fillStyle = T.urban; ctx.fill(A.urban, 'evenodd');
        ctx.fillStyle = T.lakes; ctx.fill(A.lakes, 'evenodd');
        // hills: a soft grey shading multiplied over everything
        if (greyRelief?.complete && greyRelief.naturalWidth) {
          ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.42; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(greyRelief, X0, -Y1, X1 - X0, Y1 - Y0);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
        ctx.strokeStyle = T.coast; ctx.lineWidth = 1.2 * px; ctx.stroke(P.land);
      } else {
        // Land with hills
        if (relief?.complete && relief.naturalWidth) {
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(relief, X0, -Y1, X1 - X0, Y1 - Y0);
        } else { ctx.fillStyle = '#1e2a22'; ctx.fill(P.land); }
        ctx.strokeStyle = 'rgba(120,170,150,.45)'; ctx.lineWidth = 1.2 * px; ctx.stroke(P.land);
      }

      // Land use: parks, golf, docks, quarries, farm fields, the airport
      ctx.save();
      ctx.clip(P.land); // keep land use on land (the game's boxes run into the sea)
      for (const [cat, x, y, w2, h2] of data.landuse || []) {
        if (!vis(x + w2 / 2, y + h2 / 2, Math.max(w2, h2))) continue;
        ctx.fillStyle = T.landuse[cat] || 'rgba(255,255,255,.05)';
        ctx.fillRect(x, y, w2, h2);
      }
      ctx.fillStyle = atlas ? T.fields : 'rgba(150,175,80,.28)'; ctx.fill(P.fields);
      ctx.restore();

      // City blocks (the spaces between streets) as you get closer
      if (s >= 0.16) {
        const a = Math.min(1, (s - 0.16) / 0.12);
        ctx.globalAlpha = a;
        ctx.fillStyle = atlas ? T.blocks : 'rgba(78,84,96,.75)';
        this.eachCell('blocks', (p) => ctx.fill(p));
        if (s >= 0.4) { ctx.strokeStyle = atlas ? T.blockLine : 'rgba(160,170,190,.25)'; ctx.lineWidth = px; this.eachCell('blocks', (p) => ctx.stroke(p)); }
        ctx.globalAlpha = 1;
      }

      // Rivers and canals
      ctx.strokeStyle = atlas ? T.rivers : 'rgba(30,70,100,.9)'; ctx.lineWidth = Math.max(1.4 * px, 16); ctx.stroke(P.rivers);

      // Height lines (every 50 m, thicker every 200 m)
      if (s >= 0.1) {
        const a = Math.min(1, (s - 0.1) / 0.15);
        ctx.strokeStyle = `rgba(${T.contour},${0.10 * a})`; ctx.lineWidth = 0.8 * px; ctx.stroke(P.contour);
        ctx.strokeStyle = `rgba(${T.contour},${0.2 * a})`; ctx.lineWidth = 1.1 * px; ctx.stroke(P.contourMajor);
      }

      // Areas
      const sel = this.selected && zoneFor(this.selected);
      if (s < 0.5 && !atlas) for (const z of P.zones) { ctx.fillStyle = z.fill; ctx.fill(z.path); }
      ctx.strokeStyle = s < 0.2 ? T.zoneLineFar : T.zoneLine; ctx.lineWidth = px;
      for (const z of P.zones) ctx.stroke(z.path);
      if (sel) {
        const zz = P.zones.find((z) => z.z === sel);
        if (zz) { ctx.fillStyle = 'rgba(145,70,255,.18)'; ctx.fill(zz.path); ctx.strokeStyle = '#9b6bff'; ctx.lineWidth = 2 * px; ctx.stroke(zz.path); }
      }

      // Roads: more of them as you zoom in. Up close they're drawn at their real
      // width, so the separate lanes of a freeway read as one road.
      const w = (minPx, metres) => Math.max(minPx * px, metres);
      // Zoomed out: one simplified path per kind. Closer: full detail, only for the squares on screen.
      const far = s < 0.2;
      const road = (kind, color, width) => {
        ctx.strokeStyle = color; ctx.lineWidth = width;
        if (kind === 'rails') { ctx.stroke(P.rails); return; }
        if (far && P.lo[kind]) ctx.stroke(P.lo[kind]);
        else this.eachCell(kind, (p) => ctx.stroke(p));
      };
      road('dirt', T.dirt, w(s >= 0.6 ? 1.2 : s >= 0.22 ? 0.8 : 0.5, 4));
      // outlines first, then all the road surfaces on top, so joins are clean
      const close = s >= 0.4;
      if (close) { road('minor', T.minorCase, w(2.6, 8)); road('major', T.majorCase, w(3.4, 11)); }
      road('freeway', T.fwyCase, w(s >= 0.5 ? 5.5 : 3.5, 20));
      road('minor', close ? T.minor : T.minorFar, w(s >= 0.4 ? 1.2 : s >= 0.14 ? 0.8 : 0.55, 5));
      road('major', close ? T.major : T.majorFar, w(s >= 0.3 ? 1.7 : 1, 7.5));
      if (atlas) road('rails', T.rails, Math.max(1.6 * px, 3));
      else {
        ctx.setLineDash(s >= 0.12 ? [5 * px, 4 * px] : [3 * px, 2 * px]);
        road('rails', T.rails, 1.3 * px);
        ctx.setLineDash([]);
      }
      road('freeway', T.fwy, w(s >= 0.5 ? 3.5 : 2, 14));

      // Text and icons in screen pixels from here on
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const taken = []; // label boxes already drawn, to avoid overlaps
      const free = (x0, y0, x1, y1) => {
        for (const b of taken) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false;
        taken.push([x0, y0, x1, y1]);
        return true;
      };
      for (const d of this.dots || []) { const [x, y] = this.toScreen(d.x, d.y); const r = d.size / 2 + 2; taken.push([x - r, y - r, x + r, y + r]); }

      // Places: small colored dots when zoomed out, badges closer in
      if (s < 0.33) {
        const r = s < 0.12 ? 2.2 : 3;
        for (const p of data.pois) {
          if (this.hidden.has(p[0]) || CLOSE_ONLY.has(p[0]) || !vis(p[2], -p[3], 20)) continue;
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
          if (this.hidden.has(p[0]) || (CLOSE_ONLY.has(p[0]) && s < 0.6) || !vis(p[2], -p[3], 50)) continue;
          const [x, y] = this.toScreen(p[2], -p[3]);
          const [color, glyph] = POI_STYLE[p[0]] || ['#888', '●'];
          ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.fillText(glyph, x, y + 0.5);
          taken.push([x - 9, y - 9, x + 9, y + 9]);
          if (s >= 0.6) {
            ctx.font = '600 10.5px "Segoe UI", sans-serif';
            const w = ctx.measureText(p[1]).width;
            if (free(x + 10, y - 7, x + 14 + w, y + 7)) {
              ctx.textAlign = 'left';
              ctx.lineWidth = 3; ctx.strokeStyle = T.poiHalo; ctx.strokeText(p[1], x + 12, y);
              ctx.fillStyle = T.poiText; ctx.fillText(p[1], x + 12, y);
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
        ctx.lineWidth = 3.5; ctx.strokeStyle = T.halo; ctx.strokeText(t, x, y);
        ctx.fillStyle = z.water ? T.water : T.label; ctx.fillText(t, x, y);
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
          const landLabel = color === '255,255,255';
          ctx.fillStyle = `rgba(${landLabel ? T.region : color},${(atlas && landLabel ? 0.28 : 0.16) * a})`;
          ctx.fillText(t, sx, sy);
          ctx.letterSpacing = '0px';
        }
      }

      // Street names along the streets
      if (s >= 0.32) {
        ctx.font = `600 ${s >= 0.8 ? 11.5 : s >= 0.5 ? 10.5 : 9.5}px "Segoe UI", sans-serif`;
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
            ctx.lineWidth = 3; ctx.strokeStyle = T.streetHalo; ctx.strokeText(st.n, 0, 0);
            ctx.fillStyle = T.street; ctx.fillText(st.n, 0, 0);
            ctx.restore();
          }
        }
      }

      this.moveDots();
      // Keep this drawing for quick frames while moving.
      if (this.snap.width !== this.canvas.width || this.snap.height !== this.canvas.height) { this.snap.width = this.canvas.width; this.snap.height = this.canvas.height; }
      const sc = this.snap.getContext('2d');
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.drawImage(this.canvas, 0, 0);
      this.snapView = { cx: this.cx, cy: this.cy, s: this.s, w: this.w, h: this.h };
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
    view.setGroups(groups, selected, onSelect, arguments[2]);
    return groups.filter((g) => !place(g.area, g.street));
  }

  window.NPMap = { draw, place, load, view: () => view };
})();
