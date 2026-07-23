#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

WFS_BASE = "https://firms.modaps.eosdis.nasa.gov/mapserver/wfs/Europe"
LAYERS = {
    "VIIRS_SNPP_NRT": ("fires_snpp_24hrs", "fires_snpp_7days"),
    "VIIRS_NOAA20_NRT": ("fires_noaa20_24hrs", "fires_noaa20_7days"),
    "VIIRS_NOAA21_NRT": ("fires_noaa21_24hrs", "fires_noaa21_7days"),
}


def args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--bbox", default="-15,27,45,72")
    p.add_argument("--days", type=int, default=7)
    p.add_argument("--manual-exclusions")
    return p.parse_args()


def f(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_dt(row: dict[str, str]) -> datetime | None:
    date = row.get("acq_date") or row.get("ACQ_DATE") or row.get("acqdate")
    time = row.get("acq_time") or row.get("ACQ_TIME") or row.get("acqtime") or "0000"
    if not date:
        return None
    try:
        return datetime.strptime(f"{date} {str(time).zfill(4)}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def request_layer(key: str, typename: str) -> list[dict[str, str]]:
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAME": f"ms:{typename}",
        "SRSNAME": "urn:ogc:def:crs:EPSG::4326",
        "BBOX": "-90,-180,90,180,urn:ogc:def:crs:EPSG::4326",
        "COUNT": "10000",
        "STARTINDEX": "0",
        "outputformat": "csv",
    }
    url = f"{WFS_BASE}/{key}/"
    r = requests.get(url, params=params, timeout=(20, 180), headers={"User-Agent": "Waldbranntkarte/2.0"})
    r.raise_for_status()
    text = r.text.lstrip("\ufeff")
    if not text or "ExceptionReport" in text or "ServiceException" in text:
        raise RuntimeError(text[:300] or "Leere WFS-Antwort")
    return list(csv.DictReader(io.StringIO(text)))


def row_to_feature(row: dict[str, str], source: str) -> dict[str, Any] | None:
    lat = f(row.get("latitude") or row.get("LATITUDE") or row.get("lat") or row.get("y"))
    lon = f(row.get("longitude") or row.get("LONGITUDE") or row.get("lon") or row.get("x"))
    if lat is None or lon is None:
        geom = row.get("msGeometry") or row.get("geometry") or row.get("wkt") or ""
        if "POINT" in geom.upper():
            try:
                inside = geom[geom.index("(") + 1 : geom.index(")")]
                a, b = inside.replace(",", " ").split()[:2]
                lon, lat = float(a), float(b)
            except Exception:
                return None
    if lat is None or lon is None:
        return None
    dt = parse_dt(row)
    confidence = (row.get("confidence") or row.get("CONFIDENCE") or "n").lower()
    if confidence in {"l", "low"}:
        return None
    frp = f(row.get("frp") or row.get("FRP"))
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "acquired_utc": dt.isoformat().replace("+00:00", "Z") if dt else None,
            "confidence": "h" if confidence in {"h", "high"} else "n",
            "frp_mw": frp,
            "satellite": row.get("satellite") or row.get("SATELLITE") or source,
            "source": source,
            "agricultural": False,
            "sensor_count_4h_1_2km": 1,
        },
    }


def collection(features: list[dict[str, Any]], generated: str, period: str) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "metadata": {"generated_utc": generated, "period": period, "source": "NASA FIRMS WFS Europe"},
        "features": features,
    }


def main() -> int:
    ns = args()
    out = ns.output
    out.mkdir(parents=True, exist_ok=True)
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    now = datetime.now(timezone.utc)
    generated = now.isoformat().replace("+00:00", "Z")
    west, south, east, north = [float(x) for x in ns.bbox.split(",")]
    errors: list[str] = []
    raw24: list[dict[str, Any]] = []
    raw7: list[dict[str, Any]] = []

    if key:
        for source, (l24, l7) in LAYERS.items():
            for layer, target in ((l24, raw24), (l7, raw7)):
                try:
                    for row in request_layer(key, layer):
                        feat = row_to_feature(row, source)
                        if not feat:
                            continue
                        lon, lat = feat["geometry"]["coordinates"]
                        if west <= lon <= east and south <= lat <= north:
                            target.append(feat)
                except Exception as exc:
                    errors.append(f"{source}/{layer}: {exc}")

    def dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        found: dict[tuple[Any, ...], dict[str, Any]] = {}
        for feat in items:
            lon, lat = feat["geometry"]["coordinates"]
            p = feat["properties"]
            k = (round(lat, 5), round(lon, 5), p.get("acquired_utc"), p.get("source"))
            found[k] = feat
        return list(found.values())

    data24 = dedupe(raw24)
    data7 = dedupe(raw7)
    cutoff48 = now - timedelta(hours=48)
    data48 = []
    for feat in data7:
        value = feat["properties"].get("acquired_utc")
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
        except ValueError:
            dt = None
        if dt is None or dt >= cutoff48:
            data48.append(feat)

    (out / "fire_hotspots_24h.geojson").write_text(json.dumps(collection(data24, generated, "24h"), ensure_ascii=False), encoding="utf-8")
    (out / "fire_hotspots_48h.geojson").write_text(json.dumps(collection(data48, generated, "48h"), ensure_ascii=False), encoding="utf-8")
    (out / "fire_hotspots_7d.geojson").write_text(json.dumps(collection(data7, generated, "7d"), ensure_ascii=False), encoding="utf-8")
    (out / "excluded_hotspots_7d.geojson").write_text(json.dumps(collection([], generated, "7d"), ensure_ascii=False), encoding="utf-8")
    status = {
        "configured": bool(key),
        "generated_utc": generated,
        "bbox": [west, south, east, north],
        "counts": {"24h": len(data24), "48h": len(data48), "7d": len(data7)},
        "raw_count_7d": len(raw7),
        "kept_count_7d": len(data7),
        "excluded_count_7d": 0,
        "source_errors": errors,
        "filter_version": "2.0.0-wfs",
        "message": "OK" if data7 else ("; ".join(errors)[:1000] or "Keine Daten geliefert"),
    }
    (out / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    if not data7:
        raise SystemExit("FIRMS WFS lieferte keine Punkte: " + status["message"])
    print(json.dumps(status, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
