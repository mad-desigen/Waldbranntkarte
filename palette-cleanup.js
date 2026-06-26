/*
  Verarbeitet die DWD-WBI-Grafik ausschließlich anhand der fünf exakten
  Gefahrenfarben. Alle anderen Pixel werden ignoriert und als Lücke behandelt.
  Die Lücken wachsen synchron von den angrenzenden echten Farben zu, sodass
  gegenüberliegende Farbflächen in der Mitte zusammentreffen.
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

  for (const [level, value] of Object.entries(PALETTE)) {
    LV[level].c = value.hex;
    LV[level].r = value.rgb.slice();
  }

  function exactPaletteLevel(r, g, b) {
    for (const [level, value] of Object.entries(PALETTE)) {
      const rgb = value.rgb;
      if (r === rgb[0] && g === rgb[1] && b === rgb[2]) {
        return Number(level);
      }
    }
    return 0;
  }

  sourceCanvas = function sourceCanvasExactPalette(img) {
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
    const sourceLabels = new Uint8Array(width * height);

    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;

    for (let y = 0; y < scanHeight; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;
        if (pixels[pixelIndex + 3] === 0) continue;

        const level = exactPaletteLevel(
          pixels[pixelIndex],
          pixels[pixelIndex + 1],
          pixels[pixelIndex + 2]
        );

        if (!level) continue;

        sourceLabels[y * width + x] = level;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }

    if (right < left || bottom < top) {
      throw new Error('In der DWD-Grafik wurden keine exakten WBI-Farben erkannt.');
    }

    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    const labels = new Uint8Array(cropWidth * cropHeight);

    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < cropWidth; x++) {
        labels[y * cropWidth + x] = sourceLabels[(y + top) * width + x + left];
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

  fillGaps = function fillExactPaletteGaps(labels, inMask, width, height) {
    const current = labels.slice();
    const cardinal = [
      [-1, 0, 4], [1, 0, 4], [0, -1, 4], [0, 1, 4],
      [-1, -1, 2], [1, -1, 2], [-1, 1, 2], [1, 1, 2]
    ];

    let frontier = [];
    const queued = new Uint8Array(width * height);

    function hasColoredNeighbor(x, y) {
      for (const [dx, dy] of cardinal) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        const value = current[yy * width + xx];
        if (value >= 1 && value <= 5) return true;
      }
      return false;
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (!inMask[index] || current[index] !== 0) continue;
        if (!hasColoredNeighbor(x, y)) continue;
        frontier.push(index);
        queued[index] = 1;
      }
    }

    while (frontier.length) {
      const assignments = [];

      for (const index of frontier) {
        if (current[index] !== 0) continue;

        const x = index % width;
        const y = Math.floor(index / width);
        const scores = [0, 0, 0, 0, 0, 0];

        for (const [dx, dy, weight] of cardinal) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
          const value = current[yy * width + xx];
          if (value >= 1 && value <= 5) scores[value] += weight;
        }

        let bestLevel = 0;
        let bestScore = 0;
        for (let level = 1; level <= 5; level++) {
          if (scores[level] > bestScore) {
            bestScore = scores[level];
            bestLevel = level;
          }
        }

        if (bestLevel) assignments.push([index, bestLevel]);
      }

      if (!assignments.length) break;

      const nextFrontier = [];
      for (const [index, level] of assignments) {
        current[index] = level;
      }

      for (const [index] of assignments) {
        const x = index % width;
        const y = Math.floor(index / width);

        for (const [dx, dy] of cardinal) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
          const neighborIndex = yy * width + xx;
          if (!inMask[neighborIndex] || current[neighborIndex] !== 0 || queued[neighborIndex]) continue;
          queued[neighborIndex] = 1;
          nextFrontier.push(neighborIndex);
        }
      }

      frontier = nextFrontier;
    }

    return current;
  };
})();
