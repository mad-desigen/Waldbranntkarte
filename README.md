# Waldbrandgefahrenindex Deutschland

Statische GitHub-Pages-Anwendung zur Darstellung der DWD-Waldbrandgefahrenindex-Grafik und zum Export abgeleiteter Flächen als GeoJSON.

## Funktionen

- DWD-Grafik für heute und bis zu vier Folgetage
- passgenaue Darstellung auf der Deutschlandgeometrie
- GeoJSON-Export in WGS 84 / EPSG:4326
- drei wählbare Rasterauflösungen
- automatische Aktualisierung über GitHub Actions
- zusätzliche Unterseite mit aktuellen, streng gefilterten VIIRS-Feuer-Hotspots für Europa
- separate GeoJSON-Dateien für 24 Stunden, 48 Stunden und 7 Tage

## Feuer-Hotspots einrichten

Für den automatischen FIRMS-Abruf wird einmalig ein kostenloser NASA-FIRMS-Schlüssel benötigt:

1. Im Repository **Settings → Secrets and variables → Actions** öffnen.
2. **New repository secret** wählen.
3. Name: `FIRMS_MAP_KEY`
4. Als Wert den persönlichen NASA-FIRMS-MAP_KEY eintragen.
5. Den Workflow **Stabile WBI-Kartenanwendung veröffentlichen** manuell starten oder den nächsten automatischen Lauf abwarten.

Die Hotspot-Anwendung wird anschließend unter `/fire-hotspots/` veröffentlicht. Sie entfernt niedrige Konfidenz, nicht-vegetative Landbedeckung, bebaute/industrielle Nähe und isolierte ortsfeste Mehrtagessignale. Verworfene Punkte werden getrennt als Kontroll-GeoJSON ausgegeben und niemals auf der Hauptkarte angezeigt.

## Veröffentlichung

Die Anwendung wird aus dem Branch `gh-pages` veröffentlicht. Vor jeder automatischen Veröffentlichung wird die Kartenansicht geprüft und die GeoJSON-Erzeugung validiert.

## Datenhinweise

Die exportierten DWD-Geometrien werden aus der offiziellen DWD-PNG-Grafik abgeleitet. Es handelt sich um rasterbasierte Näherungen und nicht um einen originären amtlichen DWD-Vektordatensatz.

Die Feuer-Hotspots basieren auf NASA FIRMS VIIRS NRT und werden mit ESA WorldCover 2021 v200 streng gefiltert. Satellitenbasierte Filter können reale Brände übersehen oder einzelne zweifelhafte Punkte nicht vollständig ausschließen; die Daten sind keine Einsatz- oder Evakuierungsgrundlage.
