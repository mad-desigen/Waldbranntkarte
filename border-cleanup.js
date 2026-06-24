/*
 * Entfernt schmale Bundesland-Grenzlinien aus der ausgelesenen DWD-PNG,
 * bevor die Karte an die Deutschland-Geometrie angepasst und vektorisiert wird.
 *
 * Strategie:
 * 1. WBI-Farben klassifizieren.
 * 2. Dünne, linienförmige Stufe-5-Artefakte über lokale Mehrheiten entfernen.
 * 3. Opaque, aber nicht klassifizierte Grenzpixel aus den umgebenden WBI-Flächen auffüllen.
 * 4. Beim späteren Sampling nur noch sehr kleine Suchradien zulassen.
 */

function wbiIntegral(labels, width, height, level) {
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    const src = y * width;
    const dst = (y + 1) * stride;
    const prev = y * stride;
    for (let x = 0; x < width; x++) {
      if (labels[src + x] === level) row++;
      integral[dst + x + 1] = integral[prev + x + 1] + row;
    }
  }
  return integral;
}

function wbiRectSum(integral, stride, x0, y0, x1, y1) {
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(stride - 2, x1);
  y1 = Math.min(Math.floor(integral.length / stride) - 2, y1);
  if (x1 < x0 || y1 < y0) return 0;
  const a = y0 * stride + x0;
  const b = y0 * stride + x1 + 1;
  const c = (y1 + 1) * stride + x0;
  const d = (y1 + 1) * stride + x1 + 1;
  return integral[d] - integral[b] - integral[c] + integral[a];
}

function wbiBuildIntegrals(labels, width, height) {
  return [null, 1, 2, 3, 4, 5].map(level => level ? wbiIntegral(labels, width, height, level) : null);
}

function wbiRemoveThinLevel5(labels, quality, width, height, rounds = 3) {
  const stride = width + 1;
  let current = labels;
  for (let round = 0; round < rounds; round++) {
    const integrals = wbiBuildIntegrals(current, width, height);
    const next = current.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (current[i] !== 5) continue;
        const c5 = wbiRectSum(integrals[5], stride, x - 4, y - 4, x + 4, y + 4);
        let majorityLevel = 1;
        let majorityCount = 0;
        for (let level = 1; level <= 4; level++) {
          const count = wbiRectSum(integrals[level], stride, x - 4, y - 4, x + 4, y + 4);
          if (count > majorityCount) {
            majorityCount = count;
            majorityLevel = level;
          }
        }
        const weakLine = c5 <= 28 && majorityCount >= 18;
        const antialiasLine = quality[i] > 300 && c5 <= 40 && majorityCount >= 16;
        if (weakLine || antialiasLine) next[i] = majorityLevel;
      }
    }
    current = next;
  }
  return current;
}

function wbiRemoveIsolatedPixels(labels, width, height) {
  const stride = width + 1;
  const integrals = wbiBuildIntegrals(labels, width, height);
  const next = labels.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const currentLevel = labels[i];
      if (!currentLevel) continue;
      const own = wbiRectSum(integrals[currentLevel], stride, x - 2, y - 2, x + 2, y + 2);
      let majorityLevel = currentLevel;
      let majorityCount = own;
      for (let level = 1; level <= 5; level++) {
        const count = wbiRectSum(integrals[level], stride, x - 2, y - 2, x + 2, y + 2);
        if (count > majorityCount) {
          majorityCount = count;
          majorityLevel = level;
        }
      }
      if (majorityLevel !== currentLevel && own <= 3 && majorityCount >= 10) {
        next[i] = majorityLevel;
      }
    }
  }
  return next;
}

function wbiFillOpaqueGaps(labels, inside, width, height, rounds = 8) {
  const stride = width + 1;
  let current = labels;
  for (let round = 0; round < rounds; round++) {
    const integrals = wbiBuildIntegrals(current, width, height);
    const next = current.slice();
    let changed = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!inside[i] || current[i]) continue;
        let majorityLevel = 0;
        let majorityCount = 0;
        let total = 0;
        for (let level = 1; level <= 5; level++) {
          const count = wbiRectSum(integrals[level], stride, x - 2, y - 2, x + 2, y + 2);
          total += count;
          if (count > majorityCount) {
            majorityCount = count;
            majorityLevel = level;
          }
        }
        if (majorityLevel && total >= 2 && majorityCount >= Math.max(2, Math.ceil(total * 0.38))) {
          next[i] = majorityLevel;
          changed++;
        }
      }
    }
    current = next;
    if (!changed) break;
  }
  return current;
}

function prepareSource(img) {
  const original = document.createElement('canvas');
  original.width = img.naturalWidth;
  original.height = img.naturalHeight;
  const originalContext = original.getContext('2d', { willReadFrequently: true });
  originalContext.drawImage(img, 0, 0);
  const originalData = originalContext.getImageData(0, 0, original.width, original.height);
  const box = largestColorComponent(originalData);

  const out = document.createElement('canvas');
  out.width = 900;
  out.height = Math.round(900 * box.h / box.w);
  const context = out.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.drawImage(original, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);

  const image = context.getImageData(0, 0, out.width, out.height);
  const pixelCount = out.width * out.height;
  const labels = new Uint8Array(pixelCount);
  const inside = new Uint8Array(pixelCount);
  const quality = new Uint16Array(pixelCount);

  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    inside[p] = image.data[i + 3] > 18 ? 1 : 0;
    if (!inside[p]) continue;
    const match = nearest(image.data[i], image.data[i + 1], image.data[i + 2]);
    quality[p] = Math.min(65535, Math.round(match.dist));
    if (match.dist < 1600) labels[p] = match.level;
  }

  let cleaned = wbiRemoveThinLevel5(labels, quality, out.width, out.height, 3);
  cleaned = wbiRemoveIsolatedPixels(cleaned, out.width, out.height);
  cleaned = wbiFillOpaqueGaps(cleaned, inside, out.width, out.height, 9);
  cleaned = wbiRemoveThinLevel5(cleaned, quality, out.width, out.height, 2);
  cleaned = wbiRemoveIsolatedPixels(cleaned, out.width, out.height);

  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const level = cleaned[p];
    if (!level) {
      image.data[i + 3] = 0;
      continue;
    }
    const color = LEVELS[level].rgb;
    image.data[i] = color[0];
    image.data[i + 1] = color[1];
    image.data[i + 2] = color[2];
    image.data[i + 3] = 255;
  }

  context.putImageData(image, 0, 0);
  return out;
}

function sampleSource(imageData, x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const { width, height, data } = imageData;
  const read = (px, py) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return 0;
    const i = (py * width + px) * 4;
    if (data[i + 3] < 90) return 0;
    return nearest(data[i], data[i + 1], data[i + 2]).level;
  };

  const direct = read(cx, cy);
  if (direct) return direct;

  for (const radius of [1, 2, 3, 4]) {
    const votes = {};
    const points = [
      [cx - radius, cy], [cx + radius, cy], [cx, cy - radius], [cx, cy + radius],
      [cx - radius, cy - radius], [cx + radius, cy - radius],
      [cx - radius, cy + radius], [cx + radius, cy + radius]
    ];
    for (const [px, py] of points) {
      const level = read(px, py);
      if (level) votes[level] = (votes[level] || 0) + 1;
    }
    const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (winner) return Number(winner[0]);
  }
  return null;
}
