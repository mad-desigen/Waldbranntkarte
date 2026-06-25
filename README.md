# Waldbrandgefahrenindex Deutschland

Statische GitHub-Pages-Anwendung zur Darstellung der DWD-Waldbrandgefahrenindex-Grafik und zum Export abgeleiteter Flächen als GeoJSON.

## Funktionen

- DWD-Grafik für heute und bis zu vier Folgetage
- passgenaue Darstellung auf der Deutschlandgeometrie
- GeoJSON-Export in WGS 84 / EPSG:4326
- drei wählbare Rasterauflösungen
- automatische Aktualisierung über GitHub Actions

## Veröffentlichung

Die Anwendung wird aus dem Branch `gh-pages` veröffentlicht. Vor jeder automatischen Veröffentlichung wird die Kartenansicht im Browser geladen und die GeoJSON-Erzeugung geprüft.

## Datenhinweis

Die exportierten Geometrien werden aus der offiziellen DWD-PNG-Grafik abgeleitet. Es handelt sich um rasterbasierte Näherungen und nicht um einen originären amtlichen DWD-Vektordatensatz.
