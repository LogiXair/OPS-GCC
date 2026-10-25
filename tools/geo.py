#!/usr/bin/env python3
"""Builds src/js/05-geo.js: real map layers for peninsular India, clipped, simplified and quantised.
Sources: Natural Earth 1:10m vectors (public domain); NASA-derived Earth textures shipped with three.js."""
import json, sys, base64, io, math
import numpy as np
from PIL import Image, ImageFilter

NE, TEX, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
REGION = sys.argv[4] if len(sys.argv) > 4 else 'IN'
if REGION == 'GCC':
    LON0, LON1, LAT0, LAT1 = 34.0, 60.0, 15.5, 32.5
    COUNTRIES, VAR, TOL, POP, RW = {'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Bahrain', 'Kuwait', 'Oman', 'Yemen', 'Jordan', 'Iraq', 'Iran', 'Egypt', 'Israel', 'Sudan', 'Eritrea'}, 'GEO', 0.005, 200000, 384
elif REGION == 'SEA':
    LON0, LON1, LAT0, LAT1 = 95.0, 127.5, -11.0, 20.0
    COUNTRIES, VAR, TOL, POP, RW = {'Indonesia', 'Philippines', 'Thailand', 'Malaysia', 'Brunei', 'East Timor', 'Singapore', 'Vietnam', 'Cambodia', 'Myanmar', 'Laos'}, 'GEO_SEA', 0.006, 250000, 384
else:
    LON0, LON1, LAT0, LAT1 = 68.0, 86.0, 7.6, 23.0
    COUNTRIES, VAR, TOL, POP, RW = {'India'}, 'GEO', 0.0018, 180000, 256
CITY_COUNTRIES = {'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Bahrain', 'Kuwait', 'Oman'}
Q = 600 if REGION in ('SEA', 'GCC') else 2000  # quantisation steps per degree (~185 m / ~55 m)

def load(name):
    return json.load(open(f'{NE}/{name}.geojson'))['features']

def inside(p): return LON0 <= p[0] <= LON1 and LAT0 <= p[1] <= LAT1

def clip_poly(ring):
    """Sutherland-Hodgman against the bbox."""
    def clip(pts, edge):
        axis, val, keep_ge = edge
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia = (a[axis] >= val) if keep_ge else (a[axis] <= val)
            ib = (b[axis] >= val) if keep_ge else (b[axis] <= val)
            if ia != ib:
                t = (val - a[axis]) / (b[axis] - a[axis])
                out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            if ib: out.append(b)
        return out
    pts = [tuple(p[:2]) for p in ring]
    for e in ((0, LON0, True), (0, LON1, False), (1, LAT0, True), (1, LAT1, False)):
        if not pts: break
        pts = clip(pts, e)
    return pts

def clip_line(line):
    """Split a polyline into the runs that lie inside the bbox (segment-wise Liang-Barsky)."""
    runs, cur = [], []
    for i in range(len(line) - 1):
        a, b = line[i][:2], line[i + 1][:2]
        dx, dy = b[0] - a[0], b[1] - a[1]
        t0, t1, ok = 0.0, 1.0, True
        for p, q in ((-dx, a[0] - LON0), (dx, LON1 - a[0]), (-dy, a[1] - LAT0), (dy, LAT1 - a[1])):
            if p == 0:
                if q < 0: ok = False; break
            else:
                r = q / p
                if p < 0:
                    if r > t1: ok = False; break
                    t0 = max(t0, r)
                else:
                    if r < t0: ok = False; break
                    t1 = min(t1, r)
        if not ok:
            if len(cur) > 1: runs.append(cur)
            cur = []
            continue
        pa = (a[0] + t0 * dx, a[1] + t0 * dy); pb = (a[0] + t1 * dx, a[1] + t1 * dy)
        if not cur or t0 > 0:
            if len(cur) > 1: runs.append(cur)
            cur = [pa]
        cur.append(pb)
        if t1 < 1:
            runs.append(cur); cur = []
    if len(cur) > 1: runs.append(cur)
    return runs

def simplify(pts, tol):
    """Douglas-Peucker, iterative."""
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]; bx, by = pts[j]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
        md, mi = 0, -1
        for k in range(i + 1, j):
            d = abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / L if L > 1e-9 else math.hypot(pts[k][0] - ax, pts[k][1] - ay)
            if d > md: md, mi = d, k
        if md > tol:
            keep[mi] = True; stack.append((i, mi)); stack.append((mi, j))
    return [p for p, k in zip(pts, keep) if k]

def quant(pts):
    out, last = [], None
    for lo, la in pts:
        q = (round((lo - LON0) * Q), round((la - LAT0) * Q))
        if q != last: out.extend(q); last = q
    return out

def rings(geom):
    if geom['type'] == 'Polygon': return [geom['coordinates'][0]]
    if geom['type'] == 'MultiPolygon': return [p[0] for p in geom['coordinates']]
    return []

def lines(geom):
    if geom['type'] == 'LineString': return [geom['coordinates']]
    if geom['type'] == 'MultiLineString': return geom['coordinates']
    return []

def bbox_hit(ring):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return not (max(xs) < LON0 or min(xs) > LON1 or max(ys) < LAT0 or min(ys) > LAT1)

geo = {'bbox': [LON0, LON1, LAT0, LAT1], 'q': Q}

# land polygons + coastlines
land, coast = [], []
for layer in ('ne_10m_land', 'ne_10m_minor_islands'):
    for f in load(layer):
        for r in rings(f['geometry']):
            if not bbox_hit(r): continue
            c = clip_poly(r)
            if len(c) >= 3:
                s = simplify(c + [c[0]], TOL)
                if len(s) >= 4: land.append(quant(s))
            for run in clip_line(r):
                s = simplify([tuple(p) for p in run], TOL)
                if len(s) >= 2: coast.append(quant(s))
geo['land'], geo['coast'] = land, ([] if REGION in ('SEA', 'GCC') else coast)   # SEA: the land rings double as the coastline

# continental shelf edge (200 m isobath): deep-water polygons
deep = []
for f in load('ne_10m_bathymetry_K_200'):
    for r in rings(f['geometry']):
        if not bbox_hit(r): continue
        c = clip_poly(r)
        if len(c) >= 3:
            s = simplify(c + [c[0]], 0.02)
            if len(s) >= 4: deep.append(quant(s))
geo['deep'] = deep

# state boundaries (India only)
st = []
for f in load('ne_10m_admin_1_states_provinces_lines'):
    if f['properties'].get('ADM0_NAME') not in COUNTRIES: continue
    for l in lines(f['geometry']):
        for run in clip_line(l):
            s = simplify([tuple(p) for p in run], 0.03 if REGION in ('SEA', 'GCC') else 0.008)
            if len(s) >= 2: st.append(quant(s))
geo['states'] = st

# rivers
rv = []
for f in load('ne_10m_rivers_lake_centerlines'):
    p = f['properties']
    if (p.get('scalerank') or 99) > 7: continue
    for l in lines(f['geometry']):
        for run in clip_line(l):
            s = simplify([tuple(q) for q in run], 0.006)
            if len(s) >= 2: rv.append({'n': p.get('name') or '', 'r': int(p.get('scalerank') or 9), 'p': quant(s)})
geo['rivers'] = rv

# lakes / reservoirs
lk = []
for f in load('ne_10m_lakes'):
    for r in rings(f['geometry']):
        if not bbox_hit(r): continue
        c = clip_poly(r)
        if len(c) >= 3:
            s = simplify(c + [c[0]], TOL)
            if len(s) >= 4: lk.append(quant(s))
geo['lakes'] = lk

# major roads
rd = []
for f in load('ne_10m_roads'):
    p = f['properties']
    if p.get('type') != 'Major Highway': continue
    for l in lines(f['geometry']):
        for run in clip_line(l):
            s = simplify([tuple(q) for q in run], 0.01)
            if len(s) >= 2: rd.append(quant(s))
geo['roads'] = rd

# cities
ct = []
for f in load('ne_10m_populated_places_simple'):
    p = f['properties']; lo, la = f['geometry']['coordinates'][:2]
    if p.get('adm0name') not in (CITY_COUNTRIES if REGION == 'GCC' else COUNTRIES) or not inside((lo, la)): continue
    if (p.get('pop_max') or 0) < POP: continue
    ct.append({'n': p['name'], 'lat': round(la, 4), 'lon': round(lo, 4), 'pop': int(p['pop_max']), 'st': p.get('adm1name') or ''})
ct.sort(key=lambda c: -c['pop'])
geo['cities'] = ct

# airports
ap = []
for f in load('ne_10m_airports'):
    p = f['properties']; lo, la = f['geometry']['coordinates'][:2]
    if not inside((lo, la)): continue
    if REGION in ('SEA', 'GCC') and 'major' not in (p.get('type') or ''): continue
    ap.append({'n': (p.get('name') or '').strip(), 'icao': p.get('gps_code') or '', 'iata': p.get('iata_code') or '',
               'lat': round(la, 4), 'lon': round(lo, 4), 'ty': p.get('type') or ''})
geo['airports'] = ap

# rasters
Image.MAX_IMAGE_PIXELS = None
def crop(fn):
    im = Image.open(f'{TEX}/{fn}'); W, H = im.size
    x0 = (LON0 + 180) / 360 * W; x1 = (LON1 + 180) / 360 * W
    y0 = (90 - LAT1) / 180 * H; y1 = (90 - LAT0) / 180 * H
    # resample the exact fractional box to a fixed grid
    return im.transform((RW, round(RW * (LAT1 - LAT0) / (LON1 - LON0))), Image.EXTENT, (x0, y0, x1, y1), Image.BICUBIC)

def b64(im, fmt, **kw):
    b = io.BytesIO(); im.save(b, fmt, **kw)
    return f'data:image/{fmt.lower()};base64,' + base64.b64encode(b.getvalue()).decode()

bump = crop('earth_bump_roughness_clouds_4096.jpg').split()[0].filter(ImageFilter.GaussianBlur(0.8))
a = np.asarray(bump).astype(np.float32); a = np.clip((a - 2) / (a.max() - 2), 0, 1) * 255
geo['dem'] = b64(Image.fromarray(a.astype(np.uint8)), 'PNG', optimize=True)
geo['tint'] = b64(crop('earth_day_4096.jpg').convert('RGB'), 'JPEG', quality=80)
geo['lights'] = b64(crop('earth_night_4096.jpg').convert('L'), 'JPEG', quality=72)

js = '/* Generated by tools/geo.py. Natural Earth 1:10m (public domain) + NASA-derived relief, colour and night lights. */\nconst ' + VAR + ' = ' + json.dumps(geo, separators=(',', ':')) + ';\n'
open(OUT, 'w').write(js)
n = lambda k: sum(len(x if isinstance(x, list) else x['p']) for x in geo[k]) // 2
print({k: (len(geo[k]), n(k)) for k in ('land', 'coast', 'deep', 'states', 'rivers', 'lakes', 'roads')})
print('cities', len(ct), [c['n'] for c in ct[:60]])
print('airports', [(a['iata'], a['n']) for a in ap])
print('rivers', sorted(set(r['n'] for r in rv)))
print('bytes', len(js))
