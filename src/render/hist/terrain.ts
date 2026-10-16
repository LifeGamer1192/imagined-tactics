// Static terrain layer, baked to a canvas for a world rectangle at a given
// scale. The full map is baked once at a moderate scale; when zoomed in, the
// visible rectangle is re-baked at screen resolution (see MapView).
// The visual style (old map / globe / modern map) picks colours and features.

import { Water, type CellMap } from './types';
import { buildGeometry, cellPath, edgePath, type Geometry } from './geometry';
import { css, mix, type RGB } from './palette';
import { STYLES, hypsoTint, type RenderStyle } from './style';
import { drawSymbol, placeSymbols, type Symbol } from './symbols';
import { drawSprite, spriteSetFor, spritesReady } from './sprites';
import type { VisualStyle } from './types';

export interface TerrainModel {
  m: CellMap;
  geo: Geometry;
  style: RenderStyle;
  landColor: string[];
  waterColor: string[];
  symbols: Symbol[];
  /** cells whose bounding box intersects a rect: precomputed bboxes */
  bbox: Float32Array;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number; }

const CONTOURS = [2, 4, 7];

export function buildTerrainModel(m: CellMap, visual: VisualStyle = 'antique', fractal = false): TerrainModel {
  const style = STYLES[visual];
  const geo = buildGeometry(m, fractal);
  const landColor: string[] = new Array(m.n);
  const waterColor: string[] = new Array(m.n);
  const K = 6 * m.spacing;

  for (let i = 0; i < m.n; i++) {
    if (m.water[i] !== Water.Land) {
      if (m.water[i] === Water.Lake) waterColor[i] = css(style.lake);
      else waterColor[i] = css(mix(style.seaShallow, style.seaDeep, (-m.coastDist[i] - 1) / 6));
      continue;
    }
    // least-squares slope over neighbours -> hillshade lit from the north-west
    let sxx = 0, syy = 0, sxh = 0, syh = 0;
    for (let k = m.nbOff[i]; k < m.nbOff[i + 1]; k++) {
      const j = m.nb[k];
      const dx = m.x[j] - m.x[i], dy = m.y[j] - m.y[i];
      const dh = Math.max(m.height[j], 0.2) - m.height[i];
      sxx += dx * dx; syy += dy * dy; sxh += dx * dh; syh += dy * dh;
    }
    const gx = sxx ? sxh / sxx : 0, gy = syy ? syh / syy : 0;
    // (lit chiefly from the north-west, a little from the north and the west, so ridges facing any way read; the
    // steeper the ground, the darker)
    const lit = 0.55 * (gx + gy) / Math.SQRT2 + 0.25 * gx + 0.2 * gy;
    const steep = Math.hypot(gx, gy);
    const shade = Math.max(-1, Math.min(1, (lit * 1.25 - steep * 0.18) * K * style.hillshade));
    let c: RGB = style.biome[m.biome[i]];
    if (style.hypsometric) {
      const tint = hypsoTint(m.height[i]);
      if (tint) c = mix(c, tint, 0.55);
    } else {
      c = mix(c, style.highland, (m.height[i] - 0.45) * 1.4);
    }
    if (style.hillshade > 0) c = shade > 0 ? mix(c, [250, 244, 228], shade * 0.45) : mix(c, [60, 50, 40], -shade * 0.5);
    landColor[i] = css(c);
  }

  const bbox = new Float32Array(m.n * 4);
  for (let i = 0; i < m.n; i++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let q = m.polyOff[i]; q < m.polyOff[i + 1]; q++) {
      const x = m.poly[2 * q], y = m.poly[2 * q + 1];
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    const pad = m.spacing * 0.5;
    bbox.set([x0 - pad, y0 - pad, x1 + pad, y1 + pad], i * 4);
  }

  return { m, geo, style, landColor, waterColor, symbols: style.symbols ? placeSymbols(m) : [], bbox };
}

export function cellsIn(t: TerrainModel, r: Rect): number[] {
  const out: number[] = [];
  const b = t.bbox;
  for (let i = 0; i < t.m.n; i++) {
    if (b[4 * i + 2] < r.x0 || b[4 * i] > r.x1 || b[4 * i + 3] < r.y0 || b[4 * i + 1] > r.y1) continue;
    out.push(i);
  }
  return out;
}

/**
 * Give a canvas's memory back at once. Safari on iPhone and iPad has a small
 * budget for all canvases together and frees them late; past it new canvases
 * come out blank and the map turns black.
 */
export function releaseCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (c) { c.width = 0; c.height = 0; }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Bake terrain for world rect r at S canvas px per world unit. */
export function bakeTerrain(t: TerrainModel, r: Rect, S: number): HTMLCanvasElement {
  const { m, geo, style } = t;
  const W = (r.x1 - r.x0) * S, H = (r.y1 - r.y0) * S;
  const px = 1 / S; // world units per canvas px
  const cells = cellsIn(t, r);
  const land = cells.filter((i) => m.water[i] === Water.Land);
  const wet = cells.filter((i) => m.water[i] !== Water.Land);

  const toWorld = (ctx: CanvasRenderingContext2D) => ctx.setTransform(S, 0, 0, S, -r.x0 * S, -r.y0 * S);

  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = css(style.paperBg);
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- water: soft depth gradient ---
  const water = softFill(t, wet, t.waterColor, r, S, 0.6);
  ctx.drawImage(water, 0, 0, out.width, out.height);
  releaseCanvas(water);

  toWorld(ctx);

  // --- sea contour lines ---
  if (style.contours) {
    const band = (i: number) => {
      if (m.water[i] !== Water.Ocean) return -1;
      const d = -m.coastDist[i];
      let b = 0;
      for (const c of CONTOURS) if (d >= c) b++;
      return b;
    };
    ctx.beginPath();
    edgePath(ctx, m, geo, (i, j) => {
      const a = band(i), b = band(j);
      return a >= 0 && b >= 0 && a !== b;
    });
    // ink painting: a few brushed wave lines instead of survey contours
    ctx.strokeStyle = style.id === 'ink' ? 'rgba(40,38,34,0.16)' : 'rgba(64,96,104,0.38)';
    ctx.lineWidth = (style.id === 'ink' ? 1.4 : 0.8) * px;
    ctx.stroke();
  }

  // coastal glow on the water side
  const isLand = (i: number) => m.water[i] === Water.Land;
  const coast = new Path2D();
  edgePath(coast, m, geo, (i, j) => isLand(i) !== isLand(j));
  if (style.id !== 'flat') {
    ctx.strokeStyle = style.id === 'globe' ? 'rgba(200,230,255,0.18)' : style.id === 'ink' ? 'rgba(30,28,24,0.12)' : 'rgba(70,100,105,0.16)';
    ctx.lineWidth = Math.max(5 * px, m.spacing * 0.45);
    ctx.stroke(coast);
  }

  // --- water lines: two or three fine lines following the coast out to sea, as old maps drew the shore ---
  if (style.id === 'antique' || style.id === 'ink') {
    const lines = makeCanvas(W, H);
    const l = lines.getContext('2d')!;
    l.lineCap = 'round';
    l.lineJoin = 'round';
    toWorld(l);
    const lw = Math.max(0.7 * px, m.spacing * 0.03);
    const ink = style.id === 'ink' ? [30, 28, 24] : [60, 92, 100];
    // outermost first: each ring is cut out of a wide stroke, and the cut must not take the rings already drawn
    for (let k = 3; k >= 1; k--) {
      const d = m.spacing * 0.32 * k;
      l.globalCompositeOperation = 'source-over';
      l.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${(0.42 - k * 0.09).toFixed(2)})`;
      l.lineWidth = 2 * d + lw;
      l.stroke(coast);
      l.globalCompositeOperation = 'destination-out';
      l.strokeStyle = '#000';
      l.lineWidth = 2 * d - lw;
      l.stroke(coast);
    }
    // only on the water's side
    l.globalCompositeOperation = 'destination-out';
    l.beginPath();
    for (const i of land) cellPath(l, m, geo, i);
    l.fillStyle = '#000';
    l.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lines, 0, 0);
    releaseCanvas(lines);
    toWorld(ctx);
  }

  // --- land: watercolour fill (blurred) or crisp fill, clipped to the coastline ---
  if (style.blurLand) {
    const blurred = makeCanvas(W, H);
    const b = blurred.getContext('2d')!;
    const soft = softFill(t, land, t.landColor, r, S, 0.35);
    b.drawImage(soft, 0, 0, blurred.width, blurred.height);
    releaseCanvas(soft);
    b.globalCompositeOperation = 'destination-in';
    toWorld(b);
    b.beginPath();
    for (const i of land) cellPath(b, m, geo, i);
    b.fillStyle = '#000';
    b.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(blurred, 0, 0);
    releaseCanvas(blurred);
    toWorld(ctx);
  } else {
    ctx.lineWidth = 1.2 * px;
    for (const i of land) {
      ctx.beginPath();
      cellPath(ctx, m, geo, i);
      ctx.fillStyle = t.landColor[i];
      ctx.strokeStyle = t.landColor[i];
      ctx.fill();
      ctx.stroke();
    }
  }

  // --- graticule (globe) ---
  if (style.graticule) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 0.8 * px;
    ctx.beginPath();
    const step = m.w / 16;
    for (let x = 0; x <= m.w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, m.h); }
    for (let y = 0; y <= m.h; y += step) { ctx.moveTo(0, y); ctx.lineTo(m.w, y); }
    ctx.stroke();
  }

  // --- lakes ---
  ctx.beginPath();
  for (const i of wet) if (m.water[i] === Water.Lake) cellPath(ctx, m, geo, i);
  ctx.fillStyle = css(style.lake);
  ctx.fill();

  // --- rivers ---
  // (zoomed out, the small streams are left out: only rivers of some size, so the great ones stand out)
  drawRivers(ctx, m, cells, px, style.river, px * 5 > m.spacing ? 3 : 1);

  // --- coastline & lake shores ---
  ctx.strokeStyle = style.coastInk;
  ctx.lineWidth = style.coastWidth * px;
  ctx.stroke(coast);
  ctx.beginPath();
  edgePath(ctx, m, geo, (i, j) => (m.water[i] === Water.Lake) !== (m.water[j] === Water.Lake) && (isLand(i) || isLand(j)));
  ctx.lineWidth = 0.9 * style.coastWidth * px;
  ctx.stroke();

  // --- symbols ---
  const margin = m.spacing * 3;
  const inView = (s: Symbol) => !(s.x < r.x0 - margin || s.x > r.x1 + margin || s.y < r.y0 - margin || s.y > r.y1 + margin);
  // P23: hand-drawn symbols, printed with multiply so their white paper vanishes
  const set = spriteSetFor(style.id);
  if (spritesReady(set)) {
    ctx.globalCompositeOperation = 'multiply';
    for (const s of t.symbols) if (inView(s) && !drawSprite(ctx, set!, s)) drawSymbol(ctx, s, px);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // ink painting: symbols go to their own layer, turned to sumi in one pass
    // (a filter per symbol would cost a full-canvas layer each time)
    const layer = style.id === 'ink' ? makeCanvas(W, H) : null;
    const sctx = layer ? layer.getContext('2d')! : ctx;
    if (layer) { sctx.lineCap = 'round'; sctx.lineJoin = 'round'; toWorld(sctx); }
    for (const s of t.symbols) if (inView(s)) drawSymbol(sctx, s, px);
    if (layer) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = 'grayscale(1) contrast(1.15)';
      ctx.drawImage(layer, 0, 0);
      ctx.filter = 'none';
      releaseCanvas(layer);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

/**
 * Cells filled with their colours and blurred by `blur` x spacing. Rendered at
 * reduced resolution (the result is blurry anyway) and upscaled by the caller,
 * which keeps the blur cost small for big bakes.
 */
function softFill(t: TerrainModel, cells: number[], colors: string[], r: Rect, S: number, blur: number): HTMLCanvasElement {
  const { m, geo } = t;
  const blurWorld = m.spacing * blur;
  // ~3 low-res px per blur radius is plenty
  const lowS = Math.min(S, 3 / blurWorld);
  const pad = 2;
  const c = makeCanvas((r.x1 - r.x0) * lowS, (r.y1 - r.y0) * lowS);
  const x = c.getContext('2d')!;
  x.setTransform(lowS, 0, 0, lowS, -r.x0 * lowS, -r.y0 * lowS);
  x.lineWidth = pad / lowS;
  for (const i of cells) {
    x.beginPath();
    cellPath(x, m, geo, i);
    x.fillStyle = colors[i];
    x.strokeStyle = colors[i];
    x.fill();
    x.stroke();
  }
  const out = makeCanvas(c.width, c.height);
  const o = out.getContext('2d')!;
  o.filter = `blur(${Math.max(0.8, blurWorld * lowS)}px)`;
  o.drawImage(c, 0, 0);
  releaseCanvas(c);
  return out;
}

function drawRivers(ctx: CanvasRenderingContext2D, m: CellMap, cells: number[], px: number, color: string, minFlux = 1): void {
  const isRiver = (i: number) => m.water[i] === Water.Land && m.flux[i] >= m.riverMin * minFlux;
  // A cell is a source if no river flows into it.
  const fed = new Set<number>();
  for (const i of cells) if (isRiver(i) && m.down[i] >= 0) fed.add(m.down[i]);

  ctx.strokeStyle = color;
  for (const c of cells) {
    if (!isRiver(c)) continue;
    const d = m.down[c];
    if (d < 0) continue;
    const width = Math.min(3.2, 0.5 + Math.sqrt(m.flux[c] / m.riverMin) * 0.45) * px * 1.4;
    const mx1 = (m.x[c] + m.x[d]) / 2, my1 = (m.y[c] + m.y[d]) / 2;
    ctx.beginPath();
    if (!fed.has(c)) {
      ctx.moveTo(m.x[c], m.y[c]);
      ctx.lineTo(mx1, my1);
    } else {
      ctx.moveTo(mx1, my1);
    }
    if (m.water[d] === Water.Land) {
      const dd = m.down[d];
      if (dd >= 0) {
        const mx2 = (m.x[d] + m.x[dd]) / 2, my2 = (m.y[d] + m.y[dd]) / 2;
        ctx.quadraticCurveTo(m.x[d], m.y[d], mx2, my2);
      }
    }
    ctx.lineWidth = width;
    ctx.stroke();
  }
}
