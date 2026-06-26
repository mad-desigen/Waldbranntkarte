/* Build-Marker: strictDwdPalette */
(() => {
  'use strict';

  const colors = {
    1: ['#ffffcc', [255,255,204]],
    2: ['#ffd979', [255,217,121]],
    3: ['#ff8c38', [255,140,56]],
    4: ['#e8151c', [232,21,28]],
    5: ['#7e0025', [126,0,37]]
  };

  for (const [level,value] of Object.entries(colors)) {
    LV[level].c = value[0];
    LV[level].r = value[1].slice();
  }

  nearest = function strictDwdPalette(r,g,b) {
    let level = 0;
    let dist = Infinity;
    for (const [number,value] of Object.entries(colors)) {
      const rgb = value[1];
      const current = (r-rgb[0])**2 + (g-rgb[1])**2 + (b-rgb[2])**2;
      if (current <= 8 && current < dist) {
        level = Number(number);
        dist = current;
      }
    }
    return {level,dist};
  };
})();
