(() => {
  if (!new URLSearchParams(location.search).has('smoketest')) return;
  const root = document.documentElement;
  const started = Date.now();
  root.dataset.smoke = 'pending';

  function check() {
    const state = (document.getElementById('topState')?.textContent || '').trim();
    const notice = (document.getElementById('notice')?.textContent || '').trim();
    const download = document.getElementById('download');
    const palette = document.getElementById('palette');
    const script = document.getElementById('scriptDownload');
    const features = typeof S !== 'undefined' && S.geo?.features ? S.geo.features.length : 0;

    if (/fehler|fehlgeschlagen|konnte nicht/i.test(state + ' ' + notice)) {
      root.dataset.smoke = 'fail';
      root.dataset.smokeReason = (notice || state).slice(0, 300);
      return;
    }

    if (state === 'Bereit' && features >= 4 && download && !download.disabled &&
        palette?.options.length === 2 && script?.href.includes('MiMa-Farben')) {
      root.dataset.smoke = 'ok';
      root.dataset.smokeFeatures = String(features);
      return;
    }

    if (Date.now() - started > 115000) {
      root.dataset.smoke = 'fail';
      root.dataset.smokeReason = `Zeitüberschreitung; Status: ${state}; Flächen: ${features}; Hinweis: ${notice}`;
      return;
    }
    setTimeout(check, 250);
  }

  setTimeout(check, 100);
})();
