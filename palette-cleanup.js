/* Exakte DWD-Palette, stabiler Kartenzuschnitt und Grenzluecken-Fuellung */
(() => {
  'use strict';

  const PALETTE = {
    1: { hex:'#ffffcc', rgb:[255,255,204] },
    2: { hex:'#ffd979', rgb:[255,217,121] },
    3: { hex:'#ff8c38', rgb:[255,140,56] },
    4: { hex:'#e8151c', rgb:[232,21,28] },
    5: { hex:'#7e0025', rgb:[126,0,37] }
  };

  const COLOR_DISTANCE_SQ = 8;
  const BORDER_RADIUS = 2;

  for (const [level,value] of Object.entries(PALETTE)) {
    LV[level].c = value.hex;
    LV[level].r = value.rgb.slice();
  }

  function paletteLevel(r,g,b) {
    let bestLevel = 0;
    let bestDistance = Infinity;
    for (const [level,value] of Object.entries(PALETTE)) {
      const rgb = value.rgb;
      const distance = (r-rgb[0])**2 + (g-rgb[1])**2 + (b-rgb[2])**2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLevel = Number(level);
      }
    }
    return bestDistance <= COLOR_DISTANCE_SQ ? bestLevel : 0;
  }

  function isBorderPixel(r,g,b) {
    const max = Math.max(r,g,b);
    const min = Math.min(r,g,b);
    const chroma = max-min;
    const luminance = 0.2126*r + 0.7152*g + 0.0722*b;
    return luminance < 215 && chroma <= 28;
  }

  function dilate(mask,width,height,radius) {
    const out = mask.slice();
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      if (!mask[y*width+x]) continue;
      for (let dy=-radius;dy<=radius;dy++) {
        const yy=y+dy;
        if (yy<0||yy>=height) continue;
        for (let dx=-radius;dx<=radius;dx++) {
          const xx=x+dx;
          if (xx<0||xx>=width||dx*dx+dy*dy>radius*radius) continue;
          out[yy*width+xx]=1;
        }
      }
    }
    return out;
  }

  nearest = function nearestExactDwdColor(r,g,b) {
    const level = paletteLevel(r,g,b);
    if (!level) return {level:0,dist:Infinity};
    const rgb = PALETTE[level].rgb;
    return {
      level,
      dist:(r-rgb[0])**2 + (g-rgb[1])**2 + (b-rgb[2])**2
    };
  };

  sourceCanvas = function sourceCanvasPaletteOnly(img) {
    const canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth;
    canvas.height=img.naturalHeight;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(img,0,0);

    const image=context.getImageData(0,0,canvas.width,canvas.height);
    const pixels=image.data;
    const width=canvas.width;
    const height=canvas.height;
    const scanHeight=Math.floor(height*.90);
    const paletteLabels=new Uint8Array(width*height);
    const borderCore=new Uint8Array(width*height);

    let left=width,top=height,right=-1,bottom=-1;

    for (let y=0;y<scanHeight;y++) for (let x=0;x<width;x++) {
      const p=(y*width+x)*4;
      if (pixels[p+3]<128) continue;
      const level=paletteLevel(pixels[p],pixels[p+1],pixels[p+2]);
      if (level) {
        paletteLabels[y*width+x]=level;
        left=Math.min(left,x);
        right=Math.max(right,x);
        top=Math.min(top,y);
        bottom=Math.max(bottom,y);
      }
      if (isBorderPixel(pixels[p],pixels[p+1],pixels[p+2])) {
        borderCore[y*width+x]=1;
      }
    }

    if (right<left||bottom<top) {
      throw new Error('In der DWD-Grafik wurden keine der fünf WBI-Farben erkannt.');
    }

    const borders=dilate(borderCore,width,height,BORDER_RADIUS);
    const cropWidth=right-left+1;
    const cropHeight=bottom-top+1;
    const labels=new Uint8Array(cropWidth*cropHeight);

    for (let y=0;y<cropHeight;y++) for (let x=0;x<cropWidth;x++) {
      const sourceIndex=(y+top)*width+x+left;
      const targetIndex=y*cropWidth+x;
      labels[targetIndex]=borders[sourceIndex]?6:paletteLabels[sourceIndex];
    }

    return {
      labels,
      box:{l:0,t:0,r:cropWidth-1,b:cropHeight-1,w:cropWidth,h:cropHeight}
    };
  };

  sourceAt = function sourceAtStable(labels,width,height,x,y) {
    const centerX=Math.round(x);
    const centerY=Math.round(y);
    for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) {
      const xx=centerX+dx;
      const yy=centerY+dy;
      if (xx<0||yy<0||xx>=width||yy>=height) continue;
      if (labels[yy*width+xx]>0) return true;
    }
    return false;
  };

  function valid(value) {
    return value>=1&&value<=5;
  }

  function read(data,width,height,x,y) {
    return x>=0&&y>=0&&x<width&&y<height?data[y*width+x]:0;
  }

  function seek(data,width,height,x,y,dx,dy,maxDistance) {
    for (let distance=1;distance<=maxDistance;distance++) {
      const value=read(data,width,height,x+dx*distance,y+dy*distance);
      if (valid(value)) return value;
    }
    return 0;
  }

  fillGaps = function fillOppositePaletteGaps(labels,inMask,width,height) {
    let current=labels.slice();
    for (let i=0;i<current.length;i++) if (current[i]===6) current[i]=0;

    const axes=[[1,0],[0,1],[1,1],[1,-1]];

    for (let round=0;round<18;round++) {
      const next=current.slice();
      let changed=0;

      for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
        const index=y*width+x;
        if (!inMask[index]||valid(current[index])) continue;
        const votes=[0,0,0,0,0,0];

        for (const [dx,dy] of axes) {
          const first=seek(current,width,height,x,y,dx,dy,6);
          const opposite=seek(current,width,height,x,y,-dx,-dy,6);
          if (!first||!opposite) continue;
          if (first===opposite) votes[first]+=10;
          else {
            votes[first]+=3;
            votes[opposite]+=3;
          }
        }

        for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
          if (!dx&&!dy) continue;
          const value=read(current,width,height,x+dx,y+dy);
          if (valid(value)) votes[value]++;
        }

        let best=0;
        for (let level=1;level<=5;level++) if (votes[level]>votes[best]) best=level;
        if (best&&votes[best]>=2) {
          next[index]=best;
          changed++;
        }
      }

      current=next;
      if (!changed) break;
    }

    for (let round=0;round<20;round++) {
      const next=current.slice();
      let changed=0;
      for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
        const index=y*width+x;
        if (!inMask[index]||valid(current[index])) continue;
        const counts=[0,0,0,0,0,0];
        let total=0;
        for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) {
          if (!dx&&!dy) continue;
          const value=read(current,width,height,x+dx,y+dy);
          if (valid(value)) {
            counts[value]++;
            total++;
          }
        }
        if (!total) continue;
        let best=1;
        for (let level=2;level<=4;level++) if (counts[level]>counts[best]) best=level;
        if (counts[5]>=Math.max(4,Math.ceil(total*.6))&&counts[5]>counts[best]) best=5;
        next[index]=best;
        changed++;
      }
      current=next;
      if (!changed) break;
    }

    return current;
  };
})();
