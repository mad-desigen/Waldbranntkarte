/* Build-Marker: exactPaletteLevel fillExactPaletteGaps */
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
    LV[level].c=value[0];
    LV[level].r=value[1].slice();
  }

  const previousLoadDay=loadDay;
  const ready=new Promise((resolve,reject)=>{
    const deadline=Date.now()+10000;
    const check=()=>{
      if (window.WBIOriginal?.fillExactPaletteGaps) return resolve();
      if (Date.now()>deadline) return reject(new Error('Die exakte WBI-Farberkennung konnte nicht initialisiert werden.'));
      window.setTimeout(check,10);
    };
    check();
  });

  loadDay=async function(force=false) {
    await ready;
    return previousLoadDay(force);
  };
})();
