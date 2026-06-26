/*
  Entfernt DWD-Ländergrenzen aus der WBI-Klassifikation.

  Zweistufiges Verfahren:
  1. Im DWD-PNG werden ausschließlich die fünf festgelegten WBI-Farben akzeptiert.
     Schwarze/graue Konturen werden als eigene Klasse markiert und entfernt.
  2. Nach dem Mapping wird zusätzlich ein schmaler Korridor entlang der amtlichen
     Bundeslandgrenzen aus dem GeoJSON entfernt. Die Lücke wächst synchron von
     beiden Seiten mit den echten WBI-Farben zu.
*/
(() => {
  'use strict';

  const PALETTE = {
    1: { hex: '#ffffce', rgb: [255, 255, 206] },
    2: { hex: '#ffd879', rgb: [255, 216, 121] },
    3: { hex: '#ff8c39', rgb: [255, 140, 57] },
    4: { hex: '#e9151c', rgb: [233, 21, 28] },
    5: { hex: '#800126', rgb: [128, 1, 38] }
  };

  const PALETTE_TOLERANCE = 12;
  const SOURCE_BORDER_RADIUS = 2;
  const TARGET_BORDER_WIDTH = 10;
  const TARGET_EDGE_MARGIN = 6;
  const MAX_FILL_ROUNDS = 28;

  for (const [level, value] of Object.entries(PALETTE)) {
    LV[level].c = value.hex;
    LV[level].r = value.rgb.slice();
  }

  function paletteLevel(r, g, b) {
    let bestLevel = 0;
    let bestDistance = Infinity;

    for (const [level, value] of Object.entries(PALETTE)) {
      const [pr, pg, pb] = value.rgb;
      const distance = Math.sqrt(
        (r - pr) * (r - pr) +
        (g - pg) * (g - pg) +
        (b - pb) * (b - pb)
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestLevel = Number(level);
      }
    }

    return bestDistance <= PALETTE_TOLERANCE ? bestLevel : 0;
  }

  function isBorderCore(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // Schwarz, Grau und neutrale Antialiasing-Pixel der DWD-Länderlinien.
    // Echtes WBI-Dunkelrot ist deutlich gesättigt und wird hier nicht erfasst.
    return luminance < 210 && chroma <= 28;
  }

  function dilate(mask, width, height, radius) {
    const result = mask.slice();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!mask[y * width + x]) continue;

        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;

          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            if (dx * dx + dy * dy > radius * radius) continue;
            result[yy * width + xx] = 1;
          }
        }
      }
    }

    return result;
  }

  function isInsideWithMargin(inMask, width, height, x, y, radius) {
    const probes = [
      [0, 0],
      [-radius, 0], [radius, 0], [0, -radius], [0, radius],
      [-radius, -radius], [radius, -radius],
      [-radius, radius], [radius, radius]
    ];

    for (const [dx, dy] of probes) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || xx >= width || yy < 0 || yy >= height) return false;
      if (!inMask[yy * width + xx]) return false;
    }

    return true;
  }

  function buildInternalStateBoundaryMask(inMask, width, height) {
    const result = new Uint8Array(width * height);
    if (!S.states?.features?.length) return result;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const bbox = turf.bbox(S.states);

    context.clearRect(0, 0, width, height);
    context.strokeStyle = '#ffffff';
    context.lineWidth = TARGET_BORDER_WIDTH;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (const feature of S.states.features) {
      const geometry = feature?.geometry;
      if (!geometry || !/Polygon/.test(geometry.type)) continue;
      drawGeom(context, geometry, width, height, bbox);
      context.stroke();
    }

    const pixels = context.getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (pixels[index * 4 + 3] === 0) continue;

        // Nur innere Ländergrenzen entfernen. Die deutsche Außenkontur bleibt erhalten.
        if (isInsideWithMargin(inMask, width, height, x, y, TARGET_EDGE_MARGIN)) {
          result[index] = 1;
        }
      }
    }

    return result;
  }

  sourceCanvas = function sourceCanvasPaletteOnly(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(img, 0, 0);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    const scanHeight = Math.floor(height * 0.89);

    const paletteLabels = new Uint8Array(width * height);
    const borderCore = new Uint8Array(width * height);

    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;

    // Der Kartenausschnitt wird ausschließlich durch echte WBI-Farbpixel bestimmt.
    for (let y = 0; y < scanHeight; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;
        const r = pixels[pixelIndex];
        const g = pixels[pixelIndex + 1];
        const b = pixels[pixelIndex + 2];
        const alpha = pixels[pixelIndex + 3];
        if (alpha < 128) continue;

        const level = paletteLevel(r, g, b);
        if (level) {
          paletteLabels[y * width + x] = level;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }

        if (isBorderCore(r, g, b)) {
          borderCore[y * width + x] = 1;
        }
      }
    }

    if (right < left || bottom < top) {
      throw new Error('In der DWD-Grafik wurden keine exakten WBI-Farben erkannt.');
    }

    const expandedBorder = dilate(borderCore, width, height, SOURCE_BORDER_RADIUS);
    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    const labels = new Uint8Array(cropWidth * cropHeight);

    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < cropWidth; x++) {
        const sourceIndex = (y + top) * width + (x + left);
        const targetIndex = y * cropWidth + x;

        if (expandedBorder[sourceIndex]) {
          labels[targetIndex] = 6;
        } else {
          labels[targetIndex] = paletteLabels[sourceIndex];
        }
      }
    }

    return {
      labels,
      box: {
        l: 0,
        t: 0,
        r: cropWidth - 1,
        b: cropHeight - 1,
        w: cropWidth,
        h: cropHeight
      }
    };
  };

  fillGaps = function fillPaletteGaps(labels, inMask, width, height) {
    let current = labels.slice();
    const stateBoundaries = buildInternalStateBoundaryMask(inMask, width, height);

    // Sowohl erkannte DWD-Konturpixel als auch der amtliche Zielkorridor werden zu Lücken.
    for (let i = 0; i < current.length; i++) {
      if (current[i] === 6 || stateBoundaries[i]) current[i] = 0;
    }

    // Synchrones Auffüllen von beiden Seiten. Dadurch endet die neue Farbgrenze
    // ungefähr in der Mitte der entfernten Konturlinie.
    for (let round = 0; round < MAX_FILL_ROUNDS; round++) {
      const next = current.slice();
      let changed = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x;
          if (!inMask[index]) continue;
          if (current[index] >= 1 && current[index] <= 5) continue;

          const counts = [0, 0, 0, 0, 0, 0];
          const neighbors = [
            [-1, 0, 5], [1, 0, 5], [0, -1, 5], [0, 1, 5],
            [-1, -1, 3], [1, -1, 3], [-1, 1, 3], [1, 1, 3],
            [-2, 0, 2], [2, 0, 2], [0, -2, 2], [0, 2, 2],
            [-2, -1, 1], [2, -1, 1], [-2, 1, 1], [2, 1, 1],
            [-1, -2, 1], [1, -2, 1], [-1, 2, 1], [1, 2, 1]
          ];

          for (const [dx, dy, weight] of neighbors) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
            const value = current[yy * width + xx];
            if (value >= 1 && value <= 5) counts[value] += weight;
          }

          let bestLevel = 0;
          let bestScore = 0;
          for (let level = 1; level <= 5; level++) {
            if (counts[level] > bestScore) {
              bestScore = counts[level];
              bestLevel = level;
            }
          }

          if (bestLevel) {
            next[index] = bestLevel;
            changed++;
          }
        }
      }

      current = next;
      if (!changed) break;
    }

    return current;
  };
})();
