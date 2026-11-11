"""Rellena lat/lon en tools/paradas-sin-coordenadas.csv y ejecuta:  python tools/aplicar_coordenadas.py"""
import csv, glob, os, re
raiz = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
f = lambda s: float(s.replace(',', '.'))
datos = {r['cod']: (f(r['lat']), f(r['lon'])) for r in csv.DictReader(open(os.path.join(raiz, 'tools', 'paradas-sin-coordenadas.csv'), encoding='utf-8')) if r['lat'].strip() and r['lon'].strip()}
n = 0
for ruta in glob.glob(os.path.join(raiz, 'linea[0-9]*.json')):
    t = open(ruta, encoding='utf-8').read()
    for c, (la, lo) in datos.items():
        t, k = re.subn(r'("%s": \{"name": "[^"]*", "coords": )null' % re.escape(c), r'\g<1>[%s, %s]' % (la, lo), t); n += k
    open(ruta, 'w', encoding='utf-8').write(t)
print(n, 'paradas actualizadas (sube la versión V de sw.js y despliega)')
