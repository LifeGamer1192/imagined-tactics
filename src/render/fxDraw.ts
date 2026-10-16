// 攻撃のエフェクトの描き方。絵のファイルは使わず、筆あと・墨のにじみ・朱の差し色を Canvas で描く。
// ここは「いまの進み具合 p（0〜1）での1コマ」を描くだけ。いつ・どこに出すかは src/ui/battleFx.ts が決める。

import { css, hash01, INDIGO, MINCHO, OCHRE, VERDIGRIS, VERMILION, type RGB } from './ink';

/** 攻撃のエフェクト（battleView の Fx に足すぶん）。時刻は performance.now() のミリ秒 */
export type FxExtra =
  /** 近接の一撃：斬る・突く・打つ。ang は攻める向き。miss は空を切る */
  | { kind: 'slash'; x: number; y: number; ang: number; style: 'slash' | 'thrust' | 'blow'; crit: boolean; miss: boolean; seed: number; t0: number; dur: number }
  /** 飛んでいくもの */
  | { kind: 'proj'; from: [number, number]; to: [number, number]; style: 'arrow' | 'javelin' | 'dart' | 'bullet' | 'cannon' | 'stone' | 'fire'; seed: number; t0: number; dur: number }
  /** その場に出て消えるもの：発射の光、煙、土煙、炎、水しぶき、回復、補助、妨害、打ち消し、兵が襲う */
  | { kind: 'puff'; x: number; y: number; style: 'flash' | 'smoke' | 'dust' | 'flame' | 'splash' | 'heal' | 'buff' | 'debuff' | 'dispel' | 'raid'; ang?: number; seed: number; t0: number; dur: number }
  /** 広がる輪（声や音） */
  | { kind: 'ring'; x: number; y: number; r: number; color: RGB; t0: number; dur: number };

const INK: RGB = [24, 22, 20], GREY: RGB = [96, 90, 82], PALE: RGB = [255, 240, 190], PURPLE: RGB = [122, 84, 132];
const ease = (p: number): number => p * p * (3 - 2 * p);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 3 * k;
    if (k === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

/** 墨のにじみ：まん中が濃く、外へ薄れる丸 */
function blot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, a: number): void {
  if (r <= 0 || a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(c, a)); g.addColorStop(0.55, css(c, a * 0.6)); g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

/** 三日月の筆あと：中心 (cx, 0)、半径 r、角度 a0〜a1。太さは両端で細くなる */
function crescent(ctx: CanvasRenderingContext2D, cx: number, r: number, w: number, a0: number, a1: number, from: number, to: number): void {
  if (to <= from) return;
  const N = 14;
  ctx.beginPath();
  for (let k = 0; k <= N; k++) { const u = from + (to - from) * k / N, a = a0 + (a1 - a0) * u; ctx.lineTo(cx + r * Math.cos(a), r * Math.sin(a)); }
  for (let k = N; k >= 0; k--) {
    const u = from + (to - from) * k / N, a = a0 + (a1 - a0) * u, rr = r - w * Math.pow(Math.sin(Math.PI * u), 0.8);
    ctx.lineTo(cx + rr * Math.cos(a), rr * Math.sin(a));
  }
  ctx.closePath(); ctx.fill();
}

/** 近接の一撃。R はマスの大きさ */
export function drawStrike(ctx: CanvasRenderingContext2D, f: Extract<FxExtra, { kind: 'slash' }>, p: number, R: number): void {
  const big = f.crit ? 1.45 : 1;
  const fade = p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) / 0.5);
  ctx.save();
  ctx.translate(f.x, f.y); ctx.rotate(f.ang);
  // 外れは、相手のわきの空を切る。色は薄い墨だけ
  if (f.miss) ctx.translate(-R * 0.1, (hash01(f.seed, 1) < 0.5 ? -1 : 1) * R * 0.72);
  ctx.globalAlpha = fade * (f.miss ? 0.6 : 1);
  const body = f.miss ? GREY : f.crit ? VERMILION : INK;
  const edge = f.crit ? PALE : VERMILION;
  ctx.lineCap = 'round';
  if (f.style === 'slash') {
    const r = R * 0.74 * big, w = R * 0.27 * big, a0 = -1.25, a1 = 1.25;
    const head = ease(clamp01(p / 0.38)), tail = ease(clamp01((p - 0.3) / 0.6));
    ctx.fillStyle = css(body, 0.9);
    crescent(ctx, -R * 0.3 * big, r, w, a0, a1, tail, head);
    if (!f.miss) {
      // 刃の光：内側に朱（会心は明るい色）の細い筋
      ctx.fillStyle = css(edge, f.crit ? 0.95 : 0.8);
      crescent(ctx, -R * 0.3 * big, r - w * 0.28, w * 0.3, a0, a1, Math.max(tail, 0.08), Math.min(head, 0.92));
    }
  } else if (f.style === 'thrust') {
    const x0 = -R * 1.05 * big, tip = x0 + (R * 0.3 - x0) * ease(clamp01(p / 0.3)), w = R * 0.12 * big;
    const start = x0 + (tip - x0) * ease(clamp01((p - 0.35) / 0.6));
    ctx.fillStyle = css(body, 0.9);
    ctx.beginPath(); ctx.moveTo(start, 0); ctx.lineTo(tip - w * 2.2, -w); ctx.lineTo(tip, 0); ctx.lineTo(tip - w * 2.2, w); ctx.closePath(); ctx.fill();
    if (!f.miss) {
      ctx.strokeStyle = css(edge, 0.9); ctx.lineWidth = Math.max(1, w * 0.35);
      ctx.beginPath(); ctx.moveTo(start + (tip - start) * 0.35, 0); ctx.lineTo(tip - w, 0); ctx.stroke();
      // 突いた先に、短い筋が散る
      const q = clamp01((p - 0.28) / 0.4);
      if (q > 0) {
        ctx.strokeStyle = css(f.crit ? PALE : VERMILION, 1 - q); ctx.lineWidth = 2 * big;
        for (const a of [-0.75, -0.3, 0.3, 0.75]) {
          const r0 = R * 0.12 + R * 0.25 * q, r1 = r0 + R * 0.2 * big;
          ctx.beginPath(); ctx.moveTo(R * 0.3 + r0 * Math.cos(a), r0 * Math.sin(a)); ctx.lineTo(R * 0.3 + r1 * Math.cos(a), r1 * Math.sin(a)); ctx.stroke();
        }
      }
    }
  } else {
    // 打つ：衝撃の輪と、外へ散る筋
    const q = ease(clamp01(p / 0.55)), r = R * (0.18 + 0.5 * q) * big;
    if (f.crit) blot(ctx, 0, 0, r * 1.1, PALE, 0.7 * (1 - q));
    ctx.strokeStyle = css(body, 0.9); ctx.lineWidth = Math.max(1, R * 0.13 * big * (1 - q * 0.7));
    for (let k = 0; k < 3; k++) {
      const a = k * 2.09 + hash01(f.seed, k) * 0.6;
      ctx.beginPath(); ctx.arc(0, 0, r, a, a + 1.55); ctx.stroke();
    }
    if (!f.miss) {
      ctx.strokeStyle = css(edge, 0.95); ctx.lineWidth = 2.2 * big;
      for (let k = 0; k < 7; k++) {
        const a = k * 0.9 + hash01(f.seed, k + 5) * 0.5;
        ctx.beginPath(); ctx.moveTo(r * 0.8 * Math.cos(a), r * 0.8 * Math.sin(a)); ctx.lineTo(r * 1.3 * Math.cos(a), r * 1.3 * Math.sin(a)); ctx.stroke();
      }
    }
  }
  // 当たったら、墨と朱のしぶきが飛ぶ（会心は多め）
  if (!f.miss) {
    const q = clamp01((p - 0.22) / 0.6);
    if (q > 0) {
      const count = f.crit ? 9 : 5;
      for (let k = 0; k < count; k++) {
        const a = (hash01(f.seed, k + 20) - 0.5) * 2.2, d = R * (0.25 + 0.75 * hash01(f.seed, k + 40) * q) * big;
        ctx.fillStyle = css(k % 2 ? VERMILION : INK, 0.85 * (1 - q));
        ctx.beginPath(); ctx.arc(d * Math.cos(a), d * Math.sin(a), 1.1 + hash01(f.seed, k + 60) * 2 * big, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** 山なりの高さ（飛ぶ距離に対する割合） */
const ARC: Record<Extract<FxExtra, { kind: 'proj' }>['style'], number> = { arrow: 0.24, javelin: 0.16, dart: 0, bullet: 0, cannon: 0.3, stone: 0.36, fire: 0.26 };

/** 飛んでいくもの */
export function drawProjectile(ctx: CanvasRenderingContext2D, f: Extract<FxExtra, { kind: 'proj' }>, p: number, R: number): void {
  const dx = f.to[0] - f.from[0], dy = f.to[1] - f.from[1], len = Math.hypot(dx, dy) || 1;
  const h = Math.max(len * ARC[f.style], ARC[f.style] > 0 ? R * 0.35 : 0);
  const at = (s: number): [number, number] => [f.from[0] + dx * s, f.from[1] + dy * s - Math.sin(Math.PI * clamp01(s)) * h];
  const [x, y] = at(p), [bx, by] = at(p - 0.05);
  const ang = Math.atan2(y - by, x - bx);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  /** 通ってきた道に残る、薄い筆あと */
  const trail = (back: number, color: RGB, a: number, w: number) => {
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) { const [tx, ty] = at(Math.max(0, p - back * (1 - k / 6))); if (k === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty); }
    ctx.strokeStyle = css(color, a); ctx.lineWidth = w; ctx.stroke();
  };
  if (f.style === 'arrow' || f.style === 'javelin') {
    const jav = f.style === 'javelin', L = R * (jav ? 0.85 : 0.56), w = jav ? 2.8 : 1.7;
    trail(0.3, INK, 0.2, w);
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.strokeStyle = css(INK, 0.95); ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(0, 0); ctx.stroke();
    // 矢じり
    ctx.fillStyle = css(INK, 0.95);
    ctx.beginPath(); ctx.moveTo(R * 0.14, 0); ctx.lineTo(-R * 0.06, -R * 0.085); ctx.lineTo(-R * 0.06, R * 0.085); ctx.closePath(); ctx.fill();
    // 矢羽（投げ槍には無い）
    if (!jav) {
      ctx.strokeStyle = css(VERMILION, 0.9); ctx.lineWidth = 1.5;
      for (const s of [-1, 1]) for (const o of [0, R * 0.09]) { ctx.beginPath(); ctx.moveTo(-L + o, 0); ctx.lineTo(-L + o - R * 0.1, s * R * 0.09); ctx.stroke(); }
    }
  } else if (f.style === 'dart') {
    trail(0.22, INK, 0.25, 1.2);
    ctx.translate(x, y); ctx.rotate(p * 16 + f.seed);
    ctx.fillStyle = css(INK, 0.95);
    ctx.beginPath();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? R * 0.045 : R * 0.15; ctx.lineTo(r * Math.cos(a), r * Math.sin(a)); }
    ctx.closePath(); ctx.fill();
  } else if (f.style === 'bullet') {
    // 速い直線の弾：墨のふちに、明るい芯
    const [tx, ty] = at(Math.max(0, p - 0.3));
    ctx.strokeStyle = css(INK, 0.55); ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
    ctx.strokeStyle = css(PALE, 0.98); ctx.lineWidth = 1.9;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = css(INK, 0.95);
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
  } else if (f.style === 'cannon' || f.style === 'stone') {
    const r = f.style === 'cannon' ? R * 0.16 : R * 0.13;
    // 地面に落ちる影（玉が浮いて見える）
    ctx.fillStyle = 'rgba(30,24,16,0.2)';
    ctx.beginPath(); ctx.ellipse(f.from[0] + dx * p, f.from[1] + dy * p + R * 0.3, r * 1.1, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    for (let k = 3; k >= 1; k--) { const [tx, ty] = at(p - k * 0.035); ctx.fillStyle = css(INK, 0.16 * (4 - k)); ctx.beginPath(); ctx.arc(tx, ty, r * (1 - k * 0.12), 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = f.style === 'cannon' ? css(INK, 0.96) : css([92, 84, 74], 0.96);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(INK, 0.9); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(250,246,234,0.5)';
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, Math.PI * 2); ctx.fill();
  } else {
    // 火の玉：朱から黄土へ薄れる尾と、明るい芯
    for (let k = 7; k >= 1; k--) {
      const [tx, ty] = at(p - k * 0.04);
      const j = (hash01(f.seed + k, Math.floor(p * 30)) - 0.5) * R * 0.1;
      blot(ctx, tx + j, ty + j, R * (0.26 - k * 0.024), k < 3 ? OCHRE : VERMILION, 0.5 * (1 - k / 8));
    }
    blot(ctx, x, y, R * 0.5, VERMILION, 0.9);
    // 火の玉の形：進む向きの後ろへ、とがった尾を引く
    ctx.translate(x, y); ctx.rotate(ang);
    const drop = (r: number, tail: number, c: RGB, a: number) => {
      ctx.beginPath();
      ctx.moveTo(-tail, 0); ctx.quadraticCurveTo(-r * 0.6, -r * 1.15, r * 0.35, -r * 0.8);
      ctx.arc(r * 0.2, 0, r * 0.82, -Math.PI / 2 + 0.2, Math.PI / 2 - 0.2);
      ctx.quadraticCurveTo(-r * 0.6, r * 1.15, -tail, 0);
      ctx.closePath(); ctx.fillStyle = css(c, a); ctx.fill();
    };
    drop(R * 0.2, R * 0.62, VERMILION, 0.95);
    drop(R * 0.13, R * 0.36, OCHRE, 0.98);
    drop(R * 0.07, R * 0.16, PALE, 1);
  }
  ctx.restore();
}

/** その場に出て消えるもの */
export function drawPuff(ctx: CanvasRenderingContext2D, f: Extract<FxExtra, { kind: 'puff' }>, p: number, R: number): void {
  const h = (k: number) => hash01(f.seed, k);
  const out = 1 - p;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (f.style) {
    case 'flash': {
      // 発射の光：とがった星
      ctx.rotate(f.ang ?? 0);
      const r = R * (0.3 + 0.35 * p);
      blot(ctx, 0, 0, r * 1.5, OCHRE, 0.6 * out);
      ctx.fillStyle = css(PALE, out);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, rr = k % 2 ? r * 0.32 : r * (k === 0 ? 1.9 : 1); ctx.lineTo(rr * Math.cos(a), rr * Math.sin(a)); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = css(VERMILION, 0.8 * out); ctx.lineWidth = 1.2; ctx.stroke();
      break;
    }
    case 'smoke':
      // 煙：墨のにじみが、ふくらみながら上がる
      for (let k = 0; k < 6; k++) {
        const x = (h(k) - 0.5) * R * 0.6 + (h(k + 9) - 0.5) * R * 0.5 * p, y = (h(k + 3) - 0.5) * R * 0.3 - R * (0.25 + 0.5 * h(k + 6)) * p;
        blot(ctx, x, y, R * (0.16 + 0.34 * p) * (0.7 + 0.6 * h(k + 12)), [70, 66, 60], 0.5 * out);
      }
      break;
    case 'dust': {
      // 土煙：低く横へ広がる。土くれが跳ねる
      for (let k = 0; k < 7; k++) {
        const s = k % 2 ? 1 : -1;
        const x = s * R * (0.1 + 0.75 * h(k)) * ease(p), y = R * 0.28 - R * 0.28 * h(k + 3) * Math.sin(Math.PI * p);
        blot(ctx, x, y, R * (0.22 + 0.4 * p) * (0.7 + 0.6 * h(k + 6)), [138, 104, 66], 0.85 * Math.min(1, out * 1.5));
      }
      ctx.fillStyle = css(INK, 0.85 * out);
      for (let k = 0; k < 8; k++) {
        const x = (h(k + 20) - 0.5) * R * 1.5 * p, y = R * 0.2 - R * (0.5 + 0.7 * h(k + 30)) * Math.sin(Math.PI * Math.min(1, p * 1.15));
        ctx.beginPath(); ctx.arc(x, y, 1.2 + h(k + 40) * 1.6, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'flame': {
      // 炎：ゆらぐ舌が立ちのぼる
      const grow = Math.sin(Math.PI * Math.min(1, p * 1.25));
      blot(ctx, 0, R * 0.2, R * 0.75, VERMILION, 0.4 * grow);
      const tongue = (x: number, w: number, hgt: number, c: RGB, a: number) => {
        const sway = (hash01(f.seed + Math.floor(p * 14), Math.round(x * 7)) - 0.5) * w * 1.2;
        ctx.beginPath();
        ctx.moveTo(x - w, R * 0.34);
        ctx.quadraticCurveTo(x - w * 1.1, R * 0.34 - hgt * 0.5, x + sway, R * 0.34 - hgt);
        ctx.quadraticCurveTo(x + w * 1.1, R * 0.34 - hgt * 0.5, x + w, R * 0.34);
        ctx.closePath();
        ctx.fillStyle = css(c, a); ctx.fill();
      };
      for (let k = 0; k < 5; k++) {
        const x = (k - 2) * R * 0.2 + (h(k) - 0.5) * R * 0.1, hgt = R * (0.55 + 0.5 * h(k + 5)) * grow;
        tongue(x, R * 0.15, hgt, VERMILION, 0.82 * Math.min(1, out * 1.6));
        tongue(x, R * 0.09, hgt * 0.66, OCHRE, 0.9 * Math.min(1, out * 1.6));
        tongue(x, R * 0.045, hgt * 0.36, PALE, 0.9 * Math.min(1, out * 1.6));
      }
      // 火の粉
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = css(k % 2 ? OCHRE : VERMILION, out);
        ctx.beginPath(); ctx.arc((h(k + 20) - 0.5) * R * 1.1, R * 0.2 - R * (0.4 + 1.0 * h(k + 30)) * p, 1.3, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'splash': {
      // 水：藍の波が外へ広がり、しぶきが上がる
      blot(ctx, 0, 0, R * 0.8, INDIGO, 0.3 * Math.sin(Math.PI * p));
      ctx.strokeStyle = css(INDIGO, 0.85 * out);
      for (let k = 0; k < 3; k++) {
        const q = clamp01(p * 1.3 - k * 0.15), r = R * (0.2 + 0.7 * ease(q)), y = R * 0.15 * k - R * 0.1;
        ctx.lineWidth = 2.6 - k * 0.5;
        ctx.beginPath(); ctx.moveTo(-r, y); ctx.quadraticCurveTo(-r * 0.5, y - R * 0.22, 0, y); ctx.quadraticCurveTo(r * 0.5, y + R * 0.22, r, y); ctx.stroke();
      }
      ctx.fillStyle = css(INDIGO, 0.8 * out);
      for (let k = 0; k < 7; k++) {
        ctx.beginPath(); ctx.arc((h(k) - 0.5) * R * 1.4 * p, -R * (0.3 + 0.9 * h(k + 9)) * Math.sin(Math.PI * Math.min(1, p * 1.2)), 1.4 + h(k + 4) * 1.4, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'heal': {
      // 回復：緑青の光がともり、粒がのぼる
      blot(ctx, 0, 0, R * 0.85, VERDIGRIS, 0.42 * Math.sin(Math.PI * p));
      ctx.strokeStyle = css(VERDIGRIS, 0.8 * out); ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, R * (0.3 + 0.45 * ease(p)), 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 8; k++) {
        const x = (h(k) - 0.5) * R * 1.1, y = R * 0.4 - R * (0.5 + 0.9 * h(k + 9)) * p;
        ctx.fillStyle = css(k % 3 ? VERDIGRIS : PALE, Math.min(1, out * 1.5));
        ctx.beginPath(); ctx.arc(x, y, 1.6 + h(k + 4) * 1.6, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'buff': {
      // 補助：黄土の山形が、下から上へ重なってのぼる
      blot(ctx, 0, 0, R * 0.8, OCHRE, 0.36 * Math.sin(Math.PI * p));
      for (let k = 0; k < 3; k++) {
        const q = clamp01(p * 1.4 - k * 0.18);
        if (q <= 0) continue;
        const y = R * 0.45 - R * 0.95 * ease(q), w = R * 0.42;
        ctx.strokeStyle = css(k === 1 ? PALE : OCHRE, 1 - q); ctx.lineWidth = 3.4 - k * 0.5;
        ctx.beginPath(); ctx.moveTo(-w, y + w * 0.5); ctx.lineTo(0, y); ctx.lineTo(w, y + w * 0.5); ctx.stroke();
      }
      break;
    }
    case 'debuff': {
      // 妨害：紫の墨が、上から垂れて渦を巻く
      blot(ctx, 0, 0, R * 0.8, PURPLE, 0.4 * Math.sin(Math.PI * p));
      ctx.strokeStyle = css(PURPLE, 0.9 * out); ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) { const u = k / 24 * clamp01(p * 1.5), a = u * 7 + f.seed, r = R * 0.62 * (1 - u * 0.75); ctx.lineTo(r * Math.cos(a), r * Math.sin(a) * 0.8); }
      ctx.stroke();
      for (let k = 0; k < 5; k++) {
        const x = (k - 2) * R * 0.24 + (h(k) - 0.5) * R * 0.1, y0 = -R * 0.7, y1 = y0 + R * (0.5 + 0.7 * h(k + 5)) * ease(clamp01(p * 1.3));
        ctx.strokeStyle = css(k % 2 ? PURPLE : INK, 0.75 * out); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath(); ctx.arc(x, y1, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'dispel': {
      // 打ち消し：藍の輪がしぼんで、欠けらになって散る
      const q = ease(clamp01(p / 0.5)), r = R * (0.75 - 0.45 * q);
      ctx.strokeStyle = css(INDIGO, 0.9 * Math.min(1, out * 2)); ctx.lineWidth = 2.6;
      if (p < 0.5) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); }
      else {
        const s = (p - 0.5) / 0.5;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4 + f.seed, r0 = R * (0.3 + 0.6 * s);
          ctx.beginPath(); ctx.arc(0, 0, r0, a, a + 0.35 * (1 - s)); ctx.stroke();
        }
      }
      break;
    }
    case 'raid': {
      // 兵が襲う：斬撃が続けて交わる
      const cuts: [number, number][] = [[-0.9, 0], [0.9, 0.22], [-2.4, 0.44]];
      for (const [a, start] of cuts) {
        const q = clamp01((p - start) / 0.45);
        if (q <= 0 || q >= 1) continue;
        ctx.save(); ctx.rotate(a + (h(3) - 0.5) * 0.4);
        const head = ease(clamp01(q / 0.5)), tail = ease(clamp01((q - 0.35) / 0.6));
        ctx.fillStyle = css(INK, 0.9); crescent(ctx, -R * 0.35, R * 0.8, R * 0.2, -1.1, 1.1, tail, head);
        ctx.fillStyle = css(VERMILION, 0.9); crescent(ctx, -R * 0.35, R * 0.8 - R * 0.06, R * 0.06, -1.1, 1.1, Math.max(tail, 0.1), Math.min(head, 0.9));
        ctx.restore();
      }
      break;
    }
  }
  ctx.restore();
}

/** 広がる輪（声や音）。少しずつ遅れて3つ出る */
export function drawRing(ctx: CanvasRenderingContext2D, f: Extract<FxExtra, { kind: 'ring' }>, p: number): void {
  ctx.save();
  for (let k = 0; k < 3; k++) {
    const q = clamp01(p * 1.25 - k * 0.14);
    if (q <= 0 || q >= 1) continue;
    ctx.strokeStyle = css(f.color, 0.75 * (1 - q)); ctx.lineWidth = 3.2 - k * 0.7;
    // 筆のかすれ：輪を3つの弧に分けて、少しすき間を空ける
    for (let j = 0; j < 3; j++) { const a = j * 2.094 + k * 0.7; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * ease(q), a, a + 1.8); ctx.stroke(); }
  }
  ctx.restore();
}

/**
 * ダメージの表示。マスを六角形に色づけ、その中に大きく数字を出す。
 * slot が 0 以上のとき（同じマスに次の表示が来たあと）は、マスの上に小さく積む。
 */
export function drawHexNote(
  ctx: CanvasRenderingContext2D, x: number, y: number, R: number, note: { text: string; color: RGB; big: boolean; label?: string }, p: number, slot: number,
): void {
  const a = p < 0.06 ? p / 0.06 : p > 0.76 ? Math.max(0, (1 - p) / 0.24) : 1;
  const dark: RGB = [note.color[0] * 0.3, note.color[1] * 0.3, note.color[2] * 0.3];
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  if (slot >= 0) {
    // 小さく積む：色の字に、紙の色のふち
    const text = note.label ? `${note.label} ${note.text}` : note.text;
    ctx.font = `700 ${R * 0.4}px ${MINCHO}`;
    ctx.globalAlpha = a;
    const ty = y - R * 1.02 - slot * R * 0.44;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(250,246,234,0.95)'; ctx.strokeText(text, x, ty);
    ctx.fillStyle = css(note.color); ctx.fillText(text, x, ty);
    ctx.restore();
    return;
  }
  // 出た瞬間に少しふくらむ（会心は大きく）
  const pop = 1 + (note.big ? 0.3 : 0.1) * Math.max(0, 1 - p * 8);
  const r = (R - 2.5) * pop;
  hexPath(ctx, x, y, r);
  // 下の駒が透けて見えるくらいの濃さ（会心は濃く）
  ctx.fillStyle = css(note.color, (note.big ? 0.7 : 0.5) * a); ctx.fill();
  ctx.strokeStyle = css(dark, 0.9 * a); ctx.lineWidth = note.big ? 3.6 : 2.6; ctx.stroke();
  hexPath(ctx, x, y, r - 4);
  ctx.strokeStyle = css(note.big ? PALE : [250, 246, 234], (note.big ? 0.95 : 0.5) * a); ctx.lineWidth = note.big ? 2 : 1; ctx.stroke();
  ctx.globalAlpha = a;
  // 字の大きさ：マスに収まるよう、字数（かな・漢字は2字ぶん）で決める
  let units = 0;
  for (const ch of note.text) units += ch.charCodeAt(0) > 0xff ? 2 : 1;
  const size = R * Math.min(0.86, 2.6 / Math.max(1, units)) * (note.big ? 1.08 : 1) * pop;
  let ty = y + 1;
  if (note.label) {
    ctx.font = `700 ${R * 0.34}px ${MINCHO}`;
    ctx.lineWidth = 3; ctx.strokeStyle = css(dark, 0.95); ctx.strokeText(note.label, x, y - R * 0.46);
    ctx.fillStyle = css(PALE); ctx.fillText(note.label, x, y - R * 0.46);
    ty = y + R * 0.14;
  }
  ctx.font = `700 ${size}px ${MINCHO}`;
  ctx.lineWidth = 4.5; ctx.strokeStyle = css(dark, 0.95); ctx.strokeText(note.text, x, ty);
  ctx.fillStyle = 'rgb(253,249,238)'; ctx.fillText(note.text, x, ty);
  ctx.restore();
}
