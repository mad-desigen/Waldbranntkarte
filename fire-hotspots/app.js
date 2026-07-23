(() => {
  "use strict";

  const state = {
    period: "24h",
    includeAgriculture: true,
    quality: "all",
    data: null,
    layer: null,
    gibsLayers: [],
  };

  const map = L.map("map", {
    zoomControl: true,
    minZoom: 3,
    maxZoom: 15,
    preferCanvas: true,
  }).setView([49.5, 11], 4);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles © Esri, Maxar, Earthstar Geographics" },
  ).addTo(map);

  L.tileLayer(
    "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, pane: "overlayPane", attribution: "Grenzen und Orte © Esri" },
  ).addTo(map);

  const statusMessage = document.querySelector("#status-message");
  const countMessage = document.querySelector("#count-message");
  const timeMessage = document.querySelector("#time-message");
  const downloadLink = document.querySelector("#download-link");
  const agricultureToggle = document.querySelector("#agriculture-toggle");
  const qualitySelect = document.querySelector("#quality-select");

  const setStatus = (message, isError = false) => {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error", isError);
  };

  const formatDate = (value) => {
    if (!value) return "unbekannt";
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(new Date(value));
  };

  const isoDay = (date) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const rebuildGibs = () => {
    state.gibsLayers.forEach((layer) => map.removeLayer(layer));
    state.gibsLayers = [];

    const today = new Date();
    const days = state.period === "7d" ? 7 : state.period === "48h" ? 2 : 1;
    const layerNames = [
      "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
      "VIIRS_SNPP_Thermal_Anomalies_375m_All",
      "VIIRS_NOAA21_Thermal_Anomalies_375m_All",
    ];

    for (let offset = 0; offset < days; offset += 1) {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() - offset);
      const time = `${isoDay(date)}T00:00:00Z`;
      layerNames.forEach((name) => {
        const layer = L.tileLayer.wms(
          "https://{s}.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi",
          {
            subdomains: ["gibs-a", "gibs-b", "gibs-c"],
            layers: name,
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            TIME: time,
            opacity: 0.95,
            attribution: "NASA GIBS/LANCE",
          },
        );
        layer.addTo(map);
        state.gibsLayers.push(layer);
      });
    }
  };

  const filteredFeatures = () => {
    if (!state.data) return [];
    return state.data.features.filter((feature) => {
      const p = feature.properties || {};
      if (!state.includeAgriculture && p.agricultural) return false;
      if (state.quality === "high" && p.confidence !== "h") return false;
      if (state.quality === "consensus" && Number(p.sensor_count_4h_1_2km || 0) < 2) return false;
      return true;
    });
  };

  const markerRadius = (frp) => {
    const value = Math.max(0, Number(frp || 0));
    return Math.max(4, Math.min(13, 4 + Math.sqrt(value) * 1.1));
  };

  const popupHtml = (feature) => {
    const p = feature.properties || {};
    return `<strong>Feuer-Hotspot</strong><div class="popup-grid">
      <span>Zeit</span><span>${formatDate(p.acquired_utc)}</span>
      <span>FRP</span><span>${p.frp_mw == null ? "–" : `${Number(p.frp_mw).toFixed(1)} MW`}</span>
      <span>Konfidenz</span><span>${p.confidence === "h" ? "hoch" : "nominal"}</span>
      <span>Landbedeckung</span><span>${p.landcover || "–"}</span>
      <span>Satelliten</span><span>${p.sensor_count_4h_1_2km || 1}</span>
      <span>Quelle</span><span>${p.satellite || p.source || "VIIRS"}</span>
    </div>`;
  };

  const render = () => {
    if (state.layer) map.removeLayer(state.layer);
    const features = filteredFeatures();
    state.layer = L.geoJSON({ type: "FeatureCollection", features }, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: markerRadius(feature.properties?.frp_mw),
        color: "#ffb44a",
        weight: 0.8,
        fillColor: "#ff3d1f",
        fillOpacity: 0.88,
        className: "fire-marker",
      }),
      onEachFeature: (feature, layer) => layer.bindPopup(popupHtml(feature)),
    }).addTo(map);
    countMessage.textContent = features.length
      ? `${features.length.toLocaleString("de-DE")} GeoJSON-Punkte angezeigt`
      : "Live-Feuerpunkte über NASA GIBS sichtbar";
  };

  const loadPeriod = async (period) => {
    state.period = period;
    document.querySelectorAll(".period-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.period === period);
    });
    rebuildGibs();
    const url = `data/fire_hotspots_${period}.geojson`;
    downloadLink.href = url;
    setStatus("Aktuelle VIIRS-Feuerpunkte werden geladen …");
    try {
      const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
      timeMessage.textContent = `Stand: ${formatDate(state.data.metadata?.generated_utc || new Date())}`;
      render();
      setStatus(state.data.features?.length ? "Streng gefilterte Vegetationsfeuer" : "Live-VIIRS-Feuerpunkte; GeoJSON-Erzeugung wird parallel repariert");
    } catch (error) {
      console.error(error);
      state.data = { type: "FeatureCollection", features: [] };
      render();
      setStatus("Live-VIIRS-Feuerpunkte sichtbar; GeoJSON derzeit nicht verfügbar", true);
    }
  };

  document.querySelectorAll(".period-button").forEach((button) => {
    button.addEventListener("click", () => loadPeriod(button.dataset.period));
  });
  agricultureToggle.addEventListener("change", () => {
    state.includeAgriculture = agricultureToggle.checked;
    render();
  });
  qualitySelect.addEventListener("change", () => {
    state.quality = qualitySelect.value;
    render();
  });

  loadPeriod("24h");
})();
