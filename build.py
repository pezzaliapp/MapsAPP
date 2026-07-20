#!/usr/bin/env python3
"""
Applica un numero di versione unico a tutti i file che cambiano a ogni rilascio.
Uso: python3 build.py 14.13
Aggiorna: APP_VERSION e SW_EXPECTED in app.js, CACHE in sw.js, e i ?v= negli URL di
index.html (app.js, style.css, manifest). Così ogni versione ha URL diversi e il browser
non può più servire file vecchi dalla cache.
"""
import re, sys, pathlib

if len(sys.argv) != 2:
    print("uso: python3 build.py <versione>  (es. 14.13)"); sys.exit(1)
ver = sys.argv[1].lstrip('v')                     # 14.13
tag = 'v' + ver                                    # v14.13
slug = 'maps-app-v' + ver.replace('.', '-') + '-rel'   # maps-app-v14-13-rel
q = ver.replace('.', '-')                          # 14-13

root = pathlib.Path(__file__).parent
app = (root / 'app.js').read_text()
app = re.sub(r"const APP_VERSION='[^']*'", f"const APP_VERSION='{tag}'", app)
app = re.sub(r"const SW_EXPECTED='[^']*'", f"const SW_EXPECTED='{slug}'", app)
(root / 'app.js').write_text(app)

sw = (root / 'sw.js').read_text()
sw = re.sub(r"const CACHE='[^']*'", f"const CACHE='{slug}'", sw)
(root / 'sw.js').write_text(sw)

html = (root / 'index.html').read_text()
for name in ('style.css', 'app.js', 'manifest.webmanifest'):
    esc = re.escape(name)
    html = re.sub(rf'((?:href|src)=")({esc})(\?v=[^"]*)?(")', rf'\1\2?v={q}\4', html)
(root / 'index.html').write_text(html)

print(f"versione applicata: {tag}  (cache {slug}, asset ?v={q})")
for line in html.split('\n'):
    if '?v=' in line and any(n in line for n in ('app.js', 'style.css', 'manifest')):
        print('  ', line.strip()[:80])
