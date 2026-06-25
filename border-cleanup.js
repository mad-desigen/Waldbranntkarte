/* Sichere Ausrichtung nach der gelieferten Referenz. Die Deutschlandmaske bleibt unverändert. */
(function () {
  const STRICT_DISTANCE = 80;

  function readLevelFromImage(imageData, x, y, radii) {
    const { width, height, data } = imageData;
    const cx = Math.round(x);
    const cy = Math.round(y);
    const read = (px, py) => {
      if (px < 0 || py < 0 || px >= width || py >= height) return 0;
      const i = (py * width + px) * 4;
      if (data[i + 3] < 90) return 0;
      const match = nearest(data[i], data[i + 1], data[i + 2]);
      return match.dist <= STRICT_DISTANCE ? match.level : 0;
    };
    for (const radius of radii) {
      if (radius === 0) {
        const direct = read(cx, cy);
        if (direct) return direct;
        continue;
      }
      const votes = [0, 0, 0, 0, 0, 0];
      for (const [px, py] of [
        [cx - radius, cy], [cx + radius, cy], [cx, cy - radius], [cx, cy + radius],
        [cx - radius, cy - radius], [cx + radius, cy - radius],
        [cx - radius, cy + radius], [cx + radius, cy + radius]
      ]) {
        const level = read(px, py);
        if (level) votes[level]++;
      }
      let best = 0;
      for (let level = 1; level <= 5; level++) if (votes[level] > votes[best]) best = level;
      if (best) return best;
    }
    return 0;
  }

  sourceCanvas = function (img) {
    const original = document.createElement('canvas');
    original.width = img.naturalWidth;
    original.height = img.naturalHeight;
    const originalContext = original.getContext('2d', { willReadFrequently: true });
    originalContext.drawImage(img, 0, 0);
    const raw = originalContext.getImageData(0, 0, original.width, original.height);

    let left = original.width, top = original.height, right = -1, bottom = -1;
    const scanBottom = Math.floor(original.height * 0.9);
    for (let y = 0; y < scanBottom; y++) {
      for (let x = 0; x < original.width; x++) {
        const i = (y * original.width + x) * 4;
        const match = nearest(raw.data[i], raw.data[i + 1], raw.data[i + 2]);
        if (match.dist <= STRICT_DISTANCE) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left || bottom < top) throw new Error('In der DWD-Grafik wurden keine WBI-Farben erkannt.');

    const padding = 2;
    left = Math.max(0, left - padding); top = Math.max(0, top - padding);
    right = Math.min(original.width - 1, right + padding); bottom = Math.min(original.height - 1, bottom + padding);
    const cropWidth = right - left + 1, cropHeight = bottom - top + 1;

    const out = document.createElement('canvas');
    out.width = 900;
    out.height = Math.max(1, Math.round(out.width * cropHeight / cropWidth));
    const context = out.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(original, left, top, cropWidth, cropHeight, 0, 0, out.width, out.height);

    const image = context.getImageData(0, 0, out.width, out.height);
    for (let p = 0; p < out.width * out.height; p++) {
      const i = p * 4;
      const match = nearest(image.data[i], image.data[i + 1], image.data[i + 2]);
      if (match.dist <= STRICT_DISTANCE) {
        const color = LV[match.level].r;
        image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = 255;
      } else image.data[i + 3] = 0;
    }
    context.putImageData(image, 0, 0);
    return { canvas: out, im: image, box: { l: 0, t: 0, r: out.width - 1, b: out.height - 1, w: out.width, h: out.height } };
  };

  fit = function (img) {
    const src = sourceCanvas(img);
    const bbox = turf.bbox(S.mask);
    const [west, south, east, north] = bbox;
    const northY = my(north), southY = my(south);
    const height = 1100;
    const width = Math.max(320, Math.round(height * ((east - west) * Math.PI / 180) / (northY - southY)));

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width; maskCanvas.height = height;
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
    drawGeom(maskContext, S.mask.geometry, width, height, bbox);
    maskContext.fillStyle = '#fff'; maskContext.fill('evenodd');
    const mask = maskContext.getImageData(0, 0, width, height);
    const sourceBox = alphaBox(src.im), targetBox = alphaBox(mask);
    if (!sourceBox || !targetBox) throw new Error('Eine benötigte Kartenmaske ist leer.');

    const labels = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0, tail = 0;

    for (let y = targetBox.t; y <= targetBox.b; y++) {
      const v = targetBox.h > 1 ? (y - targetBox.t) / (targetBox.h - 1) : 0;
      const sy = sourceBox.t + v * (sourceBox.h - 1);
      for (let x = targetBox.l; x <= targetBox.r; x++) {
        const index = y * width + x;
        if (mask.data[index * 4 + 3] === 0) continue;
        const u = targetBox.w > 1 ? (x - targetBox.l) / (targetBox.w - 1) : 0;
        const sx = sourceBox.l + u * (sourceBox.w - 1);
        const level = readLevelFromImage(src.im, sx, sy, [0, 1, 2, 4, 7]);
        if (level) { labels[index] = level; queue[tail++] = index; }
      }
    }
    if (!tail) throw new Error('Die DWD-Farbflächen konnten nicht auf die Deutschlandmaske übertragen werden.');

    while (head < tail) {
      const index = queue[head++], level = labels[index], x = index % width, y = (index / width) | 0;
      if (x > 0) { const n = index - 1; if (!labels[n] && mask.data[n * 4 + 3]) { labels[n] = level; queue[tail++] = n; } }
      if (x + 1 < width) { const n = index + 1; if (!labels[n] && mask.data[n * 4 + 3]) { labels[n] = level; queue[tail++] = n; } }
      if (y > 0) { const n = index - width; if (!labels[n] && mask.data[n * 4 + 3]) { labels[n] = level; queue[tail++] = n; } }
      if (y + 1 < height) { const n = index + width; if (!labels[n] && mask.data[n * 4 + 3]) { labels[n] = level; queue[tail++] = n; } }
    }

    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const outContext = out.getContext('2d', { willReadFrequently: true });
    const output = outContext.createImageData(width, height);
    let filled = 0;
    for (let i = 0; i < labels.length; i++) {
      const level = labels[i];
      if (!level || mask.data[i * 4 + 3] === 0) continue;
      const color = LV[level].r, p = i * 4;
      output.data[p] = color[0]; output.data[p + 1] = color[1]; output.data[p + 2] = color[2]; output.data[p + 3] = 255; filled++;
    }
    outContext.putImageData(output, 0, 0);
    return { canvas: out, data: output, bbox, info: { method: 'Unabhängige X/Y-Skalierung nach Referenz; Konturlücken mit nächster echter WBI-Farbe geschlossen', filled_pixels: filled, width, height } };
  };
})();
