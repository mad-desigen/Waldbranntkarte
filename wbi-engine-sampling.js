(() => {
  'use strict';

  const engine = window.WBIOriginal;

  engine.sourceAt = function sourceAt(imageData, x, y) {
    const centerX = Math.round(x);
    const centerY = Math.round(y);
    if (centerX < 0 || centerY < 0 || centerX >= imageData.width || centerY >= imageData.height) return false;

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = centerX + dx;
        const py = centerY + dy;
        if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
        if (imageData.data[(py * imageData.width + px) * 4 + 3] > 90) return true;
      }
    }
    return false;
  };

  engine.sample = function sample(imageData, x, y) {
    const centerX = Math.round(x);
    const centerY = Math.round(y);

    for (const radius of [0,1,2,3,5,8,12,18]) {
      const points = radius ? [
        [centerX-radius,centerY], [centerX+radius,centerY],
        [centerX,centerY-radius], [centerX,centerY+radius],
        [centerX-radius,centerY-radius], [centerX+radius,centerY-radius],
        [centerX-radius,centerY+radius], [centerX+radius,centerY+radius]
      ] : [[centerX, centerY]];
      const votes = {};

      for (const [px, py] of points) {
        if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
        const index = (py * imageData.width + px) * 4;
        if (imageData.data[index+3] < 90) continue;
        const match = engine.nearest(imageData.data[index], imageData.data[index+1], imageData.data[index+2]);
        if (match.dist < 1600) votes[match.level] = (votes[match.level] || 0) + 1;
      }

      const winner = Object.entries(votes).sort((a,b) => b[1]-a[1])[0];
      if (winner) return Number(winner[0]);
    }
    return 0;
  };
})();
