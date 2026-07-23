#!/usr/bin/env python3
"""Erzeugt gefilterte Feuer-Hotspots über den offiziellen FIRMS-WFS-Dienst.

Der WFS-Dienst läuft auf einem anderen NASA-Host als die Area-API und liefert
VIIRS-Punkte für Europa direkt als CSV. Die bestehende Filter- und GeoJSON-
Logik aus update_fire_hotspots.py wird weiterverwendet.
"""
from __future__ import annotations

import csv
import importlib.util
import io
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import requests

MODULE_PATH = Path(__file__).with_name("update_fire_hotspots.py")
SPEC = importlib.util.spec_from_file_location("fire_core", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Modul konnte nicht geladen werden: {MODULE_PATH}")
core = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = core
SPEC.loader.exec_module(core)

WFS_BASE = "https://firms2.modaps.eosdis.nasa.gov/mapserver/wfs/Europe"
TYPE_NAMES = {
    "VIIRS_SNPP_NRT": "ms:fires_snpp_7days",
    "VIIRS_NOAA20_NRT": "ms:fires_noaa20_7days",
    "VIIRS_NOAA21_NRT": "ms:fires_noaa21_7days",
}


def first_value(row: dict[str, str], *names: str) -> str:
    lowered = {str(k).lower(): v for k, v in row.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value not in (None, ""):
            return str(value)
    return ""


def request_wfs_csv(map_key: str, type_name: str, attempts: int = 4) -> str:
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAME": type_name,
        "SRSNAME": "urn:ogc:def:crs:EPSG::4326",
        "BBOX": "27,-15,72,45,urn:ogc:def:crs:EPSG::4326",
        "COUNT": "100000",
        "STARTINDEX": "0",
        "outputformat": "csv",
    }
    url = f"{WFS_BASE}/{map_key}/?{urlencode(params)}"
    session = requests.Session()
    session.headers.update({"User-Agent": "Waldbranntkarte-GeoJSON/2.0"})
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = session.get(url, timeout=(20, 180))
            response.raise_for_status()
            text = response.text
            first_line = text.splitlines()[0].lower() if text.splitlines() else ""
            if "latitude" not in first_line and "lat" not in first_line:
                raise RuntimeError(f"Unerwartete WFS-Antwort: {text[:240]!r}")
            return text
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"FIRMS-WFS-Abruf fehlgeschlagen: {last_error}")


def parse_detection(row: dict[str, str], source: str):
    lat = first_value(row, "latitude", "lat", "y")
    lon = first_value(row, "longitude", "lon", "long", "x")
    date_value = first_value(row, "acq_date", "acqdate", "date")
    time_value = first_value(row, "acq_time", "acqtime", "time")
    if not (lat and lon and date_value and time_value):
        return None

    confidence = first_value(row, "confidence").lower()
    # WFS kann numerische oder textuelle Konfidenz liefern.
    if confidence.isdigit():
        number = int(confidence)
        confidence = "h" if number >= 80 else "n" if number >= 30 else "l"
    elif confidence.startswith("high"):
        confidence = "h"
    elif confidence.startswith("low"):
        confidence = "l"
    elif confidence not in {"h", "n", "l"}:
        confidence = "n"

    return core.Detection(
        latitude=float(lat),
        longitude=float(lon),
        acquired_utc=core.parse_datetime(date_value[:10], time_value),
        source=source,
        satellite=first_value(row, "satellite", "instrument") or source,
        confidence=confidence,
        frp=core.safe_float(first_value(row, "frp")),
        bright_ti4=core.safe_float(first_value(row, "bright_ti4", "brightness")),
        bright_ti5=core.safe_float(first_value(row, "bright_ti5", "bright_t31")),
        scan=core.safe_float(first_value(row, "scan")),
        track=core.safe_float(first_value(row, "track")),
        daynight=first_value(row, "daynight"),
        version=first_value(row, "version"),
    )


def fetch_wfs(map_key: str):
    detections = []
    errors: list[str] = []
    for source, type_name in TYPE_NAMES.items():
        try:
            text = request_wfs_csv(map_key, type_name)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{source}: {exc}")
            continue
        for row in csv.DictReader(io.StringIO(text)):
            try:
                item = parse_detection(row, source)
                if item is not None:
                    detections.append(item)
            except (TypeError, ValueError, KeyError):
                continue

    unique = {}
    for item in detections:
        key = (
            round(item.latitude, 5),
            round(item.longitude, 5),
            item.acquired_utc.isoformat(),
            item.source,
        )
        unique[key] = item
    return list(unique.values()), errors


def main() -> int:
    args = core.parse_args()
    now = core.utc_now()
    bbox = core.parse_bbox(args.bbox)
    map_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not map_key:
        core.write_unconfigured(args.output, now, bbox)
        print("FIRMS_MAP_KEY fehlt; leere Ausgabedateien wurden erzeugt.")
        return 0

    detections, source_errors = fetch_wfs(map_key)
    cutoff = now - core.timedelta(days=args.days)
    west, south, east, north = bbox
    detections = [
        item for item in detections
        if cutoff <= item.acquired_utc <= now
        and south <= item.latitude <= north
        and west <= item.longitude <= east
    ]
    detections.sort(key=lambda item: item.acquired_utc)

    core.enrich_spatial_context(detections)
    worldcover_errors = core.sample_worldcover(detections, args.worldcover_base)
    static_indices = core.mark_persistent_static_sources(detections)
    manual_exclusions = core.load_manual_exclusions(args.manual_exclusions)
    core.apply_filters(detections, static_indices, manual_exclusions)
    core.create_outputs(
        args.output,
        detections,
        now,
        bbox,
        source_errors,
        worldcover_errors,
        configured=True,
    )

    kept = sum(1 for item in detections if item.exclusion_reason is None)
    print(f"{len(detections)} WFS-Rohpunkte verarbeitet, {kept} Feuer-Hotspots ausgegeben.")
    if not detections and source_errors:
        print("\n".join(source_errors), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
