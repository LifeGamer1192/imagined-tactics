// 国を選ぶ画面の広域地図：勢力ごとに領を塗り、選んでいる国だけを明るくする。押した所の国を返す。
// セルの形は勢力ごとに1つの Path2D にまとめておくので、選び直したときの描き直しは軽い。

import type { HWorld } from '../bridge/histsim';
import type { GameStart } from '../convert/model';

const SEA = '#5d7a8a', LAND = '#8a8170', OUT = '#6f685c';

export class NationMap {
  readonly canvas = document.createElement('canvas');
  private paths = new Map<number, Path2D>();
  private land = new Path2D();
  private x0 = 0; private y0 = 0; private scale = 1;
  private cssW = 0; private cssH = 0;

  constructor(private w: HWorld, private gs: GameStart) {
    const m = w.map;
    // 舞台（どれかの勢力の領がある陸）の範囲だけを描く
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of gs.provinces) {
      if (p.out) continue;
      for (const c of w.provinces[p.id].cells) { x0 = Math.min(x0, m.x[c]); x1 = Math.max(x1, m.x[c]); y0 = Math.min(y0, m.y[c]); y1 = Math.max(y1, m.y[c]); }
    }
    const pad = Math.max(x1 - x0, y1 - y0) * 0.04;
    this.x0 = x0 - pad; this.y0 = y0 - pad;
    this.bw = x1 - x0 + pad * 2; this.bh = y1 - y0 + pad * 2;
    const WATER = new Set([0, 1]);
    for (let i = 0; i < m.n; i++) {
      if (m.x[i] < this.x0 || m.x[i] > this.x0 + this.bw || m.y[i] < this.y0 || m.y[i] > this.y0 + this.bh) continue;
      if (m.water[i] || WATER.has(m.biome[i])) continue;
      const pid = w.provinceOf[i], gp = pid >= 0 ? gs.provinces[pid] : undefined;
      const owner = gp && !gp.out ? gp.owner : 0;
      let path = owner ? this.paths.get(owner) : this.land;
      if (!path) { path = new Path2D(); this.paths.set(owner, path); }
      const a = m.polyOff[i], b = m.polyOff[i + 1];
      if (b - a < 3) continue;
      path.moveTo(m.poly[2 * a], m.poly[2 * a + 1]);
      for (let k = a + 1; k < b; k++) path.lineTo(m.poly[2 * k], m.poly[2 * k + 1]);
      path.closePath();
    }
  }
  private bw = 1; private bh = 1;

  /** 地図の縦横の比（高さ ÷ 幅） */
  get aspect(): number { return this.bh / this.bw; }

  /** 幅 cssW（CSS の px）で描く。selected の国を明るく、ほかを暗くする */
  draw(cssW: number, selected: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = cssW; this.cssH = Math.round(cssW * this.aspect);
    this.canvas.width = Math.round(this.cssW * dpr); this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`; this.canvas.style.height = `${this.cssH}px`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = SEA; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.scale = this.cssW / this.bw;
    ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, -this.x0 * this.scale * dpr, -this.y0 * this.scale * dpr);
    // セルのすき間が見えないよう、同じ色で細く縁取る
    const fill = (p: Path2D, color: string) => { ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.2 / this.scale; ctx.fill(p); ctx.stroke(p); };
    fill(this.land, OUT);
    for (const [fid, p] of this.paths) {
      const f = this.gs.factions[fid];
      if (!f) { fill(p, LAND); continue; }
      const [r, g, b] = f.color;
      // 選んでいない国は灰色に寄せる（国の境目が分かる程度に色を残す）
      fill(p, fid === selected ? `rgb(${r},${g},${b})` : `rgb(${Math.round(r * 0.22 + 96)},${Math.round(g * 0.22 + 92)},${Math.round(b * 0.22 + 84)})`);
    }
    const sel = this.paths.get(selected);
    if (sel) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,230,160,0.95)'; ctx.shadowBlur = 14 * dpr;
      ctx.strokeStyle = 'rgba(255,236,180,0.9)'; ctx.lineWidth = 2.2 / this.scale; ctx.stroke(sel);
      const [r, g, b] = this.gs.factions[selected].color;
      ctx.shadowBlur = 0; ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fill(sel);
      ctx.restore();
    }
    // 本拠の印。選んでいる国は大きく、名前を添える
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const f of Object.values(this.gs.factions)) {
      const cp = this.gs.provinces[f.capital];
      if (!cp) continue;
      const [x, y] = this.toScreen(cp.cx, cp.cy), on = f.id === selected;
      ctx.beginPath(); ctx.arc(x, y, on ? 5 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#fff3d6' : 'rgba(30,24,16,0.8)'; ctx.fill();
      if (on) {
        ctx.lineWidth = 2; ctx.strokeStyle = '#2a2018'; ctx.stroke();
        ctx.font = 'bold 14px "Yu Mincho", "Hiragino Mincho ProN", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,14,10,0.9)'; ctx.strokeText(f.name.ja, x, y - 8);
        ctx.fillStyle = '#fff3d6'; ctx.fillText(f.name.ja, x, y - 8);
      }
    }
  }

  private toScreen(wx: number, wy: number): [number, number] { return [(wx - this.x0) * this.scale, (wy - this.y0) * this.scale]; }

  /** 地図の上の点（CSS の px）にある国（無ければ 0）。いちばん近い領の持ち主 */
  factionAt(px: number, py: number): number {
    const wx = px / this.scale + this.x0, wy = py / this.scale + this.y0;
    let best = 0, bd = Infinity;
    for (const p of this.gs.provinces) {
      if (p.out || !p.owner) continue;
      const d = (p.cx - wx) ** 2 + (p.cy - wy) ** 2;
      if (d < bd) { bd = d; best = p.owner; }
    }
    return best;
  }
}
