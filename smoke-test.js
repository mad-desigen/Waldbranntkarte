(() => {
  if (!new URLSearchParams(location.search).has('smoketest')) return;
  const root = document.documentElement;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const getText = id => (document.getElementById(id)?.textContent || '').trim();
  root.dataset.smoke = 'pending';

  function imageStats(imageData) {
    let count = 0, left = imageData.width, top = imageData.height, right = -1, bottom = -1;
    for (let y = 0; y < imageData.height; y++) {
      for (let x = 0; x < imageData.width; x++) {
        if (imageData.data[(y * imageData.width + x) * 4 + 3] < 200) continue;
        count++;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return { count, width: right >= left ? right - left + 1 : 0, height: bottom >= top ? bottom - top + 1 : 0 };
  }

  (async () => {
    try {
      const deadline = Date.now() + 90000;
      while ((getText('topState') !== 'Bereit' || document.getElementById('generate')?.disabled) && Date.now() < deadline) {
        if (getText('topState') === 'Fehler') throw new Error(getText('notice'));
        await wait(200);
      }
      if (getText('topState') !== 'Bereit') throw new Error('Karte wurde nicht bereit.');

      const results = [];
      for (let day = 0; day < 5; day++) {
        document.getElementById('day').value = String(day);
        await loadDay(true);
        if (!S.fitted?.data || !S.fitted?.canvas) throw new Error('Tag ' + day + ': Raster fehlt.');
        const canvas = S.fitted.canvas;
        const stats = imageStats(S.fitted.data);
        if (stats.height < canvas.height * 0.94 || stats.width < canvas.width * 0.68) throw new Error('Tag ' + day + ': Karte abgeschnitten.');
        if (stats.count < canvas.width * canvas.height * 0.30) throw new Error('Tag ' + day + ': Kartenfläche unvollständig.');
        await generate();
        const features = parseInt(getText('count'), 10) || 0;
        if (features < 4 || document.getElementById('download')?.disabled) throw new Error('Tag ' + day + ': GeoJSON fehlt.');
        results.push({ day, features, width: canvas.width, height: canvas.height, alpha: stats.count });
      }
      root.dataset.smoke = 'ok';
      root.dataset.smokeDays = '5';
      root.dataset.smokeFeatures = String(Math.min(...results.map(item => item.features)));
      root.dataset.smokeResult = encodeURIComponent(JSON.stringify(results));
    } catch (error) {
      root.dataset.smoke = 'fail';
      root.dataset.smokeReason = String(error?.message || error).slice(0, 400);
    }
  })();
})();
