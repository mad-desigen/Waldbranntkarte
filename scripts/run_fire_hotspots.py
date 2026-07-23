#!/usr/bin/env python3
"""Startet die Hotspot-Erzeugung mit stabilem IPv4-Abruf der FIRMS-CSV-Daten."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("update_fire_hotspots.py")
SPEC = importlib.util.spec_from_file_location("update_fire_hotspots", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Modul konnte nicht geladen werden: {MODULE_PATH}")

module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)

# Der primäre offizielle FIRMS-Area-Endpunkt ist korrekt. GitHub Actions hatte
# bei requests zeitweise eine nicht erreichbare IPv6-Route gewählt. curl -4
# erzwingt IPv4 und liefert die CSV-Daten zuverlässig.
module.FIRMS_API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"


def request_csv_ipv4(url: str, session: object = None, attempts: int = 4) -> str:
    last_error = "unbekannter Fehler"
    for attempt in range(1, attempts + 1):
        result = subprocess.run(
            [
                "curl",
                "-4",
                "--silent",
                "--show-error",
                "--location",
                "--fail",
                "--retry",
                "3",
                "--retry-all-errors",
                "--connect-timeout",
                "20",
                "--max-time",
                "180",
                "--user-agent",
                "Waldbranntkarte-GeoJSON/1.1",
                url,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            text = result.stdout
            first_line = text.splitlines()[0].lower() if text.splitlines() else ""
            if "latitude" in first_line and "longitude" in first_line:
                return text
            last_error = f"Unerwartete FIRMS-Antwort: {text[:200]!r}"
        else:
            last_error = result.stderr.strip() or f"curl exit {result.returncode}"

        if attempt < attempts:
            subprocess.run(["sleep", str(2**attempt)], check=False)

    raise RuntimeError(f"FIRMS-Abruf fehlgeschlagen: {last_error}")


module.request_csv = request_csv_ipv4

if __name__ == "__main__":
    raise SystemExit(module.main())
