// 勢力の紋。丸い紋（巴・菱・花・輪・亀甲・引両・星・十字・勢力名の一文字）を、勢力の番号と名前から決まった形で描く。
// hist-sim/src/render/heraldry.ts の東洋の紋（drawMon）から。絵のファイルは使わない。

import { MINCHO, type RGB } from './ink';

export interface CrestSpec {
  id: number;
  /** 勢力の名前（紋の形を決める種と、一文字の紋に使う） */
  name: string;
  color: RGB;
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** 形を選ぶための、小さな決まった乱数（mulberry32） */
function picker(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] };
}
const rgb = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const lum = (c: RGB) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

const MON = ['tomoe', 'hishi', 'flower', 'rings', 'kikko', 'bars', 'stars', 'cross', 'glyph', 'glyph'] as const;

function drawMon(ctx: CanvasRenderingContext2D, spec: CrestSpec, size: number): void {
  const r = picker(hashString(`${spec.id}:${spec.name}:mon`));
  const kind = r.pick(MON);
  const ringed = r.next() < 0.6;
  const colour = rgb(spec.color);
  // 勢力の色の地に白い紋か、白い地に勢力の色の紋
  const onColour = r.next() < 0.6;
  const bg = onColour ? colour : '#f4efe2';
  const ink = onColour ? (lum(spec.color) > 0.7 ? '#2a2420' : '#f8f4ea') : colour;
  const R = size / 2;
  ctx.save();
  ctx.translate(R, R);
  ctx.beginPath(); ctx.arc(0, 0, R * 0.96, 0, Math.PI * 2);
  ctx.fillStyle = bg; ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.strokeStyle = 'rgba(30,20,10,0.85)'; ctx.stroke();
  ctx.fillStyle = ink; ctx.strokeStyle = ink;
  let s = R * 0.8;
  if (ringed) {
    ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.lineWidth = s * 0.13; ctx.stroke();
    s *= 0.78;
  }
  ctx.scale(s, s);
  ctx.beginPath();
  switch (kind) {
    case 'tomoe':
      for (let k = 0; k < 3; k++) {
        ctx.save(); ctx.rotate((k * 2 * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, -0.74);
        ctx.arc(0, 0, 0.74, -Math.PI / 2, 0.45);
        ctx.quadraticCurveTo(0.5, -0.12, 0.3, -0.44);
        ctx.arc(0, -0.44, 0.3, 0, -Math.PI / 2, false);
        ctx.fill();
        ctx.restore();
      }
      break;
    case 'hishi':
      for (const [x, y] of [[0, -0.45], [0.45, 0], [0, 0.45], [-0.45, 0]]) {
        ctx.moveTo(x, y - 0.4); ctx.lineTo(x + 0.4, y); ctx.lineTo(x, y + 0.4); ctx.lineTo(x - 0.4, y); ctx.closePath();
      }
      ctx.fill(); break;
    case 'flower':
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
        ctx.moveTo(Math.cos(a) * 0.55 + 0.38, Math.sin(a) * 0.55);
        ctx.arc(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.38, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, 0.2, 0, Math.PI * 2);
      ctx.globalCompositeOperation = 'destination-out'; ctx.fill(); ctx.globalCompositeOperation = 'source-over'; break;
    case 'rings':
      ctx.lineWidth = 0.14;
      for (const rr of [0.85, 0.55, 0.25]) { ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke(); }
      break;
    case 'kikko':
      ctx.lineWidth = 0.16;
      for (const rr of [0.95, 0.62]) {
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, 0.22, 0, Math.PI * 2); ctx.fill(); break;
    case 'bars': {
      const n = r.next() < 0.5 ? 2 : 3;
      for (let i = 0; i < n; i++) { const y = -0.6 + (1.2 * (i + 0.5)) / n; ctx.rect(-0.9, y - 0.13, 1.8, 0.26); }
      ctx.fill(); break;
    }
    case 'stars':
      for (const [x, y, rr] of [[0, -0.45, 0.28], [-0.48, 0.32, 0.28], [0.48, 0.32, 0.28]]) { ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, Math.PI * 2); }
      ctx.fill(); break;
    case 'cross':
      ctx.rect(-0.14, -0.9, 0.28, 1.8); ctx.rect(-0.9, -0.14, 1.8, 0.28); ctx.fill(); break;
    case 'glyph':
      // 文字は実際のピクセルの大きさで指定する（縮尺をかけた小さな字はきれいに出ない）
      ctx.scale(1 / s, 1 / s);
      ctx.font = `700 ${Math.round(s * 1.35)}px ${MINCHO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText([...spec.name][0] || '◆', 0, s * 0.08); break;
  }
  ctx.restore();
}

const canvases = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();
const keyOf = (spec: CrestSpec, px: number): string => `${spec.id}|${spec.name}|${spec.color.join(',')}|${px}`;

/** 紋を描いた canvas（px 四方）。同じ勢力・同じ大きさなら使い回す */
export function crestCanvas(spec: CrestSpec, px: number): HTMLCanvasElement {
  px = Math.max(8, Math.round(px));
  const key = keyOf(spec, px);
  let c = canvases.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = px;
  drawMon(c.getContext('2d')!, spec, px);
  if (canvases.size > 600) canvases.clear();
  canvases.set(key, c);
  return c;
}

/** 画面の部品（HTML）に置くための <img> */
export function crestImg(spec: CrestSpec, cssPx: number, cls = 'crest'): string {
  const px = Math.round(cssPx * (globalThis.devicePixelRatio || 1));
  const key = keyOf(spec, px);
  let u = urls.get(key);
  if (!u) {
    u = crestCanvas(spec, px).toDataURL();
    if (urls.size > 400) urls.clear();
    urls.set(key, u);
  }
  return `<img class="${cls}" src="${u}" width="${cssPx}" height="${cssPx}" alt="">`;
}
