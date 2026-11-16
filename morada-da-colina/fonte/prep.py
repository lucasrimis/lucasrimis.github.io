"""Parse the OSM export of Morada da Colina and produce world data for the 3D game."""
import json, math, random, sys
import xml.etree.ElementTree as ET

SRC = sys.argv[1]
OUT = sys.argv[2]
DEM = sys.argv[3] if len(sys.argv) > 3 else None
random.seed(42)

root = ET.parse(SRC).getroot()
b = root.find('bounds')
minlat, maxlat = float(b.get('minlat')), float(b.get('maxlat'))
minlon, maxlon = float(b.get('minlon')), float(b.get('maxlon'))
lat0, lon0 = (minlat + maxlat) / 2, (minlon + maxlon) / 2
KX = 111320 * math.cos(math.radians(lat0))
KZ = 110540


def proj(lat, lon):
    return ((lon - lon0) * KX, -(lat - lat0) * KZ)


BX0, BZ0 = proj(maxlat, minlon)
BX1, BZ1 = proj(minlat, maxlon)

nodes = {}
named_nodes = []
for n in root.findall('node'):
    p = proj(float(n.get('lat')), float(n.get('lon')))
    nodes[n.get('id')] = p
    tags = {t.get('k'): t.get('v') for t in n.findall('tag')}
    if 'name' in tags:
        named_nodes.append((tags['name'], p))

# streets already recreated from Street View (Oct 2024)
REAL_STREETS = {'Rua Albert Sabin', 'Rua Darci de Carvalho', 'Rua Coronel José Fernando Bruno'}
# per-street style from Street View / satellite (Oct 2024)
DENSE = {'kind': 'dense', 'dens': 0.93}
STYLE = {
    'Rua Doutor Astor R. Ornellas': DENSE, 'Rua João Manoel M. Guedes Maneco': {'kind': 'dense', 'dens': 0.85},
    'Rua Nove A': DENSE, 'Rua Coronel Aviador Aurélio Machado': DENSE, 'Rua Sebastião Barroso da Silva': DENSE,
    'Rua Professora Anália Franco': DENSE, 'Rua Agenor Lopes Siqueira': DENSE, 'Rua Antônio Ramos': DENSE,
    'Rua Wandir de Carvalho': DENSE, 'Rua Vandir de Carvalho': {'kind': 'dense', 'dens': 0.8},
    'Rua Eurycliders de Jesus Zerbini': DENSE, 'Rua Silvio Mageste da Silva': {'kind': 'dense', 'dens': 0.85, 'cl': True},
    "Avenida Antenor O' Reilly de Souza Júnior": {'kind': 'dense', 'dens': 0.6},
    'Rua Maria Candida Vianna Moraes': {'kind': 'sparse', 'dens': 0.45}, 'Rua Doze': {'kind': 'sparse', 'dens': 0.5},
    'Rua Carlos Ferreira Pinto': {'kind': 'sparse', 'dens': 0.15}, 'Rua Professor Coronel Antônio Esteves': {'kind': 'sparse', 'dens': 0.1},
    'Via 7': {'kind': 'condo', 'dens': 0.85}, 'Via 8': {'kind': 'condo', 'dens': 0.85}, 'Via 9': {'kind': 'condo', 'dens': 0.85}, 'Via 12': {'kind': 'condo', 'dens': 0.85},
}
for _n in ('Rua Albert Sabin', 'Rua Darci de Carvalho', 'Rua Coronel José Fernando Bruno'): STYLE[_n] = DENSE
ROAD = {  # type: (half width of carriageway, sidewalk width)
    'secondary': (5.0, 2.5), 'secondary_link': (2.6, 0), 'residential': (3.6, 2.0),
    'living_street': (2.8, 1.2), 'service': (2.0, 0), 'unclassified': (2.6, 0),
    'footway': (0.9, 0),
}
roads, areas = [], []
for w in root.findall('way'):
    tags = {t.get('k'): t.get('v') for t in w.findall('tag')}
    pts = [nodes[nd.get('ref')] for nd in w.findall('nd') if nd.get('ref') in nodes]
    if len(pts) < 2:
        continue
    hw = tags.get('highway')
    if hw in ROAD:
        half, sw = ROAD[hw]
        if hw == 'secondary' and tags.get('oneway') == 'yes':
            half = 3.6
        if hw == 'residential' and tags.get('oneway') == 'yes':
            half = 3.2
        pave = False
        st = STYLE.get(tags.get('name')) or ({'kind': 'condo', 'dens': 0.85} if hw == 'living_street' else {'kind': 'sparse', 'dens': 0.6} if hw == 'residential' and not tags.get('name') else None)
        real = st is not None
        if tags.get('name') == 'Rua Albert Sabin':   # Street View (out/2024): bloquete, ~6 m, calçadas estreitas
            half, sw, pave = 3.0, 1.5, True
        elif real:                                   # Darci de Carvalho / Cel. José Fernando Bruno: asfalto, ~6.6 m
            half, sw = 3.3, 1.8
        roads.append({'id': w.get('id'), 't': hw, 'h': half, 'sw': sw, 'n': tags.get('name', ''),
                      'ring': tags.get('junction') == 'roundabout',
                      'dirt': tags.get('surface') == 'unpaved', 'pave': pave, 'real': real, 'st': st,
                      'pts': pts})
        continue
    kind = None
    if tags.get('natural') == 'water': kind = 'water'
    elif tags.get('natural') == 'wood': kind = 'wood'
    elif tags.get('leisure') == 'pitch': kind = 'pitch'
    elif tags.get('leisure') == 'park': kind = 'park'
    elif tags.get('amenity') == 'university': kind = 'uni'
    elif tags.get('building'): kind = 'building'
    elif tags.get('landuse') == 'grass': kind = 'grass'
    if kind and pts[0] == pts[-1]:
        areas.append({'t': kind, 'n': tags.get('name', ''), 'pts': pts[:-1]})

# ---------- elevation (GeoTIFF, WGS84, 1 arc-second) ----------
dem = None
if DEM:
    from PIL import Image
    import numpy as np
    im = Image.open(DEM)
    arr = np.array(im).astype(float)
    tie = im.tag_v2[33922]; scl = im.tag_v2[33550]
    dem = {'lon0': tie[3], 'lat0': tie[4], 'step': scl[0], 'rows': arr.shape[0], 'cols': arr.shape[1], 'a': arr}
    print('DEM', arr.shape, arr.min(), arr.max())

def H(x, z):
    if dem is None: return 0.0
    lon = x / KX + lon0; lat = -z / KZ + lat0
    c = (lon - dem['lon0']) / dem['step'] - 0.5; r = (dem['lat0'] - lat) / dem['step'] - 0.5
    c = min(max(c, 0), dem['cols'] - 1.001); r = min(max(r, 0), dem['rows'] - 1.001)
    i, j = int(r), int(c); fr, fc = r - i, c - j; a = dem['a']
    return a[i, j]*(1-fr)*(1-fc) + a[i, j+1]*(1-fr)*fc + a[i+1, j]*fr*(1-fc) + a[i+1, j+1]*fr*fc

# green strip with a creek between Rua Darci de Carvalho (515090114) and Rua Vandir de Carvalho (347965439)
byid = {r['id']: r for r in roads}
darci, vandir = byid['515090114']['pts'], byid['347965439']['pts']
strip_poly = vandir + darci
creek = []
def _resample(pts, n):
    L = [0]
    for a, bb in zip(pts, pts[1:]): L.append(L[-1] + math.hypot(bb[0]-a[0], bb[1]-a[1]))
    out = []
    for k in range(n + 1):
        s = L[-1] * k / n
        i = 1
        while i < len(L) - 1 and L[i] < s: i += 1
        t = (s - L[i-1]) / ((L[i] - L[i-1]) or 1)
        out.append((pts[i-1][0] + (pts[i][0]-pts[i-1][0]) * t, pts[i-1][1] + (pts[i][1]-pts[i-1][1]) * t))
    return out
dv = _resample(darci, 60); vv = _resample(vandir[::-1], 60)
for (ax, az), (bx, bz) in zip(dv, vv):
    # follow the valley floor: lowest point across the strip (keeping clear of the roads)
    best = None
    for k in range(12, 29):
        t = k / 40
        x, z = ax + (bx-ax)*t, az + (bz-az)*t
        hh = H(x, z) + abs(t - 0.5) * 1.5  # slight preference for the middle
        if best is None or hh < best[0]: best = (hh, t)
    t = best[1] if dem else 0.5
    creek.append((ax + (bx-ax)*t, az + (bz-az)*t))
# smooth the path
for _ in range(4):
    creek = [creek[0]] + [((creek[i-1][0]+2*creek[i][0]+creek[i+1][0])/4, (creek[i-1][1]+2*creek[i][1]+creek[i+1][1])/4) for i in range(1, len(creek)-1)] + [creek[-1]]
widths = [math.hypot(bx-ax, bz-az) for (ax, az), (bx, bz) in zip(dv, vv)]
print('strip width min/max', round(min(widths),1), round(max(widths),1))
areas.append({'t': 'strip', 'n': '', 'pts': strip_poly})

# roundabout centre island
for r in roads:
    if r['ring']:
        areas.append({'t': 'island', 'n': '', 'pts': r['pts'][:-1]})


# ---------- geometry helpers ----------
def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L = dx * dx + dz * dz
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / L))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz))


def in_poly(x, z, poly):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]; xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


# spatial grid for road segments
CELL = 25
seg_grid = {}
for ri, r in enumerate(roads):
    reach = r['h'] + r['sw']
    for a, bb in zip(r['pts'], r['pts'][1:]):
        x0, x1 = sorted([a[0], bb[0]]); z0, z1 = sorted([a[1], bb[1]])
        for gx in range(int(math.floor((x0 - reach - 20) / CELL)), int(math.floor((x1 + reach + 20) / CELL)) + 1):
            for gz in range(int(math.floor((z0 - reach - 20) / CELL)), int(math.floor((z1 + reach + 20) / CELL)) + 1):
                seg_grid.setdefault((gx, gz), []).append((a, bb, reach))


def road_clear(x, z, margin):
    for a, bb, reach in seg_grid.get((int(math.floor(x / CELL)), int(math.floor(z / CELL))), []):
        if seg_dist(x, z, a[0], a[1], bb[0], bb[1]) < reach + margin:
            return False
    return True


def road_dist(x, z):
    best = 1e9
    for a, bb, reach in seg_grid.get((int(math.floor(x / CELL)), int(math.floor(z / CELL))), []):
        best = min(best, seg_dist(x, z, a[0], a[1], bb[0], bb[1]) - reach)
    return best


blockers = [a['pts'] for a in areas if a['t'] in ('water', 'wood', 'pitch', 'park', 'uni', 'building', 'island', 'strip')]


def area_clear(x, z):
    return not any(in_poly(x, z, p) for p in blockers)


def in_bounds(x, z, m=4):
    return BX0 + m < x < BX1 - m and BZ0 + m < z < BZ1 - m


def rect_corners(cx, cz, w, d, ang):
    c, s = math.cos(ang), math.sin(ang)
    out = []
    for u, v in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        out.append((cx + u * c - v * s, cz + u * s + v * c))
    return out


def sat_overlap(A, B):
    for poly in (A, B):
        for i in range(4):
            ax, az = poly[i]; bx, bz = poly[(i + 1) % 4]
            nx, nz = -(bz - az), bx - ax
            pa = [nx * p[0] + nz * p[1] for p in A]
            pb = [nx * p[0] + nz * p[1] for p in B]
            if max(pa) < min(pb) or max(pb) < min(pa):
                return False
    return True


occ_grid = {}  # placed rectangles


def rect_free(corners, pad=0):
    cx = sum(p[0] for p in corners) / 4; cz = sum(p[1] for p in corners) / 4
    gx, gz = int(cx // 20), int(cz // 20)
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for other in occ_grid.get((gx + dx, gz + dz), []):
                if sat_overlap(corners, other):
                    return False
    return True


def occupy(corners):
    cx = sum(p[0] for p in corners) / 4; cz = sum(p[1] for p in corners) / 4
    occ_grid.setdefault((int(cx // 20), int(cz // 20)), []).append(corners)


def rect_ok(corners, road_margin):
    for (x, z) in corners + [(sum(p[0] for p in corners) / 4, sum(p[1] for p in corners) / 4)]:
        if not in_bounds(x, z) or not road_clear(x, z, road_margin) or not area_clear(x, z):
            return False
    # edge midpoints too
    for i in range(4):
        x = (corners[i][0] + corners[(i + 1) % 4][0]) / 2
        z = (corners[i][1] + corners[(i + 1) % 4][1]) / 2
        if not road_clear(x, z, road_margin):
            return False
    return True


# ---------- houses ----------
houses = []
poles = []
# ---------- Rua Albert Sabin, based on Street View (Oct 2024) ----------
# dense lots, walls/gradis on the property line, many sobrados, some geminadas, solar panels,
# a grassy empty lot on the north side at the start of the long SE straight
WALL_IDX = {'amarelo': 1, 'creme': 0, 'pessego': 2, 'rosa': 3, 'verde': 5, 'branco': 6, 'amarelo2': 7, 'terracota': 8}
weed_lot = proj(-22.48612, -44.47790)
_b0 = proj(-22.48705, -44.47562); _brg = math.radians(127)
grass_bank = (_b0[0] + math.sin(_brg) * 13, _b0[1] - math.cos(_brg) * 13)
J = proj(-22.48722, -44.47576)
_bu, _bv = math.radians(30), math.radians(300)
UDIR = (math.sin(_bu), -math.cos(_bu)); VDIR = (math.sin(_bv), -math.cos(_bv))
corner_c = (J[0] + (UDIR[0] + VDIR[0]) * 17, J[1] + (UDIR[1] + VDIR[1]) * 17)
EMPTY = [(weed_lot, 16), (grass_bank, 16), (corner_c, 17), (proj(-22.48858, -44.47548), 20), (proj(-22.48822, -44.47708), 20)]
for r in roads:
    if not r.get('real'):
        continue
    pts = r['pts']
    for a, bb in zip(pts, pts[1:]):
        L = math.hypot(bb[0] - a[0], bb[1] - a[1])
        if L < 6: continue
        ux, uz = (bb[0] - a[0]) / L, (bb[1] - a[1]) / L
        ang = math.atan2(uz, ux)
        for side in (-1, 1):
            nx, nz = -uz * side, ux * side
            t = random.uniform(1, 3)
            st = r['st']; condo = st['kind'] == 'condo'
            while t < L - 3:
                if random.random() > st['dens']:   # empty lot
                    t += random.uniform(10, 16); continue
                pair = (not condo) and random.random() < (0.18 if st['kind'] == 'dense' else 0.05)
                w = 6.5 if pair else random.choice([13, 14, 15, 16, 17]) if condo else random.choice([8, 9, 10, 10, 11, 12])
                d = random.choice([12, 13, 14, 15]) if condo else random.choice([9, 10, 11, 12])
                setback = random.uniform(5, 7.5) if condo else random.uniform(2.2, 4.5)
                off = r['h'] + r['sw'] + setback + d / 2
                cx = a[0] + ux * t + nx * off; cz = a[1] + uz * t + nz * off
                if any(math.hypot(cx - p[0], cz - p[1]) < rr for p, rr in EMPTY):
                    t += 3; continue
                corners = rect_corners(cx, cz, w, d, ang)
                if rect_ok(corners, 0.6) and rect_free(rect_corners(cx, cz, w + 0.8, d + 1, ang)):
                    occupy(corners)
                    floors = 2 if (pair or random.random() < (0.7 if condo else 0.5 if st['kind'] == 'dense' else 0.3)) else 1
                    col = random.randrange(10)
                    face = math.atan2(-nz, -nx)
                    flags = (1 if random.random() < (0.45 if condo else 0.3) else 0) | (2 if random.random() < 0.6 else 0) | 4 | \
                            (8 if floors == 2 and random.random() < 0.6 else 0) | (16 if (not condo) and random.random() < 0.35 else 0) | (32 if condo else 0)
                    pool = 0; ppx = ppz = 0; pw_, pd_ = 4, 7
                    if random.random() < (0.6 if condo else 0.2):   # piscina no fundo do lote
                        pw_, pd_ = random.choice([(4, 8), (5, 9), (4, 7)]) if condo else random.choice([(3, 6), (3.5, 6), (4, 7)])
                        poff = r['h'] + r['sw'] + setback + d + 2.5 + pw_ / 2
                        ppx, ppz = a[0] + ux * t - (-uz * side) * 0 + nx * poff, a[1] + uz * t + nz * poff
                        pc = rect_corners(ppx, ppz, pd_, pw_, ang)
                        if rect_ok(pc, 1) and rect_free(pc): occupy(pc); pool = 1
                    houses.append([round(cx, 1), round(cz, 1), w, d, round(ang, 3), floors, col, random.choice([2, 2, 3, 0]) if condo else random.choice([0, 0, 0, 1, 2]), pool,
                                   round(ppx, 1), round(ppz, 1), pw_, pd_, round(face, 3), random.randrange(1000), flags, round(setback - 0.15, 2)])
                    if pair:  # geminada: twin attached on the side, same colour
                        cx2 = cx + ux * w; cz2 = cz + uz * w
                        c2 = rect_corners(cx2, cz2, w, d, ang)
                        if rect_ok(c2, 0.6) and rect_free(rect_corners(cx2, cz2, w - 0.2, d, ang)):
                            occupy(c2)
                            houses.append([round(cx2, 1), round(cz2, 1), w, d, round(ang, 3), 2, col, houses[-1][7], 0,
                                           0, 0, 4, 7, round(face, 3), houses[-1][14], flags, round(setback - 0.15, 2)])
                            t += w
                    t += w + random.uniform(0.4, 1.4)
                else:
                    t += 2
    # utility poles with wires, every ~32 m on the left-hand side
    acc = 0; first = True
    for a, bb in zip(pts, pts[1:]):
        L = math.hypot(bb[0] - a[0], bb[1] - a[1])
        if L < 0.5: continue
        ux, uz = (bb[0] - a[0]) / L, (bb[1] - a[1]) / L
        t = 10 if first else (32 - acc) % 32
        first = False
        while t < L:
            off = r['h'] + 0.6
            px_, pz_ = a[0] + ux * t - uz * off, a[1] + uz * t + ux * off
            ok = True
            for r2 in roads:
                if r2 is r: continue
                for a2, b2 in zip(r2['pts'], r2['pts'][1:]):
                    if seg_dist(px_, pz_, a2[0], a2[1], b2[0], b2[1]) < r2['h'] + r2['sw'] + 0.3: ok = False; break
                if not ok: break
            if ok: poles.append([round(px_, 1), round(pz_, 1)])
            t += 32
        acc = (acc + L) % 32
landmarks_pre = [{'type': 'weedlot', 'x': round(weed_lot[0], 1), 'z': round(weed_lot[1], 1)},
                 {'type': 'weedlot', 'x': round(grass_bank[0], 1), 'z': round(grass_bank[1], 1)},
                 {'type': 'esquina', 'x': round(J[0], 2), 'z': round(J[1], 2), 'u': [round(UDIR[0], 4), round(UDIR[1], 4)], 'v': [round(VDIR[0], 4), round(VDIR[1], 4)]}]
# bloquete stretch where Darci, Cel. Bruno and Albert Sabin meet
pave_zones = [[*[round(v, 1) for v in proj(-22.48680, -44.47525)], 50]]

for r in roads:
    if r['t'] not in ('residential', 'living_street') or r.get('real'):
        continue
    pts = r['pts']
    for a, bb in zip(pts, pts[1:]):
        L = math.hypot(bb[0] - a[0], bb[1] - a[1])
        if L < 6:
            continue
        ux, uz = (bb[0] - a[0]) / L, (bb[1] - a[1]) / L
        ang = math.atan2(uz, ux)
        for side in (-1, 1):
            nx, nz = -uz * side, ux * side
            t = random.uniform(2, 7)
            while t < L - 3:
                w = random.choice([8, 9, 10, 11, 12, 13])
                d = random.choice([8, 9, 10, 11, 12])
                setback = random.uniform(3, 6)
                off = r['h'] + r['sw'] + setback + d / 2
                cx = a[0] + ux * t + nx * off
                cz = a[1] + uz * t + nz * off
                corners = rect_corners(cx, cz, w, d, ang)
                if rect_ok(corners, 1.5) and rect_free(rect_corners(cx, cz, w + 3, d + 2, ang)):
                    occupy(corners)
                    floors = 2 if random.random() < 0.35 else 1
                    pool = 0
                    # pool behind the house (away from the street)
                    pw, pd = random.choice([(4, 7), (4, 8), (5, 8), (3.5, 6)])
                    poff = off + d / 2 + 2.5 + pw / 2
                    px, pz = a[0] + ux * t + nx * poff, a[1] + uz * t + nz * poff
                    pc = rect_corners(px, pz, pd, pw, ang)
                    if random.random() < 0.4 and rect_ok(pc, 1) and rect_free(pc):
                        occupy(pc)
                        pool = 1
                    # facing: front of house points toward road (-n)
                    face = math.atan2(-nz, -nx)
                    houses.append([round(cx, 1), round(cz, 1), w, d, round(ang, 3), floors,
                                   random.randrange(8), random.randrange(4), pool,
                                   round(px, 1), round(pz, 1), pw, pd, round(face, 3), random.randrange(1000)])
                    t += w + random.uniform(3, 6)
                else:
                    t += 2.5

# campus buildings in the university area (generic blocks)
for a in areas:
    if a['t'] == 'uni':
        xs = [p[0] for p in a['pts']]; zs = [p[1] for p in a['pts']]
        cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)

# ---------- trees ----------
trees = []
tree_occ = {}


def tree_free(x, z, rad):
    gx, gz = int(x // 10), int(z // 10)
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for (tx, tz, tr) in tree_occ.get((gx + dx, gz + dz), []):
                if math.hypot(tx - x, tz - z) < (rad + tr) * 0.8:
                    return False
    return True


def house_hit(x, z, rad):
    probe = rect_corners(x, z, rad * 2, rad * 2, 0)
    return not rect_free(probe)


def add_tree(x, z, kind, size):
    rad = size * 1.3
    if not tree_free(x, z, rad) or house_hit(x, z, rad * 0.6):
        return False
    tree_occ.setdefault((int(x // 10), int(z // 10)), []).append((x, z, rad))
    trees.append([round(x, 1), round(z, 1), kind, round(size, 2)])
    return True


def fill_poly(poly, spacing, kind_fn, road_margin=1.0, prob=1.0, wbounds=True):
    xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
    x = min(xs)
    while x < max(xs):
        z = min(zs)
        while z < max(zs):
            jx = x + random.uniform(-spacing * .45, spacing * .45)
            jz = z + random.uniform(-spacing * .45, spacing * .45)
            if random.random() < prob and in_poly(jx, jz, poly) and road_clear(jx, jz, road_margin) \
                    and (not wbounds or in_bounds(jx, jz, -60)):
                k, s = kind_fn()
                add_tree(jx, jz, k, s)
            z += spacing
        x += spacing


water = [a['pts'] for a in areas if a['t'] == 'water']
for a in areas:
    if a['t'] == 'wood':
        fill_poly(a['pts'], 5.0, lambda: (random.choice([0, 0, 1, 2]), random.uniform(0.9, 1.6)))
    elif a['t'] == 'park' and 'Bosque' in a['n']:
        fill_poly(a['pts'], 5.5, lambda: (random.choice([0, 1, 2]), random.uniform(0.9, 1.5)))
    elif a['t'] == 'park':
        fill_poly(a['pts'], 16, lambda: (random.choice([0, 1, 3]), random.uniform(0.8, 1.3)), prob=0.6)

# riparian trees on both sides of the creek
for i in range(len(creek) - 1):
    ax, az = creek[i]; bx, bz = creek[i+1]
    L = math.hypot(bx-ax, bz-az)
    if L < 0.1: continue
    ux, uz = (bx-ax)/L, (bz-az)/L
    t = 0
    while t < L:
        for side in (-1, 1):
            for rowoff in (3.5, 7.5, 11.5):
                off = side * (rowoff + random.uniform(-1.2, 1.2))
                x = ax + ux*t - uz*off; z = az + uz*t + ux*off
                if road_clear(x, z, 1.5) and in_poly(x, z, strip_poly) and random.random() < 0.85:
                    add_tree(x, z, random.choice([0, 0, 0, 1, 2, 2, 2, 4]), random.uniform(0.9, 1.4))
        t += random.uniform(3.5, 5.5)

# palms around the lake
for poly in water:
    for i in range(len(poly)):
        ax, az = poly[i]; bx, bz = poly[(i + 1) % len(poly)]
        cx = sum(p[0] for p in poly) / len(poly); cz = sum(p[1] for p in poly) / len(poly)
        L = math.hypot(bx - ax, bz - az)
        t = 0
        while t < L:
            px, pz = ax + (bx - ax) * t / L, az + (bz - az) * t / L
            dx, dz = px - cx, pz - cz; dl = math.hypot(dx, dz)
            px += dx / dl * 5; pz += dz / dl * 5
            if road_clear(px, pz, 1) and random.random() < 0.7:
                add_tree(px, pz, 3, random.uniform(0.9, 1.2))
            t += 9

# street trees
for r in roads:
    if r['t'] not in ('residential', 'secondary', 'living_street'):
        continue
    pts = r['pts']
    for a, bb in zip(pts, pts[1:]):
        L = math.hypot(bb[0] - a[0], bb[1] - a[1])
        if L < 4: continue
        ux, uz = (bb[0] - a[0]) / L, (bb[1] - a[1]) / L
        for side in (-1, 1):
            nx, nz = -uz * side, ux * side
            t = random.uniform(3, 15)
            while t < L - 2:
                off = r['h'] + max(r['sw'], 1.0) + 1.8
                x, z = a[0] + ux * t + nx * off, a[1] + uz * t + nz * off
                if in_bounds(x, z, -20) and road_clear(x, z, 0.8) and area_clear(x, z) and random.random() < 0.45:
                    add_tree(x, z, random.choice([1, 2, 4]), random.uniform(0.7, 1.0))
                t += random.uniform(14, 26)

# backyard trees
for h in houses:
    cx, cz, w, d, ang = h[0], h[1], h[2], h[3], h[4]
    face = h[13]
    for _ in range(2):
        if random.random() < 0.55:
            back = d / 2 + random.uniform(3, 8)
            lat = random.uniform(-w / 2, w / 2)
            x = cx - math.cos(face) * back + math.cos(face + math.pi / 2) * lat
            z = cz - math.sin(face) * back + math.sin(face + math.pi / 2) * lat
            if in_bounds(x, z) and road_clear(x, z, 1.5) and area_clear(x, z):
                add_tree(x, z, random.choice([0, 1, 2, 3, 4]), random.uniform(0.7, 1.1))

# scattered vegetation on empty land (hillside)
x = BX0 - 40
while x < BX1 + 40:
    z = BZ0 - 40
    while z < BZ1 + 40:
        jx, jz = x + random.uniform(-5, 5), z + random.uniform(-5, 5)
        rd = road_dist(jx, jz)
        if rd > 14 and area_clear(jx, jz) and random.random() < 0.55:
            add_tree(jx, jz, random.choice([0, 0, 1, 2, 2]), random.uniform(0.8, 1.4))
        z += 11
    x += 11

# ---------- lamps along the avenue ----------
lamps = []
for r in roads:
    if r['t'] != 'secondary': continue
    pts = r['pts']; acc = 0
    for a, bb in zip(pts, pts[1:]):
        L = math.hypot(bb[0] - a[0], bb[1] - a[1])
        if L < 1: continue
        ux, uz = (bb[0] - a[0]) / L, (bb[1] - a[1]) / L
        t = (30 - acc) % 30
        while t < L:
            nx, nz = -uz, ux
            off = r['h'] + 1.2
            lamps.append([round(a[0] + ux * t + nx * off, 1), round(a[1] + uz * t + nz * off, 1), round(math.atan2(-nz, -nx), 2)])
            t += 30
        acc = (acc + L) % 30

# ---------- spawn: closest road point to the neighbourhood node ----------
target = next((p for n, p in named_nodes if n == 'Morada da Colina'), (0, 0))
best = None
for r in roads:
    if r['t'] not in ('residential',): continue
    for a, bb in zip(r['pts'], r['pts'][1:]):
        for k in range(11):
            x = a[0] + (bb[0] - a[0]) * k / 10; z = a[1] + (bb[1] - a[1]) * k / 10
            dd = math.hypot(x - target[0], z - target[1])
            if best is None or dd < best[0]:
                best = (dd, x, z)

# ---------- remove houses generated inside small grass islands (e.g. roundabout centre) ----------
grass_polys = [a['pts'] for a in areas if a['t'] == 'grass']
houses = [h for h in houses if not any(in_poly(h[0], h[1], g) for g in grass_polys)]

# ---------- landmark: guarita "SEGURANÇA" on the median between Av. Antenor O'Reilly and RJ-161 ----------
def _nearest(pts, x, z):
    best = None
    for a, bb in zip(pts, pts[1:]):
        dx, dz = bb[0]-a[0], bb[1]-a[1]; L = dx*dx + dz*dz
        t = max(0, min(1, ((x-a[0])*dx + (z-a[1])*dz) / L))
        px, pz = a[0]+t*dx, a[1]+t*dz; dd = math.hypot(x-px, z-pz)
        if best is None or dd < best[0]: best = (dd, px, pz, math.atan2(dz, dx))
    return best
landmarks = []
ant = min((_nearest(r['pts'], 222, -418) for r in roads if r['n'].startswith('Avenida Antenor')), key=lambda b: b[0])
dar = min((_nearest(r['pts'], 222, -418) for r in roads if r['n'].startswith('Avenida Professor Darcy')), key=lambda b: b[0])
nx, nz = dar[1]-ant[1], dar[2]-ant[2]; nl = math.hypot(nx, nz); nx /= nl; nz /= nl   # from Antenor towards the RJ-161
gx, gz = ant[1] + nx*8.6, ant[2] + nz*8.6
front = math.atan2(-nz, -nx)            # the booth faces Av. Antenor O'Reilly
landmarks.append({'type': 'guarita', 'x': round(gx, 2), 'z': round(gz, 2), 'front': round(front, 4)})
trees = [t for t in trees if math.hypot(t[0]-gx, t[1]-gz) > 8]
print('guarita at', round(gx, 1), round(gz, 1), 'median width', round(nl, 1))

# ---------- landmark: Parque Colina (campo, vôlei de areia, parquinho) + igreja ----------
ana = [r for r in roads if r['n'].startswith('Rua Professora An')][0]['pts']
SW, NW = ana[1], ana[0]
conn = [r for r in roads if r['n'] == '' and r['t'] == 'residential' and r['pts'][0] == SW]
SE = conn[0]['pts'][-1]
ux, uz = NW[0]-SW[0], NW[1]-SW[1]; L = math.hypot(ux, uz); ux /= L; uz /= L
pang = math.atan2(uz, ux)
vx, vz = -math.sin(pang), math.cos(pang)          # frame az
Wd = (SE[0]-SW[0])*vx + (SE[1]-SW[1])*vz
def park_local(x, z):
    dx, dz = x - SW[0], z - SW[1]
    return dx*ux + dz*uz, dx*vx + dz*vz
def in_park(x, z, m=0):
    u, v = park_local(x, z)
    return 2 - m < u < L - 2 + m and 2 - m < v < 44.5 + m
before = len(houses)
def house_in_park(h):
    c, s_ = math.cos(h[4]), math.sin(h[4])
    pts = [(h[0], h[1])] + [(h[0]+uu*c-vv*s_, h[1]+uu*s_+vv*c) for uu, vv in ((-h[2]/2, -h[3]/2), (h[2]/2, -h[3]/2), (h[2]/2, h[3]/2), (-h[2]/2, h[3]/2))]
    return any(in_park(x, z) for x, z in pts)
houses = [h for h in houses if not house_in_park(h)]
trees = [t for t in trees if not in_park(t[0], t[1], 1)]
# the whole block is park + pitch + church: no houses, no generated trees
def in_block(x, z):
    u, v = park_local(x, z); return 1 < u < L - 1 and 1 < v < Wd - 1
def house_in_block(h):
    c, s_ = math.cos(h[4]), math.sin(h[4])
    pts = [(h[0], h[1])] + [(h[0]+uu*c-vv*s_, h[1]+uu*s_+vv*c) for uu, vv in ((-h[2]/2, -h[3]/2), (h[2]/2, -h[3]/2), (h[2]/2, h[3]/2), (-h[2]/2, h[3]/2))]
    return any(in_block(x, z) for x, z in pts)
houses = [h for h in houses if not house_in_block(h)]
trees = [t for t in trees if not in_block(t[0], t[1])]
landmarks.append({'type': 'parque', 'x': SW[0], 'z': SW[1], 'ang': round(pang, 5), 'L': round(L, 2), 'W': round(Wd, 2)})
print('parque: removed houses', before - len(houses), 'L', round(L, 1), 'W', round(Wd, 1))

# ---- sobrado da esquina Darci de Carvalho x Cel. José Fernando Bruno (Street View 10/2024) ----
_dc = [r for r in roads if r['n'] == 'Rua Darci de Carvalho']; _cb = [r for r in roads if r['n'] == 'Rua Coronel José Fernando Bruno']
J9 = min(((p, q) for r1 in _dc for p in r1['pts'] for r2 in _cb for q in r2['pts']), key=lambda pq: math.hypot(pq[0][0] - pq[1][0], pq[0][1] - pq[1][1]))[0]
def _arm(rs, pick):  # unit directions of the arms leaving J9
    out = []
    for r1 in rs:
        P_ = r1['pts']
        for k, p in enumerate(P_):
            if math.hypot(p[0] - J9[0], p[1] - J9[1]) < 1:
                for q in ([P_[k - 1]] if k else []) + ([P_[k + 1]] if k + 1 < len(P_) else []):
                    L_ = math.hypot(q[0] - p[0], q[1] - p[1]); out.append(((q[0] - p[0]) / L_, (q[1] - p[1]) / L_))
    return max(out, key=pick)
A9 = _arm(_dc, lambda d: d[1])          # Darci descendo para SE (z+)
D9 = _arm(_cb, lambda d: -d[1])         # Cel. Bruno subindo para N (z-)
N9 = (-A9[1], A9[0]) if (-A9[1]) * D9[0] + A9[0] * D9[1] > 0 else (A9[1], -A9[0])
SD = (D9[0] * A9[0] + D9[1] * A9[1], D9[0] * N9[0] + D9[1] * N9[1])     # Cel. Bruno no frame (u, v)
SN = (SD[1], -SD[0]) if SD[1] * 10 - SD[0] * 0 > 0 else (-SD[1], SD[0])  # normal apontando para o lote (u+)
def _uv(x, z):
    dx, dz = x - J9[0], z - J9[1]; return dx * A9[0] + dz * A9[1], dx * N9[0] + dz * N9[1]
def in_lot9(x, z, m=0):
    u, v = _uv(x, z)
    return u < 24 + m and 4 - m < v < 25 + m and u * SN[0] + v * SN[1] > 4.5 - m
def _hcorners(h):
    c, s_ = math.cos(h[4]), math.sin(h[4])
    return [(h[0], h[1])] + [(h[0]+uu*c-vv*s_, h[1]+uu*s_+vv*c) for uu, vv in ((-h[2]/2, -h[3]/2), (h[2]/2, -h[3]/2), (h[2]/2, h[3]/2), (-h[2]/2, h[3]/2))]
_nb = len(houses)
houses = [h for h in houses if not any(in_lot9(x, z, 0.5) for x, z in _hcorners(h))]
trees = [t for t in trees if not in_lot9(t[0], t[1], 1)]
landmarks.append({'type': 'sobrado9', 'x': J9[0], 'z': J9[1], 'u': [round(A9[0], 4), round(A9[1], 4)], 'v': [round(N9[0], 4), round(N9[1], 4)],
                  'sd': [round(SD[0], 4), round(SD[1], 4)], 'sn': [round(SN[0], 4), round(SN[1], 4)]})
print('sobrado9 at', J9, 'removed houses', _nb - len(houses), 'SD', SD, 'SN', SN)
# ---- continuação do riacho: faixa de grama entre R. Carlos Ferreira Pinto e R. Eurycliders de Jesus Zerbini ----
# o riacho atravessa a R. Darci por um tubo de cimento e desce pelo meio da faixa até a R. Albert Sabin
_cf = next(r for r in roads if r['n'] == 'Rua Carlos Ferreira Pinto')['pts']; _ej = next(r for r in roads if r['n'] == 'Rua Eurycliders de Jesus Zerbini')['pts']
_A, _B = _cf[0], _cf[-1]                    # Albert Sabin -> Darci
_L = math.hypot(_B[0] - _A[0], _B[1] - _A[1]); _d = ((_B[0] - _A[0]) / _L, (_B[1] - _A[1]) / _L)
_C = _ej[-1]; _off = ((_C[0] - _A[0]) * -_d[1] + (_C[1] - _A[1]) * _d[0]) / 2     # meia largura (com sinal) até o eixo da faixa
_nrm = (-_d[1], _d[0])
def _mid(t):  # ponto no eixo da faixa, t em metros a partir da ponta da Albert Sabin
    return (_A[0] + _d[0] * t + _nrm[0] * _off, _A[1] + _d[1] * t + _nrm[1] * _off)
# limites da faixa: projeção das pontas das duas ruas
def _hit(rname):   # t onde o eixo da faixa cruza a rua
    best = None
    for r_ in roads:
        if r_['n'] != rname: continue
        for (ax, az), (bx, bz) in zip(r_['pts'], r_['pts'][1:]):
            m0 = _mid(-50); ex, ez = _d[0] * 200, _d[1] * 200; fx, fz = bx - ax, bz - az
            den = ex * fz - ez * fx
            if abs(den) < 1e-9: continue
            u = ((ax - m0[0]) * fz - (az - m0[1]) * fx) / den; w_ = ((ax - m0[0]) * ez - (az - m0[1]) * ex) / den
            if 0 <= u <= 1 and 0 <= w_ <= 1: t = -50 + u * 200; best = t if best is None else best
    return best
_t_as, _t_dc = _hit('Rua Albert Sabin'), _hit('Rua Darci de Carvalho')
_t0, _t1 = _t_as + 8.0, _t_dc - 7.5
creek2 = []
_n = max(2, int((_t1 - _t0) / 3.5))
for k in range(_n + 1):
    t = _t0 + (_t1 - _t0) * k / _n
    w = math.sin(t * 0.21) * 1.1 + math.sin(t * 0.47 + 1.3) * 0.5      # pequenas curvas
    m = _mid(t); creek2.append((m[0] + _nrm[0] * w, m[1] + _nrm[1] * w))
creek2 = creek2[::-1]   # nasce no tubo da Darci e desce para a Albert Sabin
def _cdist(x, z, pts):
    best = 1e9
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz or 1; t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L2))
        best = min(best, math.hypot(x - ax - dx * t, z - az - dz * t))
    return best
def in_strip2(x, z, m=0):
    t = (x - _A[0]) * _d[0] + (z - _A[1]) * _d[1]; v = (x - _A[0]) * _nrm[0] + (z - _A[1]) * _nrm[1]
    return _t_as + 3 - m < t < _t_dc - 3 + m and min(0, 2 * _off) + 2 - m < v < max(0, 2 * _off) - 2 + m
# tubos: um ligando ao riacho principal (sob a Darci), outro levando a água para baixo da Albert Sabin
_cm = min(creek, key=lambda p: math.hypot(p[0] - creek2[0][0], p[1] - creek2[0][1]))
_ang1 = math.atan2(_cm[1] - creek2[0][1], _cm[0] - creek2[0][0])
_ang2 = math.atan2(-_d[1], -_d[0])
culverts = [
    {'x': creek2[0][0], 'z': creek2[0][1], 'a': _ang1},                                     # boca do lado da faixa
    {'x': _cm[0] - math.cos(_ang1) * 2.0, 'z': _cm[1] - math.sin(_ang1) * 2.0, 'a': _ang1 + math.pi},  # boca no barranco do riacho
    {'x': creek2[-1][0], 'z': creek2[-1][1], 'a': _ang2},                                   # desce para baixo da Albert Sabin
]
_nb = len(houses)
houses = [h for h in houses if not in_strip2(h[0], h[1], 2)]
trees = [t for t in trees if _cdist(t[0], t[1], creek2) > 3.2 and min(math.hypot(t[0] - c['x'], t[1] - c['z']) for c in culverts) > 3]
print('creek2', len(creek2), 'pts; t', round(_t_as,1), round(_t_dc,1), 'removed houses', _nb - len(houses))
# ---- casa 127 da R. Albert Sabin (Street View 10/2024): em frente à ponta do riacho novo, um pouco ao sul ----
_as2 = next(r for r in roads if r['n'] == 'Rua Albert Sabin')['pts']
_cv = culverts[-1]
_seg = min(zip(_as2, _as2[1:]), key=lambda ab: _cdist(_cv['x'], _cv['z'], list(ab)))
(_ax, _az), (_bx, _bz) = _seg
_l = math.hypot(_bx - _ax, _bz - _az); _u = ((_bx - _ax) / _l, (_bz - _az) / _l)
if _u[1] < 0: _u = (-_u[0], -_u[1]); (_ax, _az) = (_bx, _bz)              # u aponta para o sul (z+)
_t = (_cv['x'] - _ax) * _u[0] + (_cv['z'] - _az) * _u[1]
_O = (_ax + _u[0] * _t, _az + _u[1] * _t)
_v = (-_u[1], _u[0]) if ((-_u[1]) * (_cv['x'] - _O[0]) + _u[0] * (_cv['z'] - _O[1])) < 0 else (_u[1], -_u[0])   # v aponta para longe do riacho (lado oposto da rua)
_O = (_O[0] + _u[0] * 12, _O[1] + _u[1] * 12)   # a casa fica um pouco à esquerda de quem olha o riacho descendo
def in_lot127(x, z, m=0):
    dx, dz = x - _O[0], z - _O[1]; uu = dx * _u[0] + dz * _u[1]; vv = dx * _v[0] + dz * _v[1]
    return -4 - m < uu < 24 + m and 4.2 - m < vv < 30 + m
_nb = len(houses)
houses = [h for h in houses if not any(in_lot127(x, z, 0.5) for x, z in _hcorners(h))]
trees = [t for t in trees if not in_lot127(t[0], t[1], 1)]
landmarks.append({'type': 'casa127', 'x': round(_O[0], 2), 'z': round(_O[1], 2), 'u': [round(_u[0], 4), round(_u[1], 4)], 'v': [round(_v[0], 4), round(_v[1], 4)]})
print('casa127 at', [round(c, 1) for c in _O], 'removed houses', _nb - len(houses))
trees = [t for t in trees if math.hypot(t[0] - corner_c[0], t[1] - corner_c[1]) > 17 and math.hypot(t[0] - grass_bank[0], t[1] - grass_bank[1]) > 13]
R = lambda pts: [[round(p[0], 1), round(p[1], 1)] for p in pts]
data = {
    'bounds': [round(BX0, 1), round(BZ0, 1), round(BX1, 1), round(BZ1, 1)],
    'roads': [{'t': r['t'], 'h': r['h'], 'sw': r['sw'], 'n': r['n'], 'ring': r['ring'], 'dirt': r['dirt'], 'pave': r.get('pave', False), 'real': r.get('real', False), 'cl': bool((r.get('st') or {}).get('cl')), 'pts': R(r['pts'])} for r in roads],
    'poles': poles,
    'paveZones': pave_zones,
    'areas': [{'t': a['t'], 'n': a['n'], 'pts': R(a['pts'])} for a in areas],
    'dem': None if dem is None else {'lon0': dem['lon0'], 'lat0': dem['lat0'], 'step': dem['step'], 'rows': dem['rows'], 'cols': dem['cols'],
            'base': 400, 'data': [int(round((v - 400) * 10)) for v in dem['a'].flatten()]},
    'proj': {'lat0': lat0, 'lon0': lon0, 'KX': KX, 'KZ': KZ},
    'landmarks': landmarks + landmarks_pre,
    'creek': [[round(x, 1), round(z, 1)] for x, z in creek],
    'creek2': [[round(x, 1), round(z, 1)] for x, z in creek2],
    'culverts': [{'x': round(c['x'], 2), 'z': round(c['z'], 2), 'a': round(c['a'], 3)} for c in culverts],
    'houses': houses, 'trees': trees, 'lamps': lamps,
    'spawn': [round(best[1], 1), round(best[2], 1)],
    'label': [round(target[0], 1), round(target[1], 1)],
}
with open(OUT, 'w') as f:
    json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
print('roads', len(roads), 'areas', len(areas), 'houses', len(houses), 'pools', sum(h[8] for h in houses),
      'trees', len(trees), 'lamps', len(lamps), 'bounds', data['bounds'], 'spawn', data['spawn'])
