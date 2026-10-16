// 和紙の質感。画面に対して毎回かけるので、拡大しても粗くならない。
// hist-sim/src/render/paper.ts から（もとは dunmas-web/src/render/textures.ts の addNoise の考え方）。

import { RNG } from '../core/rng';

let grain: HTMLCanvasElement | null = null;

export function paperGrain(): HTMLCanvasElement {
  if (grain) return grain;
  const size = 384;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rng = new RNG(20240904);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);

  // やわらかいむら
  for (let k = 0; k < 40; k++) {
    const x = rng.float() * size, y = rng.float() * size, r = rng.range(20, 90);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = rng.chance(0.5) ? 112 : 142;
    g.addColorStop(0, `rgba(${v},${v},${v},0.25)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      ctx.save(); ctx.translate(dx, dy); ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.restore();
    }
  }
  // 繊維
  ctx.lineWidth = 0.6;
  for (let k = 0; k < 160; k++) {
    const x = rng.float() * size, y = rng.float() * size, a = rng.range(0, Math.PI), l = rng.range(4, 14);
    ctx.strokeStyle = rng.chance(0.5) ? 'rgba(100,100,100,0.18)' : 'rgba(160,160,160,0.18)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // 点ごとのざらつき
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng.float() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  grain = c;
  return c;
}

/** いまの画面に、紙のざらつき（soft-light）と、ふちの陰り（multiply）を重ねる */
export function applyPaper(ctx: CanvasRenderingContext2D, w: number, h: number, vignette = 0.28): void {
  const pat = ctx.createPattern(paperGrain(), 'repeat');
  if (pat) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.78);
  g.addColorStop(0, 'rgba(90,60,30,0)');
  g.addColorStop(1, `rgba(90,60,30,${vignette})`);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
