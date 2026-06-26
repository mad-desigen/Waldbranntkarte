(() => {
  'use strict';

  const palettes = {
    mima: {
      name: 'MiMa-Farben',
      logo: 'MiMa-Logo.svg',
      alt: 'MiMa',
      script: 'WBI_GEOlayers_Einfaerben_MiMa-Farben.jsx',
      colors: {1:'#d0cbc2',2:'#f8f287',3:'#fabb7a',4:'#fd6165',5:'#a62121'}
    },
    aktuell: {
      name: 'Aktuell-Farben',
      logo: 'AKTUELL-Logo.svg',
      alt: 'Aktuell',
      script: 'WBI_GEOlayers_Einfaerben_Aktuell-Farben.jsx',
      colors: {1:'#c1bdb2',2:'#fec804',3:'#ff8b00',4:'#c61e1e',5:'#71207f'}
    }
  };

  const sections = Array.from(document.querySelectorAll('aside > section'));
  const daySection = sections[0];
  const displaySection = sections[1];
  const vectorSection = sections[2];
  const geoSection = sections[3];
  const legendSection = sections[4];

  displaySection.hidden = true;
  vectorSection.hidden = true;

  const paletteSection = document.createElement('section');
  paletteSection.innerHTML = '<label for="paletteChoice">Farbschema</label><select id="paletteChoice"><option value="mima">MiMa-Farben</option><option value="aktuell">Aktuell-Farben</option></select>';
  daySection.insertAdjacentElement('afterend', paletteSection);

  const paletteChoice = document.getElementById('paletteChoice');

  const geoHeading = geoSection.querySelector('h2');
  if (geoHeading) geoHeading.hidden = true;
  if (ui.generate) ui.generate.hidden = true;
  if (ui.reload) ui.reload.hidden = true;
  const metrics = geoSection.querySelector('.metrics');
  if (metrics) metrics.hidden = true;
  if (ui.download) {
    ui.download.className = 'secondary';
    ui.download.textContent = 'GeoJSON herunterladen';
  }

  const scriptSection = document.createElement('section');
  scriptSection.innerHTML = '<h2>GEOlayers-Skript</h2><a id="scriptDownload" class="script-download" href="WBI_GEOlayers_Einfaerben_MiMa-Farben.jsx" download>MiMa-Farben herunterladen</a><p class="script-note">After-Effects-Skript zum automatischen Einfärben der importierten GEOlayers-Flächen.</p>';
  legendSection.insertAdjacentElement('afterend', scriptSection);

  const header = document.querySelector('header');
  const oldStatus = header.querySelector('.status');
  const headerRight = document.createElement('div');
  headerRight.className = 'header-right';
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = '<img id="brandLogo" src="MiMa-Logo.svg" alt="MiMa">';
  headerRight.appendChild(brand);
  if (oldStatus) headerRight.appendChild(oldStatus);
  header.appendChild(headerRight);

  const subtitle = header.querySelector('p');
  if (subtitle) {
    subtitle.innerHTML = 'Passgenau auf die amtliche Deutschlandgeometrie · <span id="stamp">Datenstand wird geladen</span>';
    ui.stamp = document.getElementById('stamp');
  }

  function updateDateLabels() {
    const formatter = new Intl.DateTimeFormat('de-DE', {weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
    Array.from(ui.day.options).forEach(option => {
      const offset = Number(option.value);
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const prefix = offset === 0 ? 'Heute' : `+${offset} Tag${offset === 1 ? '' : 'e'}`;
      option.textContent = `${prefix} · ${formatter.format(date)}`;
    });
  }

  function renderLegend() {
    ui.legend.innerHTML = Object.entries(LEVELS).map(([number,value]) =>
      `<div><span class="sw" style="background:${value.color}"></span><span>${number} · ${value.label}</span></div>`
    ).join('');
  }

  function applyPalette(key) {
    const palette = palettes[key];
    Object.entries(palette.colors).forEach(([level,color]) => {
      LEVELS[level].color = color;
    });

    const logo = document.getElementById('brandLogo');
    logo.src = palette.logo + '?v=1';
    logo.alt = palette.alt;

    const scriptLink = document.getElementById('scriptDownload');
    scriptLink.href = palette.script;
    scriptLink.textContent = palette.name + ' herunterladen';

    renderLegend();

    if (S.geojson) {
      S.geojson.features.forEach(feature => {
        const level = feature.properties.wbi_stufe;
        feature.properties.farbe = LEVELS[level].color;
      });
      renderVector();
    }
  }

  renderVector = function renderOpaqueVector() {
    if (S.vectorLayer) map.removeLayer(S.vectorLayer);
    S.vectorLayer = L.geoJSON(S.geojson, {
      style: feature => ({
        color: LEVELS[feature.properties.wbi_stufe].color,
        weight: 0,
        opacity: 0,
        fillColor: LEVELS[feature.properties.wbi_stufe].color,
        fillOpacity: 1
      }),
      onEachFeature: (feature,layer) => layer.bindPopup(`<strong>WBI ${feature.properties.wbi_stufe}</strong><br>${feature.properties.wbi_text}<br>${feature.properties.datum}`)
    });
    visibility();
  };

  ui.opacity.value = '100';
  ui.opval.textContent = '100 %';
  ui.raster.checked = false;
  ui.vector.checked = true;
  ui.borders.checked = true;
  ui.res.value = '190,245';

  paletteChoice.addEventListener('change', () => applyPalette(paletteChoice.value));
  updateDateLabels();
  applyPalette('mima');
  visibility();

  const autoGenerate = window.setInterval(() => {
    if (!S.geojson && ui.generate && !ui.generate.disabled) {
      ui.generate.click();
      return;
    }
    if (S.geojson && ui.download && !ui.download.disabled) {
      ui.raster.checked = false;
      visibility();
    }
  }, 150);

  window.addEventListener('beforeunload', () => window.clearInterval(autoGenerate));
})();
