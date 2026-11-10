// A simple drawn map of Los Santos and Blaine County for the NoPixel tab.
// It's a sketch, not Rockstar's map: the coastline and area positions are
// approximate, close enough to see who is where at a glance. Positions are
// in game-world units (x east, y north).
(function () {
  const Z = {
    // Los Santos
    'Los Santos International Airport': [-1250, -2850], 'Terminal': [1050, -3150], 'Port of South Los Santos': [800, -2900],
    'Elysian Island': [150, -2850], 'Cypress Flats Port': [1050, -2500], 'Cypress Flats': [800, -2250], 'El Burro Heights': [1450, -2100],
    'Banning': [-150, -2300], 'Maze Bank Arena': [-250, -2000], 'Rancho': [400, -1800], 'Davis': [100, -1650], 'Chamberlain Hills': [-200, -1550],
    'Strawberry': [100, -1300], 'La Puerta': [-750, -1450], 'Puerto Del Sol': [-850, -1300], 'Vespucci Beach': [-1350, -1450],
    'Vespucci Canals': [-1100, -1050], 'Vespucci': [-1050, -1250], 'Del Perro Pier': [-1700, -1080], 'Del Perro Beach': [-1650, -850],
    'Del Perro': [-1450, -550], 'Morningwood': [-1400, -250], 'Richards Majestic': [-1000, -500], 'Little Seoul': [-700, -900],
    'Mission Row': [430, -980], 'Legion Square': [190, -930], 'Pillbox Hill': [180, -750], 'Downtown': [100, -900], 'Textile City': [430, -720],
    'La Mesa': [850, -1100], 'Murrieta Heights': [1150, -1500], 'Mirror Park': [1150, -600], 'East Vinewood': [900, -200],
    'Alta': [250, -350], 'Hawick': [100, -150], 'Burton': [-400, -250], 'Rockford Hills': [-800, -200], 'West Vinewood': [-200, 230],
    'Downtown Vinewood': [300, 150], 'Vinewood': [350, 250], 'Diamond Casino': [950, 50], 'Vinewood Racetrack': [1100, 150],
    'Vinewood Bowl': [700, 600], 'Rogers Salvage & Scrap': [-450, -1700],
    // Vinewood Hills & west coast
    'Vinewood Hills': [300, 900], 'Richman': [-1600, 250], 'Richman Glen': [-1800, 550], 'GWC and Golfing Society': [-1200, 50],
    'Pacific Bluffs': [-2200, -250], 'Banham Canyon': [-2750, 1400], 'Chumash': [-3150, 900], 'Tongva Hills': [-1900, 2000],
    'Tongva Valley': [-1550, 2350], 'Great Chaparral': [-450, 2050], 'Land Act Dam': [1650, 0], 'Land Act Reservoir': [1950, 300],
    'Tataviam Mountains': [2500, -400], 'Palomino Highlands': [2350, -1200], 'Mount Haan': [900, 1350], 'Ron Alternates Wind Farm': [2250, 1800],
    'Palmer-Taylor Power Station': [2750, 1550], 'San Chianski Mountain Range': [2900, 3700], 'Davis Quartz': [2700, 2850],
    'Noose Headquarters': [2500, -350], 'Tataviam': [2500, -400],
    // Blaine County
    'Sandy Shores': [1800, 3700], 'Sandy Shores Airfield': [1700, 3250], 'Alamo Sea': [950, 3950], 'Grand Senora Desert': [1450, 3000],
    'Harmony': [550, 2700], 'Grapeseed': [2000, 4850], 'Stab City': [100, 3600], 'Fort Zancudo': [-2250, 3150], 'Lago Zancudo': [-1700, 2650],
    'Zancudo River': [-350, 3000], 'Redwood Lights Track': [1000, 2400], 'Raton Canyon': [-700, 4400], 'Cassidy Creek': [-400, 4500],
    'Mount Josiah': [-1100, 4400], 'North Chumash': [-2300, 4300], 'Braddock Pass': [2400, 5300], 'Galilee': [1300, 4400],
    'Humane Labs and Research': [3550, 3700], 'Mount Chiliad': [500, 5600], 'Chiliad Mountain State Wilderness': [-800, 5000],
    'Calafia Bridge': [-100, 4600], 'Mount Gordo': [2800, 5700], 'El Gordo Lighthouse': [3400, 5150], 'Thomson Scrapyard': [2400, 3100],
    'McKenzie Field': [2100, 4800],
    // Paleto & north
    'Paleto Bay': [-300, 6300], 'Paleto Forest': [-700, 5700], 'Paleto Cove': [-1500, 5200], 'Procopio Beach': [1300, 6600], 'Procopio Promenade': [1450, 6400]
  };
  const COAST = [[-1900, -3600], [-1000, -3700], [300, -3500], [1300, -3600], [1700, -3000], [2000, -2600], [2800, -1800], [3100, -1000],
    [3250, -200], [3500, 1000], [3700, 2200], [3850, 3600], [3750, 4600], [3350, 5500], [2650, 6300], [1700, 6850], [500, 7150],
    [-300, 6950], [-1000, 6350], [-1600, 5550], [-2300, 4950], [-3000, 4350], [-3350, 3250], [-3450, 2000], [-3350, 1000], [-2950, 300],
    [-2400, -300], [-2000, -800], [-1780, -1000], [-1600, -1500], [-1750, -1900], [-2150, -2450], [-2300, -3100]];
  const LABELS = [['LOS SANTOS', 300, -1450], ['BLAINE COUNTY', 1700, 3450], ['PALETO BAY', -350, 6650], ['VINEWOOD HILLS', 200, 1150], ['ALAMO SEA', 950, 3900]];
  const VB = { x: -3900, y: -7600, w: 8200, h: 11600 }; // y is flipped (north up)
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
  const pt = ([x, y]) => [x, -y];
  const zoneKey = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  const byKey = new Map(Object.entries(Z).map(([n, p]) => [zoneKey(n), p]));

  // Where an area name goes on the map (null if it isn't drawn).
  function place(area) { return byKey.get(zoneKey(area)) || null; }

  // view = { x, y, k } kept by the caller so zoom survives redraws.
  function draw(host, areas, { view, selected, onSelect }) {
    host.textContent = '';
    const svg = el('svg', { class: 'npm-svg', viewBox: `${VB.x} ${VB.y} ${VB.w} ${VB.h}`, preserveAspectRatio: 'xMidYMid meet' });
    const g = el('g', { class: 'npm-world' });
    const apply = () => g.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
    apply();
    g.append(el('polygon', { class: 'npm-land', points: COAST.map((p) => pt(p).join(',')).join(' ') }));
    g.append(el('ellipse', { class: 'npm-water', cx: 950, cy: -3950, rx: 1000, ry: 380, transform: 'rotate(-8 950 -3950)' }));
    g.append(el('ellipse', { class: 'npm-water', cx: 1950, cy: -300, rx: 260, ry: 160 }));
    for (const [t, x, y] of LABELS) g.append(el('text', { class: 'npm-region', x, y: -y, 'text-anchor': 'middle' }, t));
    // Every known area as a faint dot, so the map has a sense of place.
    for (const p of Object.values(Z)) { const [x, y] = pt(p); g.append(el('circle', { class: 'npm-spot', cx: x, cy: y, r: 22 })); }
    const off = [];
    const sorted = [...areas].sort((a, b) => a.people.length - b.people.length); // big ones on top
    for (const a of sorted) {
      const p = place(a.area);
      if (!p) { off.push(a); continue; }
      const [x, y] = pt(p);
      const n = a.people.length;
      const r = 110 + 55 * Math.sqrt(n);
      const node = el('g', { class: 'npm-dot' + (selected === a.area ? ' sel' : ''), transform: `translate(${x} ${y})`, 'data-area': a.area },
        el('circle', { r: r + 26, class: 'npm-halo' }), el('circle', { r }),
        el('text', { class: 'npm-n', 'text-anchor': 'middle', dy: '0.35em', 'font-size': Math.max(90, r * 0.9) }, String(n)),
        el('text', { class: 'npm-name', 'text-anchor': 'middle', y: r + 150, 'font-size': 165 }, a.area),
        el('title', {}, `${a.area}: ${a.people.map((x) => x.name).join(', ')}`));
      g.append(node);
    }
    svg.append(g);
    host.append(svg);

    // Zoom with the wheel (around the pointer), drag to pan, double-click to reset.
    const toWorld = (cx, cy) => {
      const m = svg.getScreenCTM().inverse();
      const p = new DOMPoint(cx, cy).matrixTransform(m);
      return p;
    };
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY);
      const k = Math.max(1, Math.min(8, view.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      view.x = p.x - ((p.x - view.x) * k) / view.k;
      view.y = p.y - ((p.y - view.y) * k) / view.k;
      view.k = k;
      if (k === 1) { view.x = 0; view.y = 0; }
      apply();
    }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { p: toWorld(e.clientX, e.clientY), x: view.x, y: view.y, moved: false, id: e.pointerId, area: e.target.closest('.npm-dot')?.dataset.area || null };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = toWorld(e.clientX, e.clientY);
      view.x = drag.x + (p.x - drag.p.x);
      view.y = drag.y + (p.y - drag.p.y);
      if (!drag.moved && Math.abs(p.x - drag.p.x) + Math.abs(p.y - drag.p.y) > 60) { drag.moved = true; try { svg.setPointerCapture(drag.id); } catch {} }
      if (drag.moved) apply();
    });
    svg.addEventListener('pointerup', () => { if (drag && !drag.moved) onSelect(drag.area); drag = null; });
    svg.addEventListener('dblclick', () => { view.x = 0; view.y = 0; view.k = 1; apply(); });
    return off;
  }

  window.NPMap = { draw, place };
})();
