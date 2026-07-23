/*
 * DWD-WBI-Auswertung fuer die urspruengliche affine Kartenanpassung.
 * Nur die fuenf WBI-Farben werden als Daten akzeptiert. Konturen und
 * Antialiasing bleiben transparent und werden erst nach dem Mapping
 * aus den benachbarten echten WBI-Flaechen geschlossen.
 */
(() => {
  'use strict';

  const SOURCE = {
    1: { color: '#ffffcc', rgb: [255, 255, 204] },
    2: { color: '#ffd979', rgb: [255, 217, 121] },
    3: { color: '#ff8c38', rgb: [255, 140, 56] },
    4: { color: '#e8151c', rgb: [232, 21, 28] },
    5: { color: '#7e0025', rgb: [126, 0, 37] }
  };

  const SOURCE_TOLERANCE = 14;
  const SOURCE_TOLERANCE_SQ = SOURCE_TOLERANCE * SOURCE_TOLERANCE;
  const MAP_SCAN_LIMIT = 0.89;

  for (const [level, value] of Object.entries(SOURCE)) {
    LEVELS[level].rgb = value.rgb.slice();
  }

  function classify(r, g, b) {
    let level = 0;
    let distance = Infinity;
    for (const [number, value] of Object.entries(SOURCE)) {
      const rgb = value.rgb;
      const current = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
      if (current < distance) {
        level = Number(number);
        distance = current;
      }
    }
    return distance <= SOURCE_TOLERANCE_SQ ? { level, dist: distance } : { level: 0, dist: Infinity };
  }

  nearest = classify;

  prepareSource = function preparePaletteOnly(img) {
    const source = document.createElement('canvas');
    source.width = img.naturalWidth;
    source.height = img.naturalHeight;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(img, 0, 0);
    const raw = sourceContext.getImageData(0, 0, source.width, source.height);

    let left = source.width;
    let top = source.height;
    let right = -1;
    let bottom = -1;
    const scanBottom = Math.floor(source.height * MAP_SCAN_LIMIT);

    for (let y = 0; y < scanBottom; y++) {
      for (let x = 0; x < source.width; x++) {
        const index = (y * source.width + x) * 4;
        if (raw.data[index + 3] < 128) continue;
        const match = classify(raw.data[index], raw.data[index + 1], raw.data[index + 2]);
        if (!match.level) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }

    if (right < left || bottom < top) {
      throw new Error('In der DWD-Grafik wurden keine der fünf WBI-Farben erkannt.');
    }

    const padding = 2;
    left = Math.max(0, left - padding);
    top = Math.max(0, top - padding);
    right = Math.min(source.width - 1, right + padding);
    bottom = Math.min(scanBottom - 1, bottom + padding);

    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    const output = document.createElement('canvas');
    output.width = 900;
    output.height = Math.max(1, Math.round(output.width * cropHeight / cropWidth));
    const context = output.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, output.width, output.height);

    const image = context.getImageData(0, 0, output.width, output.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const match = classify(image.data[index], image.data[index + 1], image.data[index + 2]);
      if (!match.level) {
        image.data[index] = 0;
        image.data[index + 1] = 0;
        image.data[index + 2] = 0;
        image.data[index + 3] = 0;
        continue;
      }
      const rgb = SOURCE[match.level].rgb;
      image.data[index] = rgb[0];
      image.data[index + 1] = rgb[1];
      image.data[index + 2] = rgb[2];
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return output;
  };

  function readLevel(imageData, x, y) {
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return 0;
    const index = (y * imageData.width + x) * 4;
    if (imageData.data[index + 3] < 90) return 0;
    return classify(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2]).level;
  }

  sourceAt = function sourceAtPalette(imageData, x, y) {
    const centerX = Math.round(x);
    const centerY = Math.round(y);
    for (let radius = 0; radius <= 3; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (radius && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          if (readLevel(imageData, centerX + dx, centerY + dy)) return true;
        }
      }
    }
    return false;
  };

  function sampleStrict(imageData, x, y) {
    const centerX = Math.round(x);
    const centerY = Math.round(y);
    const direct = readLevel(imageData, centerX, centerY);
    if (direct) return direct;

    for (const radius of [1, 2, 3, 5, 7]) {
      const votes = [0, 0, 0, 0, 0, 0];
      const points = [
        [centerX - radius, centerY], [centerX + radius, centerY],
        [centerX, centerY - radius], [centerX, centerY + radius],
        [centerX - radius, centerY - radius], [centerX + radius, centerY - radius],
        [centerX - radius, centerY + radius], [centerX + radius, centerY + radius]
      ];
      for (const [px, py] of points) {
        const level = readLevel(imageData, px, py);
        if (level) votes[level]++;
      }
      let best = 0;
      for (let level = 1; level <= 5; level++) {
        if (votes[level] > votes[best]) best = level;
      }
      if (best) return best;
    }
    return 0;
  }

  sampleSource = sampleStrict;

  function fillMappedGaps(labels, mask, width, height) {
    const valid = value => value >= 1 && value <= 5;
    let current = labels.slice();

    for (let round = 0; round < 28; round++) {
      const next = current.slice();
      let changed = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x;
          if (!mask.data[index * 4 + 3] || valid(current[index])) continue;
          const votes = [0, 0, 0, 0, 0, 0];
          for (let dy = -2; dy <= 2; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= height) continue;
            for (let dx = -2; dx <= 2; dx++) {
              if (!dx && !dy) continue;
              const xx = x + dx;
              if (xx < 0 || xx >= width) continue;
              const level = current[yy * width + xx];
              if (!valid(level)) continue;
              const weight = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? 3 : 1;
              votes[level] += weight;
            }
          }
          let best = 0;
          for (let level = 1; level <= 5; level++) {
            if (votes[level] > votes[best]) best = level;
          }
          if (best && votes[best] >= 3) {
            next[index] = best;
            changed++;
          }
        }
      }
      current = next;
      if (!changed) break;
    }

    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    for (let index = 0; index < current.length; index++) {
      if (mask.data[index * 4 + 3] && valid(current[index])) queue[tail++] = index;
    }
    while (head < tail) {
      const index = queue[head++];
      const level = current[index];
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);
      for (const neighbor of neighbors) {
        if (!mask.data[neighbor * 4 + 3] || valid(current[neighbor])) continue;
        current[neighbor] = level;
        queue[tail++] = neighbor;
      }
    }
    return current;
  }

  fitToGermany = function fitPaletteToGermany(src) {
    const bounds = S.bounds;
    const west = bounds.getWest();
    const east = bounds.getEast();
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const northMercator = merc(north);
    const southMercator = merc(south);
    const aspect = ((east - west) * Math.PI / 180) / (northMercator - southMercator);
    const height = 1100;
    const width = Math.max(620, Math.round(height * aspect));

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
    maskContext.fillStyle = '#fff';
    drawGeometry(maskContext, S.mask.geometry, width, height, west, east, northMercator, southMercator);
    maskContext.fill('evenodd');
    const target = maskContext.getImageData(0, 0, width, height);
    const source = S.sourceData;
    const sourceBox = alphaBox(source);
    const targetBox = alphaBox(target);
    const fitted = optimize(source, target, sourceBox, targetBox);
    const [scaleX, scaleY, offsetX, offsetY, shear] = fitted.params;
    const sourceCenterX = (sourceBox.left + sourceBox.right) / 2;
    const sourceCenterY = (sourceBox.top + sourceBox.bottom) / 2;
    const targetCenterX = (targetBox.left + targetBox.right) / 2;
    const targetCenterY = (targetBox.top + targetBox.bottom) / 2;
    const labels = new Uint8Array(width * height);

    for (let y = targetBox.top; y <= targetBox.bottom; y++) {
      for (let x = targetBox.left; x <= targetBox.right; x++) {
        const index = y * width + x;
        if (!target.data[index * 4 + 3]) continue;
        const sourceX = Math.max(sourceBox.left, Math.min(sourceBox.right,
          sourceCenterX + (x - targetCenterX) * scaleX + offsetX + shear * (y - targetCenterY)));
        const sourceY = Math.max(sourceBox.top, Math.min(sourceBox.bottom,
          sourceCenterY + (y - targetCenterY) * scaleY + offsetY));
        labels[index] = sampleStrict(source, sourceX, sourceY);
      }
    }

    const filled = fillMappedGaps(labels, target, width, height);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
    const output = outputContext.createImageData(width, height);
    for (let index = 0; index < filled.length; index++) {
      const level = filled[index];
      if (!level || !target.data[index * 4 + 3]) continue;
      const rgb = SOURCE[level].rgb;
      const pixel = index * 4;
      output.data[pixel] = rgb[0];
      output.data[pixel + 1] = rgb[1];
      output.data[pixel + 2] = rgb[2];
      output.data[pixel + 3] = 255;
    }
    outputContext.putImageData(output, 0, 0);
    return { canvas: outputCanvas, imageData: output };
  };

  sampleFitted = function sampleFittedStrict(xFraction, yFraction) {
    const image = S.imageData;
    const x = Math.max(0, Math.min(image.width - 1, Math.round(xFraction * (image.width - 1))));
    const y = Math.max(0, Math.min(image.height - 1, Math.round(yFraction * (image.height - 1))));
    return readLevel(image, x, y) || null;
  };
})();
