// Hand-drawn geometry: every Voronoi edge is split into `per` segments and
// all points are displaced by a noise field that depends only on position.
// Two cells sharing an edge therefore produce the very same wobbly line, so
// fills and strokes stay seamless. "Fractal" mode (P7) splits edges finer and
// adds smaller octaves, for realistic coastlines; it never touches the sim.
//
// Layout: original polygon edge e (global index into edgeNb) owns displaced
// points per*e .. per*e+per-1; the next vertex is the first point of the next edge.

import { createNoise2D } from 'simplex-noise';
import { RNG, codeToSeed } from '../../core/rng';
import type { CellMap } from './types';

export interface Geometry {
  /** points per original edge */
  per: number;
  /** displaced points, x,y pairs; cell i owns points per*polyOff[i] .. per*polyOff[i+1] */
  pts: Float32Array;
}

export function buildGeometry(m: CellMap, fractal = false): Geometry {
  const rng = new RNG(codeToSeed(m.seed)).fork('wobble');
  const nx = createNoise2D(rng.fn());
  const ny = createNoise2D(rng.fn());
  const s = m.spacing;
  const octaves = fractal
    ? [[1 / (s * 1.7), s * 0.26], [1 / (s * 0.45), s * 0.11], [1 / (s * 0.16), s * 0.045], [1 / (s * 0.06), s * 0.018]]
    : [[1 / (s * 1.7), s * 0.22], [1 / (s * 0.45), s * 0.07]];
  const per = fractal ? 9 : 3;
  const disp = (x: number, y: number, out: Float32Array, o: number) => {
    // Keep the map frame straight: no displacement on the bounding box.
    const edge = x <= 0.01 || y <= 0.01 || x >= m.w - 0.01 || y >= m.h - 0.01;
    if (edge) { out[o] = x; out[o + 1] = y; return; }
    let dx = 0, dy = 0;
    octaves.forEach(([f, a], k) => {
      dx += nx(x * f + k * 31, y * f) * a;
      dy += ny(x * f, y * f + k * 17) * a;
    });
    out[o] = x + dx;
    out[o + 1] = y + dy;
  };

  const pts = new Float32Array(m.edgeNb.length * per * 2);
  for (let i = 0; i < m.n; i++) {
    const a = m.polyOff[i], b = m.polyOff[i + 1], cnt = b - a;
    for (let k = 0; k < cnt; k++) {
      const e = a + k, e2 = a + ((k + 1) % cnt);
      const x0 = m.poly[2 * e], y0 = m.poly[2 * e + 1];
      const x1 = m.poly[2 * e2], y1 = m.poly[2 * e2 + 1];
      for (let q = 0; q < per; q++) {
        const t = q / per;
        disp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, pts, 2 * (per * e + q));
      }
    }
  }
  return { per, pts };
}

export function cellPath(ctx: CanvasRenderingContext2D | Path2D, m: CellMap, g: Geometry, i: number): void {
  const a = g.per * m.polyOff[i], b = g.per * m.polyOff[i + 1];
  if (b <= a) return;
  const p = g.pts;
  ctx.moveTo(p[2 * a], p[2 * a + 1]);
  for (let q = a + 1; q < b; q++) ctx.lineTo(p[2 * q], p[2 * q + 1]);
  ctx.closePath();
}

/**
 * The outline of a set of cells as closed rings (outer edges and holes), with the same wobbly points the
 * cells use. Filling these rings paints exactly what filling every cell would, with a fraction of the
 * points (a realm's wash was the slowest part of a redraw). Returns false — adding nothing — if the
 * edges do not close into rings, so the caller can fall back to the cells.
 */
export function ringPath(ctx: Path2D, m: CellMap, g: Geometry, cells: number[]): boolean {
  const inSet = new Set(cells);
  const key = (e: number) => `${Math.round(m.poly[2 * e] * 1000)},${Math.round(m.poly[2 * e + 1] * 1000)}`;
  // boundary edges: from the start vertex of e to the start vertex of the next edge of the same cell
  const from = new Map<string, number[]>();
  const ends: number[] = [];
  const edges: number[] = [];
  for (const i of cells) {
    const a = m.polyOff[i], b = m.polyOff[i + 1], cnt = b - a;
    for (let k = 0; k < cnt; k++) {
      const e = a + k, j = m.edgeNb[e];
      if (j >= 0 && inSet.has(j)) continue;
      const e2 = a + ((k + 1) % cnt);
      const ks = key(e);
      const list = from.get(ks);
      if (list) list.push(edges.length); else from.set(ks, [edges.length]);
      edges.push(e);
      ends.push(e2);
    }
  }
  if (!edges.length) return false;
  const used = new Uint8Array(edges.length);
  const p = g.pts, per = g.per;
  const rings: number[][] = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const ring: number[] = [];
    const startKey = key(edges[s]);
    let cur = s;
    for (let guard = 0; guard <= edges.length; guard++) {
      used[cur] = 1;
      ring.push(cur);
      const endKey = key(ends[cur]);
      if (endKey === startKey) break;
      const next = from.get(endKey)?.find((x) => !used[x]);
      if (next === undefined) return false;
      cur = next;
    }
    if (key(ends[ring[ring.length - 1]]) !== startKey) return false;
    rings.push(ring);
  }
  for (const ring of rings) {
    let first = true;
    for (const r of ring) {
      const sp = per * edges[r];
      for (let q = 0; q < per; q++) {
        const x = p[2 * (sp + q)], y = p[2 * (sp + q) + 1];
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
  }
  return true;
}

/** Adds every edge between cells i<j where pred(i,j) holds as an open sub-path. */
export function edgePath(
  ctx: CanvasRenderingContext2D | Path2D,
  m: CellMap,
  g: Geometry,
  pred: (i: number, j: number) => boolean,
  cells?: Iterable<number>,
): void {
  const p = g.pts, per = g.per;
  const iter = cells ?? range(m.n);
  for (const i of iter) {
    const a = m.polyOff[i], b = m.polyOff[i + 1], cnt = b - a;
    for (let k = 0; k < cnt; k++) {
      const e = a + k;
      const j = m.edgeNb[e];
      if (j < 0 || !pred(i, j)) continue;
      // Draw each shared edge once unless only a subset of cells is iterated.
      if (!cells && j < i) continue;
      const e2 = a + ((k + 1) % cnt);
      const s = per * e;
      ctx.moveTo(p[2 * s], p[2 * s + 1]);
      for (let q = 1; q < per; q++) ctx.lineTo(p[2 * (s + q)], p[2 * (s + q) + 1]);
      ctx.lineTo(p[2 * per * e2], p[2 * per * e2 + 1]);
    }
  }
}

function* range(n: number): Iterable<number> {
  for (let i = 0; i < n; i++) yield i;
}
