(() => {
  'use strict';

  const refs = {
    1: [255, 255, 206],
    2: [255, 216, 121],
    3: [255, 140, 57],
    4: [233, 21, 28],
    5: [128, 1, 38]
  };

  function nearest(r, g, b) {
    let level = 1;
    let dist = Infinity;
    for (const [number, rgb] of Object.entries(refs)) {
      const value = (r-rgb[0])**2 + (g-rgb[1])**2 + (b-rgb[2])**2;
      if (value < dist) {
        dist = value;
        level = Number(number);
      }
    }
    return { level, dist };
  }

  function largestComponent(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const step = 2;
    const gridWidth = Math.ceil(width / step);
    const gridHeight = Math.ceil(height / step);
    const mask = new Uint8Array(gridWidth * gridHeight);
    const seen = new Uint8Array(gridWidth * gridHeight);

    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const px = Math.min(width - 1, x * step);
        const py = Math.min(height - 1, y * step);
        const index = (py * width + px) * 4;
        if (nearest(data[index], data[index+1], data[index+2]).dist < 1600) {
          mask[y * gridWidth + x] = 1;
        }
      }
    }

    let best = null;
    const stack = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      seen[start] = 1;
      stack.push(start);
      let count = 0;
      let minX = gridWidth, minY = gridHeight, maxX = 0, maxY = 0;

      while (stack.length) {
        const current = stack.pop();
        const x = current % gridWidth;
        const y = Math.floor(current / gridWidth);
        count++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);

        for (const next of [current-1, current+1, current-gridWidth, current+gridWidth]) {
          if (next < 0 || next >= mask.length || seen[next] || !mask[next]) continue;
          if (Math.abs((next % gridWidth) - x) > 1) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }

      if (!best || count > best.count) best = { count, minX, minY, maxX, maxY };
    }

    if (!best) throw new Error('In der DWD-Grafik wurden keine WBI-Farben erkannt.');
    const padding = 4;
    const x = Math.max(0, best.minX * step - padding);
    const y = Math.max(0, best.minY * step - padding);
    const right = Math.min(width, (best.maxX + 1) * step + padding);
    const bottom = Math.min(height, (best.maxY + 1) * step + padding);
    return { x, y, width:right-x, height:bottom-y };
  }

  function prepare(img) {
    const source = document.createElement('canvas');
    source.width = img.naturalWidth;
    source.height = img.naturalHeight;
    const sourceContext = source.getContext('2d', { willReadFrequently:true });
    sourceContext.drawImage(img, 0, 0);
    const raw = sourceContext.getImageData(0, 0, source.width, source.height);
    const box = largestComponent(raw);

    const output = document.createElement('canvas');
    output.width = 900;
    output.height = Math.round(900 * box.height / box.width);
    const context = output.getContext('2d', { willReadFrequently:true });
    context.imageSmoothingEnabled = false;
    context.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, output.width, output.height);

    const data = context.getImageData(0, 0, output.width, output.height);
    for (let index = 0; index < data.data.length; index += 4) {
      const match = nearest(data.data[index], data.data[index+1], data.data[index+2]);
      if (match.dist < 1600) {
        const rgb = refs[match.level];
        data.data[index] = rgb[0];
        data.data[index+1] = rgb[1];
        data.data[index+2] = rgb[2];
        data.data[index+3] = 255;
      } else {
        data.data[index+3] = 0;
      }
    }
    context.putImageData(data, 0, 0);
    return output;
  }

  function bounds(imageData) {
    let left=imageData.width, top=imageData.height, right=-1, bottom=-1;
    for (let y=0; y<imageData.height; y++) for (let x=0; x<imageData.width; x++) {
      if (!imageData.data[(y*imageData.width+x)*4+3]) continue;
      left=Math.min(left,x); right=Math.max(right,x);
      top=Math.min(top,y); bottom=Math.max(bottom,y);
    }
    if (right < left) throw new Error('Leere WBI-Maske.');
    return { left, top, right, bottom, width:right-left+1, height:bottom-top+1 };
  }

  window.WBIOriginal = { refs, nearest, prepare, bounds };
})();
