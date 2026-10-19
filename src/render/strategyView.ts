// 戦略マップの描画。hist-sim の地図と同じ描き方で描く（セーブから続けて遊んでいる感じを出すため）。
//   地形：src/render/hist/ に移した hist-sim の地形描画（terrain.ts ほか）を、セーブの地図データと絵柄の設定でそのまま使う
//   勢力：領を勢力の色で薄く塗り、境に色の帯と墨の線（hist-sim/src/render/political.ts の drawWash）
//   国名：領土の形に沿って大きく書く（同 drawLabels・drawVertical）
//   町、方位、題字（世界の名前と年）も hist-sim にならう
// その上に、hex-sim の操作の表示（選んだ領、移動・攻撃できる領、武将の人数）を重ねる。

import { offstageCells, type HWorld } from '../bridge/histsim';
import type { GameStart } from '../convert/model';
import { Camera } from './camera';
import { crestCanvas } from './crest';
import { cellPath, edgePath, ringPath } from './hist/geometry';
import { css, INK, type RGB } from './hist/palette';
import { loadSprites, setsFor, spritesReady, townSprite, type TownStage } from './hist/sprites';
import { tint, type RenderStyle } from './hist/style';
import { bakeTerrain, buildTerrainModel, releaseCanvas, type TerrainModel } from './hist/terrain';
import type { CellMap, VisualStyle } from './hist/types';
import { hash01, INDIGO, OCHRE, VERMILION } from './ink';
import { applyPaper } from './paper';
import { drawDesk } from './desk';
import { onArtLoaded } from '../art/art';

export interface StrategyHighlight {
  selected?: number;
  /** 移動できる領 */
  move?: Set<number>;
  /** 攻められる領 */
  attack?: Set<number>;
  hover?: number;
  /** 領ごとの武将の人数 */
  counts?: Map<number, number>;
  player?: number;
  /** 交戦中の勢力の組（"小さい番号-大きい番号"）。境に戦線を引く */
  wars?: Set<string>;
  /** 囲まれている領 → 進み具合（0〜1） */
  sieges?: Map<number, number>;
  /** 攻めてきた領（from）と攻められた領（to）。両方を目立たせ、矢印でつなぐ */
  alarm?: { from: number; to: number };
  /** 持ち主が変わったところを見せる領（月送りの演出） */
  flash?: number;
}

/** 国名を書く曲線（始点・制御点・終点） */
interface Spine { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number; len: number }
const SPINE_SAMPLES = 32;
/** 先に描いておく地形の細かさ（地図の1単位あたりのピクセル数） */
const BAKE = 2;

function spinePoint(s: Spine, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * s.x0 + 2 * u * t * s.cx + t * t * s.x1, u * u * s.y0 + 2 * u * t * s.cy + t * t * s.y1];
}

/** 領土のいちばん大きなかたまりの長い向きに、土地の曲がりに合わせて引いた曲線 */
function realmSpine(block: { cx: number; cy: number; area: number }[], spacing: number): Spine {
  let sx = 0, sy = 0, a = 0;
  for (const P of block) { sx += P.cx * P.area; sy += P.cy * P.area; a += P.area; }
  const mx = sx / a, my = sy / a;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const P of block) {
    const dx = P.cx - mx, dy = P.cy - my;
    cxx += dx * dx * P.area; cyy += dy * dy * P.area; cxy += dx * dy * P.area;
  }
  // 読みやすいよう、傾きは約50度まで
  const angle = Math.max(-0.85, Math.min(0.85, 0.5 * Math.atan2(2 * cxy, cxx - cyy)));
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const vx = -uy, vy = ux;
  let tmin = Infinity, tmax = -Infinity;
  for (const P of block) {
    const t = (P.cx - mx) * ux + (P.cy - my) * uy;
    const r = Math.sqrt(P.area) * spacing * 0.5;
    tmin = Math.min(tmin, t - r); tmax = Math.max(tmax, t + r);
  }
  const L = tmax - tmin;
  const off = [0, 0, 0], wt = [0, 0, 0];
  for (const P of block) {
    const t = (P.cx - mx) * ux + (P.cy - my) * uy;
    const k = Math.min(2, Math.max(0, Math.floor(((t - tmin) / L) * 3)));
    off[k] += ((P.cx - mx) * vx + (P.cy - my) * vy) * P.area;
    wt[k] += P.area;
  }
  const s = off.map((o, k) => (wt[k] ? o / wt[k] : 0));
  const tA = tmin + L * 0.17, tB = tmax - L * 0.17, tM = (tA + tB) / 2;
  const at = (t: number, o: number): [number, number] => [mx + ux * t + vx * o, my + uy * t + vy * o];
  let A = at(tA, s[0]), B = at(tB, s[2]);
  const M = at(tM, s[1]);
  // 曲がりすぎないよう、たわみを抑える
  const chord = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
  const midX = (A[0] + B[0]) / 2, midY = (A[1] + B[1]) / 2;
  const sag = Math.hypot(M[0] - midX, M[1] - midY);
  const k = sag > chord * 0.18 ? (chord * 0.18) / sag : 1;
  const Mx = midX + (M[0] - midX) * k, My = midY + (M[1] - midY) * k;
  if (A[0] > B[0]) [A, B] = [B, A];
  const spine: Spine = { x0: A[0], y0: A[1], cx: 2 * Mx - midX, cy: 2 * My - midY, x1: B[0], y1: B[1], len: 0 };
  let [px, py] = spinePoint(spine, 0);
  for (let i = 1; i <= SPINE_SAMPLES; i++) {
    const [x, y] = spinePoint(spine, i / SPINE_SAMPLES);
    spine.len += Math.hypot(x - px, y - py);
    px = x; py = y;
  }
  return spine;
}

/** つながった領のかたまりのうち、いちばん重いもの */
function largestBlock(items: number[], nb: (p: number) => number[], weight: (p: number) => number): number[] {
  const set = new Set(items), seen = new Set<number>();
  let best: number[] = [], bestW = -1;
  for (const s of items) {
    if (seen.has(s)) continue;
    const block: number[] = [], stack = [s];
    seen.add(s);
    while (stack.length) {
      const p = stack.pop()!;
      block.push(p);
      for (const q of nb(p)) if (set.has(q) && !seen.has(q)) { seen.add(q); stack.push(q); }
    }
    const wsum = block.reduce((a, p) => a + weight(p), 0);
    if (wsum > bestW) { bestW = wsum; best = block; }
  }
  return best;
}

interface FactionGeo { path: Path2D; border: Path2D; spine: Spine }

/**
 * 世界の地図の下ごしらえ（地形の色、領の形、地形の絵）。重いので1つだけ覚えておき、同じ世界なら使い回す。
 * 地形の絵は、地図を縦横に分けた区画ごとに焼く。区画に分けるのは、世界を読み込んだあとの手のあいた時間に
 * 少しずつ進めるため（一度にやると1秒近く画面が固まる）。戦略を始めるまでに終わっていれば、すぐに地図が出る。
 */
interface Kept {
  world: HWorld; visual: VisualStyle; model: TerrainModel; provPath: Path2D[]; provBorders: Path2D;
  base: HTMLCanvasElement;
  /** まだ焼いていない区画 */
  queue: { x0: number; y0: number; x1: number; y1: number }[];
}
let kept: Kept | null = null;
const TILES_X = 5, TILES_Y = 4;

function visualOf(world: HWorld): { visual: VisualStyle; fractal: boolean; east: boolean } {
  const s = (world as unknown as { settings?: { visual?: VisualStyle; fractal?: boolean; naming?: string } }).settings;
  // 絵柄は、セーブに入っている hist-sim の設定に合わせる
  return { visual: s?.visual ?? 'antique', fractal: s?.fractal ?? false, east: s?.naming !== 'west' };
}

function tileQueue(m: CellMap): Kept['queue'] {
  const q: Kept['queue'] = [];
  for (let ty = 0; ty < TILES_Y; ty++) for (let tx = 0; tx < TILES_X; tx++) {
    q.push({ x0: (m.w * tx) / TILES_X, y0: (m.h * ty) / TILES_Y, x1: (m.w * (tx + 1)) / TILES_X, y1: (m.h * (ty + 1)) / TILES_Y });
  }
  return q;
}

/**
 * 描くための地図：どの勢力の領も無い陸のかたまり（日本の戦国の地図に入り込む朝鮮半島など）は、海として描く。
 * 遊びに関わらない土地が大きく映ると、どこが舞台なのか分かりにくいため。元の地図データは変えない。
 */
function playableMap(world: HWorld): CellMap {
  const m = world.map as unknown as CellMap;
  const off = offstageCells(world);
  if (!off.some((v) => v)) return m;
  const water = Uint8Array.from(m.water);
  for (let i = 0; i < m.n; i++) if (off[i]) water[i] = 1;   // 1 = 海
  // 海の色は岸からの近さで決まるので、岸からの近さを取り直す（消した陸の岸の跡が、海の色に残らないように）
  const coastDist = Int16Array.from(m.coastDist);
  const dist = new Int32Array(m.n).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < m.n; i++) {
    if (!water[i]) continue;
    for (let k = m.nbOff[i]; k < m.nbOff[i + 1]; k++) if (!water[m.nb[k]]) { dist[i] = 1; frontier.push(i); break; }
  }
  for (let d = 2; frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) for (let k = m.nbOff[i]; k < m.nbOff[i + 1]; k++) { const j = m.nb[k]; if (water[j] && dist[j] < 0) { dist[j] = d; next.push(j); } }
    frontier = next;
  }
  for (let i = 0; i < m.n; i++) if (water[i] && m.water[i] !== 2) coastDist[i] = -(dist[i] < 0 ? 99 : Math.min(99, dist[i]));
  return { ...m, water, coastDist };
}

/** 下ごしらえの前半（色の計算と領の形）。地形の絵は bakeStep で区画ごとに焼く */
function prepare(world: HWorld): Kept {
  const { visual, fractal } = visualOf(world);
  if (kept && kept.world === world && kept.visual === visual) return kept;
  const m = playableMap(world);
  const model = buildTerrainModel(m, visual, fractal);
  const geo = model.geo;
  const provPath = world.provinces.map((p) => {
    const path = new Path2D();
    if (!ringPath(path, m, geo, p.cells)) for (const c of p.cells) cellPath(path, m, geo, c);
    return path;
  });
  const provBorders = new Path2D();
  edgePath(provBorders, m, geo, (i, j) => !m.water[i] && !m.water[j] && world.provinceOf[i] !== world.provinceOf[j]);
  const base = document.createElement('canvas');
  base.width = Math.ceil(m.w * BAKE); base.height = Math.ceil(m.h * BAKE);
  kept = { world, visual, model, provPath, provBorders, base, queue: tileQueue(m) };
  return kept;
}

/** 区画を1つ焼く。まだ残っていれば true */
function bakeStep(k: Kept): boolean {
  const r = k.queue.shift();
  if (!r) return false;
  // 区画の端は、ぼかしが途切れて継ぎ目（薄い線）になる。少し広めに焼いて、まん中だけを貼る
  const m = k.model.m, PAD = 32;
  const wide = { x0: Math.max(0, r.x0 - PAD), y0: Math.max(0, r.y0 - PAD), x1: Math.min(m.w, r.x1 + PAD), y1: Math.min(m.h, r.y1 + PAD) };
  const tile = bakeTerrain(k.model, wide, BAKE);
  const sx = Math.round((r.x0 - wide.x0) * BAKE), sy = Math.round((r.y0 - wide.y0) * BAKE);
  const dx = Math.round(r.x0 * BAKE), dy = Math.round(r.y0 * BAKE);
  const w = Math.round(r.x1 * BAKE) - dx, h = Math.round(r.y1 * BAKE) - dy;
  k.base.getContext('2d')!.drawImage(tile, sx, sy, w, h, dx, dy, w, h);
  releaseCanvas(tile);
  return k.queue.length > 0;
}

const whenIdle = (fn: () => void): void => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 400 }); else window.setTimeout(fn, 30);
};

/**
 * 世界を読み込んだら呼ぶ：戦略マップの下ごしらえを、手のあいた時間に少しずつ進めておく。
 * 途中で戦略が始まったら、残りはその場で済ませる（draw の中）。
 */
export function prewarm(world: HWorld): void {
  const { visual } = visualOf(world);
  void Promise.all(setsFor(visual).map((s) => loadSprites(s))).then(() => whenIdle(() => {
    const k = prepare(world);
    const next = (): void => { if (kept === k && bakeStep(k)) whenIdle(next); };
    whenIdle(next);
  }));
}

export class StrategyView {
  readonly cam: Camera;
  gs: GameStart | null = null;
  world: HWorld | null = null;
  hl: StrategyHighlight = {};
  private model: TerrainModel | null = null;
  private visual: VisualStyle = 'antique';
  private east = true;
  private provPath: Path2D[] = [];
  private provBorders = new Path2D();
  /** 勢力ごとの形。持ち主が変わったら作り直す */
  private geo = new Map<number, FactionGeo>();
  private nationBorders = new Path2D();
  private geoKey = '';
  /** 戦線（交戦中の勢力どうしの境） */
  private front = new Path2D();
  private frontKey = '';
  private radius = 14;
  private fitKey = '';

  constructor(readonly canvas: HTMLCanvasElement) {
    // 机の布などの絵が後から読めたら、描き直す（地図を外したら、知らせを受けるのをやめる）
    const unsub = onArtLoaded(() => { if (this.canvas.isConnected) this.draw(); else unsub(); });
    this.cam = new Camera(canvas);
    this.cam.onChange = () => this.draw();
  }

  private get style(): RenderStyle { return this.model!.style; }

  setState(gs: GameStart, world: HWorld): void {
    this.gs = gs; this.world = world;
    const m = world.map as unknown as CellMap;
    const v = visualOf(world);
    this.visual = v.visual; this.east = v.east;
    // 下ごしらえは、同じ世界なら前のもの（読み込んだあとに進めておいたもの）を使う
    const k = prepare(world);
    this.model = k.model; this.provPath = k.provPath; this.provBorders = k.provBorders;
    // 記号と町の絵がまだなら、読み込めたときに地形を焼き直す
    if (!setsFor(this.visual).every((s) => spritesReady(s))) {
      void Promise.all(setsFor(this.visual).map((s) => loadSprites(s))).then(() => {
        if (kept !== k) return;
        k.queue = tileQueue(m);
        if (this.world === world && this.canvas.isConnected) this.draw();
      });
    }
    this.geoKey = '';
    this.cam.resize();
    this.cam.setWorld(m.w, m.h);
    this.frame();
    // 領どうしの間隔から、印の大きさを決める
    let sum = 0, n = 0;
    for (const p of gs.provinces) for (const j of p.nb) { const q = gs.provinces[j]; sum += Math.hypot(p.cx - q.cx, p.cy - q.cy); n++; }
    this.radius = Math.max(4, Math.min(22, (n ? sum / n : 60) * 0.28));
  }

  /** 領のある範囲だけを映す（海ばかりの余白を省く） */
  private frame(): void {
    const gs = this.gs;
    if (!gs) return;
    this.fitKey = `${this.cam.vw}x${this.cam.vh}`;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of gs.provinces) { if (p.out) continue; x0 = Math.min(x0, p.cx); x1 = Math.max(x1, p.cx); y0 = Math.min(y0, p.cy); y1 = Math.max(y1, p.cy); }
    if (x0 === Infinity) return;
    const pad = 70, w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
    const z = Math.min(this.cam.vw / w, this.cam.vh / h);
    this.cam.zoom = Math.max(this.cam.minZoom, Math.min(this.cam.maxZoom, z));
    this.cam.centerOn((x0 + x1) / 2, (y0 + y1) / 2);
  }

  /** 画面上の位置 → 領の番号（海や、領でない土地は -1） */
  pick(sx: number, sy: number): number {
    const w = this.world;
    if (!w || !this.gs) return -1;
    const [wx, wy] = this.cam.toWorld(sx, sy);
    const m = w.map;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < m.n; i++) {
      const d = (m.x[i] - wx) ** 2 + (m.y[i] - wy) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const prov = best >= 0 ? w.provinceOf[best] : -1;
    // 舞台の外の領は、選べない
    return prov >= 0 && this.gs.provinces[prov]?.out ? -1 : prov;
  }

  /** 勢力ごとの形（塗る範囲、ほかの勢力との境、国名を書く曲線）を作る */
  private buildGeo(): void {
    const gs = this.gs!, w = this.world!, m = w.map as unknown as CellMap, g = this.model!.geo;
    const ownerOfCell = (c: number): number => { const p = w.provinceOf[c]; return p >= 0 ? gs.provinces[p]?.owner ?? 0 : 0; };
    this.geo.clear();
    const provs = new Map<number, number[]>();
    for (const p of gs.provinces) {
      if (!p.owner) continue;
      const list = provs.get(p.owner);
      if (list) list.push(p.id); else provs.set(p.owner, [p.id]);
    }
    for (const [id, list] of provs) {
      const cells = list.flatMap((p) => w.provinces[p].cells);
      const path = new Path2D();
      if (!ringPath(path, m, g, cells)) for (const p of list) path.addPath(this.provPath[p]);
      const border = new Path2D();
      edgePath(border, m, g, (_i, j) => !m.water[j] && ownerOfCell(j) !== id, cells);
      const block = largestBlock(list, (p) => gs.provinces[p].nb, (p) => w.provinces[p].cells.length);
      const spine = realmSpine(block.map((p) => ({ cx: gs.provinces[p].cx, cy: gs.provinces[p].cy, area: w.provinces[p].cells.length })), m.spacing);
      this.geo.set(id, { path, border, spine });
    }
    this.nationBorders = new Path2D();
    edgePath(this.nationBorders, m, g, (i, j) => !m.water[i] && !m.water[j] && ownerOfCell(i) !== ownerOfCell(j));
  }

  private color(id: number): RGB { return tint(this.style, this.gs!.factions[id].color); }

  draw(): void {
    const gs = this.gs, w = this.world, model = this.model;
    const { ctx, cv } = this.cam;
    drawDesk(ctx, cv.width, cv.height, model?.style.frameBg ?? '#2a2219');
    if (!gs || !w || !model) return;
    // 画面の大きさが変わったら、映す範囲を合わせ直す
    if (this.fitKey !== `${this.cam.vw}x${this.cam.vh}`) { this.frame(); return; }
    const key = gs.provinces.map((p) => p.owner).join(',');
    if (key !== this.geoKey) { this.buildGeo(); this.geoKey = key; this.frontKey = ''; }
    const warKey = [...(this.hl.wars ?? [])].sort().join(',');
    if (`${warKey}` !== this.frontKey || this.frontKey === '') {
      const cm = w.map as unknown as CellMap, wars = this.hl.wars ?? new Set<string>();
      const ownerOfCell = (cell: number): number => { const p = w.provinceOf[cell]; return p >= 0 ? gs.provinces[p]?.owner ?? 0 : 0; };
      this.front = new Path2D();
      if (wars.size) edgePath(this.front, cm, model.geo, (i, j) => {
        if (cm.water[i] || cm.water[j]) return false;
        const a = ownerOfCell(i), b = ownerOfCell(j);
        return a !== b && a > 0 && b > 0 && wars.has(a < b ? `${a}-${b}` : `${b}-${a}`);
      });
      this.frontKey = warKey || '-';
    }
    const style = model.style, m = model.m;
    const zoom = this.cam.zoom, z = zoom * this.cam.dpr;
    ctx.setTransform(z, 0, 0, z, -this.cam.x * z, -this.cam.y * z);
    // 地形の絵が焼き終わっていなければ、残りをここで済ませる
    const k = prepare(w);
    while (bakeStep(k)) { /* 残りの区画 */ }
    ctx.drawImage(k.base, 0, 0, m.w, m.h);

    // 勢力の色：薄い塗りと、境に沿った内側の色の帯
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [id, g] of this.geo) {
      const f = gs.factions[id];
      if (!f) continue;
      const lord = f.overlord && gs.factions[f.overlord] ? f.overlord : 0;
      const col = this.color(lord || id);
      ctx.fillStyle = css(col, style.washAlpha * (lord ? 0.85 : 1));
      ctx.fill(g.path);
      ctx.save();
      ctx.clip(g.path);
      ctx.strokeStyle = css(col, style.bandAlpha * (lord ? 1.3 : 1));
      ctx.lineWidth = 7 / zoom;
      ctx.stroke(g.border);
      ctx.restore();
    }
    // 選んだ領、移動できる領、攻められる領
    const fillProv = (p: number, color: string): void => { if (this.provPath[p]) { ctx.fillStyle = color; ctx.fill(this.provPath[p]); } };
    for (const p of this.hl.move ?? []) fillProv(p, css(INDIGO, 0.4));
    for (const p of this.hl.attack ?? []) fillProv(p, css(VERMILION, 0.42));
    if (this.hl.hover !== undefined && this.hl.hover >= 0 && this.hl.hover !== this.hl.selected) fillProv(this.hl.hover, 'rgba(255,252,240,0.28)');
    if (this.hl.selected !== undefined && this.hl.selected >= 0) fillProv(this.hl.selected, css(OCHRE, 0.45));
    // 領の境（細い点線）と、勢力の境
    ctx.strokeStyle = 'rgba(59,49,35,0.3)'; ctx.lineWidth = 0.8 / zoom;
    ctx.setLineDash([3 / zoom, 3 / zoom]); ctx.stroke(this.provBorders);
    ctx.strokeStyle = style.borderInk; ctx.lineWidth = 1.4 / zoom;
    ctx.setLineDash(style.borderDash.map((d) => d / zoom)); ctx.stroke(this.nationBorders);
    ctx.setLineDash([]);
    // 自分の国の境（P54）：一目で分かるよう、内側に自分の色の太い帯、外に白い縁どりと濃い墨の太線を引く
    const mine = this.hl.player ? this.geo.get(this.hl.player) : undefined;
    if (mine && gs.factions[this.hl.player!]) {
      const col = this.color(this.hl.player!);
      ctx.save();
      ctx.clip(mine.path);
      ctx.strokeStyle = css(col, 0.55); ctx.lineWidth = 16 / zoom; ctx.stroke(mine.border);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,250,235,0.95)'; ctx.lineWidth = 7 / zoom; ctx.stroke(mine.border);
      ctx.strokeStyle = css(col.map((v) => Math.round(v * 0.55)) as RGB, 1); ctx.lineWidth = 3.6 / zoom; ctx.stroke(mine.border);
      ctx.setLineDash([6 / zoom, 5 / zoom]);
      ctx.strokeStyle = 'rgba(255,250,235,0.9)'; ctx.lineWidth = 1.2 / zoom; ctx.stroke(mine.border);
      ctx.setLineDash([]);
    }
    // 占領中の領（持ち主と押さえている勢力が違う）：押さえている勢力の色の斜線
    for (const p of gs.provinces) {
      if (!p.controller || p.controller === p.owner || !gs.factions[p.controller] || !this.provPath[p.id]) continue;
      ctx.save();
      ctx.clip(this.provPath[p.id]);
      ctx.strokeStyle = css(this.color(p.controller), 0.7); ctx.lineWidth = 1.2 / zoom;
      const span = 60, step = 5 / Math.sqrt(zoom);
      ctx.beginPath();
      for (let d = -span; d <= span; d += step) { ctx.moveTo(p.cx + d - span, p.cy + span); ctx.lineTo(p.cx + d + span, p.cy - span); }
      ctx.stroke();
      ctx.restore();
    }
    // 海路：海の向こうの領どうしのつながり（隣の領と同じく、移ることも攻めることもできる）。選んだ領の海路は濃く
    ctx.save();
    for (const p of gs.provinces) {
      if (p.out) continue;
      for (const q of p.sea) {
        const b = gs.provinces[q];
        if (q < p.id || !b || b.out) continue;
        const sel = this.hl.selected === p.id || this.hl.selected === q;
        const dx = b.cx - p.cx, dy = b.cy - p.cy, len = Math.hypot(dx, dy) || 1;
        // 海の側へふくらませた弧：2つの領の陸の隣の領（内陸の側）とは反対へ
        const land = [...p.nb, ...b.nb].map((n) => gs.provinces[n]).filter((x) => x && x.id !== p.id && x.id !== b.id);
        const ox = (p.cx + b.cx) / 2, oy = (p.cy + b.cy) / 2;
        const lx = land.length ? land.reduce((s, x) => s + x.cx, 0) / land.length : ox, ly = land.length ? land.reduce((s, x) => s + x.cy, 0) / land.length : oy;
        const nx = -dy / len, ny = dx / len, side = (lx - ox) * nx + (ly - oy) * ny > 0 ? -1 : 1;
        const mx = ox + nx * side * len * 0.38, my = oy + ny * side * len * 0.38;
        ctx.beginPath(); ctx.moveTo(p.cx, p.cy); ctx.quadraticCurveTo(mx, my, b.cx, b.cy);
        ctx.setLineDash([5 / zoom, 4 / zoom]);
        ctx.lineWidth = (sel ? 2.6 : 1.4) / zoom;
        ctx.strokeStyle = sel ? 'rgba(25,55,120,0.92)' : 'rgba(35,65,110,0.42)';
        ctx.stroke();
      }
    }
    ctx.restore();
    // 戦線：赤いにじみの上に、赤黒い破線
    ctx.strokeStyle = 'rgba(190,40,25,0.28)'; ctx.lineWidth = 7 / zoom; ctx.stroke(this.front);
    ctx.strokeStyle = 'rgba(140,22,14,0.95)'; ctx.lineWidth = 2.2 / zoom;
    ctx.setLineDash([6 / zoom, 3 / zoom]); ctx.stroke(this.front); ctx.setLineDash([]);
    // 囲まれている領：赤い縁取り
    for (const [p] of this.hl.sieges ?? []) {
      if (!this.provPath[p]) continue;
      ctx.strokeStyle = 'rgba(160,30,20,0.9)'; ctx.lineWidth = 2.4 / zoom;
      ctx.setLineDash([2 / zoom, 2 / zoom]); ctx.stroke(this.provPath[p]); ctx.setLineDash([]);
    }
    if (this.hl.selected !== undefined && this.provPath[this.hl.selected]) {
      ctx.strokeStyle = 'rgba(120,40,20,0.9)'; ctx.lineWidth = 2 / zoom; ctx.stroke(this.provPath[this.hl.selected]);
    }
    // 攻められたとき：攻めてきた領は朱、攻められた領は金で塗って太く縁取り、矢印でつなぐ
    const al = this.hl.alarm;
    if (al && this.provPath[al.from] && this.provPath[al.to]) {
      const a = gs.provinces[al.from], b = gs.provinces[al.to];
      ctx.fillStyle = 'rgba(200,50,30,0.45)'; ctx.fill(this.provPath[al.from]);
      ctx.fillStyle = 'rgba(230,190,90,0.5)'; ctx.fill(this.provPath[al.to]);
      ctx.lineWidth = 4 / zoom;
      ctx.strokeStyle = 'rgba(150,20,10,0.95)'; ctx.stroke(this.provPath[al.from]);
      ctx.strokeStyle = 'rgba(120,80,10,0.95)'; ctx.stroke(this.provPath[al.to]);
      const ang = Math.atan2(b.cy - a.cy, b.cx - a.cx), hd = 14 / zoom;
      ctx.strokeStyle = 'rgba(150,20,10,0.95)'; ctx.lineWidth = 5 / zoom; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.cx, a.cy); ctx.lineTo(b.cx - Math.cos(ang) * hd * 0.6, b.cy - Math.sin(ang) * hd * 0.6); ctx.stroke();
      ctx.fillStyle = 'rgba(150,20,10,0.95)';
      ctx.beginPath(); ctx.moveTo(b.cx, b.cy);
      ctx.lineTo(b.cx - Math.cos(ang - 0.45) * hd, b.cy - Math.sin(ang - 0.45) * hd);
      ctx.lineTo(b.cx - Math.cos(ang + 0.45) * hd, b.cy - Math.sin(ang + 0.45) * hd);
      ctx.closePath(); ctx.fill(); ctx.lineCap = 'butt';
    }

    // 持ち主が変わった領：金で塗って太く縁取る
    const fl = this.hl.flash;
    if (fl !== undefined && this.provPath[fl]) {
      ctx.fillStyle = 'rgba(255,220,120,0.55)'; ctx.fill(this.provPath[fl]);
      ctx.strokeStyle = 'rgba(255,240,190,0.95)'; ctx.lineWidth = 5 / zoom; ctx.stroke(this.provPath[fl]);
    }

    this.drawTowns();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (style.paperGrain) applyPaper(ctx, cv.width, cv.height, 0.2);
    this.drawLabels();
    this.drawCounts();
    this.drawCompass();
    this.drawCartouche();
  }

  /** 領の町の絵（地図に描いているもの）。領の欄に小さく出す。無ければ null */
  townImage(prov: number): string | null {
    const gs = this.gs, p = gs?.provinces[prov];
    if (!gs || !p || !this.visual) return null;
    const f = gs.factions[p.owner], capital = !!f && f.capital === p.id;
    const stage: TownStage = capital ? 'capital' : p.fort >= 0.8 ? 'walled' : p.pop > 8000 ? 'town' : 'village';
    return townSprite(this.visual, this.east ? 'east' : 'west', stage, hash01(p.id, 31))?.src ?? null;
  }

  /** 二つの領が両方見えるように、地図を寄せる（拡大はそのまま） */
  focusOn(a: number, b: number): void {
    const gs = this.gs;
    if (!gs?.provinces[a] || !gs.provinces[b]) return;
    const cx = (gs.provinces[a].cx + gs.provinces[b].cx) / 2, cy = (gs.provinces[a].cy + gs.provinces[b].cy) / 2;
    // 全体を映しているときは寄せられない（地図の端より外へは動かない）ので、少し拡大してから寄せる
    // （スマホの狭い地図では、もう少し大きく）
    const want = this.cam.minZoom * (this.cam.vw < 500 ? 3.4 : 2.2);
    if (this.cam.zoom < want) {
      const [zx, zy] = this.cam.toScreen(cx, cy);
      this.cam.zoomAt(zx, zy, want / this.cam.zoom);
    }
    const [sx, sy] = this.cam.toScreen(cx, cy);
    // 窓は地図の下のほうに出すので、二つの領は上のほうへ寄せる
    this.cam.panBy(this.cam.vw / 2 - sx, this.cam.vh * 0.24 - sy);
  }

  /** 町の絵と名前。本拠は都、城の強い領は城郭、ほかは人口で町か村 */
  private drawTowns(): void {
    const gs = this.gs!, { ctx } = this.cam, zoom = this.cam.zoom, style = this.style;
    const culture = this.east ? 'east' : 'west';
    const sorted = [...gs.provinces].sort((a, b) => a.cy - b.cy);
    const showNames = zoom > this.cam.minZoom * 2;
    for (const p of sorted) {
      if (!p.owner) continue;
      const f = gs.factions[p.owner];
      const capital = !!f && f.capital === p.id;
      const stage: TownStage = capital ? 'capital' : p.fort >= 0.8 ? 'walled' : p.pop > 8000 ? 'town' : 'village';
      const img = townSprite(this.visual, culture, stage, hash01(p.id, 31));
      // 拡大しても絵が大きくなりすぎないようにする
      const size = (capital ? 24 : 15) / Math.sqrt(zoom);
      if (img) {
        const h = size * (img.naturalHeight / img.naturalWidth);
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(img, p.cx - size / 2, p.cy - h * 0.7, size, h);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.beginPath(); ctx.arc(p.cx, p.cy, size * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = INK; ctx.fill();
      }
      const named = showNames || capital || p.id === this.hl.selected || p.id === this.hl.hover;
      if (!named) continue;
      const fs = (capital ? 12 : 11) / zoom;
      ctx.font = `${capital ? '700 ' : ''}${fs}px ${style.labelFont}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineWidth = 3 / zoom; ctx.strokeStyle = style.labelHalo; ctx.fillStyle = INK;
      const y = p.cy + size * 0.32;
      ctx.strokeText(p.name.ja, p.cx, y); ctx.fillText(p.name.ja, p.cx, y);
    }
  }

  /** 国名：領土の形に合わせた大きさで書く。墨絵の絵柄では縦書きに落款を添える */
  private drawLabels(): void {
    const gs = this.gs!, cam = this.cam, ctx = cam.ctx, style = this.style;
    ctx.save();
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [id, g] of this.geo) {
      const f = gs.factions[id];
      if (!f) continue;
      const sp = g.spine, chars = [...f.name.ja];
      const lenPx = sp.len * cam.zoom;
      const ink = style.labelInk(this.color(id));
      if (style.id === 'ink') {
        const [mx, my] = spinePoint(sp, 0.5);
        const [x, y] = cam.toScreen(mx, my);
        let size = Math.min(40, (lenPx * 0.75) / Math.max(1, chars.length * 1.25));
        if (size < 8) continue;
        size = Math.max(10, size);
        const step = size * 1.2, top = y - ((chars.length - 1) * step) / 2;
        ctx.font = `700 ${Math.round(size)}px ${style.labelFont}`;
        ctx.lineWidth = Math.max(2.5, size * 0.2); ctx.strokeStyle = style.labelHalo;
        for (let i = 0; i < chars.length; i++) ctx.strokeText(chars[i], x, top + i * step);
        ctx.fillStyle = ink;
        for (let i = 0; i < chars.length; i++) ctx.fillText(chars[i], x, top + i * step);
        if (size >= 13) {
          const s = size * 0.85, sy = top + (chars.length - 1) * step + step * 0.55 + s * 0.6;
          ctx.fillStyle = 'rgba(190,40,30,0.88)';
          ctx.beginPath(); ctx.roundRect?.(x - s / 2, sy - s / 2, s, s, s * 0.12); ctx.fill();
          ctx.fillStyle = 'rgba(250,240,225,0.95)';
          ctx.font = `700 ${Math.round(s * 0.72)}px ${style.labelFont}`;
          ctx.fillText(chars[0] ?? '', x, sy + s * 0.02);
        }
        continue;
      }
      // 曲線いっぱいに、字の間を広く取って書く（古い地図の題字のように）
      const spacing = 0.5;
      ctx.font = `700 100px ${style.labelFont}`;
      const w100 = chars.reduce((s, ch) => s + ctx.measureText(ch).width + 100 * spacing, -100 * spacing);
      let size = Math.min(40, (lenPx / Math.max(1, w100)) * 100);
      if (size < 8) continue;
      size = Math.max(10, size);
      ctx.font = `700 ${Math.round(size)}px ${style.labelFont}`;
      const widths = chars.map((ch) => ctx.measureText(ch).width);
      const gap = size * spacing;
      const total = widths.reduce((s, x) => s + x, 0) + gap * (chars.length - 1);
      const placed = this.placeAlong(sp, widths, gap, total);
      ctx.lineWidth = Math.max(2.5, size * 0.18); ctx.strokeStyle = style.labelHalo;
      for (let pass = 0; pass < 2; pass++) {
        if (pass) ctx.fillStyle = ink;
        for (let i = 0; i < chars.length; i++) {
          const [x, y, r] = placed[i];
          ctx.save(); ctx.translate(x, y); ctx.rotate(r);
          if (pass) ctx.fillText(chars[i], 0, 0); else ctx.strokeText(chars[i], 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  /** 曲線に沿った、1字ごとの位置と傾き */
  private placeAlong(sp: Spine, widths: number[], gap: number, total: number): [number, number, number][] {
    const pts: [number, number][] = [], acc: number[] = [0];
    for (let i = 0; i <= SPINE_SAMPLES; i++) {
      const [wx, wy] = spinePoint(sp, i / SPINE_SAMPLES);
      pts.push(this.cam.toScreen(wx, wy));
      if (i) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const at = (s: number): [number, number, number] => {
      let i = 1;
      while (i < SPINE_SAMPLES && acc[i] < s) i++;
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const f = (s - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, Math.atan2(y1 - y0, x1 - x0)];
    };
    const out: [number, number, number][] = [];
    let s = (acc[SPINE_SAMPLES] - total) / 2;
    for (const w of widths) { out.push(at(s + w / 2)); s += w + gap; }
    return out;
  }

  /** 本拠の紋と、領ごとの武将の人数（hex-sim の表示） */
  private drawCounts(): void {
    const gs = this.gs!, cam = this.cam, ctx = cam.ctx;
    ctx.save();
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const r = Math.max(7, Math.min(12, this.radius * cam.zoom * 0.5));
    for (const p of gs.provinces) {
      const f = gs.factions[p.owner];
      const [sx, sy] = cam.toScreen(p.cx, p.cy);
      if (sx < -30 || sy < -30 || sx > cam.vw + 30 || sy > cam.vh + 30) continue;
      if (f && f.capital === p.id) {
        const s = r * 2.1;
        ctx.drawImage(crestCanvas({ id: f.id, name: f.name.ja, color: this.color(f.id) }, Math.round(s * 2)), sx - r * 2.4 - s / 2, sy - r * 1.2 - s / 2, s, s);
      }
      const sg = this.hl.sieges?.get(p.id);
      if (sg !== undefined) {
        // 包囲の進み：領の名前の下に、赤い棒
        const bw = r * 3.4, bx0 = sx - bw / 2, by0 = sy + r * 2.2;
        ctx.fillStyle = 'rgba(244,236,214,0.95)'; ctx.fillRect(bx0, by0, bw, 5);
        ctx.fillStyle = 'rgba(160,30,20,0.95)'; ctx.fillRect(bx0, by0, bw * Math.min(1, sg), 5);
        ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(bx0, by0, bw, 5);
      }
      const n = this.hl.counts?.get(p.id) ?? 0;
      if (!n) continue;
      const mine = p.owner === this.hl.player;
      const bx = sx + r * 1.7, by = sy - r * 1.1;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = mine ? css(VERMILION) : 'rgba(244,236,214,0.95)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = mine ? '#fff' : INK;
      ctx.font = `700 ${Math.round(r * 1.25)}px ${this.style.labelFont}`;
      ctx.fillText(String(n), bx, by + 0.5);
    }
    ctx.restore();
  }

  /** 方位（hist-sim の drawCompass） */
  private drawCompass(): void {
    if (this.style.id === 'flat') return;
    const cam = this.cam, ctx = cam.ctx, m = this.model!.m;
    const [cx, cy] = cam.toScreen(m.w * 0.07, m.h * 0.86);
    const r = Math.max(18, m.w * 0.035 * cam.zoom);
    ctx.save();
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.translate(cx, cy);
    ctx.globalAlpha = 0.85; ctx.strokeStyle = INK; ctx.lineWidth = 1;
    for (const k of [0.62, 0.68]) { ctx.beginPath(); ctx.arc(0, 0, r * k, 0, Math.PI * 2); ctx.stroke(); }
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 - Math.PI / 2;
      const len = k % 2 === 0 ? r : r * 0.55, wid = k % 2 === 0 ? r * 0.16 : r * 0.11;
      const tip = [Math.cos(a) * len, Math.sin(a) * len];
      const l = [Math.cos(a - Math.PI / 2) * wid, Math.sin(a - Math.PI / 2) * wid];
      const rr = [Math.cos(a + Math.PI / 2) * wid, Math.sin(a + Math.PI / 2) * wid];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(l[0], l[1]); ctx.lineTo(tip[0], tip[1]); ctx.closePath();
      ctx.fillStyle = 'rgba(244,234,210,0.95)'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(rr[0], rr[1]); ctx.lineTo(tip[0], tip[1]); ctx.closePath();
      ctx.fillStyle = k === 0 ? '#8b2a1a' : INK; ctx.fill(); ctx.stroke();
    }
    ctx.font = `700 ${Math.round(r * 0.32)}px ${this.style.labelFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = INK;
    ctx.fillText('北', 0, -r - 2);
    ctx.restore();
  }

  /** 題字：世界の名前と年（hist-sim の drawCartouche） */
  private drawCartouche(): void {
    const gs = this.gs!, w = this.world!, cam = this.cam, ctx = cam.ctx, m = this.model!.m;
    const [x0, y0] = cam.toScreen(0, 0);
    const title = w.name?.ja ?? '';
    if (!title) return;
    const sub = `${gs.year < 0 ? `紀元前${-gs.year + 1}` : gs.year}年${gs.month}月`;
    const size = Math.max(14, Math.min(26, m.w * cam.zoom * 0.016));
    ctx.save();
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.font = `700 ${Math.round(size)}px ${this.style.labelFont}`;
    const bw = Math.max(ctx.measureText(title).width, 120) + size * 2, bh = size * 2.6;
    const x = Math.max(8, x0 + 16), y = Math.max(8, y0 + 16);
    ctx.fillStyle = 'rgba(241,229,200,0.92)'; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.roundRect?.(x, y, bw, bh, 8); ctx.fill(); ctx.stroke();
    ctx.strokeRect(x + 4, y + 4, bw - 8, bh - 8);
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, x + bw / 2, y + size * 1.25);
    ctx.font = `${Math.round(size * 0.62)}px ${this.style.labelFont}`;
    ctx.fillText(sub, x + bw / 2, y + size * 2.15);
    ctx.restore();
  }
}
