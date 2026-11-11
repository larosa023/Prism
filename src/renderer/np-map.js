// The NoPixel tab's map of Los Santos and Blaine County.
// Coastline, zone outlines and roads come from GTA V's own game data (zone
// bounds and the road network, see scripts/map), so areas are where the game
// puts them. Positions are game-world metres (x east, y north); the SVG uses
// -y so north is up.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
  const key = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '');

  // Places Prism can read from a HUD that aren't zones of their own.
  const LANDMARKS = {
    'Diamond Casino': [925, 46], 'Vinewood Bowl': [686, 577], 'Del Perro Pier': [-1650, -1080], 'Puerto Del Sol': [-860, -1340],
    'Cypress Flats Port': [1000, -2500], 'Sandy Shores Airfield': [1730, 3290], 'McKenzie Field': [2120, 4805],
    'Thomson Scrapyard': [2400, 3100], 'Procopio Promenade': [1450, 6480], 'Mount Haan': [900, 1350], 'Rogers Salvage & Scrap': [-460, -1700],
    'Noose Headquarters': [2520, -380], 'Tataviam': [2500, -400], 'Pacific Ocean': null
  };
  const ALIASES = { noose: 'N.O.O.S.E', nooseheadquarters: 'N.O.O.S.E', bolingbroke: 'Bolingbroke Penitentiary', prison: 'Bolingbroke Penitentiary' };

  let data = null, loading = null;
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'np-map-data.js';
      s.onload = () => { data = window.NP_MAP_DATA; resolve(data); };
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
  // Where an area name sits on the map, or null.
  function place(area) {
    const z = zoneFor(area);
    if (z) return [z.x, z.y];
    const lm = Object.entries(LANDMARKS).find(([n]) => key(n) === key(area));
    return lm ? lm[1] : null;
  }

  const REGION_OF = (name) => {
    const z = name.toLowerCase();
    if (/paleto|procopio/.test(z)) return 'north';
    if (/alamo|sandy|senora|harmony|grapeseed|stab|zancudo|redwood|raton|cassidy|josiah|chumash|braddock|galilee|humane|chiliad|calafia|gordo|bolingbroke|davis quartz|lago/.test(z)) return 'blaine';
    if (/hills|richman|golf|bluffs|banham|tongva|chaparral|land act|tataviam|palomino|wind|power|chianski|n\.o\.o\.s\.e|baytree|galileo/.test(z)) return 'hills';
    return 'city';
  };

  const BOUNDS = { x: -4200, y: -8200, w: 8800, h: 12400 }; // in SVG units (y flipped)

  // view = { x, y, k } is kept by the caller so the zoom survives redraws.
  async function draw(host, areas, { view, selected, onSelect }) {
    host.textContent = '';
    try { await load(); } catch { host.append(Object.assign(document.createElement('div'), { className: 'rp-empty', textContent: "Couldn't load the map." })); return []; }
    if (!host.isConnected) return [];
    const svg = el('svg', { class: 'npm-svg', viewBox: `${BOUNDS.x} ${BOUNDS.y} ${BOUNDS.w} ${BOUNDS.h}`, preserveAspectRatio: 'xMidYMid meet' });
    const world = el('g', { class: 'npm-world' });
    svg.append(world);
    host.append(svg);

    world.append(el('path', { class: 'npm-land', d: data.land }));
    const zoneLayer = el('g', { class: 'npm-zones' });
    const sel = selected ? zoneFor(selected) : null;
    for (const z of data.zones) {
      if (z.water) continue;
      const p = el('path', { class: 'npm-zone r-' + REGION_OF(z.name) + (z === sel ? ' sel' : ''), d: z.path });
      p.append(el('title', {}, z.name));
      zoneLayer.append(p);
    }
    world.append(zoneLayer);
    world.append(el('path', { class: 'npm-road dirt', d: data.roads.dirt }));
    world.append(el('path', { class: 'npm-road minor', d: data.roads.minor }));
    world.append(el('path', { class: 'npm-road major', d: data.roads.major }));
    world.append(el('path', { class: 'npm-road freeway', d: data.roads.freeway }));

    // Area names: big areas always, smaller ones as you zoom in.
    const labelLayer = el('g', { class: 'npm-labels' });
    const labels = [];
    for (const z of data.zones) {
      const t = el('text', { class: 'npm-label' + (z.water ? ' water' : ''), x: z.x, y: -z.y, 'text-anchor': 'middle', dy: '0.35em' }, z.name);
      labels.push({ t, area: z.area, y: -z.y, name: z.name });
      labelLayer.append(t);
    }
    world.append(labelLayer);

    // Streamer dots
    const dotLayer = el('g', { class: 'npm-dots' });
    const dots = [];
    const off = [];
    for (const a of [...areas].sort((p, q) => p.people.length - q.people.length)) {
      const pos = place(a.area);
      if (!pos) { off.push(a); continue; }
      const n = a.people.length;
      const r = 9 + 4 * Math.sqrt(n);
      const inner = el('g', {},
        el('circle', { r: r + 4, class: 'npm-halo' }), el('circle', { r, class: 'npm-core' }),
        el('text', { class: 'npm-n', 'text-anchor': 'middle', dy: '0.35em', 'font-size': Math.max(10, r * 0.95) }, String(n)));
      const g = el('g', { class: 'npm-dot' + (selected === a.area ? ' sel' : ''), 'data-area': a.area }, inner);
      g.append(el('title', {}, `${a.area}: ${a.people.map((x) => x.name).join(', ')}`));
      dots.push({ g, x: pos[0], y: -pos[1], r, area: a.area });
      dotLayer.append(g);
    }
    world.append(dotLayer);

    // A name with a dot on it goes just under the dot.
    const dotR = new Map(dots.map((d) => [key(d.area), d.r]));
    for (const l of labels) l.dotR = dotR.get(key(l.name)) || 0;
    // Keep dots, labels and lines the same size on screen at any zoom.
    function apply() {
      world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
      const ctm = svg.getScreenCTM();
      const unit = (ctm && ctm.a ? 1 / ctm.a : BOUNDS.h / 800) / view.k; // map units per screen pixel
      svg.style.setProperty('--u', unit);
      for (const d of dots) d.g.setAttribute('transform', `translate(${d.x} ${d.y}) scale(${unit})`);
      for (const l of labels) {
        const px = l.area > 6e6 ? 13 : l.area > 1.2e6 ? 11.5 : 10.5;
        const minK = l.area > 6e6 ? 0 : l.area > 2e6 ? 1.2 : l.area > 0.6e6 ? 1.7 : 2.4;
        l.t.setAttribute('font-size', px * unit);
        l.t.setAttribute('y', l.y + (l.dotR ? (l.dotR + 13) * unit : 0));
        l.t.style.display = view.k >= minK || l.dotR ? '' : 'none';
      }
      svg.style.setProperty('--stroke', unit);
    }
    apply();
    new ResizeObserver(apply).observe(svg);

    const toSvg = (cx, cy) => new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
    const zoomAt = (p, factor) => {
      const k = Math.max(1, Math.min(14, view.k * factor));
      view.x = p.x - ((p.x - view.x) * k) / view.k;
      view.y = p.y - ((p.y - view.y) * k) / view.k;
      view.k = k;
      if (k === 1) { view.x = 0; view.y = 0; }
      apply();
    };
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(toSvg(e.clientX, e.clientY), e.deltaY < 0 ? 1.25 : 1 / 1.25); }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { p: toSvg(e.clientX, e.clientY), x: view.x, y: view.y, moved: false, id: e.pointerId, area: e.target.closest('.npm-dot')?.dataset.area || null };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = toSvg(e.clientX, e.clientY);
      if (!drag.moved && Math.hypot(e.movementX, e.movementY) >= 0 && Math.abs(p.x - drag.p.x) + Math.abs(p.y - drag.p.y) > 40 / view.k) { drag.moved = true; try { svg.setPointerCapture(drag.id); } catch {} }
      if (drag.moved) { view.x = drag.x + (p.x - drag.p.x); view.y = drag.y + (p.y - drag.p.y); apply(); }
    });
    svg.addEventListener('pointerup', () => { if (drag && !drag.moved) onSelect(drag.area); drag = null; });
    svg.addEventListener('dblclick', (e) => { if (e.target.closest('.npm-dot')) return; zoomAt(toSvg(e.clientX, e.clientY), 2); });

    // Zoom buttons and quick jumps
    const jump = (x0, y0, x1, y1) => {
      const k = Math.min(BOUNDS.w / (x1 - x0), BOUNDS.h / (y1 - y0)) * 0.9;
      const cx = (x0 + x1) / 2, cy = -(y0 + y1) / 2;
      const mx = BOUNDS.x + BOUNDS.w / 2, my = BOUNDS.y + BOUNDS.h / 2;
      view.k = Math.max(1, Math.min(14, k));
      view.x = mx - cx * view.k; view.y = my - cy * view.k;
      apply();
    };
    const btn = (text, title, fn) => { const b = document.createElement('button'); b.className = 'npm-btn'; b.textContent = text; b.title = title; b.onclick = fn; return b; };
    const center = () => toSvg(svg.getBoundingClientRect().left + svg.clientWidth / 2, svg.getBoundingClientRect().top + svg.clientHeight / 2);
    const tools = document.createElement('div');
    tools.className = 'npm-tools';
    tools.append(
      btn('+', 'Zoom in', () => zoomAt(center(), 1.5)), btn('−', 'Zoom out', () => zoomAt(center(), 1 / 1.5)),
      btn('Los Santos', 'Zoom to the city', () => jump(-2100, -3500, 1700, 700)),
      btn('Blaine County', 'Zoom to Sandy Shores and around', () => jump(-500, 2300, 3600, 5200)),
      btn('Paleto', 'Zoom to Paleto Bay', () => jump(-1200, 5600, 1000, 7000)),
      btn('Whole map', 'Show everything', () => { view.x = 0; view.y = 0; view.k = 1; apply(); }));
    host.append(tools);
    return off;
  }

  window.NPMap = { draw, place, load };
})();
