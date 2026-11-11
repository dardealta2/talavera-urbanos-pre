"""Genera trazados.json (recorrido por calles) con OSRM. Ejecútalo en tu PC con internet:
    python tools/generar_trazados.py            (todas las líneas)    |    python tools/generar_trazados.py linea5
Ajustes opcionales en tools/trazados-vias.json para forzar por dónde pasa el bus (puntos intermedios tras una parada):
    {"5:ida": [{"tras": "1238", "lat": 39.96, "lon": -4.92}]}
Después sube trazados.json con la web y súbele la versión V a sw.js."""
import glob, json, os, sys, time, urllib.error, urllib.request
RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
URL = 'https://router.project-osrm.org/route/v1/driving/%s?overview=full&geometries=geojson%s'

def osrm(pts, curb):
    time.sleep(1)
    q = ('&approaches=' + ';'.join(['curb'] * len(pts)) + '&continue_straight=true') if curb else ''
    try:
        with urllib.request.urlopen(URL % (';'.join('%s,%s' % (p[1], p[0]) for p in pts), q), timeout=60) as r: j = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 429 or e.code >= 500: raise
        j = json.load(e)
    return j['routes'][0]['geometry']['coordinates'] if j.get('code') == 'Ok' else None

def tramo(pts):
    for curb in (True, False):
        c = osrm(pts, curb)
        if c: return c
    if len(pts) <= 2:
        print('  sin ruta entre', pts[0], 'y', pts[-1], '-> línea recta'); return [[p[1], p[0]] for p in pts]
    m = len(pts) // 2
    return tramo(pts[:m + 1]) + tramo(pts[m:])

def main(sel):
    vp = os.path.join(RAIZ, 'tools', 'trazados-vias.json'); vias = json.load(open(vp, encoding='utf-8')) if os.path.exists(vp) else {}
    sp = os.path.join(RAIZ, 'trazados.json'); sal = json.load(open(sp, encoding='utf-8')) if os.path.exists(sp) else {}
    for f in sorted(glob.glob(os.path.join(RAIZ, 'linea[0-9]*.json'))):
        d = json.load(open(f, encoding='utf-8')); idl = 'linea' + d['linea']
        if sel and idl not in sel: continue
        for s in ('ida', 'vuelta'):
            tablas = [l for l in d.get(s, {}).values() if l]
            if not tablas: continue
            pts = []
            for e in max(tablas, key=len):
                c = d['paradas'][e['cod']]['coords']
                if c and (not pts or pts[-1] != c): pts.append(c)
                pts += [[v['lat'], v['lon']] for v in vias.get('%s:%s' % (d['linea'], s), []) if v['tras'] == e['cod']]
            if len(pts) < 2: continue
            print(idl, s, len(pts), 'puntos')
            sal.setdefault(idl, {})[s] = [[round(x, 5), round(y, 5)] for x, y in tramo(pts)]
    json.dump(sal, open(sp, 'w', encoding='utf-8'), separators=(',', ':')); print('trazados.json listo')

if __name__ == '__main__': main(sys.argv[1:])
