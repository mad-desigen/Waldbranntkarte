/* Build-Marker: exactPaletteLevel fillExactPaletteGaps */
(() => {
  'use strict';
  const colors = {
    1: ['#ffffce', [255, 255, 206]],
    2: ['#ffd879', [255, 216, 121]],
    3: ['#ff8c39', [255, 140, 57]],
    4: ['#e9151c', [233, 21, 28]],
    5: ['#800126', [128, 1, 38]]
  };
  for (const [level, value] of Object.entries(colors)) {
    LV[level].c = value[0];
    LV[level].r = value[1];
  }
})();
