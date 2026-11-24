# Baixa os dados abertos da Serrinha do Alambari para o jogo (roda no GitHub Actions, que tem internet).
# OpenStreetMap (ODbL) via Overpass, relevo Terrarium/SRTM (AWS Open Data) e cobertura do solo ESA WorldCover 10 m (CC-BY 4.0).
import json, math, os, io, time, urllib.request, urllib.parse

S, W, N, E = -22.425, -44.590, -22.360, -44.480          # caixa: do portal na RJ-163 até o Poço do Céu
OUT = 'serrinha-dados'
os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'jogo-morada-da-colina/1.0'}


def get(url, data=None, tries=4):
    for k in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=UA), timeout=180).read()
        except Exception as e:
            print('erro', url[:80], e)
            time.sleep(10 * (k + 1))
    return None


# --- OpenStreetMap ---
q = f"""[out:json][timeout:170];
(way["highway"]({S},{W},{N},{E}); way["waterway"]({S},{W},{N},{E}); way["natural"]({S},{W},{N},{E});
 way["landuse"]({S},{W},{N},{E}); way["building"]({S},{W},{N},{E}); way["leisure"]({S},{W},{N},{E});
 node["name"]({S},{W},{N},{E}); node["natural"]({S},{W},{N},{E}); node["tourism"]({S},{W},{N},{E}); node["amenity"]({S},{W},{N},{E});
 relation["natural"="water"]({S},{W},{N},{E}););
out body geom;"""
osm = None
for host in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']:
    osm = get(host, urllib.parse.urlencode({'data': q}).encode())
    if osm:
        try:
            json.loads(osm)
            break
        except Exception:
            osm = None
if osm:
    open(f'{OUT}/osm.json', 'wb').write(osm)
    print('osm', len(osm))

# --- relevo: Terrarium z14 (~9,5 m/pixel), reamostrado numa grade regular de ~15 m ---
from PIL import Image
Z = 14
tx = lambda lon: (lon + 180) / 360 * 2 ** Z
ty = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2 ** Z
x0, x1, y0, y1 = int(tx(W)), int(tx(E)), int(ty(N)), int(ty(S))
mos = Image.new('RGB', ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256))
for X in range(x0, x1 + 1):
    for Y in range(y0, y1 + 1):
        b = get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{X}/{Y}.png')
        if b:
            mos.paste(Image.open(io.BytesIO(b)).convert('RGB'), ((X - x0) * 256, (Y - y0) * 256))
px = mos.load()


def hpx(i, j):
    R, G, B = px[max(0, min(i, mos.width - 1)), max(0, min(j, mos.height - 1))]
    return R * 256 + G + B / 256 - 32768


step = 0.00014
cols, rows = int((E - W) / step) + 1, int((N - S) / step) + 1
data = []
for r in range(rows):
    lat = N - r * step
    for c in range(cols):
        lon = W + c * step
        fx, fy = (tx(lon) - x0) * 256, (ty(lat) - y0) * 256
        i, j = int(fx), int(fy)
        a, b = fx - i, fy - j
        v = (hpx(i, j) * (1 - a) + hpx(i + 1, j) * a) * (1 - b) + (hpx(i, j + 1) * (1 - a) + hpx(i + 1, j + 1) * a) * b
        data.append(round(v, 1))
json.dump({'lat0': N, 'lon0': W, 'step': step, 'rows': rows, 'cols': cols, 'data': data}, open(f'{OUT}/dem.json', 'w'))
print('dem', rows, cols, min(data), max(data))

# --- cobertura do solo: ESA WorldCover 2021 (10 m), reamostrada a ~20 m ---
try:
    import rasterio
    from rasterio.windows import from_bounds
    from rasterio.enums import Resampling
    url = '/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_S24W045_Map.tif'
    st = 0.00018
    with rasterio.open(url) as src:
        win = from_bounds(W, S, E, N, src.transform)
        arr = src.read(1, window=win, out_shape=(int((N - S) / st), int((E - W) / st)), resampling=Resampling.mode)
    json.dump({'lat0': N, 'lon0': W, 'step': st, 'rows': int(arr.shape[0]), 'cols': int(arr.shape[1]), 'data': arr.flatten().tolist(),
               'legenda': {'10': 'arvores', '20': 'arbustos', '30': 'campo', '40': 'lavoura', '50': 'construido', '60': 'solo nu', '80': 'agua', '90': 'brejo'}},
              open(f'{OUT}/cobertura.json', 'w'))
    print('cobertura', arr.shape)
except Exception as e:
    print('cobertura falhou', e)
