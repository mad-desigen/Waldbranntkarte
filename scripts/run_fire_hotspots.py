#!/usr/bin/env python3
"""Startet die Hotspot-Erzeugung über den alternativen offiziellen FIRMS-Host."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("update_fire_hotspots.py")
SPEC = importlib.util.spec_from_file_location("update_fire_hotspots", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Modul konnte nicht geladen werden: {MODULE_PATH}")

module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)
module.FIRMS_API = "https://firms2.modaps.eosdis.nasa.gov/api/area/csv"

if __name__ == "__main__":
    raise SystemExit(module.main())
