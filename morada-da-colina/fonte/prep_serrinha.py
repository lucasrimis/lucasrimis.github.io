"""Gera o mundo da Serrinha do Alambari (mesmo formato do world.json da Morada da Colina).

Entrada: a pasta serrinha-dados/ do branch dados-serrinha (osm.json do Overpass, dem.json, cobertura.json).
Saída: serrinha_world.json.  Uso: python3 prep_serrinha.py <pasta serrinha-dados> <saida.json>

Primeira versão, só com dados abertos: estradas, trilhas, rios e nomes do OpenStreetMap (ODbL), relevo SRTM
(Terrarium/AWS) e cobertura do solo ESA WorldCover 2021 (CC-BY 4.0). Casas e árvores são geradas.
"""
import json, math, random, sys, heapq, collections

SRC, OUT = sys.argv[1], sys.argv[2]
random.seed(7)
osm = json.load(open(SRC + '/osm.json'))['elements']
demj = json.load(open(SRC + '/dem.json'))
cov = json.load(open(SRC + '/cobertura.json'))

PORTICO = (-22.4058189, -44.5048429)
PRACA = (-22.3874978, -44.5583272)
POCO = (-22.384597, -44.5744344)

# ---------- grafo das vias, para achar o caminho portal → praça → Poço do Céu ----------
hw_ways = [e for e in osm if e['type'] == 'way' and 'highway' in e.get('tags', {}) and 'geometry' in e]
G = collections.defaultdict(list); NP = {}
for w in hw_ways:
    for a, b, ga, gb in zip(w['nodes'], w['nodes'][1:], w['geometry'], w['geometry'][1:]):
        NP[a] = (ga['lat'], ga['lon']); NP[b] = (gb['lat'], gb['lon'])
        d = math.hypot((ga['lat'] - gb['lat']) * 110540, (ga['lon'] - gb['lon']) * 102950)
        G[a].append((b, d)); G[b].append((a, d))
near = lambda ll: min(NP, key=lambda k: (NP[k][0] - ll[0]) ** 2 + ((NP[k][1] - ll[1]) * 0.93) ** 2)


def dijkstra(s, t):
    D = {s: 0}; prev = {}; pq = [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == t: break
        if d > D[u]: continue
        for v, w in G[u]:
            if d + w < D.get(v, 1e18): D[v] = d + w; prev[v] = u; heapq.heappush(pq, (d + w, v))
    p = [t]
    while p[-1] != s: p.append(prev[p[-1]])
    return p[::-1]


nS, nH, nT = near(PORTICO), near(PRACA), near(POCO)
path_bus = dijkstra(nS, nH)
path_walk = dijkstra(nH, nT)
route_ll = [NP[k] for k in path_bus] + [NP[k] for k in path_walk[1:]]

# ---------- projeção local em metros (x leste, z sul), centrada no trajeto ----------
lats = [p[0] for p in route_ll]; lons = [p[1] for p in route_ll]
lat0, lon0 = (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2
KX = 111320 * math.cos(math.radians(lat0)); KZ = 110540
proj = lambda lat, lon: ((lon - lon0) * KX, -(lat - lat0) * KZ)
unproj = lambda x, z: (-z / KZ + lat0, x / KX + lon0)
route = [proj(*p) for p in route_ll]
bus = [proj(*NP[k]) for k in path_bus]
MARGIN = 420
BX0 = min(p[0] for p in route) - MARGIN; BX1 = max(p[0] for p in route) + MARGIN
BZ0 = min(p[1] for p in route) - MARGIN; BZ1 = max(p[1] for p in route) + MARGIN
inb = lambda x, z, m=0: BX0 - m <= x <= BX1 + m and BZ0 - m <= z <= BZ1 + m

# ---------- relevo ----------
def dem_ll(lat, lon):
    c = (lon - demj['lon0']) / demj['step']; r = (demj['lat0'] - lat) / demj['step']
    c = min(max(c, 0), demj['cols'] - 1.001); r = min(max(r, 0), demj['rows'] - 1.001)
    i, j = int(r), int(c); fr, fc = r - i, c - j; a = demj['data']; C = demj['cols']
    return (a[i * C + j] * (1 - fr) * (1 - fc) + a[i * C + j + 1] * (1 - fr) * fc + a[(i + 1) * C + j] * fr * (1 - fc) + a[(i + 1) * C + j + 1] * fr * fc)
H = lambda x, z: dem_ll(*unproj(x, z))

# ---------- cobertura do solo (WorldCover) ----------
def cover_ll(lat, lon):
    c = int((lon - cov['lon0']) / cov['step']); r = int((cov['lat0'] - lat) / cov['step'])
    if 0 <= r < cov['rows'] and 0 <= c < cov['cols']: return cov['data'][r * cov['cols'] + c]
    return 10
COV = lambda x, z: cover_ll(*unproj(x, z))

# ---------- vias ----------
def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az; L = dx * dx + dz * dz
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / L))
    return math.hypot(px - ax - t * dx, pz - az - t * dz)


def clip_poly(pts, m=60):
    """Partes da linha dentro da caixa (com margem)."""
    out, cur = [], []
    for p in pts:
        if inb(p[0], p[1], m): cur.append(p)
        else:
            if len(cur) > 1: out.append(cur)
            cur = []
    if len(cur) > 1: out.append(cur)
    return out


WID = {'secondary': ('secondary', 4.0, 0), 'secondary_link': ('secondary', 3.0, 0), 'tertiary': ('unclassified', 3.3, 0),
       'unclassified': ('unclassified', 2.8, 0), 'residential': ('unclassified', 2.9, 0), 'service': ('unclassified', 2.0, 0),
       'track': ('unclassified', 1.7, 0), 'path': ('footway', 0.7, 0), 'footway': ('footway', 0.7, 0)}
roads = []
for w in hw_ways:
    t = w['tags']; hw = t['highway']
    if hw not in WID: continue
    typ, half, sw = WID[hw]
    pts = [proj(g['lat'], g['lon']) for g in w['geometry']]
    surf = t.get('surface', '')
    paved = hw.startswith('secondary') or surf in ('asphalt', 'paved', 'concrete')
    sett = surf in ('sett', 'paving_stones', 'cobblestone')
    for piece in clip_poly(pts):
        roads.append({'t': typ, 'h': half, 'sw': sw, 'n': t.get('name', ''), 'ring': False,
                      'dirt': not paved and not sett and typ != 'footway', 'pave': sett, 'real': False, 'cl': False, 'pts': piece, 'hw': hw})
print('vias', len(roads))
RG = 40; rgrid = collections.defaultdict(list)
for r in roads:
    for a, b in zip(r['pts'], r['pts'][1:]):
        m = r['h'] + 12
        for gx in range(int((min(a[0], b[0]) - m) // RG), int((max(a[0], b[0]) + m) // RG) + 1):
            for gz in range(int((min(a[1], b[1]) - m) // RG), int((max(a[1], b[1]) + m) // RG) + 1):
                rgrid[(gx, gz)].append((a, b, r['h'], r['t']))


def road_dist(x, z, foot=True):
    best = 1e9
    for a, b, h, t in rgrid.get((int(x // RG), int(z // RG)), []):
        if not foot and t == 'footway': continue
        best = min(best, seg_dist(x, z, a[0], a[1], b[0], b[1]) - h)
    return best

# ---------- rios ----------
streams = []
for w in osm:
    if w['type'] != 'way' or 'waterway' not in w.get('tags', {}) or 'geometry' not in w: continue
    ww = w['tags']['waterway']
    if ww not in ('river', 'stream'): continue
    pts = [proj(g['lat'], g['lon']) for g in w['geometry']]
    for piece in clip_poly(pts, 0):
        streams.append({'n': w['tags'].get('name', ''), 'w': 2.6 if ww == 'river' else 1.3, 'pts': piece})
SG = 40; sgrid = collections.defaultdict(list)
for s in streams:
    for a, b in zip(s['pts'], s['pts'][1:]):
        for gx in range(int((min(a[0], b[0]) - 12) // SG), int((max(a[0], b[0]) + 12) // SG) + 1):
            for gz in range(int((min(a[1], b[1]) - 12) // SG), int((max(a[1], b[1]) + 12) // SG) + 1):
                sgrid[(gx, gz)].append((a, b, s['w']))
def stream_dist(x, z):
    best = 1e9
    for a, b, w in sgrid.get((int(x // SG), int(z // SG)), []): best = min(best, seg_dist(x, z, a[0], a[1], b[0], b[1]) - w)
    return best

# ---------- pontos com nome ----------
pois = []
KEEP = ('waterfall', 'attraction', 'camp_site', 'guest_house', 'restaurant', 'chalet', 'farm', 'hamlet', 'peak')
for e in osm:
    t = e.get('tags', {})
    if e['type'] != 'node' or not t.get('name'): continue
    kind = t.get('waterway') or t.get('tourism') or t.get('amenity') or t.get('place') or t.get('natural')
    if kind not in KEEP: continue
    x, z = proj(e['lat'], e['lon'])
    if not inb(x, z, 200): continue
    if kind == 'peak': continue
    pois.append([t['name'], round(x, 1), round(z, 1), kind])

# ---------- marcos: pórtico, praça e Poço do Céu ----------
def nearest_on(pts, x, z):
    best = None
    for a, b in zip(pts, pts[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]; L = dx * dx + dz * dz or 1
        t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)); px, pz = a[0] + t * dx, a[1] + t * dz
        d = math.hypot(x - px, z - pz)
        if best is None or d < best[0]: best = (d, px, pz, math.atan2(dz, dx))
    return best
landmarks = []
_, px_, pz_, pa_ = nearest_on(bus[:12], *proj(*PORTICO))
landmarks.append({'type': 'portico', 'x': round(px_, 2), 'z': round(pz_, 2), 'a': round(pa_, 3), 'n': 'Pórtico Dairton Balbino dos Santos'})
_, qx, qz, qa = nearest_on(bus, *proj(*PRACA))
# praça ao lado da estrada, do lado de dentro da vila (lado do ponto com o nome)
hx, hz = proj(*PRACA); side = 1 if (-(math.sin(qa)) * (hx - qx) + math.cos(qa) * (hz - qz)) > 0 else -1
nx, nz = -math.sin(qa) * side, math.cos(qa) * side
pc = (qx + nx * 16, qz + nz * 16)
landmarks.append({'type': 'pracaSerrinha', 'x': round(pc[0], 2), 'z': round(pc[1], 2), 'a': round(qa, 3), 'rx': round(qx, 2), 'rz': round(qz, 2), 'side': side})
cx, cz = proj(*POCO)
# encaixa o poço no rio mais perto (o ponto do OSM fica um pouco fora do traçado do rio)
bs = None
for sm in streams:
    for a, b in zip(sm['pts'], sm['pts'][1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]; L = dx * dx + dz * dz or 1; t = max(0, min(1, ((cx - a[0]) * dx + (cz - a[1]) * dz) / L))
        px, pz = a[0] + t * dx, a[1] + t * dz; d = math.hypot(cx - px, cz - pz)
        if bs is None or d < bs[0]: bs = (d, px, pz)
if bs and bs[0] < 45: cx, cz = bs[1], bs[2]
landmarks.append({'type': 'pocoCeu', 'x': round(cx, 2), 'z': round(cz, 2)})
# a trilha termina na beira do poço, não dentro da água
for r in roads:
    if r['t'] != 'footway' and r['hw'] != 'track': continue
    keep = [p for p in r['pts'] if math.hypot(p[0] - cx, p[1] - cz) > 11]
    if len(keep) != len(r['pts']):
        runs, cur = [], []
        for p in r['pts']:
            if math.hypot(p[0] - cx, p[1] - cz) > 11: cur.append(p)
            else:
                if len(cur) > 1: runs.append(cur)
                cur = []
        if len(cur) > 1: runs.append(cur)
        r['pts'] = max(runs, key=len) if runs else []
roads[:] = [r for r in roads if len(r['pts']) > 1]
dx_, dz_ = proj(-22.3848732, -44.5734527)
landmarks.append({'type': 'pocoDino', 'x': round(dx_, 2), 'z': round(dz_, 2)})

# ---------- rota do ônibus (portal → praça), reamostrada a cada 4 m ----------
def resample(pts, step):
    cum = [0]
    for a, b in zip(pts, pts[1:]): cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    out, i, s = [], 0, 0.0
    while s <= cum[-1]:
        while i < len(cum) - 2 and cum[i + 1] < s: i += 1
        t = (s - cum[i]) / ((cum[i + 1] - cum[i]) or 1)
        out.append((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t)); s += step
    out.append(pts[-1])
    return out
# termina na frente da praça
k_end = min(range(len(bus)), key=lambda i: math.hypot(bus[i][0] - qx, bus[i][1] - qz))
bus_route = resample(bus[:k_end + 1] + [(qx, qz)], 4)

# ---------- máscara de detalhe: perto das vias e do Poço ----------
FINE_R = 170
def near_detail(x, z):
    return road_dist(x, z) < FINE_R or math.hypot(x - cx, z - cz) < 260

# ---------- casas: vila em volta da praça e sítios ao longo da estrada ----------
houses = []; occ = collections.defaultdict(list)
def rect_corners(x, z, w, d, ang):
    c, s = math.cos(ang), math.sin(ang)
    return [(x + c * u - s * v, z + s * u + c * v) for u, v in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
def free(x, z, r):
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for (ox, oz, orr) in occ[(int(x // 30) + dx, int(z // 30) + dz)]:
                if math.hypot(ox - x, oz - z) < r + orr: return False
    return True
def occupy(x, z, r): occ[(int(x // 30), int(z // 30))].append((x, z, r))
for r in roads:
    if r['t'] == 'footway' or r['hw'] == 'secondary': continue
    pts = r['pts']
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 6: continue
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L; ang = math.atan2(uz, ux)
        for sd in (-1, 1):
            nx2, nz2 = -uz * sd, ux * sd
            t = random.uniform(3, 20)
            while t < L - 4:
                mx, mz = a[0] + ux * t, a[1] + uz * t
                dv = math.hypot(mx - qx, mz - qz)
                dens = 0.55 if dv < 350 else 0.32 if dv < 900 else 0.06   # vila perto da praça, sítios espalhados no resto
                if r['hw'] == 'track': dens *= 0.4
                w_, d_ = random.choice([7, 8, 9, 10, 11]), random.choice([7, 8, 9, 10])
                setb = random.uniform(4, 9); off = r['h'] + setb + d_ / 2
                hx2, hz2 = mx + nx2 * off, mz + nz2 * off
                ok = random.random() < dens and road_dist(hx2, hz2) > d_ / 2 + 2 and stream_dist(hx2, hz2) > 10 and free(hx2, hz2, max(w_, d_) * 0.75 + 3)
                # terreno muito inclinado não recebe casa
                if ok and abs(H(hx2 + 6, hz2) - H(hx2 - 6, hz2)) + abs(H(hx2, hz2 + 6) - H(hx2, hz2 - 6)) > 9: ok = False
                if ok:
                    occupy(hx2, hz2, max(w_, d_) * 0.75 + 2)
                    floors = 2 if random.random() < 0.18 else 1
                    face = math.atan2(-nz2, -nx2)
                    houses.append([round(hx2, 1), round(hz2, 1), w_, d_, round(ang, 3), floors, random.randrange(8), random.choice([0, 0, 1, 1, 2]), 0,
                                   0, 0, 0, 0, round(face, 3), random.randrange(1000)])
                    t += w_ + random.uniform(8, 30)
                else:
                    t += random.uniform(6, 14)
print('casas', len(houses))

# ---------- árvores: Mata Atlântica onde o satélite mostra árvores, perto das vias ----------
trees = []; tocc = collections.defaultdict(list)
def tfree(x, z, r):
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for (ox, oz, orr) in tocc[(int(x // 12) + dx, int(z // 12) + dz)]:
                if math.hypot(ox - x, oz - z) < (r + orr) * 0.7: return False
    return True
pine_c = [proj(-22.3862994, -44.5545524), proj(-22.3925, -44.5320), proj(-22.3880, -44.5480)]   # áreas de pinheiros (camping e trechos da estrada)
x = BX0
while x < BX1:
    z = BZ0
    while z < BZ1:
        jx, jz = x + random.uniform(-2.5, 2.5), z + random.uniform(-2.5, 2.5)
        rd = road_dist(jx, jz)
        if rd < 130:
            c = COV(jx, jz)
            keep = (c == 10 and (rd < 40 or random.random() < 0.3)) or (c == 20 and random.random() < 0.3) or (c == 30 and random.random() < 0.035)
            if keep and rd > 2.2 and stream_dist(jx, jz) > 1.5 and free(jx, jz, 3) and math.hypot(jx - cx, jz - cz) > 14:
                pine = any(math.hypot(jx - p[0], jz - p[1]) < 260 for p in pine_c) and random.random() < 0.6
                k = 5 if pine else random.choice([0, 0, 1, 2, 2, 0, 4] if random.random() < 0.03 else [0, 0, 1, 2, 2])
                s = random.uniform(1.0, 1.7) if c == 10 else random.uniform(0.8, 1.2)
                if tfree(jx, jz, s * 1.3):
                    tocc[(int(jx // 12), int(jz // 12))].append((jx, jz, s * 1.3)); trees.append([round(jx, 1), round(jz, 1), k, round(s, 2)])
        z += 11 if rd < 40 else 19
    x += 11
print('árvores', len(trees))

# ---------- cobertura para colorir o chão (grade de 20 m em metros) ----------
CS = 20; ccols = int((BX1 - BX0) / CS) + 1; crows = int((BZ1 - BZ0) / CS) + 1
CH = {10: 't', 20: 's', 30: 'g', 40: 'g', 50: 'b', 60: 'r', 80: 'w', 90: 'g', 95: 't', 100: 'g'}
cover = ''.join(CH.get(COV(BX0 + i * CS + CS / 2, BZ0 + j * CS + CS / 2), 't') for j in range(crows) for i in range(ccols))

# ---------- relevo para o motor: toda a área baixada (montanhas em volta), passo ~30 m ----------
st = demj['step'] * 2
rows, cols = (demj['rows'] - 1) // 2 + 1, (demj['cols'] - 1) // 2 + 1
BASE = 400
data = [int(round((demj['data'][(r * 2) * demj['cols'] + c * 2] - BASE) * 10)) for r in range(rows) for c in range(cols)]
# o motor usa o centro da célula (–0,5): desloca a origem meia célula
dem = {'lon0': demj['lon0'] - st / 2, 'lat0': demj['lat0'] + st / 2, 'step': st, 'rows': rows, 'cols': cols, 'base': BASE, 'data': data}

R = lambda pts: [[round(p[0], 1), round(p[1], 1)] for p in pts]
spawn = (pc[0] - nx * 9, pc[1] - nz * 9)
world = {
    'map': 'serrinha', 'name': 'Serrinha do Alambari', 'ts': 6, 'fineR': FINE_R,
    'bounds': [round(BX0, 1), round(BZ0, 1), round(BX1, 1), round(BZ1, 1)],
    'roads': [{k: (R(v) if k == 'pts' else v) for k, v in r.items() if k != 'hw'} for r in roads],
    'poles': [], 'paveZones': [], 'areas': [], 'creek': None, 'creek2': None, 'culverts': [],
    'streams': [{'n': s['n'], 'w': s['w'], 'pts': R(s['pts'])} for s in streams],
    'dem': dem, 'proj': {'lat0': lat0, 'lon0': lon0, 'KX': KX, 'KZ': KZ},
    'landmarks': landmarks, 'pois': pois,
    'cover': {'x0': round(BX0, 1), 'z0': round(BZ0, 1), 'step': CS, 'cols': ccols, 'rows': crows, 'data': cover},
    'houses': houses, 'trees': trees, 'lamps': [],
    'busRoute': R(bus_route), 'walkRoute': R([proj(*NP[k]) for k in path_walk]),
    'spawn': [round(spawn[0], 1), round(spawn[1], 1)], 'label': [round(pc[0], 1), round(pc[1], 1)],
}
json.dump(world, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print('bounds', world['bounds'], 'rota ônibus', len(bus_route) * 4, 'm', 'rios', len(streams), 'pois', len(pois), 'dem', rows, cols)
