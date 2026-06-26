(() => {
  'use strict';

  const engine = window.WBIOriginal;

  function score(params, source, target, sourceBox, targetBox) {
    const [scaleX, scaleY, offsetX, offsetY, shear] = params;
    const sourceCenterX = (sourceBox.left + sourceBox.right) / 2;
    const sourceCenterY = (sourceBox.top + sourceBox.bottom) / 2;
    const targetCenterX = (targetBox.left + targetBox.right) / 2;
    const targetCenterY = (targetBox.top + targetBox.bottom) / 2;
    const step = Math.max(4, Math.round(Math.max(targetBox.width, targetBox.height) / 210));
    let targetCount = 0;
    let sourceCount = 0;
    let overlap = 0;

    for (let y = Math.max(0, targetBox.top-step*3); y <= Math.min(target.height-1, targetBox.bottom+step*3); y += step) {
      for (let x = Math.max(0, targetBox.left-step*3); x <= Math.min(target.width-1, targetBox.right+step*3); x += step) {
        const targetOn = target.data[(y * target.width + x) * 4 + 3] > 0;
        const sourceOn = engine.sourceAt(
          source,
          sourceCenterX + (x-targetCenterX)*scaleX + offsetX + shear*(y-targetCenterY),
          sourceCenterY + (y-targetCenterY)*scaleY + offsetY
        );
        if (targetOn) targetCount++;
        if (sourceOn) sourceCount++;
        if (targetOn && sourceOn) overlap++;
      }
    }
    return 2 * overlap / Math.max(1, targetCount + sourceCount);
  }

  function optimize(source, target, sourceBox, targetBox) {
    let params = [sourceBox.width/targetBox.width, sourceBox.height/targetBox.height, 0, 0, 0];
    let steps = [params[0]*.04, params[1]*.04, Math.max(4,sourceBox.width*.009), Math.max(4,sourceBox.height*.007), .01];
    let best = score(params, source, target, sourceBox, targetBox);

    for (let round = 0; round < 8; round++) {
      let changed = true;
      let guard = 0;
      while (changed && guard++ < 14) {
        changed = false;
        for (let index = 0; index < params.length; index++) {
          for (const sign of [-1,1]) {
            const candidate = params.slice();
            candidate[index] += sign * steps[index];
            if (candidate[0] <= 0 || candidate[1] <= 0) continue;
            const value = score(candidate, source, target, sourceBox, targetBox);
            if (value > best) {
              params = candidate;
              best = value;
              changed = true;
            }
          }
        }
      }
      steps = steps.map(value => value * .55);
    }
    return params;
  }

  fit = function fitUsingOriginalEngine(img) {
    const prepared = engine.prepare(img);
    const source = prepared.getContext('2d', { willReadFrequently:true }).getImageData(0, 0, prepared.width, prepared.height);
    const bbox = turf.bbox(S.states);
    const northMercator = my(bbox[3]);
    const southMercator = my(bbox[1]);
    const height = 1100;
    const width = Math.max(620, Math.round(height * ((bbox[2]-bbox[0])*Math.PI/180) / (northMercator-southMercator)));

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently:true });
    maskContext.fillStyle = '#fff';
    drawGeom(maskContext, S.mask.geometry, width, height, bbox);
    maskContext.fill('evenodd');
    const target = maskContext.getImageData(0, 0, width, height);

    const sourceBox = engine.bounds(source);
    const targetBox = engine.bounds(target);
    const params = optimize(source, target, sourceBox, targetBox);
    const [scaleX, scaleY, offsetX, offsetY, shear] = params;
    const sourceCenterX = (sourceBox.left + sourceBox.right) / 2;
    const sourceCenterY = (sourceBox.top + sourceBox.bottom) / 2;
    const targetCenterX = (targetBox.left + targetBox.right) / 2;
    const targetCenterY = (targetBox.top + targetBox.bottom) / 2;

    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outputContext = output.getContext('2d', { willReadFrequently:true });
    const outputData = outputContext.createImageData(width, height);
    const labels = new Uint8Array(width * height);

    for (let y = targetBox.top; y <= targetBox.bottom; y++) {
      for (let x = targetBox.left; x <= targetBox.right; x++) {
        const pixel = y * width + x;
        const dataIndex = pixel * 4;
        if (!target.data[dataIndex+3]) continue;

        const sourceX = Math.max(sourceBox.left, Math.min(sourceBox.right,
          sourceCenterX + (x-targetCenterX)*scaleX + offsetX + shear*(y-targetCenterY)));
        const sourceY = Math.max(sourceBox.top, Math.min(sourceBox.bottom,
          sourceCenterY + (y-targetCenterY)*scaleY + offsetY));
        const level = engine.sample(source, sourceX, sourceY);
        if (!level) continue;

        labels[pixel] = level;
        const rgb = engine.refs[level];
        outputData.data[dataIndex] = rgb[0];
        outputData.data[dataIndex+1] = rgb[1];
        outputData.data[dataIndex+2] = rgb[2];
        outputData.data[dataIndex+3] = 255;
      }
    }

    outputContext.putImageData(outputData, 0, 0);
    return { canvas:output, labels, w:width, h:height, bbox };
  };
})();
