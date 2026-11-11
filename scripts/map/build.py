import json, pickle, sys, numpy as np
from scipy import ndimage
from skimage import measure, morphology
nodes_pkl, zones_json, out_js = sys.argv[1:4]
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
cls_of = lambda s: 'freeway' if s[5] else 'dirt' if (s[6] or s[7]) else 'major' if s[8] >= 3 else 'minor'
lines = defaultdict(list)
adj = defaultdict(lambda: defaultdict(set))
for s in D['segs']:
    if s[4] or abs(s[0] - s[2]) + abs(s[1] - s[3]) > 600: continue
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
roads_out = {}
for c, g in adj.items():
    parts = []
    for line in chains(g):
        pts = measure.approximate_polygon(np.array(line, float), {'freeway': 6, 'major': 5, 'minor': 4, 'dirt': 8}[c])
        parts.append('M' + ' '.join(f'{int(x)},{int(-y)}' for x, y in pts))
    roads_out[c] = ''.join(parts)
data = {'land': land_path, 'zones': zones, 'roads': roads_out}
js = '// Generated from GTA V game data (zone bounds and the road network), see\n// scripts/README. Coordinates are game-world metres; y is flipped (north up).\nwindow.NP_MAP_DATA = ' + json.dumps(data, separators=(',', ':')) + ';\n'
open(out_js, 'w').write(js)
print('bytes', len(js), 'zones', len(zones), {k: len(v) for k, v in roads_out.items()}, 'land', len(land_path))
