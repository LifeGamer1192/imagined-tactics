// 戦闘の思考。
// 移動できるマス × 使える技・軍略の組み合わせを、複数の軸で採点して最も良いものを選ぶ。
//   攻める価値：与ダメージ、撃破、狙う相手（武将・軍略役・弱った相手・主君を脅かす相手）
//   危険：反撃、次の敵ターンに受ける危険（脅威）、倒される危険
//   位置：地形、采配範囲、部隊のまとまり、主君の護衛、役割に合った間合い
//   支援：回復、補助、妨害、状態異常、気力の節約
// 各軸の重みは武将の性格（personality.ts）で変わる。兵は率いる武将の性格で動く。
// さらに部隊ごとに「構え」（前進・交戦・守備・退却）を決め、位置の採点を切り替える。
// 狙いの優先をデータで持つ考え方は rts-mons/web/src/rules.js の chooseTarget にならう。

import { apply, canAct, canMove, endTurn } from '../battle/engine';
import type { Action, BUnit, BattleState } from '../battle/types';
import { D } from '../data/db';
import type { SkillDef, TacticDef } from '../data/types';
import {
  canCounter, canUseSkill, canUseTactic, healAmount, hitChance, skillDamage, skillTargetCells, skillVictims,
  tacticDamage, tacticSuccess, tacticTargetCells, tacticVictims, breachParts, breachTargets,
} from '../rules/combat';
import { MinHeap } from '../core/heap';
import { RNG, codeToSeed } from '../core/rng';
import { reach, stepCost } from '../rules/move';
import { attackPower, basicSkill, disabled, has, moveOf, outOfCommand, skillOf, skillRange, terrainMod } from '../rules/stats';
import { AI, NEUTRAL, weightsFor, type Personality, type SmartConfig } from './personality';

export type Stance = 'advance' | 'engage' | 'hold' | 'retreat';
export type Role = 'front' | 'ranged' | 'caster' | 'support';

/** 採点の内訳（調整と確認のため） */
export interface ScoreParts {
  attack: number; support: number; counter: number; threat: number; terrain: number;
  cohesion: number; stance: number; spacing: number; noise: number;
}
export interface UnitPlan {
  /** 動かずに何もしないときの点（よい順に動くとき、行動で増える点を比べる） */
  stay?: number;
  actions: Action[];
  stance: Stance;
  role: Role;
  score: number;
  parts: ScoreParts;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- 性格・役割・構え

/** ユニットを動かす性格：率いる武将のもの（武将が倒れていれば標準） */
export function personaOf(st: BattleState, u: BUnit): Personality {
  const l = st.units[u.leader];
  return (l && l.alive ? l.persona : u.persona) ?? NEUTRAL;
}

/** ユニットの役割：回復役・軍略役・射撃・前衛 */
export function roleOf(u: BUnit): Role {
  const tacs = u.tactics.map((id) => D.byTactic[id]);
  if (tacs.some((t) => t.kind === 'heal') && u.maxMp > 0) return 'support';
  if (tacs.some((t) => t.kind === 'damage') && u.int >= u.str) return 'caster';
  const b = basicSkill(u);
  if (b && b.range[1] >= 2) return 'ranged';
  return 'front';
}

/** 部隊の強さの目安：体力 × 攻撃力 */
function power(st: BattleState, us: BUnit[]): number {
  return us.reduce((s, u) => s + u.hp * attackPower(st, u) / 100, 0);
}

function nearestDist(st: BattleState, from: number, us: BUnit[]): number {
  let d = Infinity;
  for (const u of us) d = Math.min(d, st.map.grid.distance(from, u.pos));
  return d;
}

/** 部隊（率いる武将とその兵）の構え */
/** 戦闘の難しさの設定（自分と戦う相手の陣営の駒だけ。ほかは undefined＝ふつう） */
function levelOf(st: BattleState, u: BUnit) {
  return st.aiLevel && st.aiLevel.side === u.side ? AI.levels[st.aiLevel.level] : undefined;
}

export function stanceOf(st: BattleState, u: BUnit): Stance {
  const s = baseStance(st, u);
  // 先読み（むずかしい）で選んだ方針が構えを決めていれば、それに従う（退却はそのまま）
  const forced = s !== 'retreat' ? policyStance(st, u) : undefined;
  return forced ?? s;
}

function baseStance(st: BattleState, u: BUnit): Stance {
  const leader = st.units[u.leader];
  const lv = levelOf(st, u);
  const S = { ...AI.stance, ...(lv?.sallyAggression !== undefined ? { sallyAggression: lv.sallyAggression } : {}), ...(lv?.sallyStrengthRatio !== undefined ? { sallyStrengthRatio: lv.sallyStrengthRatio } : {}), ...(lv?.retreatHp !== undefined ? { retreatHp: lv.retreatHp } : {}), ...(lv?.engageDistance !== undefined ? { engageDistance: lv.engageDistance } : {}) };
  const foes = st.units.filter((x) => x.alive && x.side !== u.side);
  if (!foes.length || !leader || !leader.alive || leader.side !== u.side) return 'engage';
  const p = leader.persona ?? NEUTRAL;
  const near = nearestDist(st, leader.pos, foes);
  // 退却：武将の体力が少ない。慎重な武将ほど早く、猛攻の武将ほど粘る
  const thr = clamp(S.retreatHp + p.caution * S.retreatHpCaution + p.aggression * S.retreatHpAggression, 0.05, 0.6);
  if (leader.hp < leader.maxHp * thr && near <= 4) return 'retreat';
  if (near <= S.engageDistance) return 'engage';
  if (leader.home === 0) return 'advance';
  // 守り手：時間切れなら勝ちなので、基本は守る。猛攻の武将と、戦力が大きく上回るときは打って出る
  const mine = power(st, st.units.filter((x) => x.alive && x.side === u.side));
  const theirs = power(st, foes);
  if (p.aggression >= S.sallyAggression || mine >= theirs * S.sallyStrengthRatio) return 'advance';
  return 'hold';
}

/** 攻め手の急ぎ具合（0〜1）。時間切れが近いほど大きい */
function urgency(st: BattleState, u: BUnit): number {
  if (u.home !== 0) return 0;
  const t = st.round / st.maxRounds;
  return t <= AI.stance.urgentFrom ? 0 : clamp((t - AI.stance.urgentFrom) / (1 - AI.stance.urgentFrom), 0, 1);
}

// ---------------------------------------------------------------- 脅威

/** cells：道のりを読むときだけ。攻撃が実際に届くマス */
interface Threat { u: BUnit; radius: number; expected: number; tm0: number; cells?: Uint8Array }

/** 敵それぞれについて、届く範囲と、このユニットに与えるダメージの期待値を先に出しておく */
function threatsTo(st: BattleState, u: BUnit, exact = false): Threat[] {
  const out: Threat[] = [];
  for (const e of st.units) {
    if (!e.alive || e.side === u.side || disabled(e)) continue;
    let best = 0, range = 1;
    for (const id of e.skills) {
      const s = skillOf(id);
      if (s.noDamage || e.mp < s.mp) continue;
      const v = skillDamage(st, e, s, u) * hitChance(st, e, s, u) / 100;
      const r = s.shape.type === 'single' ? skillRange(st, e, s)[1] : s.shape.type === 'line' ? s.shape.n : s.shape.n;
      if (v > best) { best = v; range = r; }
    }
    for (const id of e.tactics) {
      const t = D.byTactic[id];
      if (t.kind !== 'damage' || e.mp < t.mp) continue;
      const v = tacticDamage(st, e, t, u);
      if (v > best) { best = v; range = (t.range ?? 0) + t.area; }
    }
    if (best > 0) out.push({ u: e, radius: moveOf(e) + range, expected: best, tm0: terrainMod(st, u), cells: exact ? strikeCells(st, e, range) : undefined });
  }
  return out;
}

/** 道のりを読む：敵ごとの「次の番に攻撃が届くマス」。その番のあいだは敵が動かないので、戦い・番・敵・位置・射程ごとに1度だけ計算する */
const strikeCache = new WeakMap<BattleState, Map<string, Uint8Array>>();
function strikeCells(st: BattleState, e: BUnit, range: number): Uint8Array {
  let m = strikeCache.get(st);
  if (!m) { m = new Map(); strikeCache.set(st, m); }
  const key = `${st.round}:${st.turn}:${e.id}:${e.pos}:${range}`;
  let out = m.get(key);
  if (out) return out;
  const g = st.map.grid, from = reach(st, e, moveOf(e)).cells;
  out = new Uint8Array(g.n);
  for (let i = 0; i < g.n; i++) {
    if (st.map.terrain[i] === 'void') continue;
    for (const f of from) if (g.distance(f, i) <= range) { out[i] = 1; break; }
  }
  m.set(key, out);
  return out;
}

/** いまの位置（u.pos）で、次の敵ターンに受けそうなダメージ */
function exposure(st: BattleState, u: BUnit, threats: Threat[], margin = 0): number {
  const g = st.map.grid;
  const tm = terrainMod(st, u);
  let sum = 0;
  for (const t of threats) {
    if (!t.u.alive) continue;
    // margin：味方の後ろにいるユニットは、届くぎりぎりの敵までは数えない（前衛が止めてくれる見込み）
    if (g.distance(t.u.pos, u.pos) > Math.max(1, t.radius - margin)) continue;
    // 道のりを読む（むずかしい）：城壁・川・山・味方の壁で、実際には届かないマスは数えない
    if (t.cells && !t.cells[u.pos]) continue;
    // 地形で回避が変わるぶんを、ざっくり反映する（回避+10 なら1割減る、という見積もり）
    sum += t.expected * clamp(1 - (tm - t.tm0) / 100, 0.3, 1.5);
  }
  return sum;
}

// ---------------------------------------------------------------- 攻める価値

/** 集中攻撃：相手ごとの、まだ動いていない味方の攻めの見込み（1駒の行動を決めるあいだだけ使う） */
let focusCache = new Map<number, number>();

function valueOfHit(st: BattleState, u: BUnit, t: BUnit, dmg: number, chance: number, w: Record<string, number>, leader: BUnit | null): number {
  const d = Math.min(dmg, t.hp);
  let v = d * chance * w.damage;
  // 倒せるなら大きく加点。攻撃力の高い相手ほど、倒す価値が高い（その相手の次の行動が無くなる）
  if (dmg >= t.hp) v += w.kill * (1 + attackPower(st, t) / 100) * chance;
  // 弱った相手ほど狙う
  v += w.weakTarget * (1 - t.hp / t.maxHp) * chance;
  // 集中攻撃（むずかしい）：この一撃で倒せなくても、まだ動いていない味方の攻めと合わせて倒せるなら、倒す価値の一部を見込む
  if (w.focus && dmg < t.hp && t.side !== u.side) {
    let rest = focusCache.get(t.id);
    if (rest === undefined) {
      rest = threatsTo(st, t).filter((x) => x.u.id !== u.id && !x.u.acted && st.map.grid.distance(x.u.pos, t.pos) <= x.radius).reduce((s, x) => s + x.expected, 0);
      focusCache.set(t.id, rest);
    }
    if (d * chance + rest >= t.hp) v += w.focus * w.kill * (1 + attackPower(st, t) / 100) * chance * Math.min(1, d / t.hp * 2);
  }
  if (t.kind === 'general') {
    v *= w.generalTarget;
    // 将を狙い撃つ（むずかしい）：将を倒すと配下の兵がみな退く。その兵を倒したのと同じだけの価値を、倒せるなら全部、削るだけなら削った割合の一部を足す
    if (w.leaderKill) {
      let worth = 0;
      for (const f of st.units) if (f.alive && f.leader === t.id && f.id !== t.id) worth += f.hp * w.damage + w.kill * (1 + attackPower(st, f) / 100);
      v += w.leaderKill * worth * chance * (dmg >= t.hp ? 1 : 0.25 * d / t.hp);
    }
  } else if (roleOf(t) === 'support' || roleOf(t) === 'caster') v *= w.supportTarget;
  // 主君のそばにいる敵を優先して叩く
  if (leader && leader.alive && leader.id !== u.id && st.map.grid.distance(t.pos, leader.pos) <= 1) v += w.guardLeader * chance;
  return v;
}

function scoreSkill(st: BattleState, u: BUnit, skill: SkillDef, target: number, w: Record<string, number>, leader: BUnit | null): { value: number; counter: number } {
  let value = 0, counter = 0;
  const single = skill.shape.type === 'single';
  for (const t of skillVictims(st, u, skill, target)) {
    const chance = hitChance(st, u, skill, t) / 100;
    const hostile = t.side !== u.side;
    if (skill.effects.some((e) => e.type === 'heal')) { value += (hostile ? -1 : 1) * Math.min(skill.power, t.maxHp - t.hp) * w.heal; continue; }
    let v = skill.noDamage ? 0 : valueOfHit(st, u, t, skillDamage(st, u, skill, t), chance, w, leader);
    for (const e of skill.effects) {
      if (e.type === 'status' && !has(t, e.status)) v += w.status * (e.chance / 100) * chance * (t.kind === 'general' && e.status === 'defect' ? 0 : 1);
      if (e.type === 'weakenStun') v += w.status * (e.chance / 100) * chance;
      if (e.type === 'mpHalf' && t.tactics.length) v += t.mp / 6;
    }
    value += hostile ? v : -v * w.friendlyFire;
    if (single && hostile) {
      const basic = basicSkill(t);
      if (canCounter(st, u, skill, t, basic)) {
        const dmg = skillDamage(st, t, basic!, u, true) * hitChance(st, t, basic!, u) / 100;
        // 倒しきれるなら反撃は来ない（当たる確率ぶんだけ減らす）
        const survive = skillDamage(st, u, skill, t) >= t.hp ? 1 - chance : 1;
        counter += Math.min(u.hp, dmg) * survive;
        if (dmg * survive >= u.hp) counter += w.deathRisk / w.counter;
      }
    }
  }
  return { value: value - skill.mp * w.mp, counter: counter * w.counter };
}

/**
 * 敵とぶつかるまでの巡の見込み（0 = この巡のうちに届く）。近い敵ごとに、どちらかの届く範囲（移動＋射程）に入るまでの距離を、
 * 近づく速さ（自分の移動＋相手の移動の半分。守り手は待つことが多いため）で割る
 */
function contactIn(st: BattleState, t: BUnit): number {
  const g = st.map.grid;
  let best = Infinity;
  for (const f of st.units) {
    if (!f.alive || f.side === t.side) continue;
    const reachT = moveOf(t) + (basicSkill(t)?.range[1] ?? 1), reachF = moveOf(f) + (basicSkill(f)?.range[1] ?? 1);
    const gap = g.distance(t.pos, f.pos) - Math.max(reachT, reachF);
    best = Math.min(best, Math.max(0, Math.ceil(gap / Math.max(1, moveOf(t) + moveOf(f) * 0.5))));
  }
  return best;
}

/** 効き目が続く軍略のうち、敵とぶつかってから使えるぶんの割合（戦いの終わりまで続くものは 1） */
function usefulShare(st: BattleState, t: BUnit, tac: TacticDef): number {
  const turns = tac.turns ?? -1;
  if (turns < 0) return 1;
  return clamp((turns - contactIn(st, t)) / turns, 0, 1);
}

function scoreTactic(st: BattleState, u: BUnit, tac: TacticDef, target: number, w: Record<string, number>, leader: BUnit | null): number {
  let s = 0;
  if (tac.kind === 'revive') return w.buff * 2;
  if (tac.kind === 'pull') return 0;
  for (const t of tacticVictims(st, u, tac, target)) {
    const hostile = t.side !== u.side;
    const big = t.kind === 'general' ? 1.4 : 1;
    switch (tac.kind) {
      case 'damage': {
        let v = valueOfHit(st, u, t, tacticDamage(st, u, tac, t), 1, w, leader);
        if (typeof tac.status === 'object' && !has(t, tac.status.status)) v += w.status * tac.status.chance / 100;
        s += hostile ? v : -v * w.friendlyFire;
        break;
      }
      case 'heal': {
        const miss = t.maxHp - t.hp;
        if (!hostile && miss > t.maxHp * 0.2) s += w.heal * Math.min(miss, healAmount(u, tac.power)) * big * (t.hp < t.maxHp * 0.4 ? 1.4 : 1);
        break;
      }
      case 'cure': if (!hostile && (disabled(t) || has(t, 'poison') || has(t, 'silence') || has(t, 'weaken'))) s += w.buff * 1.5 * big; break;
      case 'mpRestore': if (!hostile && t.maxMp - t.mp > 100 && t.tactics.length) s += w.buff; break;
      case 'dispel': {
        // 敵の補助を消す、味方の妨害を消す
        const buffs = t.statuses.filter((x) => ['defUp', 'atkUp', 'atkNext', 'agiUp', 'resistUp', 'regen', 'ward', 'moveUp', 'extraAct', 'sureNext'].includes(x.id)).length;
        const debuffs = t.statuses.filter((x) => ['weaken', 'atkDown', 'intDown', 'grounded'].includes(x.id)).length;
        s += w.buff * 0.8 * (hostile ? buffs - debuffs : debuffs - buffs);
        break;
      }
      case 'buff': {
        if (hostile || typeof tac.status !== 'string' || has(t, tac.status)) break;
        const near = nearestDist(st, t.pos, st.units.filter((x) => x.alive && x.side !== u.side));
        let v = 0;
        switch (tac.status) {
          case 'atkNext': v = near <= 2 && roleOf(t) === 'front' ? 1.2 : 0.3; break;          // これから殴る前衛に
          case 'defUp': case 'ward': v = near <= 3 ? 1 : 0.2; break;                          // 敵に近い味方に
          case 'resistUp': v = near <= 4 ? 0.7 : 0.1; break;
          case 'regen': v = t.hp < t.maxHp * 0.7 ? 1 : 0.1; break;
          case 'moveUp': v = near > 5 ? 0.6 : 0.1; break;                                      // まだ遠いときだけ
          case 'extraAct': v = (t.kind === 'general' || attackPower(st, t) > 150) && !t.extraUsed ? 1.4 : 0.6; break;
          case 'sureNext': v = near <= 2 ? 0.8 : 0.2; break;
          case 'mounted': v = 0; break;
          default: v = 0.5;
        }
        // 補助の時機（むずかしい）：敵に届く前に切れるぶんは効かない（足を速くする補助は行軍に効くので除く）
        if (w.buffTiming && tac.status !== 'moveUp') v *= usefulShare(st, t, tac);
        s += w.buff * v * big;
        break;
      }
      case 'debuff': {
        if (!hostile || typeof tac.status !== 'string' || has(t, tac.status)) break;
        let v = 1;
        if (tac.status === 'grounded') v = t.affinity === 'rider' ? 1.5 : 0.6;                  // 騎馬を降ろす
        if (tac.status === 'intDown') v = t.tactics.length ? 1.2 : 0.2;
        if (tac.status === 'weaken') v = attackPower(st, t) > 150 ? 1.3 : 0.8;
        if (w.buffTiming) v *= usefulShare(st, t, tac);
        s += w.debuff * v * big;
        break;
      }
      case 'status': {
        if (!hostile || typeof tac.status !== 'string' || has(t, tac.status)) break;
        if (tac.status === 'defect' && t.kind === 'general') break;
        const chance = tac.sure ? 1 : tacticSuccess(st, u, t) / 100;
        const v = tac.status === 'silence' ? (t.tactics.length ? 1 : 0.1) : 1.2;
        s += w.status * v * chance * big;
        break;
      }
      case 'displace': if (hostile) s += w.debuff * 0.4 * tacticSuccess(st, u, t) / 100 * big; break;
    }
  }
  // 種類ごとの使い時（むずかしい）：効き目が続く軍略（補助・妨害・状態）は、序盤ほど得が大きい。気力の惜しみ方も種類ごとに変える
  const lasting = tac.kind === 'buff' || tac.kind === 'debuff' || tac.kind === 'status';
  if (lasting && w.early && s > 0) s *= 1 + w.early * clamp(1 - st.round / (st.maxRounds * 0.6), 0, 1);
  return s - tac.mp * w.mp * (w[`mpK_${tac.kind}`] ?? 1);
}

// ---------------------------------------------------------------- 位置

/** 乱数を使わない、決まったゆらぎ（同じ盤面なら同じ値） */
function jitter(a: number, b: number, c: number): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface PosCtx {
  stance: Stance; role: Role; w: Record<string, number>; persona: Personality;
  leader: BUnit | null; foes: BUnit[]; threats: Threat[]; origin: number; urgent: number; joins: boolean;
  /** 城壁のある戦場だけ：各マスから一番近い敵までの道のり（歩数） */
  travel: Float64Array | null;
  /** 城の戦場の攻め手だけ：各マスから天守までの道のり（歩数） */
  seatPath: Float64Array | null;
  /** 難しさによる、天守を守る重みの倍率 */
  guardMult: number;
  /** むずかしいだけの考え方 */
  smart?: SmartConfig;
  /** 先手を取る：いま見ているマスに届く敵の数（scorePosition が書く） */
  reachN?: number;
}

/**
 * 各マスから、一番近い敵までの道のり（歩数。城壁を乗り越えるマスは3歩ぶんに数える）。
 * 城壁のある戦場では、まっすぐの距離で詰めると壁の前で止まってしまうので、門を通る道のりで測る。
 * その兵が入れないマス（騎馬にとっての城壁、移動力が足りなくて登れない城壁）は通らない。ほかのユニットは無視する。
 */
function travelField(st: BattleState, u: BUnit, foes: BUnit[]): Float64Array {
  const g = st.map.grid;
  const dist = new Float64Array(g.n).fill(Infinity);
  const heap = new MinHeap();
  for (const f of foes) { dist[f.pos] = 0; heap.push(0, f.pos); }
  const budget = moveOf(u);
  while (heap.size) {
    const d = heap.peekKey();
    const i = heap.pop();
    if (d > dist[i]) continue;
    for (const j of g.neighbors(i)) {
      const c = stepCost(st, u, j);
      if (c === null || c > budget) continue;
      const nd = d + (st.map.terrain[j] === 'wall' ? 3 : 1);
      if (nd < dist[j]) { dist[j] = nd; heap.push(nd, j); }
    }
  }
  return dist;
}

/** その位置にいるとしたときの、場所の評価（u.pos がその位置になっている前提） */
function scorePosition(st: BattleState, u: BUnit, c: PosCtx, parts: ScoreParts): void {
  const g = st.map.grid, w = c.w;
  const near = nearestDist(st, u.pos, c.foes);
  const isGeneral = u.kind === 'general';

  parts.terrain = terrainMod(st, u) * w.terrain;

  // まとまり：兵は采配範囲の中に。武将は自分の兵から離れすぎない
  let coh = 0;
  if (c.leader && c.leader.alive && !isGeneral) {
    if (outOfCommand(st, u)) coh -= w.outOfCommand;
    coh -= w.cohesion * Math.max(0, g.distance(u.pos, c.leader.pos) - Math.max(1, c.leader.commandRange - 1));
    // 前衛は主君と敵の間に立つ
    if (c.role === 'front' && g.distance(u.pos, c.leader.pos) <= 2 && near < nearestDist(st, c.leader.pos, c.foes)) coh += w.screen;
  } else if (isGeneral) {
    const troops = st.units.filter((x) => x.alive && x.leader === u.id && x.id !== u.id && x.side === u.side);
    if (troops.length) {
      const far = troops.filter((x) => g.distance(u.pos, x.pos) > u.commandRange).length;
      coh -= w.outOfCommand * 0.5 * far;
    }
    // 武将どうしの足並み：ほかの武将から離れすぎない（統率が高いほど気にする）
    const peers = st.units.filter((x) => x.alive && x.kind === 'general' && x.side === u.side && x.id !== u.id);
    if (peers.length) coh -= w.cohesion * Math.max(0, nearestDist(st, u.pos, peers) - AI.stance.generalSpread);
  }
  parts.cohesion = coh;

  // 脅威：次の敵ターンに受けそうなダメージ。攻め手は時間切れが近いほど気にしない
  const keepsBack0 = c.role !== 'front' || (isGeneral && !c.joins);
  const attacking = c.stance === 'advance' || c.stance === 'engage';
  // 地形を見て受ける（むずかしい）：受けるダメージの見込みを、このマスに立ったときの地形と天気で計算し直す
  const exp = exposure(st, u, c.smart?.terrainAware ? threatsTo(st, u, !!c.smart.exactReach) : c.threats, attacking && keepsBack0 ? 3 : 0);
  // 危険の重み：退却中は重く、守備は普通。攻めているときは、前衛の兵は危険を承知で踏み込み、後衛と武将は気をつける
  const byStance = c.stance === 'retreat' ? 1.5 : c.stance === 'hold' ? 1
    : keepsBack0 ? 0.6 : isGeneral ? 0.3 : 0.15;
  const brave = byStance * (1 - 0.8 * c.urgent);
  let thr = -exp * w.threat * (isGeneral ? 1.5 : 1) * brave;
  if (exp >= u.hp) thr -= w.deathRisk * (isGeneral ? 2 : 1) * brave;
  // 将を守る（むずかしい）：将が倒れると配下の兵がみな退くので、率いる兵が多い将ほど危険を重く見る
  if (c.smart?.leaderSafe && isGeneral) {
    const n = st.units.filter((x) => x.alive && x.leader === u.id && x.id !== u.id).length;
    thr *= 1 + c.smart.leaderSafe * Math.min(n, 6) / 6;
  }
  parts.threat = thr;
  // 先手を取る（むずかしい）で使う：このマスに届く敵の数
  if (c.smart?.firstStrike) c.reachN = c.threats.filter((t) => t.u.alive && g.distance(t.u.pos, u.pos) <= t.radius && (!t.cells || !!t.cells[u.pos])).length;

  // 間合い：射撃・軍略役・回復役は敵に隣り合わない。前に出ない武将も同じ
  let sp = 0;
  const keepsBack = c.role !== 'front' || (isGeneral && !c.joins);
  if (keepsBack && near < Infinity) {
    const adj = c.foes.filter((f) => g.distance(u.pos, f.pos) <= 1).length;
    sp -= w.spacing * adj;
    if (c.role === 'ranged') {
      const want = basicSkill(u)?.range[1] ?? 2;
      sp -= 2 * Math.abs(Math.min(near, want + 3) - want);
    }
  }
  // むずかしいだけの考え方：傷んだ兵を下げる・包囲する・囲まれない
  const sm = c.smart;
  if (sm) {
    if (sm.withdrawHp && sm.withdraw && u.kind === 'troop' && u.hp < u.maxHp * sm.withdrawHp && c.stance !== 'retreat' && !(sm.attackerPush && u.home === 0 && c.urgent > 0.3)) {
      // 敵から離れ、回復できる地形（陣など）へ。受けそうなダメージをさらに重く見る
      const regen = D.terrain.regen[st.map.terrain[u.pos]] ?? 0;
      sp += sm.withdraw * Math.min(near, 6) / 6 + (regen ? sm.withdraw * 0.6 : 0) - exp * w.threat;
    }
    if (sm.surround) {
      for (const f of c.foes) {
        if (g.distance(f.pos, u.pos) !== 1) continue;
        const mates = st.units.filter((x) => x.alive && x.side === u.side && x.id !== u.id && g.distance(x.pos, f.pos) === 1).length;
        sp += sm.surround * Math.min(mates, 3) * (1.3 - f.hp / f.maxHp);
      }
    }
    if (sm.surrounded) {
      const around = c.foes.filter((f) => g.distance(f.pos, u.pos) === 1).length;
      if (around >= 2) sp -= sm.surrounded * (around - 1);
    }
    // 背中を預ける：危ない場所に立つなら、味方の隣に
    if (sm.buddy && exp > 0) {
      const mates = st.units.filter((x) => x.alive && x.side === u.side && x.id !== u.id && g.distance(x.pos, u.pos) === 1).length;
      sp += sm.buddy * Math.min(mates, 2);
    }
  }
  parts.spacing = sp;

  // 構え
  let s = 0;
  if (near < Infinity) {
    const k = w.approach * (1 + c.urgent);
    // 城壁のある戦場では、門を通る道のりで詰める（道のりが無いマスは、まっすぐの距離のまま）
    const path = c.travel ? c.travel[u.pos] : Infinity;
    const far = path < Infinity ? Math.max(near, path) : near;
    switch (c.stance) {
      // 前に出ない武将・後衛は、敵から3マスの距離まで詰める（前衛についていく）
      case 'advance': s -= k * (keepsBack ? Math.max(0, far - 3) : far); break;
      case 'engage': s -= k * 0.5 * (keepsBack ? Math.max(0, far - 3) : far); break;
      case 'hold': s -= w.hold * g.distance(u.pos, c.origin); break;
      case 'retreat':
        if (isGeneral) s += w.retreat * Math.min(near, 8);
        else s -= k * 0.3 * far;     // 兵は主君を逃がすために踏みとどまる
        break;
    }
  }
  // 天守の取り合い：攻め手は天守に居座れば勝ちに近づくので、天守を目指して居続ける。守り手は、攻め手が近いときは天守を空けない
  const h = st.hold;
  if (h) {
    const W = AI.castle;
    if (u.side === 0) {
      if (u.pos === h.cell) s += W.hold * (1 + c.urgent);
      else if (c.seatPath && c.seatPath[u.pos] < Infinity) s -= W.approach * (1 + 2 * c.urgent) * (c.smart?.keepPush ?? 1) * Math.min(c.seatPath[u.pos], 30);
    } else if (u.pos === h.cell && c.foes.some((f) => g.distance(f.pos, h.cell) <= W.guardRange)) s += W.guard * c.guardMult;
  }
  parts.stance = s;
  parts.noise = jitter(u.id, u.pos, st.round) * w.noise;
}

// ---------------------------------------------------------------- 気力の値打ち（むずかしい）
// 気力は戦いの間ほとんど戻らないので、限りある技は「いちばん効くとき」に撃ちたい。気力1あたりの値打ち（引く点）を、
//   値打ち = mpPlan × 足りなさ × 良い一撃の大きさ ÷ 1回の気力
//   足りなさ：あと撃てる回数が、これから戦う巡（残りの巡、最大 mpHorizon）より少ないほど大きい（足りていれば 0。好きなだけ撃つ）
//   良い一撃の大きさ：この戦いでこの駒が撃てたいちばん良い一撃（少しずつ忘れる。まだ無ければ「倒す」の値）
//   倒されそうな駒（体力が4割を切った）は、抱えたまま倒れないよう、値打ち 0（今のうちに撃つ）

const castMemory = new WeakMap<BattleState, Map<number, number>>();
function noteCast(st: BattleState, u: BUnit, v: number): void {
  let m = castMemory.get(st);
  if (!m) { m = new Map(); castMemory.set(st, m); }
  m.set(u.id, Math.max((m.get(u.id) ?? 0) * 0.85, v));
}

function mpPrice(st: BattleState, u: BUnit, sm: SmartConfig, w: Record<string, number>): number {
  if (u.hp < u.maxHp * 0.4) return 0;
  const costs = [...u.skills.map((id) => skillOf(id).mp), ...u.tactics.map((id) => D.byTactic[id].mp)].filter((c) => c > 0 && c <= u.maxMp);
  if (!costs.length) return 0;
  const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
  const left = st.maxRounds - st.round + 1;
  let horizon = Math.min(left, sm.mpHorizon ?? 8);
  // 戦いの残りの見込み：どちらかの体力が減るほど決着は近い（減った割合の小さいほうで縮める）
  if (sm.mpAdaptive) {
    const frac = (side: boolean) => {
      const us = st.units.filter((x) => (x.side === u.side) === side);
      const max = us.reduce((s, x) => s + x.maxHp, 0);
      return max ? us.reduce((s, x) => s + (x.alive ? x.hp : 0), 0) / max : 0;
    };
    horizon = Math.max(1, Math.min(left, Math.round(horizon * Math.min(frac(true), frac(false)))));
  }
  const casts = u.mp / avg;
  if (casts >= horizon) return 0;
  const scarcity = 1 - casts / horizon;
  const ref = castMemory.get(st)?.get(u.id) ?? w.kill;
  return sm.mpPlan! * scarcity * ref / avg;
}

// ---------------------------------------------------------------- 1ユニットの行動

const zeroParts = (): ScoreParts => ({ attack: 0, support: 0, counter: 0, threat: 0, terrain: 0, cohesion: 0, stance: 0, spacing: 0, noise: 0 });
const total = (p: ScoreParts): number => p.attack + p.support - p.counter + p.threat + p.terrain + p.cohesion + p.stance + p.spacing + p.noise;

/** 1ユニットの行動を、採点の内訳つきで決める（移動 → 行動 の順） */
export function planUnitDetailed(st: BattleState, u: BUnit): UnitPlan {
  const mayMove = canMove(st, u), mayAct = canAct(st, u);
  const persona = personaOf(st, u);
  const w = weightsFor(persona);
  // 戦闘の難しさ：自分と戦う相手の駒は、思考の重みを変える（やさしいは、ばらつきが大きく危険や地形を気にしない。むずかしいは、その逆）
  const lv = levelOf(st, u);
  if (lv) for (const [k, m] of Object.entries(lv.weights)) if (k in w) w[k] *= m;
  // 先読み（むずかしい）で選んだ方針の重み
  const pol = policyFor(st, u.side);
  if (pol) for (const [k, m] of Object.entries(POLICY[pol].w)) if (k in w) w[k] *= m;
  // 技の時機（むずかしい）：気力を使う技・軍略は、効き目が大きいときに取っておく
  const mpBase = w.mp;
  if (lv?.smart?.mpThrift) w.mp *= lv.smart.mpThrift;
  // 種類ごとの惜しみ方：軍略の種類ごとに、気力の重み（ふつうの何倍か）を決める
  if (lv?.smart?.mpKind && w.mp > 0) for (const [k, m] of Object.entries(lv.smart.mpKind)) w[`mpK_${k}`] = m * mpBase / w.mp;
  w.early = lv?.smart?.early ?? 0;
  w.buffTiming = lv?.smart?.buffTiming ? 1 : 0;
  // 気力の値打ち（むずかしい）：気力の使い方を、残りの巡・あと何回撃てるか・これまでの良い一撃の大きさから決める
  if (lv?.smart?.mpPlan) w.mp = mpPrice(st, u, lv.smart, w);
  // 大将狙い（むずかしい）：武将を全員倒せば勝ち。武将への攻撃を、さらに重く見る
  if (lv?.smart?.decapitate) w.generalTarget *= lv.smart.decapitate;
  w.leaderKill = lv?.smart?.leaderKill ?? 0;
  w.focus = lv?.smart?.focus ?? 0;
  focusCache = new Map();
  // 攻め手は押す（むずかしい）：時間が経つほど、危険と倒される危うさを軽く見る
  if (lv?.smart?.attackerPush && u.home === 0) {
    const k = 1 - lv.smart.attackerPush * Math.min(1, st.round / st.maxRounds * 1.5);
    w.threat *= k; w.deathRisk *= k;
  }
  // 攻め手は時間切れが負けなので、消極的な武将でも一定の速さでは前に出る
  if (u.home === 0) w.approach = Math.max(w.approach, AI.weights.approach * AI.stance.attackerApproachFloor);
  const stance = stanceOf(st, u);
  const role = roleOf(u);
  const empty: UnitPlan = { actions: [], stance, role, score: 0, parts: zeroParts() };
  if (!mayMove && !mayAct) return empty;

  const leaderU = st.units[u.leader];
  const leader = leaderU && leaderU.alive && leaderU.side === u.side ? leaderU : null;
  const urgent = urgency(st, u);
  const foes = st.units.filter((x) => x.alive && x.side !== u.side);
  const ctx: PosCtx = {
    stance, role, w, persona, leader, urgent, origin: u.pos, foes,
    travel: st.map.siege && foes.length ? travelField(st, u, foes) : null,
    seatPath: st.hold && u.side === 0 ? travelField(st, u, [{ pos: st.hold.cell } as BUnit]) : null,
    guardMult: lv?.weights.guard ?? 1,
    smart: lv?.smart,
    threats: threatsTo(st, u, !!lv?.smart?.exactReach),
    // 武将が自ら前に出るか：猛攻・武勇の武将、前衛の役割で時間が押しているとき
    joins: u.kind !== 'general' || persona.aggression + persona.honor * 0.5 > 0.3 || urgent >= (AI.stance.generalJoinFrom - AI.stance.urgentFrom) / (1 - AI.stance.urgentFrom),
  };

  const origin = u.pos, wasMoved = u.moved;
  const cells = mayMove ? reach(st, u, moveOf(u) - u.moveSpent).cells : [origin];
  let best: { score: number; parts: ScoreParts; move: number | null; act: Action | null } = { score: -Infinity, parts: zeroParts(), move: null, act: null };
  let stay = -Infinity;
  // 気力の値打ちで使う：この駒が、いま撃てるいちばん良い一撃の大きさ（気力の値打ちを引く前）
  let bestCast = 0;
  for (const c of cells) {
    u.pos = c; u.moved = wasMoved || c !== origin;
    const base = zeroParts();
    scorePosition(st, u, ctx, base);
    const consider = (parts: ScoreParts, act: Action | null) => {
      const score = total(parts);
      if (score > best.score) best = { score, parts, move: c !== origin ? c : null, act };
    };
    // 先手を取る（むずかしい）：攻めずに敵の届く所に立つのは損。攻め手は時間が押すほど気にしない
    const fs = ctx.smart?.firstStrike;
    const idle = fs && ctx.reachN ? { ...base, spacing: base.spacing - fs * ctx.reachN * (1 - urgent) * (u.home === 0 ? 0.5 : 1) } : base;
    consider(idle, null);
    if (c === origin) stay = total(idle);
    if (!mayAct) continue;
    for (const sid of u.skills) {
      const skill = skillOf(sid);
      if (!canUseSkill(st, u, skill)) continue;
      for (const t of skillTargetCells(st, u, skill)) {
        const r = scoreSkill(st, u, skill, t, w, leader);
        if (skill.mp > 0) bestCast = Math.max(bestCast, r.value + skill.mp * w.mp);
        if (r.value <= 0) continue;
        const heals = skill.effects.some((e) => e.type === 'heal');
        consider({ ...base, attack: heals ? 0 : r.value, support: heals ? r.value : 0, counter: r.counter }, { type: 'skill', unit: u.id, skill: sid, target: t });
      }
    }
    // 造りを壊す（攻め手だけ）：閉じた門を開けると道が開くので、少し高く見る。相手を攻められるときは、ふつうそちらが勝つ
    for (const cell of breachTargets(st, u)) {
      const str = st.structures![cell], dmg = breachParts(st, u, cell).base;
      let v = AI.castle.breach * Math.min(1, dmg / str.hp) + (dmg >= str.hp ? AI.castle.breachKill : 0);
      if (str.closed) v *= AI.castle.breachClosed;
      consider({ ...base, attack: v * (1 + urgent) }, { type: 'breach', unit: u.id, target: cell });
    }    for (const tid of u.tactics) {
      const tac = D.byTactic[tid];
      if (!canUseTactic(u, tac)) continue;
      for (const t of tacticTargetCells(st, u, tac)) {
        const v = scoreTactic(st, u, tac, t, w, leader);
        if (tac.mp > 0) bestCast = Math.max(bestCast, v + tac.mp * w.mp);
        if (v <= 0) continue;
        const isAttack = tac.kind === 'damage';
        consider({ ...base, attack: isAttack ? v : 0, support: isAttack ? 0 : v }, { type: 'tactic', unit: u.id, tactic: tid, target: t });
      }
    }
  }
  u.pos = origin; u.moved = wasMoved;
  if (lv?.smart?.mpPlan && bestCast > 0) noteCast(st, u, bestCast);
  const actions: Action[] = [];
  if (best.move !== null) actions.push({ type: 'move', unit: u.id, to: best.move });
  if (mayAct) actions.push(best.act ?? { type: 'wait', unit: u.id });
  return { actions, stance, role, score: best.score, parts: best.parts, stay };
}

export function planUnit(st: BattleState, u: BUnit): Action[] { return planUnitDetailed(st, u).actions; }

// ---------------------------------------------------------------- 陣営の番

/** 動かす順番：妨害・補助の軍略役 → 射撃 → 前衛 → 回復役 → 武将。同じ役割なら敵に近いものから */
function orderOf(st: BattleState, u: BUnit, foes: BUnit[]): number {
  const role = roleOf(u);
  const rank = u.kind === 'general' ? (role === 'front' ? 4 : role === 'support' ? 3.5 : 0.5) : role === 'caster' ? 0 : role === 'ranged' ? 1 : role === 'front' ? 2 : 3;
  return rank * 100 + Math.min(99, nearestDist(st, u.pos, foes));
}

/** いまの陣営で、次に動かすユニットの行動（もう無ければ番を終える） */
export function nextAiActions(st: BattleState): Action[] {
  const foes = st.units.filter((x) => x.alive && x.side !== st.turn);
  const order = st.units.filter((u) => u.alive && u.side === st.turn && (canAct(st, u) || canMove(st, u)))
    .sort((a, b) => orderOf(st, a, foes) - orderOf(st, b, foes) || a.id - b.id);
  // よい順に動く（むずかしい）：決まった順番でなく、行動で増える点がいちばん大きい駒から動く。とどめを刺せる駒が先に動き、ほかの駒は残りを見て動く
  const smart = st.aiLevel && st.aiLevel.side === st.turn ? AI.levels[st.aiLevel.level].smart : undefined;
  const sim = SIM.has(st);
  // 先読み（むずかしい）：番の初めに、方針ごとに先を試して、いちばん良い方針を選ぶ（試しの盤の中では先読みしない）
  if (smart?.lookahead && !sim) choosePolicy(st, smart);
  // 試しの盤の中では、軽く読むため、決まった順番で動かす
  if (smart?.bestFirst && !sim) {
    let pick: UnitPlan | null = null;
    for (const u of order) {
      const p = planUnitDetailed(st, u);
      if (!p.actions.length) continue;
      if (!pick || p.score - (p.stay ?? p.score) > pick.score - (pick.stay ?? pick.score)) pick = p;
    }
    return pick ? pick.actions : [{ type: 'endTurn' }];
  }
  for (const u of order) {
    const plan = planUnit(st, u);
    if (plan.length) return plan;
  }
  return [{ type: 'endTurn' }];
}

/** 陣営の番を最後まで自動で進める */
export function runAiTurn(st: BattleState): void {
  const side = st.turn;
  for (let guard = 0; guard < 500 && st.winner === null && st.turn === side; guard++) {
    const acts = nextAiActions(st);
    let progressed = false;
    for (const a of acts) {
      if (a.type === 'endTurn') { endTurn(st); return; }
      if (apply(st, a)) progressed = true;
    }
    if (!progressed) {
      // 念のため：進まないユニットは待機させる
      const stuck = st.units.find((u) => u.alive && u.side === side && canAct(st, u));
      if (stuck) apply(st, { type: 'wait', unit: stuck.id }); else { endTurn(st); return; }
    }
  }
  if (st.winner === null && st.turn === side) endTurn(st);
}

// ---------------------------------------------------------------- 先読み（むずかしい）
// 番の初めに、方針（いつもどおり・押す・固める）ごとに、盤を写して自分の番と相手の番（lookahead 手ぶん）を試し、
// できた盤を評価して、いちばん良い方針でこの番を動かす。
//   ・試しの盤は別の乱数で動かす（本物の戦いの出目は覗かない）
//   ・試しの盤の中では、軽い読み方（決まった順番。先読みはしない）で動かす。相手はふつうの思考
//   ・盤の評価：残っている力（体力×攻撃力。将は率いる兵の数だけ重い）の差 ＋ 盤の重みづけ（押さえているマス。天守のまわりは重い） ＋ 天守の占拠

type PolicyId = 'base' | 'push' | 'guard';
/** 方針：重みの掛け目と、決める構え（守り手だけ／攻め手だけ） */
const POLICY: Record<PolicyId, { w: Record<string, number>; defender?: Stance; attacker?: Stance }> = {
  base: { w: {} },
  push: { w: { threat: 0.5, deathRisk: 0.6, approach: 1.6 }, defender: 'advance', attacker: 'advance' },
  guard: { w: { threat: 1.6, deathRisk: 1.5, approach: 0.5 }, defender: 'hold', attacker: 'engage' },
};
/** 盤ごとに、その番に選んだ方針 */
const chosenPolicy = new WeakMap<BattleState, { key: string; policy: PolicyId }>();
/** 先読みのための試しの盤 */
const SIM = new WeakSet<BattleState>();
const policyKey = (st: BattleState, side: number): string => `${st.round}:${side}`;

function policyFor(st: BattleState, side: number): PolicyId | undefined {
  const c = chosenPolicy.get(st);
  return c && c.key === policyKey(st, side) && c.policy !== 'base' ? c.policy : undefined;
}
function policyStance(st: BattleState, u: BUnit): Stance | undefined {
  const pol = policyFor(st, u.side);
  return pol ? (u.home === 0 ? POLICY[pol].attacker : POLICY[pol].defender) : undefined;
}

/** 出目がいつも真ん中の乱数（先読みで、運のぶれを消して方針の差だけを見るため） */
class MedianRNG extends RNG {
  override float(): number { return 0.4999; }
}

/** 盤を写す（駒・造り・天守・地形。乱数は別のものにする。median なら出目はいつも真ん中） */
function cloneBattle(st: BattleState, seed: number, median = false): BattleState {
  return {
    ...st,
    map: { ...st.map, terrain: [...st.map.terrain] },
    units: st.units.map((u) => ({ ...u, statuses: u.statuses.map((s) => ({ ...s })) })),
    rng: median ? new MedianRNG(seed) : new RNG(seed), log: [],
    hold: st.hold ? { ...st.hold } : undefined,
    structures: st.structures ? Object.fromEntries(Object.entries(st.structures).map(([k, v]) => [k, { ...v }])) : undefined,
  };
}

/** 盤の評価（side から見て。大きいほど良い） */
export function evaluateBattle(st: BattleState, side: number, control = 0): number {
  if (st.winner !== null) return st.winner === side ? 1e6 : -1e6;
  let v = 0;
  const alive = st.units.filter((u) => u.alive);
  for (const u of alive) {
    const followers = u.kind === 'general' ? alive.filter((x) => x.leader === u.id && x.id !== u.id).length : 0;
    v += (u.side === side ? 1 : -1) * (u.hp * attackPower(st, u) / 100 + 30) * (1 + 0.3 * followers);
  }
  if (st.hold) v += (side === 0 ? 1 : -1) * st.hold.count * AI.castle.hold;
  // 盤の重みづけ：どちらの力がよく届くマスか。天守とそのまわりは5倍
  if (control) {
    const g = st.map.grid;
    for (let c = 0; c < g.n; c++) {
      if (st.map.terrain[c] === 'void') continue;
      let mine = 0, theirs = 0;
      for (const u of alive) {
        if (g.distance(u.pos, c) > moveOf(u) + 1) continue;
        const p = u.hp * attackPower(st, u) / 100;
        if (u.side === side) mine += p; else theirs += p;
      }
      if (mine === theirs) continue;
      const wt = st.hold && g.distance(c, st.hold.cell) <= 1 ? 5 : 1;
      v += control * wt * (mine > theirs ? 1 : -1);
    }
  }
  return v;
}

function choosePolicy(st: BattleState, smart: SmartConfig): void {
  const side = st.turn, key = policyKey(st, side);
  if (chosenPolicy.get(st)?.key === key) return;
  let best: PolicyId = 'base', bestV = -Infinity;
  // どの方針も同じ出目の並びで試す（方針の差を、運の差と分けるため）。rolls 回試して平均する
  const median = !!smart.lookaheadMedian, rolls = median ? 1 : Math.max(1, smart.lookaheadRolls ?? 1);
  for (const pol of ['base', 'push', 'guard'] as const) {
    let v = 0;
    for (let r = 0; r < rolls; r++) {
      const sim = cloneBattle(st, codeToSeed(`${st.rng.seed0}:look:${key}:${r}`), median);
      SIM.add(sim);
      chosenPolicy.set(sim, { key, policy: pol });
      for (let ply = 0; ply < smart.lookahead! && sim.winner === null; ply++) runAiTurn(sim);
      v += evaluateBattle(sim, side, smart.lookaheadControl ?? 0) / rolls;
    }
    if (v > bestV) { bestV = v; best = pol; }
  }
  chosenPolicy.set(st, { key, policy: best });
}

/** 決着がつくまで両陣営を自動で進める（テスト・バランス調整用） */
export function autoBattle(st: BattleState): BattleState {
  for (let guard = 0; guard < 200 && st.winner === null; guard++) runAiTurn(st);
  return st;
}
