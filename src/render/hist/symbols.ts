// Map symbols placed once per map: mountains, hills, trees, dunes.
// Positions are seeded so the same world always looks the same.

import { RNG, codeToSeed } from '../../core/rng';
const MOUNTAIN_H = 0.68;
import { Biome, Water, type CellMap } from './types';

export const enum Sym {
  Mountain,
  Hill,
  Broadleaf,
  Conifer,
  Palm,
  Dune,
  Reed,
}

export interface Symbol {
  kind: Sym;
  x: number;
  y: number;
  /** size in world units */
  s: number;
  snow?: boolean;
  /** stable per-symbol variation 0..1 */
  v: number;
}

const HILL_H = 0.47;
const MOUNTAIN_SYM_H = 0.58;

/** Spatial hash rejecting candidates closer than r to an accepted point. */
class Spacer {
  private grid = new Map<number, number[]>();
  constructor(private cell: number) {}
  private key(x: number, y: number) {
    return Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell);
  }
  tryAdd(x: number, y: number, r: number): boolean {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    const reach = Math.ceil(r / this.cell);
    for (let i = cx - reach; i <= cx + reach; i++) {
      for (let j = cy - reach; j <= cy + reach; j++) {
        const b = this.grid.get(i * 100003 + j);
        if (!b) continue;
        for (let k = 0; k < b.length; k += 2) {
          if ((b[k] - x) ** 2 + (b[k + 1] - y) ** 2 < r * r) return false;
        }
      }
    }
    const kk = this.key(x, y);
    const b = this.grid.get(kk);
    if (b) b.push(x, y); else this.grid.set(kk, [x, y]);
    return true;
  }
}

export function placeSymbols(m: CellMap): Symbol[] {
  const rng = new RNG(codeToSeed(m.seed)).fork('symbols');
  const s = m.spacing;
  const out: Symbol[] = [];
  const relief = new Spacer(s * 2);
  const flora = new Spacer(s);

  // Mountains, highest first so ridges get the big peaks.
  const high: number[] = [];
  for (let i = 0; i < m.n; i++) if (m.water[i] === Water.Land && m.height[i] >= MOUNTAIN_SYM_H) high.push(i);
  high.sort((a, b) => m.height[b] - m.height[a] || a - b);
  for (const i of high) {
    const h = m.height[i];
    const size = s * (1.3 + (h - MOUNTAIN_SYM_H) * 5);
    const x = m.x[i] + rng.range(-0.3, 0.3) * s, y = m.y[i] + rng.range(-0.3, 0.3) * s;
    if (!relief.tryAdd(x, y, size * 0.85)) continue;
    out.push({ kind: Sym.Mountain, x, y, s: size, snow: m.temp[i] < 1 || h > MOUNTAIN_H + 0.12, v: rng.float() });
  }

  for (let i = 0; i < m.n; i++) {
    if (m.water[i] !== Water.Land) continue;
    const h = m.height[i];
    const x = m.x[i] + rng.range(-0.35, 0.35) * s, y = m.y[i] + rng.range(-0.35, 0.35) * s;
    const v = rng.float();
    if (h >= HILL_H && h < MOUNTAIN_SYM_H) {
      if (relief.tryAdd(x, y, s * 1.5)) out.push({ kind: Sym.Hill, x, y, s: s * rng.range(0.9, 1.25), v });
      continue;
    }
    const b = m.biome[i];
    const forest = b === Biome.Deciduous || b === Biome.TemperateRainforest || b === Biome.Taiga ||
      b === Biome.TropicalForest || b === Biome.Rainforest;
    if (forest) {
      const kind = b === Biome.Taiga ? Sym.Conifer : b === Biome.Rainforest && v < 0.35 ? Sym.Palm : Sym.Broadleaf;
      const tries = b === Biome.Rainforest || b === Biome.TemperateRainforest ? 3 : 2;
      for (let t = 0; t < tries; t++) {
        const tx = m.x[i] + rng.range(-0.5, 0.5) * s, ty = m.y[i] + rng.range(-0.5, 0.5) * s;
        const ts = s * rng.range(0.42, 0.58);
        if (flora.tryAdd(tx, ty, ts * 0.85)) out.push({ kind, x: tx, y: ty, s: ts, v: rng.float() });
      }
    } else if (b === Biome.HotDesert && v < 0.25) {
      if (flora.tryAdd(x, y, s * 1.4)) out.push({ kind: Sym.Dune, x, y, s: s * 0.9, v: rng.float() });
    } else if (b === Biome.Wetland && v < 0.6) {
      if (flora.tryAdd(x, y, s * 0.8)) out.push({ kind: Sym.Reed, x, y, s: s * 0.5, v: rng.float() });
    }
  }

  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

const INK = '#3b3123';

/** ctx is in world units; px = world units per screen pixel of the target canvas */
export function drawSymbol(ctx: CanvasRenderingContext2D, sym: Symbol, px: number): void {
  const { x, y, s, v } = sym;
  ctx.lineWidth = 1.1 * px;
  ctx.strokeStyle = INK;
  switch (sym.kind) {
    case Sym.Mountain: {
      const w = s, h = s * (0.72 + v * 0.25);
      const peakX = x + (v - 0.5) * w * 0.25;
      const L = x - w / 2, R = x + w / 2, top = y - h;
      // body
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(peakX - w * 0.08, top + h * 0.12);
      ctx.lineTo(peakX, top);
      ctx.lineTo(R, y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(236,224,196,0.96)';
      ctx.fill();
      // shaded right face
      ctx.beginPath();
      ctx.moveTo(peakX, top);
      ctx.lineTo(R, y);
      ctx.lineTo(peakX + w * 0.05, y);
      ctx.lineTo(peakX + w * 0.1, top + h * 0.45);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,100,72,0.42)';
      ctx.fill();
      // hatching on the shade side
      ctx.beginPath();
      const n = Math.max(2, Math.round(s / (3 * px)));
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const ax = peakX + (R - peakX) * t, ay = top + (y - top) * t;
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - w * 0.1, ay + h * 0.22);
      }
      ctx.lineWidth = 0.7 * px;
      ctx.stroke();
      if (sym.snow) {
        ctx.beginPath();
        ctx.moveTo(peakX, top);
        ctx.lineTo(peakX - w * 0.17, top + h * 0.3);
        ctx.lineTo(peakX - w * 0.05, top + h * 0.24);
        ctx.lineTo(peakX + w * 0.04, top + h * 0.33);
        ctx.lineTo(peakX + w * 0.15, top + h * 0.26);
        ctx.closePath();
        ctx.fillStyle = 'rgba(252,250,244,0.95)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(peakX - w * 0.08, top + h * 0.12);
      ctx.lineTo(peakX, top);
      ctx.lineTo(R, y);
      ctx.lineWidth = 1.2 * px;
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }
    case Sym.Hill: {
      ctx.beginPath();
      ctx.moveTo(x - s / 2, y);
      ctx.quadraticCurveTo(x, y - s * 0.62, x + s / 2, y);
      ctx.fillStyle = 'rgba(236,224,196,0.7)';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.05, y - s * 0.22);
      ctx.quadraticCurveTo(x + s * 0.25, y - s * 0.18, x + s * 0.32, y - s * 0.04);
      ctx.lineWidth = 0.7 * px;
      ctx.stroke();
      break;
    }
    case Sym.Broadleaf: {
      const r = s * 0.42;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - r * 0.9);
      ctx.lineWidth = 0.9 * px;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - r * 1.5, r, 0, Math.PI * 2);
      ctx.fillStyle = v < 0.5 ? 'rgba(112,138,82,0.95)' : 'rgba(128,150,90,0.95)';
      ctx.fill();
      ctx.lineWidth = 0.9 * px;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + r * 0.3, y - r * 1.35, r * 0.55, -0.2, 1.6);
      ctx.strokeStyle = 'rgba(59,49,35,0.45)';
      ctx.lineWidth = 0.6 * px;
      ctx.stroke();
      break;
    }
    case Sym.Conifer: {
      const w = s * 0.5, h = s * 1.15;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x - w / 2, y - h * 0.2);
      ctx.lineTo(x + w / 2, y - h * 0.2);
      ctx.closePath();
      ctx.fillStyle = v < 0.5 ? 'rgba(92,122,90,0.95)' : 'rgba(104,132,98,0.95)';
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - h * 0.2);
      ctx.lineTo(x, y);
      ctx.stroke();
      break;
    }
    case Sym.Palm: {
      const h = s * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + s * 0.12, y - h * 0.5, x + s * 0.05, y - h);
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k - 2) * 0.62;
        ctx.moveTo(x + s * 0.05, y - h);
        ctx.quadraticCurveTo(
          x + s * 0.05 + Math.cos(a) * s * 0.3, y - h + Math.sin(a) * s * 0.3 - s * 0.05,
          x + s * 0.05 + Math.cos(a) * s * 0.5, y - h + Math.sin(a) * s * 0.5 + s * 0.12,
        );
      }
      ctx.strokeStyle = 'rgba(80,110,70,1)';
      ctx.lineWidth = 1.2 * px;
      ctx.stroke();
      break;
    }
    case Sym.Dune: {
      ctx.beginPath();
      ctx.moveTo(x - s / 2, y);
      ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.32, x + s * 0.5, y);
      ctx.moveTo(x - s * 0.3, y + s * 0.25);
      ctx.quadraticCurveTo(x + s * 0.05, y + s * 0.02, x + s * 0.4, y + s * 0.25);
      ctx.strokeStyle = 'rgba(140,110,70,0.75)';
      ctx.lineWidth = 0.8 * px;
      ctx.stroke();
      break;
    }
    case Sym.Reed: {
      ctx.beginPath();
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(x + k * s * 0.18, y);
        ctx.lineTo(x + k * s * 0.28, y - s * (0.55 + 0.15 * (1 - Math.abs(k))));
      }
      ctx.moveTo(x - s * 0.45, y + s * 0.05);
      ctx.lineTo(x + s * 0.45, y + s * 0.05);
      ctx.strokeStyle = 'rgba(70,90,70,0.8)';
      ctx.lineWidth = 0.8 * px;
      ctx.stroke();
      break;
    }
  }
}
