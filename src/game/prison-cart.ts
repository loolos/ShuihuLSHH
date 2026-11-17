/** 囚车前景：透明栅栏让车内人物仍可辨认，不借用或改动原版素材。 */
export function prisonCartCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 88;
  const c = canvas.getContext('2d')!;
  c.lineJoin = 'round';
  // 木轮、轮轴与车板。
  for (const x of [12, 52]) {
    c.fillStyle = '#30251a'; c.beginPath(); c.ellipse(x, 74, 8, 11, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#a0824e'; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.moveTo(x, 65); c.lineTo(x, 83); c.moveTo(x - 6, 74); c.lineTo(x + 6, 74); c.stroke();
  }
  c.fillStyle = '#49341e'; c.fillRect(4, 62, 56, 9);
  c.fillStyle = '#a07b45'; c.fillRect(3, 60, 58, 5);
  // 笼框；中间留空，人物仍由原有精灵绘制。
  c.strokeStyle = '#38291b'; c.lineWidth = 5; c.strokeRect(8, 12, 48, 49);
  c.strokeStyle = '#b09159'; c.lineWidth = 2; c.strokeRect(8, 12, 48, 49);
  c.lineWidth = 3; c.strokeStyle = '#755b36';
  for (const x of [19, 31, 43]) { c.beginPath(); c.moveTo(x, 14); c.lineTo(x, 60); c.stroke(); }
  c.fillStyle = '#856639'; c.fillRect(4, 7, 56, 7);
  c.fillStyle = '#c1a16a'; c.fillRect(4, 7, 56, 2);
  c.fillStyle = '#393b37'; c.fillRect(29, 39, 7, 9);
  return canvas;
}
