#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from zoneinfo import ZoneInfo

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

STATE_URLS = [
    "https://maps.dwd.de/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=dwd%3AWarngebiete_Bundeslaender&outputFormat=application%2Fjson&srsName=EPSG%3A4326",
    "https://maps.dwd.de/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=dwd%3AKV_VG250_BUNDESLAENDER_2020&outputFormat=application%2Fjson&srsName=EPSG%3A4326",
    "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/2_bundeslaender/3_mittel.geo.json",
]
HOSTS = [
    "https://www.wettergefahren.de/DWD/warnungen/agrar/wbx/",
    "https://www.dwd.de/DWD/warnungen/agrar/wbx/",
]
BERLIN = ZoneInfo("Europe/Berlin")
MAX_SOURCE_AGE_HOURS = 48


def session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=5,
        connect=5,
        read=5,
        backoff_factor=1,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (compatible; WBI-GitHub-Pages/4.0)",
            "Referer": "https://www.wettergefahren.de/",
            "Cache-Control": "no-cache, no-store, max-age=0",
            "Pragma": "no-cache",
        }
    )
    return s


def cache_bust(url: str, token: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["_wbi_refresh"] = token
    return urlunparse(parsed._replace(query=urlencode(query)))


def fetch_first(s, urls, validator, accept, cache_token=None):
    errors = []
    for original_url in urls:
        request_url = cache_bust(original_url, cache_token) if cache_token else original_url
        try:
            response = s.get(request_url, timeout=60, headers={"Accept": accept})
            response.raise_for_status()
            body = response.content
            if validator(body):
                return body, original_url, dict(response.headers)
            errors.append(f"{original_url}: ungültiges Datenformat")
        except Exception as exc:
            errors.append(f"{original_url}: {exc}")
    raise RuntimeError(" | ".join(errors))


def valid_geo(body: bytes) -> bool:
    try:
        data = json.loads(body.decode("utf-8-sig"))
    except Exception:
        return False
    return (
        isinstance(data, dict)
        and data.get("type") == "FeatureCollection"
        and len(data.get("features", [])) >= 16
    )


def valid_png(body: bytes) -> bool:
    return len(body) > 1000 and body.startswith(b"\x89PNG\r\n\x1a\n")


def image_urls(day: int) -> list[str]:
    names = ["wbx_stationen.png"] if day == 0 else [f"wbx_stationen{day}kl.png", f"wbx_stationen{day}.png"]
    return [urljoin(host, name) for host in HOSTS for name in names]


def write(path: Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(body)
    temporary.replace(path)


def parse_http_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        result = parsedate_to_datetime(value)
        if result.tzinfo is None:
            result = result.replace(tzinfo=timezone.utc)
        return result.astimezone(timezone.utc)
    except Exception:
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("site/data"))
    output = parser.parse_args().output
    output.mkdir(parents=True, exist_ok=True)

    fetched_utc = datetime.now(timezone.utc)
    fetched_berlin = fetched_utc.astimezone(BERLIN)
    cache_token = fetched_utc.strftime("%Y%m%d%H%M%S")
    http = session()

    states_body, states_source, _ = fetch_first(
        http,
        STATE_URLS,
        valid_geo,
        "application/geo+json,application/json;q=0.9,*/*;q=0.2",
        cache_token,
    )
    states = json.loads(states_body.decode("utf-8-sig"))
    write(
        output / "states.geojson",
        json.dumps(states, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
    )

    status = {
        "ok": True,
        "updated_at": fetched_utc.isoformat().replace("+00:00", "Z"),
        "updated_at_berlin": fetched_berlin.isoformat(),
        "dataset_date": fetched_berlin.date().isoformat(),
        "timezone": "Europe/Berlin",
        "max_source_age_hours": MAX_SOURCE_AGE_HOURS,
        "states_source": states_source,
        "state_feature_count": len(states["features"]),
        "images": [],
        "available_days": [],
        "forecast_dates": {},
        "warnings": [],
    }

    for day in range(5):
        forecast_date = (fetched_berlin.date() + timedelta(days=day)).isoformat()
        status["forecast_dates"][str(day)] = forecast_date
        try:
            body, source_url, headers = fetch_first(
                http,
                image_urls(day),
                valid_png,
                "image/png,image/*;q=0.9,*/*;q=0.2",
                cache_token,
            )
            last_modified = parse_http_datetime(headers.get("Last-Modified"))
            source_age_hours = None
            if last_modified:
                source_age_hours = round((fetched_utc - last_modified).total_seconds() / 3600, 2)
                if day == 0 and source_age_hours > MAX_SOURCE_AGE_HOURS:
                    raise RuntimeError(
                        f"DWD-Quelldatei ist laut Last-Modified {source_age_hours:.1f} Stunden alt"
                    )

            write(output / f"wbi_{day}.png", body)
            status["images"].append(
                {
                    "day": day,
                    "forecast_date": forecast_date,
                    "source": source_url,
                    "bytes": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "fetched_at": fetched_utc.isoformat().replace("+00:00", "Z"),
                    "last_modified": last_modified.isoformat().replace("+00:00", "Z") if last_modified else None,
                    "source_age_hours": source_age_hours,
                    "etag": headers.get("ETag"),
                }
            )
            status["available_days"].append(day)
        except Exception as exc:
            status["warnings"].append({"day": day, "error": str(exc)})

    if 0 not in status["available_days"]:
        raise RuntimeError("Die aktuelle DWD-WBI-Karte konnte nicht als frischer Datensatz geladen werden.")

    status["stale"] = False
    write(
        output / "status.json",
        json.dumps(status, ensure_ascii=False, indent=2).encode("utf-8"),
    )
    print(json.dumps(status, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
