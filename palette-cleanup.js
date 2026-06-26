(() => {
  'use strict';

  const PALETTE = {
    1: { hex: '#ffffce', rgb: [255, 255, 206] },
    2: { hex: '#ffd879', rgb: [255, 216, 121] },
    3: { hex: '#ff8c39', rgb: [255, 140, 57] },
    4: { hex: '#e9151c', rgb: [233, 21, 28] },
    5: { hex: '#800126', rgb: [128, 1, 38] }
  };
  const MAX_DISTANCE = 1600;

  for (const [level, value] of Object.entries(PALETTE)) {
    LV[level].c = value.hex;
    LV[level].r = value.rgb.slice();
  }

  function nearestPaletteLevel(r, g, b) {
    let bestLevel = 0;
    let bestDistance = Infinity;
    for (const [level, value] of Object.entries(PALETTE)) {
      const [pr, pg, pb] = value.rgb;
      const distance = (r-pr)*(r-pr) + (g-pg)*(g-pg) + (b-pb)*(b-pb);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLevel = Number(level);
      }
    }
    return bestDistance <= MAX_DISTANCE ? bestLevel : 0;
  }

  sourceCanvas = function sourceCanvasPaletteOnly(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(img, 0, 0);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const width = canvas.width;
    const height = canvas.height;
    const scanHeight = Math.floor(height * 0.89);
    const sourceLabels = new Uint8Array(width * height);
    let left = width, top = height, right = -1, bottom = -1;

    for (let y = 0; y < scanHeight; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (!pixels[i + 3]) continue;
        const level = nearestPaletteLevel(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (!level) continue;
        sourceLabels[y * width + x] = level;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }

    if (right < left || bottom < top) {
      throw new Error('In der DWD-Grafik wurden keine WBI-Farben erkannt.');
    }

    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    const labels = new Uint8Array(cropWidth * cropHeight);
    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < cropWidth; x++) {
        labels[y * cropWidth + x] = sourceLabels[(y + top) * width + x + left];
      }
    }

    return { labels, box: { l:0, t:0, r:cropWidth-1, b:cropHeight-1, w:cropWidth, h:cropHeight } };
  };

  fillGaps = function fillPaletteGaps(labels, inMask, width, height) {
    const current = labels.slice();
    const neighbors = [[-1,0,4],[1,0,4],[0,-1,4],[0,1,4],[-1,-1,2],[1,-1,2],[-1,1,2],[1,1,2]];
    let frontier = [];
    const queued = new Uint8Array(width * height);

    const touchesColor = (x, y) => neighbors.some(([dx,dy]) => {
      const xx=x+dx, yy=y+dy;
      if (xx<0 || xx>=width || yy<0 || yy>=height) return false;
      const value=current[yy*width+xx];
      return value>=1 && value<=5;
    });

    for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
      const index=y*width+x;
      if (inMask[index] && current[index]===0 && touchesColor(x,y)) {
        frontier.push(index);
        queued[index]=1;
      }
    }

    while (frontier.length) {
      const assignments=[];
      for (const index of frontier) {
        if (current[index]!==0) continue;
        const x=index%width, y=Math.floor(index/width);
        const scores=[0,0,0,0,0,0];
        for (const [dx,dy,weight] of neighbors) {
          const xx=x+dx, yy=y+dy;
          if (xx<0 || xx>=width || yy<0 || yy>=height) continue;
          const value=current[yy*width+xx];
          if (value>=1 && value<=5) scores[value]+=weight;
        }
        let best=0, score=0;
        for (let level=1; level<=5; level++) {
          if (scores[level]>score) { score=scores[level]; best=level; }
        }
        if (best) assignments.push([index,best]);
      }
      if (!assignments.length) break;

      for (const [index,level] of assignments) current[index]=level;
      const next=[];
      for (const [index] of assignments) {
        const x=index%width, y=Math.floor(index/width);
        for (const [dx,dy] of neighbors) {
          const xx=x+dx, yy=y+dy;
          if (xx<0 || xx>=width || yy<0 || yy>=height) continue;
          const neighborIndex=yy*width+xx;
          if (!inMask[neighborIndex] || current[neighborIndex]!==0 || queued[neighborIndex]) continue;
          queued[neighborIndex]=1;
          next.push(neighborIndex);
        }
      }
      frontier=next;
    }

    return current;
  };
})();
