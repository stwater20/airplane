#!/usr/bin/env python3
"""下載並轉換真實地形＋衛星影像圖磚（只用 Python 標準函式庫）。

資料來源（皆可商業使用，只需標示來源）：
  地形：AWS Open Data Terrain Tiles（Mapzen Terrarium 格式）。台灣、日本一帶的原始資料為
        SRTM / GMTED2010（USGS，公有領域）與 ETOPO1（NOAA，公有領域）。
  影像：NASA Blue Marble Next Generation，經 NASA GIBS 提供（NASA 內容不受美國著作權保護，
        需標示 NASA 為來源、不得暗示 NASA 背書）。
  ※ 不使用 EOX Sentinel-2 cloudless：其商業用途需另購授權，而本站有廣告。

輸出（放在 repo 的 tiles/ 底下，GitHub Pages 直接提供）：
  tiles/index.json              各層級有哪些圖磚、哪些可以再細分
  tiles/dem9.bin                全區 z9 地形（33x33 int16，依 index 順序串接）
  tiles/dem/11/{x}_{y}.bin      航線附近 z11 地形（65x65 int16）
  tiles/img/8/{x}_{y}.jpg       NASA Blue Marble 地表顏色（z8，只存有陸地的圖磚）

用法：python3 -I scripts/build_tiles.py <cache 目錄>
"""
import json, math, os, struct, sys, zlib, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tiles')
CACHE = sys.argv[1] if len(sys.argv) > 1 else '/tmp/tilecache'
TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
IMAGERY = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'

REGION = (118.0, 21.0, 146.0, 42.0)          # lon0, lat0, lon1, lat1
ROUTES = [[(121.236, 25.070), (122.30, 25.75), (124.60, 26.70), (127.70, 27.40), (129.60, 29.10), (131.40, 31.20),
           (133.40, 32.80), (134.60, 33.90), (135.092, 34.353), (135.2445, 34.4320)],          # 關西
          [(121.236, 25.070), (122.30, 25.75), (124.80, 26.40), (126.90, 26.75), (127.646, 26.58),
           (127.646, 26.343), (127.6465, 26.1958)]]                                              # 那霸
ROUTE = [(121.236, 25.070), (122.30, 25.75), (124.60, 26.70), (127.70, 27.40), (129.60, 29.10),
         (131.40, 31.20), (134.10, 32.90), (136.00, 33.30), (139.40, 34.60), (140.25, 35.05),
         (140.52, 35.52), (140.386, 35.765)]
ROUTES.append(ROUTE)
AIRPORTS = [(121.233, 25.077), (140.386, 35.772), (135.2445, 34.4320), (127.6465, 26.1958)]
NEAR_Z11, NEAR_Z12, NEAR_Z14 = 1.3, 0.45, 0.12   # 度


def lon2x(lon, z): return (lon + 180) / 360 * 2 ** z
def lat2y(lat, z):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z
def x2lon(x, z): return x / 2 ** z * 360 - 180
def y2lat(y, z): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))
def center(z, x, y): return x2lon(x + 0.5, z), y2lat(y + 0.5, z)


def seg_dist(p, a, b):
    """平面近似（經度乘 cos 緯度）下點到線段距離，單位：度"""
    k = math.cos(math.radians(p[1]))
    px, py = p[0] * k, p[1]
    ax, ay, bx, by = a[0] * k, a[1], b[0] * k, b[1]
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)
def route_dist(lon, lat): return min(seg_dist((lon, lat), R[i], R[i + 1]) for R in ROUTES for i in range(len(R) - 1))
def airport_dist(lon, lat): return min(math.hypot((lon - a) * math.cos(math.radians(lat)), lat - b) for a, b in AIRPORTS)


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'sectools-airplane-tile-builder/1.0 (+https://airplane.sectools.tw)'})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(path + '.part', 'wb') as f:
                f.write(data)
            os.replace(path + '.part', path)
            return path
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                print('  失敗', url, e)
                return None


def decode_png(path):
    """最小 PNG 解碼器：8-bit RGB/RGBA、非交錯（Terrarium 圖磚用）。回傳高度陣列（公尺）"""
    with open(path, 'rb') as f:
        data = f.read()
    pos, idat, w, h, ctype = 8, b'', 0, 0, 2
    while pos < len(data):
        n, typ = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + n]
        if typ == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'IDAT':
            idat += chunk
        pos += 12 + n
    bpp = 4 if ctype == 6 else 3
    raw = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    i = 0
    for row in range(h):
        ft = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        for c in range(stride):
            a = line[c - bpp] if c >= bpp else 0
            b = prev[c]
            cc = prev[c - bpp] if c >= bpp else 0
            if ft == 1: line[c] = (line[c] + a) & 255
            elif ft == 2: line[c] = (line[c] + b) & 255
            elif ft == 3: line[c] = (line[c] + ((a + b) >> 1)) & 255
            elif ft == 4:
                p = a + b - cc; pa, pb, pc = abs(p - a), abs(p - b), abs(p - cc)
                line[c] = (line[c] + (a if pa <= pb and pa <= pc else b if pb <= pc else cc)) & 255
        out[row * stride:(row + 1) * stride] = line
        prev = line
    hts = [0.0] * (w * h)
    for k in range(w * h):
        r, g, b = out[k * bpp], out[k * bpp + 1], out[k * bpp + 2]
        hts[k] = r * 256 + g + b / 256 - 32768
    return hts, w, h


def sample(hts, w, h, fx, fy):
    """在 0..1 的位置做雙線性取樣"""
    x = min(max(fx * w - 0.5, 0), w - 1.001); y = min(max(fy * h - 0.5, 0), h - 1.001)
    x0, y0 = int(x), int(y); tx, ty = x - x0, y - y0
    a = hts[y0 * w + x0]; b = hts[y0 * w + x0 + 1]; c = hts[(y0 + 1) * w + x0]; d = hts[(y0 + 1) * w + x0 + 1]
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty


def grid(hts, w, h, n, x0=0.0, y0=0.0, span=1.0):
    vals = []
    for j in range(n + 1):
        for i in range(n + 1):
            v = sample(hts, w, h, x0 + span * i / n, y0 + span * j / n)
            vals.append(int(max(-500, min(6000, round(v)))))
    return vals


def has_land(vals, thr=1.0): return any(v > thr for v in vals)


def main():
    os.makedirs(ROOT, exist_ok=True)
    pool = ThreadPoolExecutor(12)

    # ── z9 全區 ──
    z = 9
    xs = range(int(lon2x(REGION[0], z)), int(lon2x(REGION[2], z)) + 1)
    ys = range(int(lat2y(REGION[3], z)), int(lat2y(REGION[1], z)) + 1)
    keys9 = [(x, y) for x in xs for y in ys]
    print('z9 地形', len(keys9))
    paths = list(pool.map(lambda k: fetch(TERRAIN.format(z=9, x=k[0], y=k[1]), f'{CACHE}/t/9/{k[0]}_{k[1]}.png'), keys9))
    dem9, land9 = {}, []
    for k, p in zip(keys9, paths):
        if not p: continue
        hts, w, h = decode_png(p)
        g = grid(hts, w, h, 32)
        if has_land(g):
            dem9[k] = g; land9.append(k)
    print('  有陸地', len(land9))

    # ── z11：航線兩側 NEAR_Z11 度內的 z9 圖磚，把它們的陸地子圖磚全部加入 ──
    ref9 = [k for k in land9 if route_dist(*center(9, *k)) < NEAR_Z11]
    cand11 = [(k[0] * 4 + i, k[1] * 4 + j) for k in ref9 for i in range(4) for j in range(4)]
    print('z11 地形候選', len(cand11))
    paths = list(pool.map(lambda k: fetch(TERRAIN.format(z=11, x=k[0], y=k[1]), f'{CACHE}/t/11/{k[0]}_{k[1]}.png'), cand11))
    dem11, land11, raw11 = {}, [], {}
    for k, p in zip(cand11, paths):
        if not p: continue
        hts, w, h = decode_png(p)
        g = grid(hts, w, h, 64)
        if has_land(g):
            dem11[k] = g; land11.append(k); raw11[k] = (hts, w, h)
    print('  有陸地', len(land11))

    set11 = set(land11)
    ref9 = [k for k in ref9 if any((k[0] * 4 + i, k[1] * 4 + j) in set11 for i in range(4) for j in range(4))]

    # ── NASA Blue Marble（z8，最高只到 z8）：涵蓋所有有陸地的 z9 圖磚 ──
    keys8 = sorted({(x // 2, y // 2) for x, y in land9})
    print('Blue Marble 影像', len(keys8))
    ok = list(ThreadPoolExecutor(6).map(lambda k: fetch(IMAGERY.format(z=8, x=k[0], y=k[1]), f'{ROOT}/img/8/{k[0]}_{k[1]}.jpg'), keys8))
    missing = [k for k, p in zip(keys8, ok) if not p]
    print('  失敗', len(missing))

    # ── 輸出地形 ──
    with open(f'{ROOT}/dem9.bin', 'wb') as f:
        for k in land9:
            f.write(struct.pack(f'<{33 * 33}h', *dem9[k]))
    os.makedirs(f'{ROOT}/dem/11', exist_ok=True)
    for k in land11:
        with open(f'{ROOT}/dem/11/{k[0]}_{k[1]}.bin', 'wb') as f:
            f.write(struct.pack(f'<{65 * 65}h', *dem11[k]))

    def enc(ks): return [f'{x},{y}' for x, y in ks]
    index = {
        'attribution': 'Terrain: SRTM & GMTED2010 courtesy of the U.S. Geological Survey; ETOPO1 by NOAA; tiles via Mapzen / AWS Terrain Tiles. Imagery: NASA Blue Marble Next Generation via NASA GIBS.',
        'levels': {'9': enc(land9), '11': enc(land11)},
        'refine': {'9': enc(ref9)},
        'img8': enc([k for k in keys8 if k not in missing]),
        'dem9': enc(land9),
    }
    with open(f'{ROOT}/index.json', 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    total = 0
    for dp, _, fs in os.walk(ROOT):
        total += sum(os.path.getsize(os.path.join(dp, x)) for x in fs)
    print(f'完成：tiles/ 共 {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
