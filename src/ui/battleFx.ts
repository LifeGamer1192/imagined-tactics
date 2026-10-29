// 戦闘の演出を組み立てる。
// ゲームの状態（st）は apply で先に確定させ、ここでは「行動の前の写し」と「増えた記録」から、見せ方（駒の動き・揺れ・数字・音）だけを作る。
// だから演出の途中でクリックされても、状態は壊れない。
// 攻撃のエフェクト（斬撃・飛び道具・炎など）の種類は fxTable.ts の表で決め、描くのは render/fxDraw.ts。

import type { Action, BUnit, BattleState, StrikeDetail, TacticDetail } from '../battle/types';
import { D } from '../data/db';
import type { StatusId } from '../data/types';
import { HEX, type Fx } from '../render/battleView';
import { INDIGO, OCHRE, VERDIGRIS, VERMILION, type RGB } from '../render/ink';
import { reach, routeTo } from '../rules/move';
import { moveOf, skillOf } from '../rules/stats';
import { isProjectile, skillFx, tacticFx, type StrikeFx, type TacticFx } from './fxTable';
import type { SoundId } from './sound';
import { STATUS_NAME } from './text';

/** 行動の前の写し */
export interface Before {
  units: BUnit[];
  logLen: number;
  /** 動いた駒の道のり（出発点を含むマスの並び） */
  paths: Map<number, number[]>;
}

export interface Cues {
  fx: Fx[];
  sounds: { id: SoundId; at: number }[];
  /** 次の手を待たせる長さ（ミリ秒）。ダメージの表示や煙の残りは、少し先まで出ていてよい */
  dur: number;
}

/** 演出の長さ（ミリ秒。速さの倍率を掛ける前） */
const T = {
  step: 85, slideMax: 420,        // 移動：1マスあたり、上限
  lunge: 200, impact: 110,        // 踏み込みの長さ、当たるまで
  strike: 320,                    // 斬撃・突き・打撃のエフェクト
  shake: 240,                     // 揺れ
  note: 1150, noteHold: 0.5,      // ダメージの表示が出ている時間、そのうち次の手を待たせる割合
  noteLead: 150,                  // 当たってから、ダメージの表示が出るまで
  chip: 900,                      // 付いた状態などの小さな字
  strikeGap: 270, volleyGap: 130, // 次の一撃まで、直線・周囲の技で次の相手まで
  splashGap: 80,                  // 範囲の軍略で次の相手まで
  flash: 520, flashLead: 200,     // 軍略の範囲の光、光ってから効くまで
  ring: 420, ringLead: 200,       // 声や音の輪、輪が届くまで
  muzzle: 150, smoke: 620, burst: 560, flame: 640, sign: 620, // 発射の光、煙、着弾の土煙、炎、軍略のしるし
  knock: 160,                     // 押し出される動き
  drain: 430,                     // 与えたダメージの一部を回復する技：当たってから、攻めた側の回復が出るまで（P94）
  fade: 450,                      // 倒れた駒が薄れる時間
};
/** 飛び道具が届くまで：[もとの長さ, 1マスごとに足す長さ] */
const FLIGHT: Record<string, [number, number]> = {
  arrow: [150, 50], javelin: [140, 45], dart: [110, 28], bullet: [60, 14], cannon: [230, 60], stone: [240, 60], fire: [200, 55],
};
const GREY: RGB = [96, 90, 82], PURPLE: RGB = [122, 84, 132];
/** 軍略のエフェクトの色：攻撃は朱、水と打ち消しは藍、回復は緑青、補助は黄土、妨害は紫 */
const TACTIC_COLOR: Record<TacticFx, RGB> = {
  fire: VERMILION, arrow: VERMILION, stone: VERMILION, raid: VERMILION, water: INDIGO, dispel: INDIGO,
  heal: VERDIGRIS, buff: OCHRE, debuff: PURPLE, shout: PURPLE,
};
/** 付くと得になる状態（小さな字の色を分ける） */
const GOOD = new Set<StatusId>(['atkNext', 'moveUp', 'resistUp', 'defUp', 'atkUp', 'agiUp', 'mounted', 'regen', 'ward', 'sureNext', 'extraAct', 'routed', 'loaded']);

export function before(st: BattleState): Before {
  return { units: st.units.map((u) => ({ ...u, statuses: [...u.statuses] })), logLen: st.log.length, paths: new Map() };
}

/** 移動の行動を実行する前に呼ぶ：通る道のりを覚える */
export function notePath(st: BattleState, b: Before, a: Action): void {
  if (a.type !== 'move') return;
  const u = st.units[a.unit];
  if (!u || !u.alive) return;
  const r = reach(st, u, moveOf(u) - u.moveSpent);
  if (a.to === u.pos || !r.cells.includes(a.to)) return;
  b.paths.set(u.id, [...(b.paths.get(u.id) ?? [u.pos]), ...routeTo(r, a.to)]);
}

/**
 * 行動のあとに呼ぶ：演出と音の並びを作る。scale は速さの倍率（1 = ふつう、0 = 演出なし）。
 * now は performance.now()。
 */
export function cues(st: BattleState, b: Before, scale: number, now: number): Cues {
  const out: Cues = { fx: [], sounds: [], dur: 0 };
  const entries = st.log.slice(b.logLen);
  if (scale <= 0) return out;
  const g = st.map.grid;
  const xy = (cell: number) => g.center(cell, HEX);
  const num = (v: string | number | undefined) => (typeof v === 'number' ? v : -1);
  /** 演出の上での駒の位置：動いたなら着いた先、そうでなければ行動の前の位置 */
  const placed = new Map<number, number>();   // 収容されて戦場に戻った兵の、新しい位置
  const posOf = (id: number): number => { const p = b.paths.get(id); return p ? p[p.length - 1] : placed.get(id) ?? b.units[id]?.pos ?? -1; };
  const at = (ms: number) => now + ms * scale;
  /** hold は、次の手を待たせる長さ（省くと、終わるまで） */
  const push = (f: Fx, hold = f.dur) => { out.fx.push(f); out.dur = Math.max(out.dur, f.t0 + hold - now); };
  const sound = (id: SoundId, ms: number) => out.sounds.push({ id, at: ms * scale });
  /** 残って見えるもの（表示・煙）は、速くしても半分までしか縮めない */
  const linger = (ms: number) => ms * Math.max(0.5, scale);
  let seed = 0;

  let t = 0;
  // 移動
  for (const [id, path] of b.paths) {
    if (path.length < 2) continue;
    const dur = Math.min(T.slideMax, T.step * (path.length - 1));
    push({ kind: 'slide', unit: id, pts: path.map(xy), t0: at(t), dur: dur * scale });
    sound('move', t);
    t += dur;
  }
  // 体力：当たる瞬間までは、当たる前の値を見せる
  const shownHp = new Map<number, number>(), hpFrom = new Map<number, number>();
  const hurt = (id: number, dmg: number, when: number) => {
    const cur = shownHp.get(id) ?? b.units[id].hp, from = hpFrom.get(id) ?? 0;
    push({ kind: 'hp', unit: id, hp: cur, t0: at(from), dur: Math.max(1, (when - from) * scale) });
    shownHp.set(id, Math.max(0, cur - dmg)); hpFrom.set(id, when);
  };
  /** ダメージの表示：マスを六角形に色づけて、中に数字（label は上に添える字） */
  const note = (cell: number, text: string, color: RGB, big: boolean, when: number, label?: string) => {
    if (cell < 0) return;
    const [x, y] = xy(cell);
    const dur = linger(T.note);
    // 当たった瞬間のエフェクト（斬撃・炎など）が見えるよう、少し遅れて出す
    push({ kind: 'text', x, y, text, color, big, cell, label, t0: at(when + T.noteLead), dur }, dur * T.noteHold);
  };
  /** マスの上に小さく出る字（付いた状態、退く、など） */
  const chip = (cell: number, text: string, color: RGB, when: number) => {
    if (cell < 0) return;
    const [x, y] = xy(cell);
    const dur = linger(T.chip);
    push({ kind: 'text', x, y, text, color, big: false, cell, chip: true, t0: at(when), dur }, dur * T.noteHold);
  };
  /** その場に出て消えるエフェクト。次の手は待たせすぎない */
  const puff = (style: Extract<Fx, { kind: 'puff' }>['style'], x: number, y: number, when: number, ms: number, ang?: number) => {
    const dur = linger(ms);
    push({ kind: 'puff', x, y, style, ang, seed: ++seed, t0: at(when), dur }, dur * 0.5);
  };

  /** いま演出している行動と1撃（記録の act・strike から） */
  let multi = false;                       // 直線・周囲の技か
  const lunged = new Set<number>();        // この行動で、もう踏み込んだ駒
  let shoutAt: number | null = null;       // 声の輪が届く時刻（1つの行動で1度だけ出す）
  let cur: { fx: StrikeFx; d: StrikeDetail | null } | null = null;
  /** 軍略：色・種類・使った駒、いまの相手に効く時刻 */
  let tac: { fx: TacticFx; color: RGB; uid: number; single: boolean; damage: boolean } | null = null;
  let tacAt: number | null = null;
  /** 石の落ちる時刻（0.12.0。続く blast の記録は、この時刻に当たる） */
  let blastAt: number | null = null;

  /**
   * 攻める動きとエフェクト。戻り値は、当たる瞬間。
   * miss のときは、近接なら相手のわきの空を切り、飛び道具なら相手の向こうへそれる。
   */
  const attack = (uid: number, tid: number, fx: StrikeFx, crit: boolean, miss: boolean): number => {
    const a = posOf(uid), c = posOf(tid);
    if (a < 0 || c < 0) return t;
    const [ax, ay] = xy(a), [cx, cy] = xy(c);
    const len = Math.hypot(cx - ax, cy - ay) || 1, ux = (cx - ax) / len, uy = (cy - ay) / len;
    const ang = Math.atan2(uy, ux);
    const first = !(multi && lunged.has(uid));
    lunged.add(uid);
    if (isProjectile(fx)) {
      const dist = Math.max(1, g.distance(a, c));
      const flight = FLIGHT[fx][0] + FLIGHT[fx][1] * dist;
      // 撃つ駒は、少しのけぞる
      if (first) push({ kind: 'lunge', unit: uid, dx: -ux * HEX * 0.14, dy: -uy * HEX * 0.14, t0: at(t), dur: T.lunge * scale });
      const from: [number, number] = [ax + ux * HEX * 0.5, ay + uy * HEX * 0.5];
      const side = seed % 2 ? 1 : -1;
      const to: [number, number] = miss ? [cx + ux * HEX * 0.55 - uy * side * HEX * 0.62, cy + uy * HEX * 0.55 + ux * side * HEX * 0.62] : [cx, cy];
      push({ kind: 'proj', from, to, style: fx as Extract<Fx, { kind: 'proj' }>['style'], seed: ++seed, t0: at(t), dur: flight * scale });
      sound(fx === 'arrow' ? 'bow' : fx === 'bullet' ? 'gun' : fx === 'cannon' ? 'cannon' : fx === 'fire' ? 'fire' : fx === 'dart' ? 'swing' : 'throw', t);
      if (fx === 'bullet' || fx === 'cannon') {
        // 発射の光と煙
        puff('flash', from[0], from[1], t, fx === 'cannon' ? T.muzzle * 1.4 : T.muzzle, ang);
        puff('smoke', from[0] + ux * HEX * 0.15, from[1] + uy * HEX * 0.15, t + 30, fx === 'cannon' ? T.smoke * 1.3 : T.smoke);
      }
      const hitAt = t + flight;
      // 着弾：玉は土煙、火は炎、弾は小さな衝撃。外れても、それた先に出る
      if (fx === 'cannon' || fx === 'stone') { puff('dust', to[0], to[1], hitAt, T.burst); sound('thud', hitAt); }
      else if (fx === 'fire') puff('flame', to[0], to[1], hitAt, T.flame);
      else if (fx === 'bullet' && !miss) push({ kind: 'slash', x: cx, y: cy, ang, style: 'blow', crit, miss: false, seed: ++seed, t0: at(hitAt), dur: T.strike * 0.7 * scale });
      return hitAt;
    }
    if (fx === 'shout') {
      // 声や音：使った駒から輪が広がる（直線・周囲の技でも1度だけ）
      if (shoutAt === null) {
        push({ kind: 'ring', x: ax, y: ay, r: Math.max(len, HEX * 1.7) + HEX * 0.4, color: [24, 22, 20], t0: at(t), dur: T.ring * scale });
        sound('shout', t);
        shoutAt = t + T.ringLead;
      }
      return Math.max(shoutAt, t);
    }
    if (fx === 'heal') {
      puff('heal', cx, cy, t, T.sign);
      sound('heal', t);
      return t + T.impact;
    }
    // 近接：踏み込んで、当たった所に斬撃・突き・打撃
    if (first) push({ kind: 'lunge', unit: uid, dx: ux * HEX * 0.4, dy: uy * HEX * 0.4, t0: at(t), dur: T.lunge * scale });
    const hitAt = t + T.impact;
    push({ kind: 'slash', x: cx, y: cy, ang, style: fx as 'slash' | 'thrust' | 'blow', crit, miss, seed: ++seed, t0: at(hitAt - 50), dur: T.strike * scale });
    sound('swing', hitAt - 60);
    return hitAt;
  };
  /** 1撃のあと、次の一撃までの間を空ける */
  const gap = (when: number) => { t = Math.max(t + (multi ? T.volleyGap : T.strikeGap), multi ? t : when + 110); };
  /** 記録に 1撃の内訳が無いとき（古い形の記録）のエフェクト：離れていれば矢、隣なら斬撃 */
  const fallback = (uid: number, tid: number): StrikeFx => (g.distance(posOf(uid), posOf(tid)) >= 2 ? 'arrow' : 'slash');
  /** いちばん最後に当たった瞬間（倒れた駒は、ここから薄れる） */
  let lastImpact = t;

  for (const e of entries) {
    const uid = num(e.vars.uid), tid = num(e.vars.tid);
    switch (e.key) {
      case 'act': {
        const skill = e.vars.kind === 'skill' ? skillOf(String(e.vars.id)) : null;
        multi = !!skill && skill.shape.type !== 'single';
        lunged.clear(); shoutAt = null; cur = null; tac = null; tacAt = null;
        break;
      }
      case 'strike': {
        const d = e.d?.type === 'strike' ? e.d : null;
        cur = { fx: skillFx(skillOf(String(e.vars.sk))), d };
        tacAt = null;
        // 反撃は、直線・周囲の技の続きではない
        if (d?.counter) multi = false;
        if (!d || uid < 0 || tid < 0) break;
        // ダメージの無い技（唄・蹂躙・薬湯）が当たったとき：hit の記録が出ないので、ここでエフェクトを出す
        if (d.landed && !d.dmg) {
          const when = attack(uid, tid, cur.fx, false, false);
          if (d.heal) note(posOf(tid), `+${d.heal[1] - d.heal[0]}`, VERDIGRIS, false, when);
          lastImpact = when; gap(when);
        }
        break;
      }
      case 'hit': case 'hit.crit': {
        if (uid < 0 || tid < 0) break;
        const crit = e.key === 'hit.crit', dmg = num(e.vars.dmg);
        const when = attack(uid, tid, cur?.fx ?? fallback(uid, tid), crit, false);
        const d = cur?.d;
        // 押し付け（0.10.0）：押す先が塞がっていて、ダメージが増えた。塞いでいるマスを光らせ、数字を大きく「押し付け×1.5」
        const wall = d?.knockWall;
        hurt(tid, dmg, when);
        push({ kind: 'shake', unit: tid, amp: crit || wall ? 8 : 4.5, t0: at(when), dur: T.shake * scale });
        if (wall && wall.cell >= 0) push({ kind: 'flash', cells: [wall.cell], color: VERMILION, t0: at(when), dur: 320 * scale });
        const shielded = !!d?.dmg?.shield?.ok;
        note(posOf(tid), String(dmg), VERMILION, crit || !!wall, when, crit ? '会心' : wall ? `押し付け×${wall.mult}` : shielded ? '盾で半減' : undefined);
        sound(crit || wall ? 'crit' : 'hit', when);
        // 盾で受けた（受け止め・飛び道具の盾。0.11.0）：マスを金に光らせ、「盾」の札と、受ける音
        if (shielded) {
          push({ kind: 'flash', cells: [posOf(tid)], color: OCHRE, t0: at(when - 40), dur: 360 * scale });
          chip(posOf(tid), '盾', OCHRE, when);
          sound('thud', when);
        }
        if (d?.unhorse) chip(posOf(tid), '落馬', VERMILION, when + 90);
        if (d?.mpHalf) chip(posOf(tid), '気力半減', PURPLE, when + 60);
        // 押し出し：当たるまでは、もとのマスにいる
        if (d?.knock) push({ kind: 'slide', unit: tid, pts: [xy(d.knock[0]), xy(d.knock[1])], t0: at(when), dur: T.knock * scale });
        // 与えたダメージの一部を回復する技（P94）：ダメージの表示のあとに、攻めた側の回復（光・緑の数字・体力の棒・音）
        let end = when;
        if (d?.steal && d.steal[1] > d.steal[0]) {
          const back = when + T.drain, gain = d.steal[1] - d.steal[0], [hx, hy] = xy(posOf(uid));
          puff('heal', hx, hy, back, T.sign);
          hurt(uid, -gain, back);
          note(posOf(uid), `+${gain}`, VERDIGRIS, false, back);
          sound('heal', back);
          end = back;
        }
        lastImpact = end; gap(end);
        break;
      }
      case 'bombard': {
        // 狙って石を落とす（0.12.0）：石が弧を描いて落ちたマスへ。落ちたマスと隣を光らせ、土煙。ずれたら狙ったマスに「ずれた」
        const a = posOf(uid), land = num(e.vars.land), aim = num(e.vars.cell);
        if (a < 0 || land < 0) break;
        const [ax, ay] = xy(a), [lx, ly] = xy(land);
        const ux = lx - ax, uy = ly - ay, len = Math.hypot(ux, uy) || 1;
        const flight = FLIGHT.stone[0] + FLIGHT.stone[1] * Math.max(1, g.distance(a, land));
        push({ kind: 'lunge', unit: uid, dx: -ux / len * HEX * 0.14, dy: -uy / len * HEX * 0.14, t0: at(t), dur: T.lunge * scale });
        push({ kind: 'proj', from: [ax + ux / len * HEX * 0.5, ay + uy / len * HEX * 0.5], to: [lx, ly], style: 'stone', seed: ++seed, t0: at(t), dur: flight * scale });
        sound('throw', t);
        const hitAt = t + flight;
        puff('dust', lx, ly, hitAt, T.burst * 1.3);
        sound('thud', hitAt);
        push({ kind: 'flash', cells: [land], color: VERMILION, t0: at(hitAt), dur: 380 * scale });
        push({ kind: 'flash', cells: g.neighbors(land), color: OCHRE, t0: at(hitAt + 40), dur: 340 * scale });
        if (num(e.vars.ok) !== 1 && aim >= 0) chip(aim, 'ずれた', GREY, hitAt - 80);
        blastAt = hitAt; lastImpact = hitAt;
        if (!entries.some((x) => x.key === 'blast')) gap(hitAt);
        break;
      }
      case 'blast': {
        if (tid < 0) break;
        const when = blastAt ?? t, dmg = num(e.vars.dmg), center = num(e.vars.center) === 1, crit = num(e.vars.crit) === 1;
        hurt(tid, dmg, when);
        push({ kind: 'shake', unit: tid, amp: center ? 7 : 4, t0: at(when), dur: T.shake * scale });
        note(posOf(tid), String(dmg), VERMILION, center || crit, when, crit ? '会心' : center ? undefined : `巻き込み${num(e.vars.pct)}%`);
        if (num(e.vars.shield)) chip(posOf(tid), '盾', OCHRE, when);
        lastImpact = when;
        break;
      }
      case 'collide': {
        // 押されて後ろの駒にぶつかった（0.10.0）：押された駒が後ろへ寄って戻り、後ろの駒にダメージ
        const pushed = uid, other = tid, dmg = num(e.vars.dmg);
        if (pushed < 0 || other < 0) break;
        const when = lastImpact + 140, a0 = xy(posOf(pushed)), b0 = xy(posOf(other));
        const mid: [number, number] = [a0[0] + (b0[0] - a0[0]) * 0.35, a0[1] + (b0[1] - a0[1]) * 0.35];
        push({ kind: 'slide', unit: pushed, pts: [a0, mid, a0], t0: at(when - 80), dur: T.knock * 1.6 * scale });
        hurt(other, dmg, when);
        push({ kind: 'shake', unit: other, amp: 6, t0: at(when), dur: T.shake * scale });
        note(posOf(other), String(dmg), VERMILION, false, when, 'ぶつかった');
        sound('thud', when);
        lastImpact = when; gap(when);
        break;
      }
      case 'breach': {
        // 造りを打つ：マスが光り、ダメージの数字と打つ音
        const cell = num(e.vars.cell);
        if (cell < 0) break;
        // 投石の巻き込み（0.13.0）は、石の落ちる時刻に
        if (blastAt !== null) {
          note(cell, String(num(e.vars.dmg)), OCHRE, false, blastAt, num(e.vars.pct) > 0 ? `巻き込み${num(e.vars.pct)}%` : undefined);
          lastImpact = Math.max(lastImpact, blastAt);
          break;
        }
        push({ kind: 'flash', cells: [cell], color: OCHRE, t0: at(t), dur: 320 * scale });
        note(cell, String(num(e.vars.dmg)), OCHRE, false, t);
        sound('hit', t);
        lastImpact = t; t += T.strikeGap;
        break;
      }
      case 'broken': {
        const cell = num(e.vars.cell);
        if (cell >= 0) { const when = Math.max(t, blastAt ?? 0); chip(cell, '打ち破った', VERMILION, when); sound('defeat', when); }
        break;
      }
      case 'miss': {
        if (uid < 0 || tid < 0) break;
        const when = attack(uid, tid, cur?.fx ?? fallback(uid, tid), false, true);
        note(posOf(tid), '外れ', GREY, false, when);
        sound('miss', when);
        lastImpact = when; gap(when);
        break;
      }
      case 'tactic': {
        const def = D.byTactic[String(e.vars.tac)];
        const cell = num(e.vars.cell);
        tac = null; tacAt = null; cur = null;
        if (def && cell >= 0 && uid >= 0) {
          const fx = tacticFx(def), color = fx === 'shout' && def.kind === 'damage' ? VERMILION : TACTIC_COLOR[fx];
          tac = { fx, color, uid, single: def.area === 0, damage: def.kind === 'damage' };
          // 範囲のある軍略は範囲を、単体なら相手のマスを、種類の色で光らせる
          const cells = def.area > 0 ? g.range(def.range ? cell : posOf(uid), def.area) : [cell];
          push({ kind: 'flash', cells, color, t0: at(t), dur: T.flash * scale });
          // 使った駒から、同じ色の輪が広がる
          const [ux, uy] = xy(posOf(uid));
          push({ kind: 'ring', x: ux, y: uy, r: fx === 'shout' ? HEX * 1.7 * Math.max(1, def.area) : HEX * 0.95, color, t0: at(t), dur: T.ring * scale });
          if (fx === 'shout') sound('shout', t);
          else if (fx === 'buff') sound('buff', t + 60);
          else if (fx === 'debuff' || fx === 'dispel') sound('debuff', t + 60);
        }
        sound('tactic', t);
        t += T.flashLead; lastImpact = t;
        break;
      }
      case 'tactic.on': {
        const d = e.d?.type === 'tactic' ? (e.d as TacticDetail) : null;
        if (d?.kind === 'revive' && d.moved) placed.set(tid, d.moved[1]);
        const cell = posOf(tid);
        tacAt = t;
        if (!tac || !d || cell < 0) { t += T.splashGap; break; }
        const [cx, cy] = xy(cell);
        if (d.ward) { note(cell, '無効', GREY, false, t); t += T.splashGap; break; }
        let when = t;
        switch (tac.fx) {
          case 'fire': case 'arrow': {
            // 単体なら、使った駒から火矢・矢が飛ぶ。範囲なら、その場に炎が上がる
            if (tac.single) {
              const from = xy(posOf(tac.uid)), dist = Math.max(1, g.distance(posOf(tac.uid), cell));
              const style = tac.fx === 'fire' ? 'fire' : 'arrow', flight = FLIGHT[style][0] + FLIGHT[style][1] * dist;
              push({ kind: 'proj', from, to: [cx, cy], style, seed: ++seed, t0: at(t), dur: flight * scale });
              sound(style === 'fire' ? 'fire' : 'bow', t);
              when = t + flight;
            } else sound('fire', t);
            if (tac.fx === 'fire') puff('flame', cx, cy, when, T.flame);
            break;
          }
          case 'stone': {
            // 落石：上から岩が落ちてきて、土煙が上がる
            const flight = FLIGHT.stone[0];
            push({ kind: 'proj', from: [cx - HEX * 0.6, cy - HEX * 2.6], to: [cx, cy], style: 'stone', seed: ++seed, t0: at(t), dur: flight * scale });
            when = t + flight;
            puff('dust', cx, cy, when, T.burst); sound('thud', when);
            break;
          }
          case 'water': puff('splash', cx, cy, t, T.flame); sound('splash', t); break;
          case 'raid': puff('raid', cx, cy, t, T.sign); sound('swing', t); when = t + 90; break;
          case 'heal': puff('heal', cx, cy, t, T.sign); if (!d.heal) sound('heal', t); break;
          case 'buff': puff('buff', cx, cy, t, T.sign); break;
          case 'dispel': puff('dispel', cx, cy, t, T.sign); break;
          default: if (!tac.damage) puff('debuff', cx, cy, t, T.sign); break;
        }
        // 呼び戻し・誘引で動かされる駒：効くまでは、もとのマスにいる
        if (d.moved && d.moved[0] >= 0) push({ kind: 'slide', unit: tid, pts: [xy(d.moved[0]), xy(d.moved[1])], t0: at(when), dur: T.slideMax * 0.7 * scale });
        if (d.mp && d.mp[1] > d.mp[0]) chip(cell, `気力+${d.mp[1] - d.mp[0]}`, INDIGO, when);
        tacAt = when; lastImpact = Math.max(lastImpact, when);
        t += T.splashGap;
        break;
      }
      case 'tactic.hit': case 'poison': {
        if (tid < 0) break;
        const when = e.key === 'poison' ? t : tacAt ?? t;
        const dmg = num(e.vars.dmg);
        hurt(tid, dmg, when);
        push({ kind: 'shake', unit: tid, amp: 4.5, t0: at(when), dur: T.shake * scale });
        note(posOf(tid), String(dmg), e.key === 'poison' ? PURPLE : VERMILION, false, when);
        sound('hit', when);
        lastImpact = Math.max(lastImpact, when);
        if (e.key === 'poison' || tacAt === null) t += T.splashGap;
        break;
      }
      case 'heal': {
        if (tid < 0) break;
        const when = tacAt ?? t;
        note(posOf(tid), `+${num(e.vars.hp)}`, VERDIGRIS, false, when);
        sound('heal', when);
        if (tacAt === null) t += T.splashGap;
        break;
      }
      case 'resist':
        if (tid >= 0) { note(posOf(tid), '効かない', GREY, false, tacAt ?? t); if (tacAt === null) t += T.splashGap; }
        break;
      case 'status.add': {
        // 付いた状態を、マスの上に小さく出す
        const sid = num(e.vars.sid), id = e.vars.status as StatusId;
        if (sid >= 0 && STATUS_NAME[id]) chip(posOf(sid), STATUS_NAME[id], GOOD.has(id) ? OCHRE : PURPLE, Math.max(lastImpact, tacAt ?? 0) + 80);
        break;
      }
      case 'defeat': case 'retreat': case 'lost': {
        if (uid < 0 || !b.units[uid] || !b.units[uid].alive) break;
        const u = { ...b.units[uid], pos: posOf(uid) };
        push({ kind: 'ghost', u, t0: at(lastImpact), dur: T.fade * Math.max(0.5, scale) });
        if (e.key === 'defeat') sound('defeat', lastImpact + 40);
        else chip(u.pos, '退く', OCHRE, lastImpact);
        break;
      }
    }
  }
  return out;
}
