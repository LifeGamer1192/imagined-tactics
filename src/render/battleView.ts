// 戦場の描画。和紙の地に、淡彩の地形、墨絵の記号、丸い駒を描く。
// スクロール・拡大縮小は hist-sim から持ってきた Camera を使う。絵が無いものは、文字や形で代わりに描く。

import { art, artCount, onArtLoaded } from '../art/art';
import type { BUnit, BattleState } from '../battle/types';
import { getVariant } from '../data/db';
import type { TerrainKind } from '../data/types';
import { has, outOfCommand } from '../rules/stats';
import { Camera } from './camera';
import { crestCanvas, type CrestSpec } from './crest';
import { drawHexNote, drawProjectile, drawPuff, drawRing, drawStrike, type FxExtra } from './fxDraw';
import { css, FRAME, hash01, INDIGO, MINCHO, OCHRE, PAPER, SIDE_RGB, TERRAIN_WASH, VERDIGRIS, VERMILION, type RGB } from './ink';
import { drawDesk } from './desk';
import { applyPaper } from './paper';

export const HEX = 34;
/** 地形の層を先に描いておくときの細かさ（1なら等倍） */
const BAKE = 2;

export const TERRAIN_NAME: Record<TerrainKind, string> = {
  plain: '草原', road: '道', bridge: '橋', forest: '森', mountain: '山', swamp: '湿地', water: '川・湖・海', castle: '城', town: '街', cliff: '段差',
  camp: '陣', fort: '砦', paddy: '棚田', wall: '城壁', gate: '門', tower: '櫓', void: '盤の外',
};
/** 絵が無いときに代わりに書く字 */
const GLYPH: Partial<Record<TerrainKind, string>> = {
  forest: '森', mountain: '山', swamp: '沼', castle: '城', town: '街', cliff: '崖', bridge: '橋',
  camp: '陣', fort: '砦', paddy: '田', wall: '壁', gate: '門', tower: '櫓',
};
/** 地形の記号：絵の組、幅（マスの大きさに対する倍率）、種類を選ぶ候補 */
const SYMBOL: Partial<Record<TerrainKind, { groups: string[]; w: number }>> = {
  forest: { groups: ['map/ink_broadleaf', 'map/ink_conifer'], w: 1.25 },
  mountain: { groups: ['map/ink_mountain'], w: 1.75 },
  swamp: { groups: ['map/sym_swamp', 'map/ink_reed'], w: 1.1 },
  bridge: { groups: ['map/sym_bridge'], w: 1.35 },
  castle: { groups: ['map/town_ink_capital'], w: 1.9 },
  town: { groups: ['map/town_ink_walled', 'map/town_ink_town'], w: 1.5 },
  cliff: { groups: ['map/ink_hill'], w: 1.6 },
  wall: { groups: ['map/sym_wall'], w: 1.9 },
  tower: { groups: ['map/sym_palisade'], w: 1.15 },
};

/** 画面の演出。ゲームの状態（st）は先に確定していて、ここは見せ方だけを受け持つ。時刻は performance.now() のミリ秒 */
export type Fx =
  /** 駒が道のりに沿って動く */
  | { kind: 'slide'; unit: number; pts: [number, number][]; t0: number; dur: number }
  /** 攻める駒が相手のほうへ踏み込んで戻る */
  | { kind: 'lunge'; unit: number; dx: number; dy: number; t0: number; dur: number }
  /** 当たった駒が揺れる */
  | { kind: 'shake'; unit: number; amp: number; t0: number; dur: number }
  /**
   * 数字や字。cell があれば、そのマスを六角形に色づけて、中に大きく出す（ダメージの表示。label は「会心」など上に添える字）。
   * 同じマスに次の表示が来たら、前のものはマスの上に小さく積む。chip は、はじめから小さく出す（付いた状態など）。
   * cell が無ければ、浮いて消える。
   */
  | { kind: 'text'; x: number; y: number; text: string; color: RGB; big: boolean; cell?: number; label?: string; chip?: boolean; t0: number; dur: number }
  /** 倒れた駒：t0 までそのまま見せ、そのあと薄れて消える */
  | { kind: 'ghost'; u: BUnit; t0: number; dur: number }
  /** マスが一瞬光る（軍略の範囲）。color を省くと黄土 */
  | { kind: 'flash'; cells: number[]; color?: RGB; t0: number; dur: number }
  /** 攻撃のエフェクト（斬撃・飛び道具・煙や炎・広がる輪）。描き方は fxDraw.ts */
  | FxExtra
  /** 飛び道具の線 */
  | { kind: 'shot'; from: [number, number]; to: [number, number]; t0: number; dur: number }
  /** 当たるまでは、当たる前の体力を見せる */
  | { kind: 'hp'; unit: number; hp: number; t0: number; dur: number };
/** 城壁・門・櫓の、版ごとの絵（public/art/map/jp・cn）。無ければ SYMBOL の絵や線で描く */
const FORT_SYMBOL: Partial<Record<TerrainKind, { name: string; w: number }>> = {
  wall: { name: 'sym_wall', w: 1.9 }, gate: { name: 'sym_gate', w: 1.7 }, tower: { name: 'sym_tower', w: 1.45 },
};
export const SIDE_COLOR = [css(SIDE_RGB[0]), css(SIDE_RGB[1])];

export interface Highlight {
  move?: Set<number>;
  target?: Set<number>;
  area?: Set<number>;
  selected?: number;
  hover?: number;
  commandOf?: BUnit;
}

export class BattleView {
  readonly cam: Camera;
  st: BattleState | null = null;
  hl: Highlight = {};
  /** 陣営の紋（攻め手・守り手）。武将の駒に付ける */
  crests: [CrestSpec | null, CrestSpec | null] = [null, null];
  private base: HTMLCanvasElement | null = null;
  private baseDirty = true;
  private unsub: () => void;
  /** 進行中の演出。終わったものは描くときに取り除く */
  private fx: Fx[] = [];
  private raf = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.cam = new Camera(canvas);
    this.cam.onChange = () => this.draw();
    // 絵が読み込まれたら、地形の層を作り直して描き直す
    this.unsub = onArtLoaded(() => { this.baseDirty = true; if (this.canvas.isConnected) this.draw(); else this.unsub(); });
  }

  /** 演出を足す。動いている間は、自分で描き直しを続ける */
  play(list: Fx[]): void {
    if (!list.length) return;
    // 同じ駒の前の動きが残っていたら、新しいほうに置きかえる
    const moving = new Set(list.filter((f) => f.kind === 'slide').map((f) => (f as { unit: number }).unit));
    if (moving.size) this.fx = this.fx.filter((f) => !(f.kind === 'slide' && moving.has(f.unit)));
    this.fx.push(...list);
    this.kick();
  }

  /** 演出をやめる（unit を渡すと、その駒のぶんだけ） */
  clearFx(unit?: number): void {
    this.fx = unit === undefined ? [] : this.fx.filter((f) => !('unit' in f) || f.unit !== unit);
  }

  private kick(): void {
    if (this.raf || !this.fx.length) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.canvas.isConnected) this.draw(); else this.fx = [];
    });
  }

  setState(st: BattleState): void {
    this.st = st;
    this.baseDirty = true;
    this.fx = [];
    const [w, h] = st.map.grid.pixelSize(HEX);
    this.cam.resize();
    this.cam.setWorld(w, h);
  }

  /** 画面上の位置 → マス番号 */
  pick(sx: number, sy: number): number {
    if (!this.st) return -1;
    const [wx, wy] = this.cam.toWorld(sx, sy);
    const i = this.st.map.grid.pick(wx, wy, HEX);
    return i >= 0 && this.st.map.terrain[i] === 'void' ? -1 : i;
  }

  private hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 3 * k;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /** そのマスに敷く絵。無ければ null（塗りと記号で描く） */
  private tileFor(k: TerrainKind, i: number): HTMLImageElement | null {
    const v = hash01(i, 43);
    if (k === 'castle') return art(`hex/${getVariant()}/castle`, v);
    if (k === 'town') return art(`hex/${getVariant()}/town`, v);
    // 水の3枚目（濃い色）も同じ理由で使わない
    if (k === 'bridge' || k === 'water') return art('hex/water', v * 0.66);
    // 草原の3枚目（枯れ草）は色が大きく違い、まだらに見えるので使わない
    if (k === 'plain') return art('hex/plain', v * 0.66);
    // 門は道の地に、門の形を描き足す
    if (k === 'gate') return art('hex/road', v);
    return art(`hex/${k}`, v);
  }

  /** 動かない層（紙、地形の塗り、道、記号）を先に描いておく */
  private bake(): HTMLCanvasElement {
    const st = this.st!, g = st.map.grid;
    const [w, h] = g.pixelSize(HEX);
    const c = this.base ?? document.createElement('canvas');
    c.width = Math.ceil(w * BAKE); c.height = Math.ceil(h * BAKE);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(BAKE, 0, 0, BAKE, 0, 0);
    ctx.fillStyle = css(PAPER);
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // 淡彩の塗り。マスごとに少しだけ濃淡を変えて、手で塗った感じにする
    // 六角形の盤の外（長方形の隅）は描かない
    const off = (i: number) => st.map.terrain[i] === 'void';
    for (let i = 0; i < g.n; i++) {
      if (off(i)) continue;
      const [x, y] = g.center(i, HEX);
      const k = st.map.terrain[i];
      const base = TERRAIN_WASH[k];
      const d = (hash01(i, 7) - 0.5) * 10;
      this.hexPath(ctx, x, y, HEX + 0.4);
      ctx.fillStyle = css([base[0] + d, base[1] + d, base[2] + d]);
      ctx.fill();
    }
    // 地形の絵（マスいっぱいに敷く絵）。ある地形は絵を敷き、無い地形は上の塗りのままにする
    const tiled = new Uint8Array(g.n);
    for (let i = 0; i < g.n; i++) {
      if (off(i)) continue;
      const img = this.tileFor(st.map.terrain[i], i);
      if (!img) continue;
      const [x, y] = g.center(i, HEX);
      ctx.save();
      this.hexPath(ctx, x, y, HEX + 0.4); ctx.clip();
      // 向きに意味の無い絵は、左右を裏返して並びの単調さを減らす
      const k = st.map.terrain[i];
      const flip = k !== 'castle' && k !== 'town' && k !== 'camp' && k !== 'fort' && hash01(i, 41) < 0.5 ? -1 : 1;
      ctx.translate(x, y); ctx.scale(flip, 1);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(img, -HEX, -HEX, HEX * 2, HEX * 2);
      ctx.restore();
      tiled[i] = 1;
    }
    // マスの線：薄い墨
    ctx.strokeStyle = 'rgba(40,36,30,0.22)'; ctx.lineWidth = 1;
    for (let i = 0; i < g.n; i++) { if (off(i)) continue; const [x, y] = g.center(i, HEX); this.hexPath(ctx, x, y, HEX); ctx.stroke(); }
    // 水：波の筆あと
    ctx.strokeStyle = css(INDIGO, 0.3); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (let i = 0; i < g.n; i++) {
      if (st.map.terrain[i] !== 'water' || tiled[i]) continue;
      const [x, y] = g.center(i, HEX);
      for (let k = 0; k < 2; k++) {
        const ox = (hash01(i, k) - 0.5) * HEX * 0.6, oy = (k - 0.5) * HEX * 0.55 + (hash01(i, k + 9) - 0.5) * 6;
        ctx.beginPath();
        ctx.moveTo(x + ox - 11, y + oy);
        ctx.quadraticCurveTo(x + ox - 5, y + oy - 5, x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + 5, y + oy + 5, x + ox + 11, y + oy);
        ctx.stroke();
      }
    }
    // 道：道・橋・城・街のマスどうしを、筆の線でつなぐ
    const linked = (k: TerrainKind) => k === 'road' || k === 'bridge' || k === 'castle' || k === 'town' || k === 'gate' || k === 'camp' || k === 'fort';
    for (let i = 0; i < g.n; i++) {
      const k = st.map.terrain[i];
      if (k !== 'road' && k !== 'bridge' && k !== 'gate') continue;
      const [x, y] = g.center(i, HEX);
      for (const j of g.neighbors(i)) {
        if (!linked(st.map.terrain[j])) continue;
        const [nx, ny] = g.center(j, HEX);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo((x + nx) / 2, (y + ny) / 2);
        ctx.strokeStyle = 'rgba(132,92,58,0.42)'; ctx.lineWidth = HEX * 0.26; ctx.stroke();
        ctx.strokeStyle = 'rgba(244,236,214,0.5)'; ctx.lineWidth = HEX * 0.1; ctx.stroke();
      }
      if (k === 'bridge') {
        // 橋：欄干の2本線
        ctx.strokeStyle = 'rgba(40,30,20,0.7)'; ctx.lineWidth = 1.6;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x - HEX * 0.55, y + s * HEX * 0.2); ctx.lineTo(x + HEX * 0.55, y + s * HEX * 0.2); ctx.stroke(); }
      }
    }
    // 城壁の絵は、下の記号のところで描く（縦に並ぶと、ひと続きの壁に見える大きさにしてある）
    // 門：上下から来た石垣が途切れ、開いたところの両わきに柱が立つ
    ctx.lineCap = 'butt';
    for (let i = 0; i < g.n; i++) {
      // 門の絵があれば、下の記号のところで絵を描く
      if (st.map.terrain[i] !== 'gate' || artCount(`map/${getVariant()}/sym_gate`)) continue;
      const [x, y] = g.center(i, HEX);
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(x, y + s * HEX * 0.87); ctx.lineTo(x, y + s * HEX * 0.4);
        ctx.strokeStyle = 'rgba(52,46,40,0.7)'; ctx.lineWidth = HEX * 0.42; ctx.stroke();
        ctx.strokeStyle = 'rgba(176,168,154,0.9)'; ctx.lineWidth = HEX * 0.3; ctx.stroke();
        ctx.fillStyle = 'rgba(64,42,26,0.95)';
        ctx.fillRect(x - HEX * 0.26, y + s * HEX * 0.36 - HEX * 0.07, HEX * 0.52, HEX * 0.14);
      }
    }
    ctx.lineCap = 'round';
    // 記号：白い紙に描かれた墨絵を、乗算で重ねる（紙の白は消え、墨だけが残る）
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < g.n; i++) {
      const k = st.map.terrain[i];
      // 絵を敷いたマスには、記号を重ねない（橋だけは、水の絵の上に橋の記号を置く）
      if (tiled[i] && k !== 'bridge' && k !== 'gate') continue;
      // 城壁・門・櫓は、名前の版（日本・中国）ごとの絵があればそれを使う
      const own = FORT_SYMBOL[k], ownGroup = own ? `map/${getVariant()}/${own.name}` : '';
      const sym = own && artCount(ownGroup) ? { groups: [ownGroup], w: own.w } : SYMBOL[k];
      const [x, y] = g.center(i, HEX);
      if (sym) {
        const group = sym.groups[Math.floor(hash01(i, 3) * sym.groups.length)];
        const img = art(group, hash01(i, 5));
        if (img) {
          const w2 = HEX * sym.w, h2 = w2 * (img.naturalHeight / img.naturalWidth);
          ctx.drawImage(img, x - w2 / 2, y + HEX * 0.62 - h2, w2, h2);
          // 櫓は柵の絵だけでは分かりにくいので、字も添える
          if (k !== 'tower' || sym.groups[0] !== 'map/sym_palisade') continue;
        }
      }
      const glyph = GLYPH[k];
      if (glyph) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(40,36,30,0.4)';
        ctx.font = `${HEX * 0.5}px ${MINCHO}`;
        ctx.fillText(glyph, x, y - HEX * 0.42);
        ctx.globalCompositeOperation = 'multiply';
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    this.drawSky(ctx, w, h);
    this.base = c; this.baseDirty = false;
    return c;
  }

  /** 天気と夜を、地形の上に薄く重ねる（雨の線、霧の白、雪の点、夜の藍） */
  private drawSky(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const st = this.st!;
    if (st.night) { ctx.fillStyle = 'rgba(22,28,62,0.3)'; ctx.fillRect(0, 0, w, h); }
    const weather = st.weather ?? 'clear';
    if (weather === 'rain') {
      ctx.fillStyle = 'rgba(70,90,120,0.12)'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(52,78,128,0.34)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
      for (let k = 0; k < 520; k++) {
        const x = hash01(k, 101) * w, y = hash01(k, 103) * h, len = 9 + hash01(k, 107) * 9;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len * 0.35, y + len); ctx.stroke();
      }
    } else if (weather === 'fog') {
      ctx.fillStyle = 'rgba(244,242,236,0.3)'; ctx.fillRect(0, 0, w, h);
      for (let k = 0; k < 26; k++) {
        const x = hash01(k, 111) * w, y = hash01(k, 113) * h, r = 70 + hash01(k, 117) * 120;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(250,249,244,0.34)'); grad.addColorStop(1, 'rgba(250,249,244,0)');
        ctx.fillStyle = grad;
        ctx.save(); ctx.translate(x, y); ctx.scale(1.9, 0.6); ctx.translate(-x, -y);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    } else if (weather === 'snow') {
      ctx.fillStyle = 'rgba(250,250,252,0.26)'; ctx.fillRect(0, 0, w, h);
      for (let k = 0; k < 620; k++) {
        const x = hash01(k, 121) * w, y = hash01(k, 123) * h, r = 1 + hash01(k, 127) * 1.8;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
        ctx.strokeStyle = 'rgba(90,100,120,0.25)'; ctx.lineWidth = 0.5; ctx.stroke();
      }
    }
  }

  /** 駒を (x, y) に描く。fade は薄れ具合（1 = そのまま）、hp は見せる体力（演出の途中は、当たる前の値） */
  private drawUnit(ctx: CanvasRenderingContext2D, u: BUnit, x: number, y: number, fade = 1, hp = u.hp): void {
    const st = this.st!;
    const general = u.kind === 'general';
    const r = general ? HEX * 0.6 : HEX * 0.5;
    const side = SIDE_RGB[u.side];
    const done = u.alive && u.side === st.turn && u.acted;
    ctx.save();
    ctx.globalAlpha = (done ? 0.55 : 1) * fade;
    // 影
    ctx.beginPath(); ctx.ellipse(x + 1.5, y + r * 0.86, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30,24,16,0.22)'; ctx.fill();
    // 駒の地：紙の色
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f4efe2'; ctx.fill();
    // 中身：絵があれば絵、無ければ名前の字
    const img = general ? null : art(`unit/${getVariant()}/${u.defId}`);
    if (img) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r - 1.5, 0, Math.PI * 2); ctx.clip();
      ctx.globalCompositeOperation = 'multiply';
      const s = Math.max((r * 2) / img.naturalWidth, (r * 2) / img.naturalHeight);
      ctx.drawImage(img, x - img.naturalWidth * s / 2, y - img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(24,22,20,0.9)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${HEX * (general ? 0.42 : 0.36)}px ${MINCHO}`;
      ctx.fillText(u.name.slice(0, 2), x, y + 1);
    }
    // ふちどり：陣営の色。武将は二重
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = general ? 4 : 3; ctx.strokeStyle = css(side); ctx.stroke();
    if (general) { ctx.beginPath(); ctx.arc(x, y, r - 4.5, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.strokeStyle = css(side, 0.8); ctx.stroke(); }
    if (u.id === this.hl.selected) { ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = css(OCHRE); ctx.stroke(); }
    // 武将には勢力の紋を付ける
    const crest = general ? this.crests[u.home] : null;
    if (crest) {
      const cs = HEX * 0.5;
      ctx.drawImage(crestCanvas(crest, cs * BAKE), x - r - cs * 0.15, y - r - cs * 0.15, cs, cs);
    }
    // 体力
    const bw = HEX * 1.1, bx = x - bw / 2, by = y + r + 2;
    ctx.fillStyle = 'rgba(30,24,16,0.35)'; ctx.fillRect(bx, by, bw, 4);
    const ratio = Math.max(0, Math.min(1, hp / u.maxHp));
    ctx.fillStyle = css(ratio > 0.5 ? VERDIGRIS : ratio > 0.25 ? OCHRE : VERMILION);
    ctx.fillRect(bx, by, bw * ratio, 4);
    ctx.restore();
    if (!u.alive) return;
    // 状態の印
    const marks: string[] = [];
    if (has(u, 'poison')) marks.push('毒');
    if (has(u, 'daze') || has(u, 'stun') || has(u, 'confuse')) marks.push('×');
    if (has(u, 'silence')) marks.push('乱');
    if (u.side !== u.home) marks.push('返');
    if (outOfCommand(st, u)) marks.push('外');
    if (marks.length) {
      ctx.font = `700 ${HEX * 0.32}px ${MINCHO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(244,239,226,0.95)'; ctx.fillStyle = css(VERMILION);
      const text = marks.join('');
      ctx.strokeText(text, x + r * 0.5, y - r * 0.95); ctx.fillText(text, x + r * 0.5, y - r * 0.95);
    }
  }

  draw(): void {
    const st = this.st;
    const { ctx, cv } = this.cam;
    drawDesk(ctx, cv.width, cv.height, FRAME);
    if (!st) return;
    const z = this.cam.zoom * this.cam.dpr;
    ctx.setTransform(z, 0, 0, z, -this.cam.x * z, -this.cam.y * z);
    const g = st.map.grid;
    const [w, h] = g.pixelSize(HEX);
    const base = this.baseDirty || !this.base ? this.bake() : this.base;
    ctx.drawImage(base, 0, 0, w, h);
    // 紙のふち
    ctx.strokeStyle = 'rgba(24,22,20,0.7)'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, w, h);

    const shade = (cells: Set<number> | undefined, fill: string, stroke: string) => {
      if (!cells) return;
      for (const i of cells) {
        const [x, y] = g.center(i, HEX);
        this.hexPath(ctx, x, y, HEX - 2);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
      }
    };
    // 采配範囲：紙を少し明るくする
    const c = this.hl.commandOf;
    if (c && c.alive) shade(new Set(g.range(c.pos, c.commandRange)), 'rgba(255,252,240,0.28)', 'rgba(0,0,0,0)');
    shade(this.hl.move, css(INDIGO, 0.22), css(INDIGO, 0.7));
    shade(this.hl.target, css(VERMILION, 0.26), css(VERMILION, 0.85));
    shade(this.hl.area, css(OCHRE, 0.4), css([150, 105, 30], 0.9));

    // 演出：終わったものを捨て、いまの時刻での位置・揺れ・体力を求める
    const now = performance.now();
    this.fx = this.fx.filter((f) => now < f.t0 + f.dur);
    const ease = (p: number) => p * p * (3 - 2 * p);
    const place = (u: BUnit): [number, number, number] => {
      let [x, y] = g.center(u.pos, HEX);
      let hp = u.hp, hpFrom = Infinity;
      for (const f of this.fx) {
        if (!('unit' in f) || f.unit !== u.id) continue;
        const p = Math.max(0, Math.min(1, (now - f.t0) / f.dur));
        if (f.kind === 'slide') {
          // 道のりの上を、同じ速さで進む（始まる前は出発点にいる）
          const s = ease(p) * (f.pts.length - 1), k = Math.min(f.pts.length - 2, Math.floor(s)), q = s - k;
          x = f.pts[k][0] + (f.pts[k + 1][0] - f.pts[k][0]) * q; y = f.pts[k][1] + (f.pts[k + 1][1] - f.pts[k][1]) * q;
        } else if (now < f.t0) continue;
        else if (f.kind === 'lunge') { const s = Math.sin(Math.PI * p); x += f.dx * s; y += f.dy * s; }
        else if (f.kind === 'shake') { x += Math.sin(p * Math.PI * 6) * f.amp * (1 - p); }
        // いくつも当たるときは、いちばん早い（まだ当たっていない）ものの体力を見せる
        else if (f.kind === 'hp' && f.t0 < hpFrom) { hp = f.hp; hpFrom = f.t0; }
      }
      return [x, y, hp];
    };
    // 軍略の範囲が一瞬光る
    for (const f of this.fx) {
      if (f.kind !== 'flash' || now < f.t0) continue;
      const p = (now - f.t0) / f.dur, a = Math.sin(Math.PI * Math.min(1, p * 1.4)) * 0.6;
      for (const i of f.cells) {
        const [x, y] = g.center(i, HEX);
        this.hexPath(ctx, x, y, HEX - 2);
        // 軍略の種類の色（攻撃は朱、回復は緑青…）で光る。色が無ければ黄土
        ctx.fillStyle = f.color ? css(f.color, a * 0.62) : `rgba(255,236,170,${a})`; ctx.fill();
        ctx.strokeStyle = css(f.color ?? OCHRE, Math.min(1, a * 1.6)); ctx.lineWidth = 2.5; ctx.stroke();
      }
    }
    // 倒れた駒：当たるまではそのまま、そのあと薄れる
    for (const f of this.fx) {
      if (f.kind !== 'ghost') continue;
      const [x, y, hp] = place(f.u);
      const p = (now - f.t0) / f.dur;
      this.drawUnit(ctx, f.u, x, y + (p > 0 ? p * 5 : 0), p > 0 ? 1 - p : 1, p > 0 ? 0 : hp);
    }
    for (const u of st.units) if (u.alive) { const [x, y, hp] = place(u); this.drawUnit(ctx, u, x, y, 1, hp); }
    // 飛び道具の線
    for (const f of this.fx) {
      if (f.kind !== 'shot' || now < f.t0) continue;
      const p = (now - f.t0) / f.dur, q = Math.max(0, p - 0.28);
      const at = (s: number): [number, number] => [f.from[0] + (f.to[0] - f.from[0]) * s, f.from[1] + (f.to[1] - f.from[1]) * s - Math.sin(Math.PI * s) * HEX * 0.5];
      const [ax, ay] = at(q), [bx, by] = at(p);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = 'rgba(30,24,16,0.9)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.stroke();
    }
    // 攻撃のエフェクト：斬撃・突き・打撃、飛んでいくもの、煙や炎、広がる輪
    for (const f of this.fx) {
      if (now < f.t0) continue;
      const p = (now - f.t0) / f.dur;
      if (f.kind === 'slash') drawStrike(ctx, f, p, HEX);
      else if (f.kind === 'proj') drawProjectile(ctx, f, p, HEX);
      else if (f.kind === 'puff') drawPuff(ctx, f, p, HEX);
      else if (f.kind === 'ring') drawRing(ctx, f, p);
    }
    // ダメージの表示：マスを六角形に色づけて、中に数字。同じマスに次が来たら、前のものは上に小さく積む
    for (let i = 0; i < this.fx.length; i++) {
      const f = this.fx[i];
      if (f.kind !== 'text' || f.cell === undefined || now < f.t0) continue;
      let later = 0, panel = false;
      for (let j = 0; j < this.fx.length; j++) {
        const o = this.fx[j];
        if (o.kind !== 'text' || o.cell !== f.cell || now < o.t0 || !(o.t0 > f.t0 || (o.t0 === f.t0 && j > i))) continue;
        later++;
        if (!o.chip) panel = true;
      }
      const slot = f.chip ? later - (panel ? 1 : 0) : panel ? later - 1 : -1;
      const [x, y] = g.center(f.cell, HEX);
      drawHexNote(ctx, x, y, HEX, f, (now - f.t0) / f.dur, slot);
    }
    // 浮く数字
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const f of this.fx) {
      if (f.kind !== 'text' || f.cell !== undefined || now < f.t0) continue;
      const p = (now - f.t0) / f.dur;
      // 会心は、出た瞬間に少し大きくはねる
      const pop = f.big ? 1 + 0.5 * Math.max(0, 1 - p * 5) : 1;
      ctx.font = `700 ${HEX * (f.big ? 0.7 : 0.5) * pop}px ${MINCHO}`;
      ctx.globalAlpha = p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.4);
      const ty = f.y - HEX * 0.5 - ease(Math.min(1, p * 1.3)) * HEX * 0.75;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(250,246,234,0.95)'; ctx.strokeText(f.text, f.x, ty);
      ctx.fillStyle = css(f.color); ctx.fillText(f.text, f.x, ty);
    }
    ctx.globalAlpha = 1;

    if (this.hl.hover !== undefined && this.hl.hover >= 0) {
      const [x, y] = g.center(this.hl.hover, HEX);
      this.hexPath(ctx, x, y, HEX - 1.5);
      ctx.strokeStyle = 'rgba(24,22,20,0.75)'; ctx.lineWidth = 2; ctx.stroke();
    }
    // 和紙のざらつきを、画面全体に重ねる
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    applyPaper(ctx, cv.width, cv.height, 0.18);
    // 演出が残っていれば、次のコマも描く
    this.kick();
  }

  /** マスの中心（演出を組み立てる側で使う） */
  cellXY(i: number): [number, number] { return this.st!.map.grid.center(i, HEX); }
}
