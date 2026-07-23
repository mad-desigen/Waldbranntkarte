(() => {
  "use strict";

  const state = {
    period: "24h",
    includeAgriculture: true,
    quality: "all",
    data: null,
    vectorLayer: null,
    gibsLayers: [],
  };

  const map = L.map("map", {
    zoomControl: true,
    minZoom: 2,
    maxZoom: 15,
    preferCanvas: true,
    worldCopyJump: true,
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

  const isoDate = (date) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const addGibsLayer = (layerName, date) => {
    const layer = L.tileLayer.wms(
      "https://{s}.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi",
      {
        subdomains: ["gibs-a", "gibs-b", "gibs-c"],
        layers: layerName,
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        crossOrigin: true,
        TIME: `${date}T00:00:00Z`,
        opacity: 1,
        attribution: "NASA GIBS/LANCE (VIIRS)",
      },
    );
    layer.addTo(map);
    state.gibsLayers.push(layer);
  };

  const rebuildGibs = () => {
    state.gibsLayers.forEach((layer) => map.removeLayer(layer));
    state.gibsLayers = [];

    const days = state.period === "7d" ? 7 : state.period === "48h" ? 2 : 1;
    const today = new Date();

    for (let offset = 0; offset < days; offset += 1) {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() - offset);
      const day = isoDate(date);
      addGibsLayer("VIIRS_NOAA20_Thermal_Anomalies_375m_All", day);
      addGibsLayer("VIIRS_SNPP_Thermal_Anomalies_375m_All", day);
    }

    countMessage.textContent = "Live-VIIRS-Feuerpunkte geladen";
    timeMessage.textContent = `Kartendatum: ${isoDate(today)}`;
  };

  const filteredFeatures = () => {
    if (!state.data?.features) return [];
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

  const renderVectors = () => {
    if (state.vectorLayer) map.removeLayer(state.vectorLayer);
    const features = filteredFeatures();
    state.vectorLayer = L.geoJSON({ type: "FeatureCollection", features }, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: markerRadius(feature.properties?.frp_mw),
        color: "#ffb44a",
        weight: 0.8,
        fillColor: "#ff3d1f",
        fillOpacity: 0.88,
      }),
    }).addTo(map);

    if (features.length) {
      countMessage.textContent = `${features.length.toLocaleString("de-DE")} GeoJSON-Punkte + Live-VIIRS`;
    }
  };

  const loadPeriod = async (period) => {
    state.period = period;
    document.querySelectorAll(".period-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.period === period);
    });

    rebuildGibs();
    setStatus("Live-VIIRS-Feuerpunkte über NASA GIBS");

    const url = `data/fire_hotspots_${period}.geojson`;
    downloadLink.href = url;

    try {
      const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
      renderVectors();
      if (state.data?.metadata?.generated_utc) {
        timeMessage.textContent = `Stand: ${formatDate(state.data.metadata.generated_utc)}`;
      }
    } catch (error) {
      console.warn("GeoJSON nicht verfügbar", error);
      state.data = { type: "FeatureCollection", features: [] };
      renderVectors();
    }
  };

  document.querySelectorAll(".period-button").forEach((button) => {
    button.addEventListener("click", () => loadPeriod(button.dataset.period));
  });

  agricultureToggle.addEventListener("change", () => {
    state.includeAgriculture = agricultureToggle.checked;
    renderVectors();
  });

  qualitySelect.addEventListener("change", () => {
    state.quality = qualitySelect.value;
    renderVectors();
  });

  loadPeriod("24h");
})();
