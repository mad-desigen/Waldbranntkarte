(() => {
  'use strict';

  const colors = {
    1: ['#ffffce', [255,255,206]],
    2: ['#ffd879', [255,216,121]],
    3: ['#ff8c39', [255,140,57]],
    4: ['#e9151c', [233,21,28]],
    5: ['#800126', [128,1,38]]
  };
  for (const [level,value] of Object.entries(colors)) {
    LV[level].c=value[0];
    LV[level].r=value[1].slice();
  }

  const previousLoadDay=loadDay;
  const modules=['wbi-engine-core.js','wbi-engine-sampling.js','wbi-engine-fit.js'];
  const ready=modules.reduce((chain,source)=>chain.then(()=>new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=source+'?v=original-1';
    script.onload=resolve;
    script.onerror=()=>reject(new Error('Originalmodul konnte nicht geladen werden: '+source));
    document.head.appendChild(script);
  })),Promise.resolve());

  loadDay=async function(force=false) {
    await ready;
    return previousLoadDay(force);
  };
})();
