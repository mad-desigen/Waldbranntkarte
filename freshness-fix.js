/* Ergänzt die bestehende Kartenanwendung um verlässliche Datums- und Frischeangaben.
   Diese Datei wird beim Deployment direkt vor init() eingebunden. */
(() => {
  'use strict';

  const MAX_UI_AGE_HOURS = 30;
  const berlinDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const germanDate = new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Berlin'
  });
  const germanDateTime = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin'
  });

  function dateForDay(day) {
    const fromStatus = S.status?.forecast_dates?.[String(day)];
    const fromImage = S.status?.images?.find(item => Number(item.day) === Number(day))?.forecast_date;
    return fromStatus || fromImage || null;
  }

  function formatIsoDate(iso) {
    if (!iso) return 'Datum unbekannt';
    const date = new Date(`${iso}T12:00:00+02:00`);
    return Number.isNaN(date.getTime()) ? iso : germanDate.format(date);
  }

  function currentBerlinDate() {
    return berlinDate.format(new Date());
  }

  function ageHours(iso) {
    const stamp = new Date(iso);
    return Number.isNaN(stamp.getTime()) ? Infinity : (Date.now() - stamp.getTime()) / 3600000;
  }

  function selectedDate() {
    return dateForDay(Number($('day').value));
  }

  function rebuildDaySelect(statusData) {
    const available = Array.isArray(statusData.available_days) ? statusData.available_days : [];
    $('day').innerHTML = '';
    const today = currentBerlinDate();

    for (const rawDay of available) {
      const day = Number(rawDay);
      const iso = statusData.forecast_dates?.[String(day)]
        || statusData.images?.find(item => Number(item.day) === day)?.forecast_date;
      if (!iso) continue;

      let prefix;
      if (iso === today) prefix = 'Heute';
      else if (day === 1) prefix = '+1 Tag';
      else prefix = `+${day} Tage`;

      $('day').add(new Option(`${prefix} · ${formatIsoDate(iso)}`, String(day)));
    }

    if (!$('day').options.length) {
      throw new Error('Im Datenstatus sind keine datierten DWD-Prognosen vorhanden.');
    }
  }

  const originalLoadStatus = loadStatus;
  loadStatus = async function loadStatusWithDates() {
    const response = await fetch(`data/status.json?_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Datenstatus fehlt (HTTP ${response.status}).`);

    const data = await response.json();
    S.status = data;
    S.version = data.updated_at || Date.now();
    rebuildDaySelect(data);

    const age = ageHours(data.updated_at);
    S.dataStale = Boolean(data.stale) || age > MAX_UI_AGE_HOURS;
    const updateText = Number.isFinite(age)
      ? germanDateTime.format(new Date(data.updated_at)) + ' Uhr'
      : 'unbekannt';

    $('stamp').textContent = S.dataStale
      ? `VERALTETER DATENSTAND · Abruf ${updateText}`
      : `DWD-Abruf ${updateText}`;
  };

  const originalLoadDay = loadDay;
  loadDay = async function loadDayWithFreshness(force = false) {
    await originalLoadDay(force);
    const iso = selectedDate();
    if (S.dataStale) {
      status('Veraltete Daten');
      note(
        `Achtung: Die Karte gehört zur DWD-Prognose für ${formatIsoDate(iso)}. ` +
        'Der Datenabruf ist älter als 30 Stunden; es wird kein aktuelles Datum vorgetäuscht.',
        'err'
      );
    } else {
      status('Bereit');
      note(
        `DWD-Prognose für ${formatIsoDate(iso)}. ` +
        `Datenabruf: ${germanDateTime.format(new Date(S.status.updated_at))} Uhr.`,
        'ok'
      );
    }
  };

  const originalGenerate = generate;
  generate = async function generateWithCorrectDate() {
    await originalGenerate();
    if (!S.geo) return;

    const iso = selectedDate();
    const stale = Boolean(S.dataStale);
    S.geo.metadata = {
      ...S.geo.metadata,
      prognosedatum: iso,
      datenabruf: S.status?.updated_at || null,
      daten_veraltet: stale,
      hinweis: stale
        ? 'Der Datensatz war beim Export als veraltet gekennzeichnet.'
        : 'Bundeslandlinien wurden vor der WBI-Flächenberechnung entfernt.'
    };

    for (const feature of S.geo.features || []) {
      feature.properties = {
        ...feature.properties,
        datum: iso,
        datenabruf: S.status?.updated_at || null,
        daten_veraltet: stale
      };
    }

    const text = JSON.stringify(S.geo);
    $('size').textContent = (new Blob([text]).size / 1024).toLocaleString('de-DE', {
      maximumFractionDigits: 1
    }) + ' KB';

    if (stale) {
      note(`GeoJSON für ${formatIsoDate(iso)} erzeugt – Datensatz ist als veraltet markiert.`, 'err');
    } else {
      note(`GeoJSON für ${formatIsoDate(iso)} erzeugt.`, 'ok');
    }
  };

  $('day').onchange = () => loadDay();
  $('generate').onclick = generate;
  $('download').onclick = () => {
    if (!S.geo) return;
    const iso = selectedDate() || 'unbekannt';
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(S.geo, null, 2)], { type: 'application/geo+json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `waldbrandgefahrenindex_${iso}.geojson`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
})();
