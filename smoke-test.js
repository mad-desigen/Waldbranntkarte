(() => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('smoketest')) return;

  const root = document.documentElement;
  root.dataset.smoke = 'pending';
  const started = Date.now();
  let generationStarted = false;

  const fail = (reason) => {
    root.dataset.smoke = 'fail';
    root.dataset.smokeReason = String(reason || 'Unbekannter Fehler').slice(0, 240);
  };

  const check = () => {
    try {
      const state = document.getElementById('topState')?.textContent?.trim() || '';
      const notice = document.getElementById('notice')?.textContent?.trim() || '';
      const generate = document.getElementById('generate');
      const download = document.getElementById('download');
      const count = Number.parseInt(document.getElementById('count')?.textContent || '0', 10) || 0;

      if (state === 'Fehler') {
        fail(notice || 'Initialisierung fehlgeschlagen');
        return;
      }

      if (!generationStarted && state === 'Bereit' && generate && !generate.disabled) {
        generationStarted = true;
        generate.click();
      }

      if (generationStarted && download && !download.disabled && count >= 4) {
        root.dataset.smoke = 'ok';
        root.dataset.smokeFeatures = String(count);
        return;
      }

      if (Date.now() - started > 85000) {
        fail(notice || `Zeitüberschreitung; Status: ${state || 'unbekannt'}, Flächen: ${count}`);
        return;
      }

      window.setTimeout(check, 250);
    } catch (error) {
      fail(error?.message || error);
    }
  };

  window.setTimeout(check, 100);
})();
