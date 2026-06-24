#!/usr/bin/env python3
"""Fetch DWD WBI assets for a static GitHub Pages deployment."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DWD_PAGE = "https://www.wettergefahren.de/warnungen/indizes/waldbrand.html"
DWD_PAGE_FALLBACK = "https://www.dwd.de/DE/leistungen/waldbrandgef/waldbrandgef.html"
WFS_URLS = [
    "https://maps.dwd.de/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=dwd%3AWarngebiete_Bundeslaender&outputFormat=application%2Fjson&srsName=EPSG%3A4326",
    "https://maps.dwd.de/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=dwd%3AKV_VG250_BUNDESLAENDER_2020&outputFormat=application%2Fjson&srsName=EPSG%3A4326",
]
IMAGE_HOSTS = [
    "https://www.dwd.de/DWD/warnungen/agrar/wbx/",
    "https://www.wettergefahren.de/DWD/warnungen/agrar/wbx/",
]
STATE_NAMES = [
    "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg",
    "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen",
    "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt",
    "Schleswig-Holstein", "Thüringen",
]


def build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=4,
        connect=4,
        read=4,
        backoff_factor=1.2,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        raise_on_status=False,
    )
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (compatible; WBI-GitHub-Pages/1.0; +https://github.com/)",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        "Referer": "https://www.wettergefahren.de/",
    })
    return session


def get_bytes(session: requests.Session, url: str, accept: str, timeout: int = 45) -> bytes:
    response = session.get(url, timeout=timeout, headers={"Accept": accept})
    response.raise_for_status()
    return response.content


def first_valid(
    session: requests.Session,
    urls: Iterable[str],
    accept: str,
    validator: Callable[[bytes], bool],
) -> tuple[bytes, str]:
    errors: list[str] = []
    for url in urls:
        try:
            body = get_bytes(session, url, accept)
            if not validator(body):
                raise ValueError("unerwartetes Datenformat")
            return body, url
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    raise RuntimeError(" | ".join(errors))


def valid_png(body: bytes) -> bool:
    return len(body) > 1000 and body.startswith(b"\x89PNG\r\n\x1a\n")


def valid_html(body: bytes) -> bool:
    lower = body[:250_000].lower()
    return len(body) > 10_000 and b"waldbrand" in lower and b"bundesland" in lower


def valid_geojson(body: bytes) -> bool:
    try:
        data = json.loads(body.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    return (
        isinstance(data, dict)
        and data.get("type") == "FeatureCollection"
        and isinstance(data.get("features"), list)
        and len(data["features"]) >= 16
    )


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def canonical_state(value: str) -> str | None:
    compact = normalize_space(value).casefold()
    for name in sorted(STATE_NAMES, key=len, reverse=True):
        if name.casefold() in compact:
            return name
    return None


def parse_table_html(html: bytes) -> dict:
    soup = BeautifulSoup(html, "lxml")
    states: dict[str, list[dict]] = {}
    dates: list[str] = []

    for heading in soup.find_all(["h2", "h3", "h4", "h5"]):
        heading_text = normalize_space(heading.get_text(" ", strip=True))
        if "Bundesland" not in heading_text:
            continue
        state_name = canonical_state(heading_text)
        if not state_name:
            continue
        table = heading.find_next("table")
        if table is None:
            continue
        rows: list[dict] = []
        table_rows = table.find_all("tr")
        for row_index, row in enumerate(table_rows):
            cells = [normalize_space(cell.get_text(" ", strip=True)) for cell in row.find_all(["th", "td"])]
            if len(cells) < 2:
                continue
            if not dates and row_index == 0:
                dates = cells[1:6]
            station = cells[0]
            if not station or "Stationsname" in station:
                continue
            values: list[int | None] = []
            for raw in cells[1:6]:
                values.append(int(raw) if re.fullmatch(r"[1-5]", raw) else None)
            if any(isinstance(value, int) for value in values):
                rows.append({"station": station, "values": values})
        if rows:
            states[state_name] = rows

    missing = sorted(set(STATE_NAMES) - set(states))
    if missing:
        raise RuntimeError("DWD-Tabelle unvollständig; fehlende Bundesländer: " + ", ".join(missing))
    station_count = sum(len(rows) for rows in states.values())
    if station_count < 200:
        raise RuntimeError(f"Zu wenige DWD-Stationen erkannt: {station_count}")

    return {
        "source": DWD_PAGE,
        "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dates": dates,
        "states": states,
        "state_count": len(states),
        "station_count": station_count,
        "parser": "beautifulsoup-lxml",
    }


def image_urls(day: int) -> list[str]:
    suffix = "" if day == 0 else str(day)
    legacy = "" if day == 0 else f"{day}kl"
    filenames = list(dict.fromkeys([
        f"wbx_stationen{suffix}.png",
        f"wbx_stationen{legacy}.png",
    ]))
    return [urljoin(host, filename) for host in IMAGE_HOSTS for filename in filenames]


def atomic_write(path: Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(body)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("site/data"))
    args = parser.parse_args()
    output: Path = args.output
    output.mkdir(parents=True, exist_ok=True)
    session = build_session()
    status: dict = {
        "ok": False,
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source_page": DWD_PAGE,
        "images": [],
        "warnings": [],
    }

    states_body, states_source = first_valid(
        session,
        WFS_URLS,
        "application/geo+json,application/json;q=0.9,*/*;q=0.2",
        valid_geojson,
    )
    states_data = json.loads(states_body.decode("utf-8-sig"))
    atomic_write(output / "states.geojson", json.dumps(states_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    status["states_source"] = states_source
    status["state_feature_count"] = len(states_data.get("features", []))

    html_body, page_source = first_valid(
        session,
        [DWD_PAGE, DWD_PAGE_FALLBACK],
        "text/html,application/xhtml+xml;q=0.9,*/*;q=0.3",
        valid_html,
    )
    table_data = parse_table_html(html_body)
    table_data["source"] = page_source
    atomic_write(output / "table.json", json.dumps(table_data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    status["table_source"] = page_source
    status["state_count"] = table_data["state_count"]
    status["station_count"] = table_data["station_count"]
    status["dates"] = table_data["dates"]

    for day in range(5):
        body, source = first_valid(
            session,
            image_urls(day),
            "image/png,image/*;q=0.9,*/*;q=0.2",
            valid_png,
        )
        atomic_write(output / f"wbi_{day}.png", body)
        status["images"].append({"day": day, "source": source, "bytes": len(body)})

    status["ok"] = True
    atomic_write(output / "status.json", json.dumps(status, ensure_ascii=False, indent=2).encode("utf-8"))
    print(json.dumps(status, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FEHLER: {exc}", file=sys.stderr)
        raise
