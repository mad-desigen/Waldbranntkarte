/* Ergänzt die exportierten WBI-Features um eindeutige Namen und Gestaltungsfarben. */
(() => {
  'use strict';

  const FEATURE_INFO = {
    1: {
      name: 'Sehr geringe Gefahr',
      fullName: 'WBI 1 – Sehr geringe Gefahr',
      slug: 'wbi_1_sehr_geringe_gefahr',
      designColor: '#d0cbc2'
    },
    2: {
      name: 'Geringe Gefahr',
      fullName: 'WBI 2 – Geringe Gefahr',
      slug: 'wbi_2_geringe_gefahr',
      designColor: '#f8f287'
    },
    3: {
      name: 'Mittlere Gefahr',
      fullName: 'WBI 3 – Mittlere Gefahr',
      slug: 'wbi_3_mittlere_gefahr',
      designColor: '#fabb7a'
    },
    4: {
      name: 'Hohe Gefahr',
      fullName: 'WBI 4 – Hohe Gefahr',
      slug: 'wbi_4_hohe_gefahr',
      designColor: '#fd6165'
    },
    5: {
      name: 'Sehr hohe Gefahr',
      fullName: 'WBI 5 – Sehr hohe Gefahr',
      slug: 'wbi_5_sehr_hohe_gefahr',
      designColor: '#a62121'
    }
  };

  function forecastDate() {
    const day = Number(S.day || 0);
    return S.status?.forecast_dates?.[String(day)]
      || S.status?.images?.find(item => Number(item.day) === day)?.forecast_date
      || new Date(Date.now() + day * 86400000).toISOString().slice(0, 10);
  }

  function applyNames() {
    if (!S.geo?.features) return;

    const date = forecastDate();

    for (const feature of S.geo.features) {
      const oldProperties = feature.properties || {};
      const level = Number(oldProperties.wbi_stufe);
      const info = FEATURE_INFO[level];
      if (!info) continue;

      feature.id = `${info.slug}_${date}`;
      feature.properties = {
        name: info.name,
        title: info.fullName,
        label: info.name,
        description: `${info.fullName}, Prognose ${date}`,
        wbi_name: info.name,
        wbi_name_voll: info.fullName,
        wbi_stufe: level,
        wbi_text: info.name,
        prognosedatum: date,
        prognosetag: Number(S.day || 0),
        dwd_farbe: oldProperties.dwd_farbe || oldProperties.farbe || LV[level].c,
        gestaltungsfarbe: info.designColor,
        ae_farbe: info.designColor,
        farbe: oldProperties.farbe || LV[level].c,
        quelle: oldProperties.quelle || 'Deutscher Wetterdienst – aus DWD-PNG abgeleitete Fläche',
        ...oldProperties
      };

      // Die eindeutigen Benennungsfelder dürfen durch alte Eigenschaften nicht überschrieben werden.
      feature.properties.name = info.name;
      feature.properties.title = info.fullName;
      feature.properties.label = info.name;
      feature.properties.wbi_name = info.name;
      feature.properties.wbi_name_voll = info.fullName;
      feature.properties.wbi_stufe = level;
      feature.properties.wbi_text = info.name;
      feature.properties.prognosedatum = date;
      feature.properties.gestaltungsfarbe = info.designColor;
      feature.properties.ae_farbe = info.designColor;
    }

    S.geo.metadata = {
      ...(S.geo.metadata || {}),
      feature_name_field: 'name',
      feature_title_field: 'title',
      gefahrenstufen: Object.fromEntries(
        Object.entries(FEATURE_INFO).map(([level, info]) => [level, {
          name: info.name,
          title: info.fullName,
          gestaltungsfarbe: info.designColor
        }])
      )
    };

    const text = JSON.stringify(S.geo);
    if ($('size')) {
      $('size').textContent = (new Blob([text]).size / 1024).toLocaleString('de-DE', {
        maximumFractionDigits: 1
      }) + ' KB';
    }
  }

  const previousGenerate = generate;
  generate = async function generateWithFeatureNames() {
    await previousGenerate();
    applyNames();
  };
})();
