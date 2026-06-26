import json
from pathlib import Path

root = Path('site')
required = (
    'index.html', 'app.css', 'app.js', 'fix.js', 'palette-cleanup.js',
    'MiMa-Logo.svg', 'AKTUELL-Logo.svg',
    'WBI_GEOlayers_Einfaerben_MiMa-Farben.jsx',
    'WBI_GEOlayers_Einfaerben_Aktuell-Farben.jsx',
    'data/status.json', 'data/states.geojson',
    'data/wbi_0.png', 'data/wbi_1.png', 'data/wbi_2.png',
    'data/wbi_3.png', 'data/wbi_4.png',
)
for relative in required:
    path = root / relative
    if not path.exists() or path.stat().st_size == 0:
        raise SystemExit(f'Erforderliche Datei fehlt: {relative}')

status = json.loads((root / 'data/status.json').read_text(encoding='utf-8'))
if status.get('ok') is not True:
    raise SystemExit('Der DWD-Datenabruf war nicht erfolgreich.')
if sorted(int(day) for day in status.get('available_days', [])) != [0, 1, 2, 3, 4]:
    raise SystemExit('Es fehlen DWD-Prognosetage.')

html = (root / 'index.html').read_text(encoding='utf-8')
for expected in (
    'MiMa-Farben', 'Aktuell-Farben', 'GEOlayers-Skript',
    'value="100"', 'palette-cleanup.js',
):
    if expected not in html:
        raise SystemExit(f'Erwarteter Oberflächeninhalt fehlt: {expected}')
for removed in ('Daten neu laden', 'Vektorisierung', 'DWD-Flächenkarte anzeigen'):
    if removed in html:
        raise SystemExit(f'Entfernte Option ist wieder sichtbar: {removed}')

app = (root / 'app.js').read_text(encoding='utf-8').lower()
for color in (
    '#d0cbc2', '#f8f287', '#fabb7a', '#fd6165', '#a62121',
    '#c1bdb2', '#fec804', '#ff8b00', '#c61e1e', '#71207f',
):
    if color not in app:
        raise SystemExit(f'Farbschema unvollständig: {color}')

cleanup = (root / 'palette-cleanup.js').read_text(encoding='utf-8')
for marker in (
    'buildInternalStateBoundaryMask',
    'sourceCanvas = function sourceCanvasPaletteOnly',
    'fillGaps = function fillPaletteGaps',
):
    if marker not in cleanup:
        raise SystemExit(f'Ländergrenzen-Bereinigung unvollständig: {marker}')

fix = (root / 'fix.js').read_text(encoding='utf-8')
if 'fillOpacity: 1' not in fix:
    raise SystemExit('Die Vektorflächen sind nicht vollständig deckend.')
if 'map.removeLayer(S.raster)' not in fix:
    raise SystemExit('Die Rastermischung wird nicht entfernt.')

print('Reduzierte Oberfläche, Ländergrenzen-Bereinigung, Farbschemata und DWD-Daten geprüft.')
