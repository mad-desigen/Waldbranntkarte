# Waldbrandgefahrenindex Deutschland

PHP-Webanwendung zur Darstellung der DWD-Waldbrandgefahrenindex-Grafik und zum Export abgeleiteter Flächen als GeoJSON.

## Funktionen

- DWD-Grafik für heute und bis zu vier Folgetage
- Heatmap auf einer interaktiven Karte
- lokale PNG-Datei als alternative Datenquelle
- GeoJSON-Export in WGS 84 / EPSG:4326
- drei wählbare Rasterauflösungen

## Installation

`index.php` auf einen Webspace mit PHP hochladen und dort über den Browser öffnen.

Der Server benötigt entweder PHP-cURL oder aktiviertes `allow_url_fopen`.

## Hinweis zu GitHub Pages

GitHub Pages führt kein PHP aus. Das Repository dient daher zur Versionsverwaltung. Für den Betrieb ist ein PHP-fähiger Webspace erforderlich.

## Datenhinweis

Die exportierten Geometrien werden aus der offiziellen DWD-PNG-Grafik abgeleitet. Es handelt sich um rasterbasierte Näherungen und nicht um einen originären amtlichen DWD-Vektordatensatz.
