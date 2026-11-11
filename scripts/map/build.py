import json, pickle, sys, numpy as np
from scipy import ndimage
from skimage import measure, morphology
nodes_pkl, zones_json, out_js, dumps_dir, shade_png, streets_json = sys.argv[1:7]
import os
D = pickle.load(open(nodes_pkl, 'rb'))
Z = json.load(open(zones_json))
X0, X1, Y0, Y1, R = -4200, 4600, -4200, 8200, 10.0
W, H = int((X1 - X0) / R), int((Y1 - Y0) / R)
def ij(x, y): return ((Y1 - np.asarray(y)) / R).astype(int), ((np.asarray(x) - X0) / R).astype(int)
def mark(grid, x0, y0, x1, y1):
    n = int(max(abs(x1 - x0), abs(y1 - y0)) / R) + 1
    i, j = ij(np.linspace(x0, x1, n), np.linspace(y0, y1, n))
    ok = (i >= 0) & (i < H) & (j >= 0) & (j < W); grid[i[ok], j[ok]] = True
def boxes(grid, b):
    for bb in b:
        mn, mx = bb['Minimum'], bb['Maximum']
        i0, j0 = ij(mn['X'], mx['Y']); i1, j1 = ij(mx['X'], mn['Y'])
        grid[max(0, i0):max(0, i1) + 1, max(0, j0):max(0, j1) + 1] = True
disk = lambda r: morphology.disk(max(1, int(r / R)))

roads = np.zeros((H, W), bool); boat = np.zeros((H, W), bool)
for s in D['segs']:
    if abs(s[0] - s[2]) + abs(s[1] - s[3]) > 600: continue
    mark(boat if s[4] else roads, *s[:4])
ocean = np.zeros((H, W), bool); alamo = np.zeros((H, W), bool); skip = np.zeros((H, W), bool); lact = np.zeros((H, W), bool)
for z in Z:
    if z['Name'].lower() == 'oceana': boxes(ocean, z['Bounds'])
    if z['Name'] in ('Alamo',): boxes(alamo, z['Bounds'])
    if z['Name'] in ('LAct',): boxes(lact, z['Bounds'])
    if z['Name'] in ('Prol', 'IsHeistZone'): boxes(skip, z['Bounds'])
near = ndimage.binary_dilation(roads, structure=disk(300))
close = ndimage.binary_dilation(roads, structure=disk(45))
land = near & ~ocean & ~ndimage.binary_dilation(boat, structure=disk(60))
land = ndimage.binary_closing(land, structure=disk(150))
lab, n = ndimage.label(~land)
for k, sz in enumerate(ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)), 1):
    if True:
        hole = lab == k
        if not (hole[0].any() or hole[-1].any() or hole[:, 0].any() or hole[:, -1].any()): land[hole] = True
# The Alamo Sea: water except right by the shore roads.
land &= ~(alamo & ~ndimage.binary_dilation(roads, structure=disk(120)))
# Land Act Reservoir: where its boats go.
land &= ~(lact & ndimage.binary_dilation(boat, structure=disk(110)) & ~ndimage.binary_dilation(roads, structure=disk(40)))
land |= close & ~ocean
land &= ~skip
lab, n = ndimage.label(land)
sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
land = np.isin(lab, [k + 1 for k, sz in enumerate(sizes) if sz * R * R > 0.15e6])
land = ndimage.gaussian_filter(land.astype(float), 2.5) > 0.5

def to_world(c):  # contour (row, col) -> world
    return [(round(X0 + (p[1] + 0.5) * R), round(Y1 - (p[0] + 0.5) * R)) for p in c]
def path(contours, tol):
    out = []
    for c in contours:
        if len(c) < 8: continue
        c = measure.approximate_polygon(c, tol / R)
        pts = to_world(c)
        out.append('M' + ' '.join(f'{x},{-y}' for x, y in pts) + 'Z')
    return ''.join(out)
land_path = path(measure.find_contours(np.pad(land, 1).astype(float), 0.5), 12).replace
# find_contours on padded grid: shift by 1 cell
def padded_contours(mask):
    return [c - 1 for c in measure.find_contours(np.pad(mask, 1).astype(float), 0.5)]
land_path = path(padded_contours(land), 12)

# ---- Zones: rasterize (smaller zones win where boxes overlap)
names = {}
for z in Z:
    dn = z['DisplayName']
    if z['Name'].lower() == 'oceana' or z['Name'] in ('Prol', 'IsHeistZone') or dn in (None, 'None'): continue
    names.setdefault(dn, []).extend(z['Bounds'])
area = {dn: sum((b['Maximum']['X'] - b['Minimum']['X']) * (b['Maximum']['Y'] - b['Minimum']['Y']) for b in bs) for dn, bs in names.items()}
owner = np.full((H, W), -1, int)
order = sorted(names, key=lambda d: -area[d])  # big first, small overwrite
for k, dn in enumerate(order):
    g = np.zeros((H, W), bool); boxes(g, names[dn]); owner[g] = k
zones = []
for k, dn in enumerate(order):
    m = (owner == k) & land
    water_zone = dn in ('Alamo Sea', 'Land Act Reservoir')
    if water_zone: m = (owner == k) & ~land
    if m.sum() * R * R < 0.02e6: continue
    m2 = ndimage.binary_opening(m, structure=disk(20))
    if m2.sum() > 0: m = m2
    dt = ndimage.distance_transform_edt(m)
    i, j = np.unravel_index(np.argmax(dt), dt.shape)
    zones.append({'water': water_zone, 'name': dn, 'x': round(X0 + (j + .5) * R), 'y': round(Y1 - (i + .5) * R), 'path': path(padded_contours(m), 25), 'area': int(m.sum() * R * R)})

# ---- Roads: chain links into lines, simplify
from collections import defaultdict
cls_of = lambda s: 'freeway' if s[5] else 'dirt' if (s[6] or s[7]) else 'major' if (s[8] >= 3 or s[9] not in ('0', None)) else 'minor'
lines = defaultdict(list)
adj = defaultdict(lambda: defaultdict(set))
def on_island(x, y):  # leaves out North Yankton and Cayo Perico
    if not (X0 < x < X1 and Y0 < y < Y1): return False
    i, j = ij(x, y)
    return not skip[i, j]
for s in D['segs']:
    if s[4] or abs(s[0] - s[2]) + abs(s[1] - s[3]) > 600: continue
    if not (on_island(s[0], s[1]) and on_island(s[2], s[3])): continue
    a = (round(s[0]), round(s[1])); b = (round(s[2]), round(s[3]))
    if a == b: continue
    c = cls_of(s)
    adj[c][a].add(b); adj[c][b].add(a)
def chains(g):
    seen = set(); out = []
    def walk(a, b):
        line = [a, b]; seen.add(frozenset((a, b)))
        while len(g[b]) == 2:
            nxt = [n for n in g[b] if frozenset((b, n)) not in seen]
            if not nxt: break
            a, b = b, nxt[0]; seen.add(frozenset((a, b))); line.append(b)
        return line
    for a in g:
        if len(g[a]) != 2:
            for b in g[a]:
                if frozenset((a, b)) not in seen: out.append(walk(a, b))
    for a in g:
        for b in g[a]:
            if frozenset((a, b)) not in seen: out.append(walk(a, b))
    return out
CELL = 1000
cell_of = lambda x, y: f'{int((x - X0) // CELL)},{int((Y1 - y) // CELL)}'
def to_cells(lines, tol):
    # Each line is cut where it crosses into another 1 km cell, so the app
    # only draws the cells on screen.
    out = {}
    for line in lines:
        pts = measure.approximate_polygon(np.array(line, float), tol)
        run = [pts[0]]; cur = cell_of(*pts[0])
        for p_ in pts[1:]:
            c2 = cell_of(*p_)
            run.append(p_)
            if c2 != cur:
                out.setdefault(cur, []).append(run); run = [p_]; cur = c2
        if len(run) > 1: out.setdefault(cur, []).append(run)
    return {k: ''.join('M' + ' '.join(f'{int(x)},{int(-y)}' for x, y in r) for r in v) for k, v in out.items()}
def whole(lines, tol):
    return ''.join('M' + ' '.join(f'{int(x)},{int(-y)}' for x, y in measure.approximate_polygon(np.array(l, float), tol)) for l in lines)
roads_out = {}; roads_lo = {}; road_lines = {}
for c, g in adj.items():
    lines = chains(g)
    road_lines[c] = lines
    roads_out[c] = to_cells(lines, {'freeway': 6, 'major': 5, 'minor': 4, 'dirt': 8}[c])
    roads_lo[c] = whole([l for l in lines if c in ('freeway', 'major') or len(l) > 3], {'freeway': 25, 'major': 20, 'minor': 18, 'dirt': 25}[c])

# ---- Street names: label spots along each named street, and where each street is in each zone
import math
from collections import defaultdict as dd
sg = dd(lambda: dd(set))
for s_ in D['segs']:
    if s_[4] or s_[9] in ('0', None) or abs(s_[0] - s_[2]) + abs(s_[1] - s_[3]) > 600: continue
    a = (round(s_[0]), round(s_[1])); b = (round(s_[2]), round(s_[3]))
    if a != b: sg[s_[9]][a].add(b); sg[s_[9]][b].add(a)
streets = []
for name, g in sg.items():
    anchors = []
    for line in chains(g):
        pts = np.array(line, float)
        if len(pts) < 2: continue
        seg = np.hypot(*np.diff(pts, axis=0).T)
        total = seg.sum()
        if total < 80: continue
        cum = np.concatenate([[0], np.cumsum(seg)])
        n = max(1, int(total // 260))
        for k in range(n):
            t = (k + 0.5) * total / n
            i = min(len(seg) - 1, int(np.searchsorted(cum, t) - 1))
            i = max(0, i)
            # direction over ~120 m around the spot
            j0 = max(0, np.searchsorted(cum, t - 60) - 1); j1 = min(len(pts) - 1, np.searchsorted(cum, t + 60))
            dx, dy = pts[j1] - pts[j0]
            f = (t - cum[i]) / max(1e-6, seg[i])
            x, y = pts[i] + (pts[i + 1] - pts[i]) * f
            ang = math.degrees(math.atan2(-dy, dx))
            if ang > 90: ang -= 180
            if ang < -90: ang += 180
            anchors.append([int(x), int(-y), int(ang)])
    # drop anchors closer than 500 m to one already kept
    kept = []
    for a in sorted(anchors, key=lambda a: a[0]):
        if all((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 > 200 ** 2 for b in kept): kept.append(a)
    if kept: streets.append({'n': name, 'a': kept})
# where each street runs within each zone (for placing streamers on the right street)
zone_names = order
acc = dd(lambda: dd(lambda: [0.0, 0.0, 0]))
for nd in D['nodes']:
    st = nd[6]
    if st in ('0', None) or nd[2]: continue
    i, j = ij(nd[0], nd[1])
    if not (0 <= i < H and 0 <= j < W): continue
    k = owner[i, j]
    if k < 0: continue
    a = acc[st][zone_names[k]]; a[0] += nd[0]; a[1] += nd[1]; a[2] += 1
street_zone = {st: {z: [round(v[0] / v[2]), round(v[1] / v[2])] for z, v in zs_.items() if v[2] >= 2} for st, zs_ in acc.items()}

# ---- Places: from the game's interiors, plus gas stations from the pumps
import json as _j
mlo = _j.load(open(os.path.join(dumps_dir, 'mloInteriors.json')))
POI = {
  'v_policehub': ('police', 'Mission Row Police Station'), 'v_sheriff': ('police', 'Sandy Shores Sheriff'), 'v_sheriff2': ('police', 'Paleto Bay Sheriff'),
  'v_hospital': ('hospital', 'Pillbox Hill Medical Center'), 'v_firedept': ('fire', 'Fire Station'), 'v_genbank': ('bank', 'Fleeca Bank'),
  'v_bank': ('bank', 'Pacific Standard Bank'), 'v_bank4': ('bank', 'Blaine County Savings Bank'), 'v_finalebank': ('bank', 'Union Depository'),
  'v_shop_247': ('store', '24/7'), 'v_gen_liquor': ('store', 'Liquor Store'), 'v_gasstation': ('store', 'LTD Gasoline'),
  'v_gun': ('gun', 'Ammu-Nation (with range)'), 'v_gun2': ('gun', 'Ammu-Nation'), 'v_clotheslo': ('clothes', 'Discount Store'),
  'v_clothesmid': ('clothes', 'Suburban'), 'v_clotheshi': ('clothes', 'Ponsonbys'), 'v_barbers': ('barber', 'Barber Shop'),
  'v_hairdresser': ('barber', 'Bob Mulét'), 'v_tattoo': ('tattoo', 'Tattoo Parlor'), 'v_tattoo2': ('tattoo', 'Tattoo Parlor'),
  'v_carmod': ('mechanic', 'Los Santos Customs'), 'v_carmod3': ('mechanic', 'Los Santos Customs'), 'v_carshowroom': ('cars', 'Premium Deluxe Motorsport'),
  'v_bahama': ('bar', 'Bahama Mamas'), 'v_rockclub': ('bar', 'Tequi-la-la'), 'v_hicksbar': ('bar', 'Yellow Jack Inn'), 'v_strip3': ('bar', 'Vanilla Unicorn'),
  'v_cinema': ('fun', 'Cinema'), 'v_comedy': ('fun', 'Comedy Club'), 'v_jewel2': ('shop', 'Vangelico Jewelry'), 'v_fib01': ('gov', 'FIB Building'),
  'v_motel_mp': ('home', 'Motel'), 'v_coroner': ('gov', 'Coroner'), 'v_lab': ('gov', 'Humane Labs'), 'v_recycle': ('work', 'Recycling Center'),
  'v_abattoir': ('work', 'Slaughterhouse'), 'v_foundry': ('work', 'Foundry'), 'v_chopshop': ('work', 'Chop Shop'), 'v_stadium': ('fun', 'Maze Bank Arena'),
  'v_epsilonism': ('gov', 'Epsilon Center')
}
pois = []
for x in mlo:
    if x['DlcName'] != 'basegame' or x['Name'] not in POI: continue
    cat, label = POI[x['Name']]
    for l in x['Locations']:
        p_ = l['Position']
        if -4200 < p_['X'] < 4600 and -4200 < p_['Y'] < 8200: pois.append([cat, label, round(p_['X']), round(p_['Y'])])
# well-known places that aren't separate interiors in the game files
for cat, label, x, y in [('hospital', 'Central Los Santos Medical', 340, -1396), ('hospital', 'Mount Zonah Medical', -449, -340),
    ('hospital', 'Sandy Shores Medical', 1839, 3672), ('hospital', 'Paleto Bay Medical', -247, 6331), ('police', 'Vespucci Police', -1094, -809),
    ('police', 'Davis Sheriff', 361, -1584), ('police', 'Vinewood Police', 639, 1), ('police', 'La Mesa Police', 826, -1290),
    ('mechanic', "Benny's Original Motorworks", -205, -1312), ('fun', 'Diamond Casino', 925, 46), ('gov', 'Bolingbroke Penitentiary', 1846, 2585),
    ('gov', 'City Hall', -544, -204), ('fun', 'Del Perro Pier', -1650, -1080), ('mechanic', 'Los Santos Customs', 731, -1088)]:
    pois.append([cat, label, x, y])
pumps = _j.load(open(os.path.join(dumps_dir, 'objectslocations', 'worldGasPumps.json')))
cl = []
for pmp in pumps:
    x, y = pmp['Position']['X'], pmp['Position']['Y']
    for c in cl:
        if (c[0] / c[2] - x) ** 2 + (c[1] / c[2] - y) ** 2 < 70 ** 2: c[0] += x; c[1] += y; c[2] += 1; break
    else: cl.append([x, y, 1])
for c in cl: pois.append(['gas', 'Gas Station', round(c[0] / c[2]), round(c[1] / c[2])])

# ---- Railways
tr = _j.load(open(os.path.join(dumps_dir, 'traintracks.json')))
rails = []
for t in tr:
    if t['TrainConfigName'] == 'metro_group': continue  # the subway, mostly underground
    pts = np.array([[n_['Position']['X'], n_['Position']['Y']] for n_ in t['Nodes']], float)
    if len(pts) < 2: continue
    # split where the track jumps (tunnels / separate pieces)
    cut = np.where(np.hypot(*np.diff(pts, axis=0).T) > 200)[0] + 1
    for part in np.split(pts, cut):
        if len(part) < 2: continue
        part = measure.approximate_polygon(part, 5)
        rails.append(('M' if True else '') + ' '.join(f'{int(x)},{int(-y)}' for x, y in part))
rails_path = ''.join('M' + r[1:] if r.startswith('M') else r for r in rails)
metro = [t for t in tr if t['TrainConfigName'] == 'metro_group']

# ---- Hills: height from the road network, shaded
zs = np.zeros((H, W)); ws = np.zeros((H, W))
for nd in D['nodes']:
    if nd[2]: continue
    i, j = ij(nd[0], nd[1])
    if 0 <= i < H and 0 <= j < W: zs[i, j] += nd[7]; ws[i, j] += 1
hm = ndimage.gaussian_filter(zs, 14) / np.maximum(ndimage.gaussian_filter(ws, 14), 1e-6)
hm = ndimage.gaussian_filter(hm, 3)
gy, gx = np.gradient(hm, R)
az, alt = math.radians(315), math.radians(40)
slope = np.arctan(np.hypot(gx, gy) * 1.6); aspect = np.arctan2(-gx, gy)
shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
shade = np.clip((shade - shade[land].mean()) * 1.3 + 0.5, 0, 1)
hnorm = np.clip(hm / 650, 0, 1)[..., None]
low = np.array([30, 43, 34], float); mid = np.array([44, 52, 38], float); high = np.array([66, 62, 52], float)
base = np.where(hnorm < 0.35, low + (mid - low) * (hnorm / 0.35), mid + (high - mid) * ((hnorm - 0.35) / 0.65))
# Land cover by area, so the map reads at a glance: desert, forest, farmland,
# beach, city.
cover = {
  'desert': (['Grand Senora Desert', 'Sandy Shores', 'Harmony', 'Redwood Lights Track', 'Davis Quartz', 'Stab City', 'Ron Alternates Wind Farm', 'Bolingbroke Penitentiary'], (1.35, 1.12, 0.78)),
  'forest': (['Paleto Forest', 'Raton Canyon', 'Chiliad Mountain State Wilderness', 'Mount Josiah', 'Cassidy Creek', 'North Chumash', 'Tongva Valley', 'Paleto Cove', 'Braddock Pass'], (0.78, 1.08, 0.82)),
  'farm': (['Grapeseed', 'Great Chaparral', 'Galilee'], (1.05, 1.25, 0.8)),
  'beach': (['Vespucci Beach', 'Del Perro Beach', 'Procopio Beach', 'Chumash'], (1.45, 1.3, 1.0)),
  'city': ([z for z in ['Pillbox Hill', 'Downtown', 'Legion Square', 'Mission Row', 'Textile City', 'Strawberry', 'Davis', 'Rancho', 'Chamberlain Hills',
            'La Mesa', 'Mirror Park', 'East Vinewood', 'West Vinewood', 'Downtown Vinewood', 'Vinewood', 'Alta', 'Hawick', 'Burton', 'Rockford Hills',
            'Little Seoul', 'Vespucci', 'Vespucci Canals', 'Del Perro', 'Morningwood', 'Richards Majestic', 'La Puerta', 'Banning', 'Cypress Flats',
            'Elysian Island', 'Terminal', 'Port of South Los Santos', 'Murrieta Heights', 'El Burro Heights', 'Maze Bank Arena',
            'Los Santos International Airport', 'Paleto Bay']], (1.08, 1.04, 1.1)),
  'golf': (['GWC and Golfing Society'], (0.85, 1.35, 0.85)),
}
tint = np.ones((H, W, 3))
for _, (names_, mult) in cover.items():
    for nm in names_:
        if nm in order:
            m = owner == order.index(nm)
            tint[m] = mult
tint = np.stack([ndimage.gaussian_filter(tint[..., c], 4) for c in range(3)], axis=-1)
base = base * tint
col = np.clip(base * (0.55 + 0.9 * shade[..., None]), 0, 255)
from PIL import Image
rgba = np.zeros((H, W, 4), np.uint8)
rgba[..., :3] = col.astype(np.uint8)
rgba[..., 3] = (ndimage.gaussian_filter(land.astype(float), 1) * 255).astype(np.uint8)
Image.fromarray(rgba).save(shade_png, 'WEBP', quality=82, method=6)

# Height lines every 50 m (worked out from road heights, so approximate)
contours = []
hm_land = np.where(land, hm, np.nan)
for lev in range(50, 800, 50):
    for c in measure.find_contours(np.nan_to_num(hm_land, nan=-50), lev):
        if len(c) < 25: continue
        c = measure.approximate_polygon(c, 1.2)
        pts = to_world(c)
        contours.append(('M' + ' '.join(f'{x},{-y}' for x, y in pts), lev))
contour_minor = ''.join(p_ for p_, lev in contours if lev % 200)
contour_major = ''.join(p_ for p_, lev in contours if lev % 200 == 0)

# ---- City blocks: the spaces between streets in built-up areas
RB = 4.0
WB, HB = int((X1 - X0) / RB), int((Y1 - Y0) / RB)
def ijb(x, y): return ((Y1 - np.asarray(y)) / RB).astype(int), ((np.asarray(x) - X0) / RB).astype(int)
def markb(grid, line):
    for (x0, y0), (x1, y1) in zip(line[:-1], line[1:]):
        n = int(max(abs(x1 - x0), abs(y1 - y0)) / RB) + 1
        i, j = ijb(np.linspace(x0, x1, n), np.linspace(y0, y1, n))
        ok = (i >= 0) & (i < HB) & (j >= 0) & (j < WB); grid[i[ok], j[ok]] = True
road_px = np.zeros((HB, WB), bool)
half = {'freeway': 12, 'major': 7, 'minor': 5, 'dirt': 3}
for c, lines in road_lines.items():
    g = np.zeros((HB, WB), bool)
    for l in lines: markb(g, l)
    road_px |= ndimage.binary_dilation(g, structure=morphology.disk(max(1, int(half[c] / RB))))
urban_names = set(cover['city'][0]) | {'Sandy Shores', 'Paleto Bay', 'Grapeseed', 'Harmony', 'Vinewood Hills', 'Richman', 'Richman Glen', 'Pacific Bluffs', 'Chumash', 'Banham Canyon', 'Tataviam Mountains', 'Stab City', 'East Vinewood', 'Murrieta Heights'}
urban = np.zeros((H, W), bool)
for nm in urban_names:
    if nm in order: urban |= owner == order.index(nm)
urban_b = np.kron(urban, np.ones((int(R / RB) + 0, int(R / RB) + 0), bool)) if R % RB == 0 else None
from skimage.transform import resize as _resize
urban_b = _resize(urban.astype(float), (HB, WB), order=0) > 0.5
land_b = _resize(land.astype(float), (HB, WB), order=0) > 0.5
free_px = ~road_px & urban_b & land_b
lab_b, nb = ndimage.label(free_px)
sizes_b = ndimage.sum(np.ones_like(lab_b), lab_b, range(1, nb + 1)) * RB * RB
keep = np.zeros(nb + 1, bool)
keep[1:] = (sizes_b > 900) & (sizes_b < 260000)
blocks = keep[lab_b]
blocks = ndimage.binary_erosion(blocks, structure=morphology.disk(1))
blocks = ndimage.binary_opening(blocks, structure=morphology.disk(1))
block_cells = {}
for c in measure.find_contours(np.pad(blocks, 1).astype(float), 0.5):
    c = c - 1
    if len(c) < 6: continue
    c = measure.approximate_polygon(c, 0.9)
    pts = [(X0 + (p_[1] + 0.5) * RB, Y1 - (p_[0] + 0.5) * RB) for p_ in c]
    cx, cy = np.mean(pts, axis=0)
    k = cell_of(cx, cy)
    block_cells[k] = block_cells.get(k, '') + 'M' + ' '.join(f'{int(x)},{int(-y)}' for x, y in pts) + 'Z'

# ---- Rivers and canals: boat routes inland
water_lines = []
bo = defaultdict(lambda: defaultdict(set))
for s_ in D['segs']:
    if not s_[4] or abs(s_[0] - s_[2]) + abs(s_[1] - s_[3]) > 400: continue
    a = (round(s_[0]), round(s_[1])); b = (round(s_[2]), round(s_[3]))
    i0, j0 = ij(*a); i1, j1 = ij(*b)
    if not (0 <= i0 < H and 0 <= j0 < W and 0 <= i1 < H and 0 <= j1 < W): continue
    if land[i0, j0] and land[i1, j1] and a != b: bo['w'][a].add(b); bo['w'][b].add(a)
rivers = whole(chains(bo['w']), 6) if bo['w'] else ''

# ---- Land use from the game's ambient zones (parks, golf, docks, quarry...)
amb = _j.load(open(os.path.join(dumps_dir, 'ambientZones.json')))
LU = [('park', r'downtown_park|richman_park|rockford_park'), ('industry', r'construction_site|port_cranes|docks_01|ls_docks|port_n$|port_se$|port_w$|factory_area'),
      ('quarry', r'quarry'), ('farm', r'fields_01|vineyard_field|grapeseed_ranch'), ('airport', r'airport_area|big_zones_airport')]
import re as _re
landuse = []
for z_ in amb:
    nm = z_['Name'].lower()
    if z_['Shape'] != 'Box' or nm.startswith('az_dlc_h4') or nm.startswith('az_yankton'): continue
    for cat, rx in LU:
        if _re.search(rx, nm):
            px_, py_ = z_['OuterPosition']['X'], z_['OuterPosition']['Y']; sx, sy = z_['OuterSize']['X'] / 2, z_['OuterSize']['Y'] / 2
            if X0 < px_ < X1 and Y0 < py_ < Y1:
                landuse.append([cat, round(px_ - sx), round(-(py_ + sy)), round(sx * 2), round(sy * 2)])
            break
# fields from crop locations
hf = _j.load(open(os.path.join(dumps_dir, 'objectslocations', 'worldHarvestFields.json')))
fg = np.zeros((H, W), bool)
for f_ in hf:
    i, j = ij(f_['Position']['X'], f_['Position']['Y'])
    if 0 <= i < H and 0 <= j < W: fg[i, j] = True
fg = ndimage.binary_closing(ndimage.binary_dilation(fg, structure=disk(30)), structure=disk(40)) & land
fields_path = path(padded_contours(fg), 10)

# ---- Small things for close up: ATMs, bus stops, oil pumps
def pts_of(fname):
    try: return [(o['Position']['X'], o['Position']['Y']) for o in _j.load(open(os.path.join(dumps_dir, 'objectslocations', fname)))]
    except Exception: return []
for x, y in pts_of('worldAtms.json'): pois.append(['atm', 'ATM', round(x), round(y)])
for x, y in pts_of('worldBusStops.json'): pois.append(['bus', 'Bus stop', round(x), round(y)])
oil = []
for x, y in pts_of('worldOilJacks.json'):
    for c in oil:
        if (c[0] / c[2] - x) ** 2 + (c[1] / c[2] - y) ** 2 < 150 ** 2: c[0] += x; c[1] += y; c[2] += 1; break
    else: oil.append([x, y, 1])
for c in oil: pois.append(['oil', 'Oil field', round(c[0] / c[2]), round(c[1] / c[2])])
pois = [p_ for p_ in pois if X0 < p_[2] < X1 and Y0 < p_[3] < Y1]

data = {'land': land_path, 'zones': zones, 'roads': roads_out, 'streets': streets, 'pois': pois, 'rails': rails_path, 'contours': [contour_minor, contour_major],
        'bounds': [X0, Y0, X1, Y1], 'cell': CELL, 'roadsLo': roads_lo, 'blocks': block_cells, 'rivers': rivers, 'landuse': landuse, 'fields': fields_path}
_j.dump({'streets': sorted(street_zone.keys()), 'streetZone': street_zone}, open(streets_json, 'w'), separators=(',', ':'))
js = '// Generated from GTA V game data (zone bounds and the road network), see\n// scripts/README. Coordinates are game-world metres; y is flipped (north up).\nwindow.NP_MAP_DATA = ' + json.dumps(data, separators=(',', ':')) + ';\n'
open(out_js, 'w').write(js)
print('bytes', len(js), 'zones', len(zones), {k: len(v) for k, v in roads_out.items()}, 'land', len(land_path))
