(() => {
  "use strict";

  const state = {
    period: "24h",
    includeAgriculture: true,
    quality: "all",
    data: null,
    layer: null,
  };

  const map = L.map("map", {
    zoomControl: true,
    minZoom: 3,
    maxZoom: 15,
    preferCanvas: true,
  }).setView([49.5, 11], 4);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles © Esri, Maxar, Earthstar Geographics",
    },
  ).addTo(map);

  L.tileLayer(
    "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      pane: "overlayPane",
      attribution: "Grenzen und Orte © Esri",
    },
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
    return `
      <strong>Feuer-Hotspot</strong>
      <div class="popup-grid">
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
    const collection = { type: "FeatureCollection", features };

    state.layer = L.geoJSON(collection, {
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

    countMessage.textContent = `${features.length.toLocaleString("de-DE")} Punkte angezeigt`;
    if (features.length && state.layer.getBounds().isValid()) {
      map.fitBounds(state.layer.getBounds(), { padding: [28, 28], maxZoom: 6 });
    }
  };

  const loadPeriod = async (period) => {
    state.period = period;
    document.querySelectorAll(".period-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.period === period);
    });
    const url = `data/fire_hotspots_${period}.geojson`;
    downloadLink.href = url;
    setStatus("GeoJSON wird geladen …");
    try {
      const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
      setStatus("Streng gefilterte Vegetationsfeuer");
      timeMessage.textContent = `Stand: ${formatDate(state.data.metadata?.generated_utc)}`;
      render();
    } catch (error) {
      console.error(error);
      state.data = { type: "FeatureCollection", features: [] };
      setStatus("GeoJSON konnte nicht geladen werden.", true);
      countMessage.textContent = "";
      timeMessage.textContent = "";
      render();
    }
  };

  const loadStatus = async () => {
    try {
      const response = await fetch(`data/status.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const status = await response.json();
      if (!status.configured) {
        setStatus(status.message || "FIRMS_MAP_KEY ist noch nicht eingerichtet.", true);
      }
    } catch (error) {
      console.warn("Status konnte nicht geladen werden", error);
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

  Promise.all([loadPeriod("24h"), loadStatus()]);
})();
