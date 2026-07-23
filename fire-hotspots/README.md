# Gefilterte Feuer-Hotspots Europa

Die Unterseite erzeugt aus aktuellen NASA-FIRMS-VIIRS-Daten drei GeoJSON-Dateien für die letzten 24 Stunden, 48 Stunden und 7 Tage.

## Strenge Filterung

- nur VIIRS S-NPP, NOAA-20 und NOAA-21
- niedrige Konfidenz wird entfernt
- nur vegetationsgeprägte ESA-WorldCover-Klassen
- bebaute Flächen und deutliche urbane/industrielle Nähe werden entfernt
- Wasser, Schnee/Eis und karge Flächen werden entfernt
- isolierte, eng ortsfeste Mehrtagessignale werden als wahrscheinliche stationäre Wärmequelle entfernt
- zusätzliche manuelle Ausschlüsse sind über `manual-exclusions.geojson` möglich

## NASA-Schlüssel einrichten

Im Repository unter **Settings → Secrets and variables → Actions → New repository secret** ein Secret mit dem Namen `FIRMS_MAP_KEY` anlegen. Einen kostenlosen Schlüssel stellt NASA FIRMS bereit.

Danach den Workflow **Stabile WBI-Kartenanwendung veröffentlichen** manuell starten oder den nächsten automatischen Lauf abwarten.

## Dateien

- `data/fire_hotspots_24h.geojson`
- `data/fire_hotspots_48h.geojson`
- `data/fire_hotspots_7d.geojson`
- `data/excluded_hotspots_7d.geojson` nur zur Kontrolle der verworfenen Punkte
- `data/status.json`
