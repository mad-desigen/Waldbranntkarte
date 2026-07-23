#!/usr/bin/env python3
"""Erzeugt streng gefilterte VIIRS-Feuer-Hotspots als GeoJSON.

Datenquellen:
- NASA FIRMS VIIRS NRT (S-NPP, NOAA-20, NOAA-21)
- ESA WorldCover 2021 v200 (Landbedeckungsfilter)

Die Filterung entfernt niedrige Konfidenz, nicht-vegetative Landbedeckung,
urbane/industrielle Nähe und isolierte, über mehrere Tage ortsfeste Quellen.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import rasterio
import requests

FIRMS_API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
SOURCES = (
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA20_NRT",
    "VIIRS_NOAA21_NRT",
)
WORLDCOVER_BASE = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/"
    "v200/2021/map"
)
FILTER_VERSION = "1.0.0"

LANDCOVER_NAMES = {
    10: "Baumbedeckung",
    20: "Strauchland",
    30: "Grasland",
    40: "Ackerland",
    50: "Bebaute Fläche",
    60: "Karge/spärliche Vegetation",
    70: "Schnee/Eis",
    80: "Dauergewässer",
    90: "Krautige Feuchtgebiete",
    95: "Mangroven",
    100: "Moos/Flechten",
}
VEGETATION_CODES = {10, 20, 30, 40, 90, 95, 100}
BUILTUP_CODE = 50


@dataclass
class Detection:
    latitude: float
    longitude: float
    acquired_utc: datetime
    source: str
    satellite: str
    confidence: str
    frp: float | None
    bright_ti4: float | None
    bright_ti5: float | None
    scan: float | None
    track: float | None
    daynight: str
    version: str
    worldcover_code: int | None = None
    nearby_builtup_samples: int = 0
    nearby_sample_count: int = 0
    sensor_count: int = 1
    local_cluster_count: int = 1
    fire_score: int = 0
    exclusion_reason: str | None = None

    @property
    def date_key(self) -> str:
        return self.acquired_utc.date().isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--bbox",
        default="-15,27,45,72",
        help="west,south,east,north in EPSG:4326",
    )
    parser.add_argument("--days", type=int, default=7, choices=range(1, 8))
    parser.add_argument(
        "--manual-exclusions",
        type=Path,
        default=None,
        help="GeoJSON mit Point-Features und optional radius_m",
    )
    parser.add_argument(
        "--worldcover-base",
        default=WORLDCOVER_BASE,
    )
    return parser.parse_args()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def empty_collection(name: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "name": name,
        "metadata": metadata,
        "features": [],
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, separators=(",", ": ")) + "\n",
        encoding="utf-8",
    )


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    parts = [float(p.strip()) for p in value.split(",")]
    if len(parts) != 4:
        raise ValueError("BBox muss west,south,east,north enthalten.")
    west, south, east, north = parts
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("Ungültige BBox.")
    return west, south, east, north


def safe_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_datetime(date_value: str, time_value: str) -> datetime:
    hhmm = str(time_value).strip().zfill(4)
    return datetime.strptime(
        f"{date_value} {hhmm}", "%Y-%m-%d %H%M"
    ).replace(tzinfo=timezone.utc)


def request_csv(url: str, session: requests.Session, attempts: int = 4) -> str:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = session.get(url, timeout=(15, 120))
            response.raise_for_status()
            text = response.text
            if "latitude" not in text.splitlines()[0].lower():
                raise RuntimeError(f"Unerwartete FIRMS-Antwort: {text[:160]!r}")
            return text
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < attempts:
                time.sleep(2**attempt)
    raise RuntimeError(f"FIRMS-Abruf fehlgeschlagen: {last_error}")


def date_chunks(days: int, now: datetime) -> list[tuple[int, str | None]]:
    """API erlaubt höchstens 5 Tage je Abruf."""
    if days <= 5:
        return [(days, None)]
    older_days = days - 5
    older_start = (now.date() - timedelta(days=days - 1)).isoformat()
    return [(older_days, older_start), (5, None)]


def fetch_firms(
    map_key: str,
    bbox: tuple[float, float, float, float],
    days: int,
    now: datetime,
) -> tuple[list[Detection], list[str]]:
    west, south, east, north = bbox
    bbox_value = f"{west},{south},{east},{north}"
    session = requests.Session()
    session.headers.update({"User-Agent": "Waldbranntkarte-GeoJSON/1.0"})
    detections: list[Detection] = []
    errors: list[str] = []

    for source in SOURCES:
        for day_range, start_date in date_chunks(days, now):
            suffix = f"/{start_date}" if start_date else ""
            url = f"{FIRMS_API}/{map_key}/{source}/{bbox_value}/{day_range}{suffix}"
            try:
                text = request_csv(url, session)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{source}: {exc}")
                continue

            for row in csv.DictReader(io.StringIO(text)):
                try:
                    acquired = parse_datetime(row["acq_date"], row["acq_time"])
                    detection = Detection(
                        latitude=float(row["latitude"]),
                        longitude=float(row["longitude"]),
                        acquired_utc=acquired,
                        source=source,
                        satellite=row.get("satellite", ""),
                        confidence=row.get("confidence", "").lower(),
                        frp=safe_float(row.get("frp")),
                        bright_ti4=safe_float(row.get("bright_ti4")),
                        bright_ti5=safe_float(row.get("bright_ti5")),
                        scan=safe_float(row.get("scan")),
                        track=safe_float(row.get("track")),
                        daynight=row.get("daynight", ""),
                        version=row.get("version", ""),
                    )
                    detections.append(detection)
                except (KeyError, TypeError, ValueError):
                    continue

    unique: dict[tuple[Any, ...], Detection] = {}
    for item in detections:
        key = (
            round(item.latitude, 5),
            round(item.longitude, 5),
            item.acquired_utc.isoformat(),
            item.source,
        )
        unique[key] = item
    return list(unique.values()), errors


def worldcover_tile(lat: float, lon: float) -> str:
    lat0 = math.floor(lat / 3.0) * 3
    lon0 = math.floor(lon / 3.0) * 3
    lat_token = f"N{lat0:02d}" if lat0 >= 0 else f"S{abs(lat0):02d}"
    lon_token = f"E{lon0:03d}" if lon0 >= 0 else f"W{abs(lon0):03d}"
    return f"{lat_token}{lon_token}"


def neighbour_coordinates(lat: float, lon: float) -> list[tuple[float, float]]:
    radius_m = 600.0
    dlat = radius_m / 111_320.0
    cos_lat = max(math.cos(math.radians(lat)), 0.2)
    dlon = radius_m / (111_320.0 * cos_lat)
    return [
        (lon, lat),
        (lon - dlon, lat),
        (lon + dlon, lat),
        (lon, lat - dlat),
        (lon, lat + dlat),
        (lon - dlon, lat - dlat),
        (lon - dlon, lat + dlat),
        (lon + dlon, lat - dlat),
        (lon + dlon, lat + dlat),
    ]


def sample_worldcover(
    detections: list[Detection], base_url: str
) -> list[str]:
    groups: dict[str, list[int]] = defaultdict(list)
    for index, item in enumerate(detections):
        groups[worldcover_tile(item.latitude, item.longitude)].append(index)

    errors: list[str] = []
    env_options = {
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
        "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
        "GDAL_HTTP_MULTIPLEX": "YES",
        "GDAL_HTTP_VERSION": "2",
        "VSI_CACHE": "TRUE",
        "VSI_CACHE_SIZE": 20_000_000,
    }

    with rasterio.Env(**env_options):
        for tile, indices in sorted(groups.items()):
            url = f"{base_url}/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
            samples: list[tuple[float, float]] = []
            ranges: list[tuple[int, int, int]] = []
            for index in indices:
                start = len(samples)
                samples.extend(
                    neighbour_coordinates(
                        detections[index].latitude, detections[index].longitude
                    )
                )
                ranges.append((index, start, len(samples)))

            values: list[int] | None = None
            last_error: Exception | None = None
            for attempt in range(1, 4):
                try:
                    with rasterio.open(url) as dataset:
                        values = [int(v[0]) for v in dataset.sample(samples)]
                    break
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    time.sleep(2**attempt)

            if values is None:
                errors.append(f"WorldCover {tile}: {last_error}")
                for index in indices:
                    detections[index].exclusion_reason = "landcover_unavailable"
                continue

            for index, start, end in ranges:
                point_values = values[start:end]
                detections[index].worldcover_code = point_values[0]
                nearby = point_values[1:]
                detections[index].nearby_sample_count = len(nearby)
                detections[index].nearby_builtup_samples = sum(
                    1 for value in nearby if value == BUILTUP_CODE
                )

    return errors


def haversine_m(a: Detection, b: Detection) -> float:
    radius = 6_371_008.8
    lat1 = math.radians(a.latitude)
    lat2 = math.radians(b.latitude)
    dlat = lat2 - lat1
    dlon = math.radians(b.longitude - a.longitude)
    value = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(value))


def grid_key(lat: float, lon: float, cell_deg: float) -> tuple[int, int]:
    return (math.floor(lat / cell_deg), math.floor(lon / cell_deg))


def neighbouring_indices(
    detections: list[Detection], cell_deg: float = 0.025
) -> tuple[dict[tuple[int, int], list[int]], dict[int, tuple[int, int]]]:
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    keys: dict[int, tuple[int, int]] = {}
    for index, item in enumerate(detections):
        key = grid_key(item.latitude, item.longitude, cell_deg)
        grid[key].append(index)
        keys[index] = key
    return grid, keys


def enrich_spatial_context(detections: list[Detection]) -> None:
    grid, keys = neighbouring_indices(detections)
    for index, item in enumerate(detections):
        row, col = keys[index]
        candidates: list[int] = []
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                candidates.extend(grid.get((row + dr, col + dc), []))

        local_sources = {item.source}
        local_count = 0
        for other_index in candidates:
            other = detections[other_index]
            distance = haversine_m(item, other)
            delta_hours = abs(
                (item.acquired_utc - other.acquired_utc).total_seconds()
            ) / 3600
            if distance <= 2_000 and delta_hours <= 24:
                local_count += 1
            if distance <= 1_200 and delta_hours <= 4:
                local_sources.add(other.source)
        item.local_cluster_count = max(local_count, 1)
        item.sensor_count = len(local_sources)


def mark_persistent_static_sources(detections: list[Detection]) -> set[int]:
    """Markiert eng ortsfeste und räumlich isolierte Mehrtagessignale."""
    fine_cell = 0.0035
    cells: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, item in enumerate(detections):
        cells[grid_key(item.latitude, item.longitude, fine_cell)].append(index)

    excluded: set[int] = set()
    for indices in cells.values():
        dates = {detections[i].date_key for i in indices}
        if len(dates) < 4:
            continue

        mean_lat = sum(detections[i].latitude for i in indices) / len(indices)
        mean_lon = sum(detections[i].longitude for i in indices) / len(indices)
        center = Detection(
            mean_lat,
            mean_lon,
            detections[indices[0]].acquired_utc,
            "",
            "",
            "",
            None,
            None,
            None,
            None,
            None,
            "",
            "",
        )
        max_spread = max(haversine_m(center, detections[i]) for i in indices)
        if max_spread > 350:
            continue

        isolated = all(detections[i].local_cluster_count <= 3 for i in indices)
        if isolated:
            excluded.update(indices)
    return excluded


def load_manual_exclusions(path: Path | None) -> list[tuple[float, float, float]]:
    if path is None or not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    exclusions: list[tuple[float, float, float]] = []
    for feature in payload.get("features", []):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) < 2:
            continue
        radius = float((feature.get("properties") or {}).get("radius_m", 1_000))
        exclusions.append((float(coordinates[1]), float(coordinates[0]), radius))
    return exclusions


def inside_manual_exclusion(
    detection: Detection, exclusions: list[tuple[float, float, float]]
) -> bool:
    for lat, lon, radius in exclusions:
        center = Detection(
            lat,
            lon,
            detection.acquired_utc,
            "",
            "",
            "",
            None,
            None,
            None,
            None,
            None,
            "",
            "",
        )
        if haversine_m(detection, center) <= radius:
            return True
    return False


def apply_filters(
    detections: list[Detection],
    static_indices: set[int],
    manual_exclusions: list[tuple[float, float, float]],
) -> None:
    for index, item in enumerate(detections):
        if item.exclusion_reason:
            continue
        if item.confidence == "l":
            item.exclusion_reason = "low_confidence"
            continue
        if item.worldcover_code not in VEGETATION_CODES:
            item.exclusion_reason = "non_vegetation_landcover"
            continue
        if item.nearby_builtup_samples >= 2:
            item.exclusion_reason = "urban_or_industrial_proximity"
            continue
        if index in static_indices:
            item.exclusion_reason = "persistent_static_source"
            continue
        if inside_manual_exclusion(item, manual_exclusions):
            item.exclusion_reason = "manual_industrial_exclusion"
            continue

        score = 2
        score += 3 if item.confidence == "h" else 1
        if item.frp is not None:
            score += 2 if item.frp >= 10 else 1 if item.frp >= 3 else 0
        if item.sensor_count >= 2:
            score += 2
        if item.local_cluster_count >= 3:
            score += 1
        if item.nearby_builtup_samples:
            score -= 1
        item.fire_score = score


def feature_from_detection(item: Detection, index: int) -> dict[str, Any]:
    return {
        "type": "Feature",
        "id": f"fire-{index:06d}",
        "geometry": {
            "type": "Point",
            "coordinates": [round(item.longitude, 6), round(item.latitude, 6)],
        },
        "properties": {
            "acquired_utc": item.acquired_utc.isoformat().replace("+00:00", "Z"),
            "source": item.source,
            "satellite": item.satellite,
            "confidence": item.confidence,
            "frp_mw": item.frp,
            "bright_ti4_k": item.bright_ti4,
            "bright_ti5_k": item.bright_ti5,
            "scan_km": item.scan,
            "track_km": item.track,
            "daynight": item.daynight,
            "version": item.version,
            "landcover_code": item.worldcover_code,
            "landcover": LANDCOVER_NAMES.get(
                item.worldcover_code, "Unbekannt"
            ),
            "agricultural": item.worldcover_code == 40,
            "nearby_builtup_samples": item.nearby_builtup_samples,
            "sensor_count_4h_1_2km": item.sensor_count,
            "local_detections_24h_2km": item.local_cluster_count,
            "fire_score": item.fire_score,
            "filter_version": FILTER_VERSION,
        },
    }


def excluded_feature(item: Detection, index: int) -> dict[str, Any]:
    feature = feature_from_detection(item, index)
    feature["id"] = f"excluded-{index:06d}"
    feature["properties"]["exclusion_reason"] = item.exclusion_reason
    return feature


def create_outputs(
    output: Path,
    detections: list[Detection],
    now: datetime,
    bbox: tuple[float, float, float, float],
    source_errors: list[str],
    worldcover_errors: list[str],
    configured: bool,
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    kept = [item for item in detections if item.exclusion_reason is None]
    excluded = [item for item in detections if item.exclusion_reason is not None]
    common_metadata = {
        "generated_utc": now.isoformat().replace("+00:00", "Z"),
        "bbox": list(bbox),
        "sources": list(SOURCES),
        "filter_version": FILTER_VERSION,
        "filter_summary": (
            "VIIRS NRT; niedrige Konfidenz, nicht-vegetative Landbedeckung, "
            "urbane/industrielle Nähe und isolierte ortsfeste Mehrtagessignale entfernt."
        ),
        "crs": "EPSG:4326",
    }

    periods = {"24h": 24, "48h": 48, "7d": 24 * 7}
    counts: dict[str, int] = {}
    agriculture_counts: dict[str, int] = {}
    for label, hours in periods.items():
        cutoff = now - timedelta(hours=hours)
        period_items = [item for item in kept if item.acquired_utc >= cutoff]
        period_items.sort(key=lambda item: item.acquired_utc, reverse=True)
        counts[label] = len(period_items)
        agriculture_counts[label] = sum(
            1 for item in period_items if item.worldcover_code == 40
        )
        collection = empty_collection(
            f"fire_hotspots_{label}",
            {**common_metadata, "period": label, "count": len(period_items)},
        )
        collection["features"] = [
            feature_from_detection(item, index)
            for index, item in enumerate(period_items, start=1)
        ]
        write_json(output / f"fire_hotspots_{label}.geojson", collection)

    excluded_collection = empty_collection(
        "excluded_hotspots_7d",
        {**common_metadata, "period": "7d", "count": len(excluded)},
    )
    excluded_collection["features"] = [
        excluded_feature(item, index)
        for index, item in enumerate(excluded, start=1)
    ]
    write_json(output / "excluded_hotspots_7d.geojson", excluded_collection)

    exclusion_counts = Counter(
        item.exclusion_reason or "unknown" for item in excluded
    )
    status = {
        "configured": configured,
        "generated_utc": common_metadata["generated_utc"],
        "bbox": list(bbox),
        "counts": counts,
        "agriculture_counts": agriculture_counts,
        "raw_count_7d": len(detections),
        "kept_count_7d": len(kept),
        "excluded_count_7d": len(excluded),
        "exclusions": dict(sorted(exclusion_counts.items())),
        "source_errors": source_errors,
        "worldcover_errors": worldcover_errors,
        "filter_version": FILTER_VERSION,
        "message": (
            "Aktuelle, streng gefilterte Vegetationsfeuer-Kandidaten."
            if configured and kept
            else "FIRMS_MAP_KEY fehlt oder es konnten keine Daten erzeugt werden."
        ),
    }
    write_json(output / "status.json", status)


def write_unconfigured(
    output: Path, now: datetime, bbox: tuple[float, float, float, float]
) -> None:
    metadata = {
        "generated_utc": now.isoformat().replace("+00:00", "Z"),
        "bbox": list(bbox),
        "filter_version": FILTER_VERSION,
        "configured": False,
    }
    for label in ("24h", "48h", "7d"):
        write_json(
            output / f"fire_hotspots_{label}.geojson",
            empty_collection(f"fire_hotspots_{label}", {**metadata, "period": label}),
        )
    write_json(
        output / "excluded_hotspots_7d.geojson",
        empty_collection("excluded_hotspots_7d", {**metadata, "period": "7d"}),
    )
    write_json(
        output / "status.json",
        {
            "configured": False,
            "generated_utc": metadata["generated_utc"],
            "bbox": list(bbox),
            "counts": {"24h": 0, "48h": 0, "7d": 0},
            "agriculture_counts": {"24h": 0, "48h": 0, "7d": 0},
            "raw_count_7d": 0,
            "kept_count_7d": 0,
            "excluded_count_7d": 0,
            "exclusions": {},
            "source_errors": [],
            "worldcover_errors": [],
            "filter_version": FILTER_VERSION,
            "message": "GitHub-Secret FIRMS_MAP_KEY ist noch nicht eingerichtet.",
        },
    )


def main() -> int:
    args = parse_args()
    now = utc_now()
    bbox = parse_bbox(args.bbox)
    map_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not map_key:
        write_unconfigured(args.output, now, bbox)
        print("FIRMS_MAP_KEY fehlt; leere Ausgabedateien wurden erzeugt.")
        return 0

    detections, source_errors = fetch_firms(map_key, bbox, args.days, now)
    cutoff = now - timedelta(days=args.days)
    detections = [item for item in detections if cutoff <= item.acquired_utc <= now]
    detections.sort(key=lambda item: item.acquired_utc)

    enrich_spatial_context(detections)
    worldcover_errors = sample_worldcover(detections, args.worldcover_base)
    static_indices = mark_persistent_static_sources(detections)
    manual_exclusions = load_manual_exclusions(args.manual_exclusions)
    apply_filters(detections, static_indices, manual_exclusions)
    create_outputs(
        args.output,
        detections,
        now,
        bbox,
        source_errors,
        worldcover_errors,
        configured=True,
    )

    kept = sum(1 for item in detections if item.exclusion_reason is None)
    print(
        f"{len(detections)} Rohpunkte verarbeitet, {kept} streng gefilterte "
        "Feuer-Hotspots ausgegeben."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:  # noqa: BLE001
        print(f"Fehler: {exc}", file=sys.stderr)
        raise
