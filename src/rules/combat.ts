// 戦闘の計算（docs/12_戦闘ルール（仮））。乱数を使わない純粋な計算だけを置く。係数は data/system/combat.json。

import type { BUnit, BattleState } from '../battle/types';
import { D } from '../data/db';
import type { SkillDef, StatusId, TacticDef } from '../data/types';
import { BM } from '../battle/map';
import { unitAt } from './move';
import {
  affinityOf, agility, attackPower, defense, disabled, has, intellect, fireMult, outOfCommand, passive, passivePct, situationHit, skillRange, supplyMultOf, fieldMult, type FieldParts, basicSkill, attackKinds,
  skillOf, tacticResist, terrainAt, terrainMod, seatDefMult,
} from './stats';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 技の「対地・対騎」のうち、相手に当てはまる記号 */
export function markFor(skill: SkillDef, target: BUnit): SkillDef['vsGround'] {
  return affinityOf(target) === 'rider' ? skill.vsRider : skill.vsGround;
}

// 計算の関数は、答えといっしょに「内訳」（式に入れた値）を返す。細かい記録（詳細）は、この内訳をそのまま出す。
// 数だけがほしいところ（画面の予測・敵の思考）は、これまでどおり hitChance・skillDamage などを使う。

/** 命中率の内訳。pct が実際に使う値 */
export interface HitParts {
  pct: number;
  /** 式を通らずに決まったとき：x=当てられない、mark=必中の技、disabled=相手が動けない、sureNext=次の攻撃が必中 */
  fixed: 'x' | 'mark' | 'disabled' | 'sureNext' | null;
  base: number; agiA: number; agiT: number; skill: number; terA: number; terT: number;
  /** △の相手への命中減（引く値） */
  tri: number;
  passHit: number; passEvade: number;
  /** 櫓の上から撃つときの命中、雨、霧、夜 */
  perch: number; rain: number; fog: number; night: number;
  /** 上限・下限に収める前の値 */
  raw: number;
}

export function hitParts(st: BattleState, a: BUnit, skill: SkillDef, t: BUnit): HitParts {
  const C = D.combat;
  const p: HitParts = {
    pct: 0, fixed: null, base: C.hitBase, agiA: 0, agiT: 0, skill: skill.hit, terA: 0, terT: 0, tri: 0,
    passHit: 0, passEvade: 0, perch: 0, rain: 0, fog: 0, night: 0, raw: 0,
  };
  const mark = markFor(skill, t);
  if (mark === 'x') { p.fixed = 'x'; return p; }
  if (mark === 'sure' || disabled(t) || has(a, 'sureNext')) {
    p.fixed = mark === 'sure' ? 'mark' : disabled(t) ? 'disabled' : 'sureNext';
    p.pct = p.raw = 100;
    return p;
  }
  p.agiA = agility(a); p.agiT = agility(t); p.terA = terrainMod(st, a); p.terT = terrainMod(st, t);
  let r = C.hitBase + p.agiA - p.agiT + skill.hit + p.terA - p.terT;
  if (mark === 'tri') { p.tri = C.triPenalty; r -= C.triPenalty; }
  p.passHit = passivePct(a, 'hit'); p.passEvade = passivePct(t, 'evade');
  r += p.passHit - p.passEvade;
  const sit = situationHit(st, a, skill, t);
  r += sit;
  // 地形と天気のぶん（sit）を、雨・霧・夜と、残り（櫓）に分ける。足すと必ず sit になる
  const W = C.weather;
  p.rain = st.weather === 'rain' && skill.range[1] >= 2 ? W.rainRangedHit : 0;
  p.fog = st.weather === 'fog' && st.map.grid.distance(a.pos, t.pos) >= 2 ? W.fogFarHit : 0;
  p.night = st.night ? W.nightHit : 0;
  p.perch = sit - p.rain - p.fog - p.night;
  p.raw = r;
  p.pct = clamp(Math.round(r), C.hitMin, C.hitMax);
  return p;
}

/** 技の命中率（%）。◎と、相手が行動不能のときは必中 */
export function hitChance(st: BattleState, a: BUnit, skill: SkillDef, t: BUnit): number {
  return hitParts(st, a, skill, t).pct;
}

/** 技のダメージの内訳。base が基準値（乱数・会心・盾防御を掛ける前） */
export interface DamageParts {
  base: number;
  power: number; atk: number; def: number;
  /** 特効（相手の得意地形・いる地形）の倍率、反撃の倍率、雨の日の火の倍率。無ければ 1 */
  bane: number; counter: number; fire: number;
  /** 地形と天気の倍率と、何が効いたか */
  field: number; fieldNotes: FieldParts['notes'];
}

export function damageParts(st: BattleState, a: BUnit, skill: SkillDef, t: BUnit, isCounter = false): DamageParts {
  const p: DamageParts = { base: 0, power: skill.power, atk: 0, def: 0, bane: 1, counter: 1, fire: 1, field: 1, fieldNotes: [] };
  if (skill.noDamage) return p;
  p.atk = attackPower(st, a); p.def = defense(st, t);
  let dmg = skill.power * p.atk / p.def;
  for (const b of passive(a, 'bane')) if (affinityOf(t) === b.vs) { dmg *= 1 + b.pct / 100; p.bane *= 1 + b.pct / 100; }
  for (const b of passive(a, 'baneOnTerrain')) if (terrainAt(st, t.pos) === b.terrain) { dmg *= 1 + b.pct / 100; p.bane *= 1 + b.pct / 100; }
  if (isCounter) { p.counter = D.combat.counterMult * (1 + passivePct(a, 'counterDamage') / 100); dmg *= p.counter; }
  p.fire = fireMult(st, skill.id);
  dmg *= p.fire;
  const fm = fieldMult(st, a, skill.id, skill.range, false, t);
  p.field = fm.mult; p.fieldNotes = fm.notes;
  dmg *= p.field;
  p.base = Math.max(1, Math.floor(dmg));
  return p;
}

/** 技のダメージ（乱数・会心・盾防御を除いた基準値） */
export function skillDamage(st: BattleState, a: BUnit, skill: SkillDef, t: BUnit, isCounter = false): number {
  return damageParts(st, a, skill, t, isCounter).base;
}

/** 攻撃・防御の値の成り立ち（記録に出すだけ。value は attackPower・defense の値そのもの） */
export interface StatParts {
  value: number;
  /** もとの値（攻撃なら武力、防御なら防御）と、それに掛ける数 */
  base: number; mult: number;
  /** 状態変化（強化・弱化）の％。足し合わせて掛ける（0.8.0） */
  adds: [StatusId, number][];
  /** 采配範囲の外にいるときの倍率（中なら 1） */
  out: number;
  /** 陣営の掛け目（飛び地で戦う側は 1 未満。無ければ 1） */
  supply: number;
  /** 混乱中の防御のように、決まった値になっている */
  fixed: boolean;
  /** 天守・本丸・本陣に立つときの防御の掛け目（0.9.0。無ければ 1） */
  seat?: number;
}

export function atkParts(st: BattleState, u: BUnit): StatParts {
  const S = D.status;
  const adds: [StatusId, number][] = [];
  for (const id of ['atkNext', 'atkUp', 'weaken', 'atkDown'] as const) if (has(u, id)) adds.push([id, S[id].atkPct]);
  return { value: attackPower(st, u), base: u.str, mult: D.combat.atkPerStr, adds, out: outOfCommand(st, u) ? 1 + S.outOfCommand.atkDefPct / 100 : 1, supply: supplyMultOf(st, u), fixed: false };
}

export function defParts(st: BattleState, u: BUnit): StatParts {
  const S = D.status;
  const value = defense(st, u);
  if (has(u, 'confuse')) return { value, base: S.confuse.def, mult: 1, adds: [], out: 1, supply: 1, fixed: true };
  const adds: [StatusId, number][] = [];
  for (const id of ['defUp', 'weaken'] as const) if (has(u, id)) adds.push([id, S[id].defPct]);
  return { value, base: u.def, mult: 1, adds, out: outOfCommand(st, u) ? 1 + S.outOfCommand.atkDefPct / 100 : 1, supply: supplyMultOf(st, u), fixed: false, seat: seatDefMult(st, u) };
}

export function critChance(a: BUnit): number {
  return clamp(D.combat.critRate + passivePct(a, 'crit') + a.critPct, 0, 100);
}

/** 軍略のダメージの内訳。base が基準値（乱数を掛ける前） */
export interface TacticParts {
  base: number;
  power: number; intA: number; mult: number; intT: number;
  /** 分母に足す値（相手の防御。防御を使わない設定なら 100） */
  def: number; defIsDefense: boolean;
  resist: number; fire: number;
  /** 地形と天気の倍率と、何が効いたか */
  field: number; fieldNotes: FieldParts['notes'];
}

export function tacticParts(st: BattleState, a: BUnit, tac: TacticDef, t: BUnit): TacticParts {
  const C = D.combat;
  const p: TacticParts = {
    base: 0, power: tac.power, intA: intellect(a), mult: C.tacticIntMult, intT: intellect(t),
    def: C.tacticDefInDenominator ? defense(st, t) : 100, defIsDefense: C.tacticDefInDenominator,
    resist: tacticResist(st, t), fire: fireMult(st, tac.id), field: 1, fieldNotes: [],
  };
  const fm = fieldMult(st, a, tac.id, null, true, t);
  p.field = fm.mult; p.fieldNotes = fm.notes;
  const denom = p.intT + p.def;
  p.base = Math.max(1, Math.floor(tac.power * (p.intA * C.tacticIntMult) / denom * (1 - p.resist) * p.fire * p.field));
  return p;
}

/** 軍略のダメージ（基準値） */
export function tacticDamage(st: BattleState, a: BUnit, tac: TacticDef, t: BUnit): number {
  return tacticParts(st, a, tac, t).base;
}

/** 確率型の軍略の成功率の内訳。pct が実際に使う値 */
export interface SuccessParts {
  pct: number;
  base: number; intA: number; intT: number;
  /** 耐性（負の耐性は 0 として扱う） */
  resist: number;
  /** 上限・下限に収める前の値 */
  raw: number;
}

export function successParts(st: BattleState, a: BUnit, t: BUnit): SuccessParts {
  const C = D.combat;
  const p: SuccessParts = { pct: 0, base: C.statusBase, intA: intellect(a), intT: intellect(t), resist: Math.max(0, tacticResist(st, t)), raw: 0 };
  // 特性（皮肉屋など）：状態の軍略の成功率を足す（P56）
  p.raw = (C.statusBase + p.intA - p.intT + (a.statusPct ?? 0)) * (1 - p.resist);
  p.pct = clamp(Math.round(p.raw), C.statusMin, C.statusMax);
  return p;
}

/** 確率型の軍略の成功率（%） */
export function tacticSuccess(st: BattleState, a: BUnit, t: BUnit): number {
  return successParts(st, a, t).pct;
}

/** 回復量の内訳：威力 ×（c0 ＋ 知略 ÷ per）×（1 ＋ 回復の特性 ÷ 100） */
export interface HealParts { amount: number; power: number; int: number; c0: number; per: number; healPct: number }

export function healParts(a: BUnit, power: number): HealParts {
  const p: HealParts = { amount: 0, power, int: intellect(a), c0: 0.6, per: 150, healPct: a.healPct };
  p.amount = Math.round(power * (p.c0 + p.int / p.per) * (1 + a.healPct / 100));
  return p;
}

/** 回復量（知略が高いほど少し増える） */
export function healAmount(a: BUnit, power: number): number {
  return healParts(a, power).amount;
}

// ---------------------------------------------------------------- 対象の決め方

export const isEnemy = (a: BUnit, b: BUnit): boolean => a.side !== b.side;

/** 技を使えるか（気力、水上の条件、移動後に使えるか） */
/** 技に使う気力（直伝の借り物は多くかかる。P68） */
export const skillCost = (u: BUnit, skill: SkillDef): number => (u.borrowed?.includes(skill.id) ? Math.round(skill.mp * (u.borrowMult ?? 1)) : skill.mp);

export function canUseSkill(st: BattleState, u: BUnit, skill: SkillDef): boolean {
  if (u.mp < skillCost(u, skill)) return false;
  if (skill.needsWater && terrainAt(st, u.pos) !== 'water') return false;
  if (u.moved && !skill.afterMove) return false;
  // 装填の要る技（弩・鉄砲の必中技）：装填済みのときだけ
  if (skill.reload && !has(u, 'loaded')) return false;
  return true;
}

/** 装填の要る技を持っているか（待機すると込め直す） */
export const needsReload = (u: BUnit): boolean => u.skills.some((id) => skillOf(id).reload);

/** 技の対象に選べるマス。単体は相手のいるマス、直線は向きを示す隣のマス、周囲は自分のマス */
export function skillTargetCells(st: BattleState, u: BUnit, skill: SkillDef): number[] {
  const g = st.map.grid;
  if (skill.shape.type === 'around') return [u.pos];
  if (skill.shape.type === 'line') return g.neighbors(u.pos);
  const [min, max] = skillRange(st, u, skill);
  return g.range(u.pos, max, min).filter((i) => {
    const t = unitAt(st, i);
    return !!t && isEnemy(u, t) && markFor(skill, t) !== 'x';
  });
}

/** 技が当たる相手 */
export function skillVictims(st: BattleState, u: BUnit, skill: SkillDef, target: number): BUnit[] {
  const g = st.map.grid;
  let cells: number[];
  if (skill.shape.type === 'around') cells = g.range(u.pos, skill.shape.n, 1);
  else if (skill.shape.type === 'line') cells = g.line(u.pos, g.dirTo(u.pos, target), skill.shape.n);
  else cells = [target];
  const out: BUnit[] = [];
  for (const c of cells) {
    const t = unitAt(st, c);
    if (!t || t.id === u.id) continue;
    if (skill.targets === 'enemy' && !isEnemy(u, t)) continue;
    out.push(t);
  }
  return out;
}

/** 軍略の対象の種類 */
export function tacticSide(tac: TacticDef): 'ally' | 'enemy' | 'any' {
  if (tac.anyTarget) return 'any';
  switch (tac.kind) {
    case 'heal': case 'cure': case 'mpRestore': case 'buff': case 'pull': case 'revive': return 'ally';
    default: return 'enemy';
  }
}

/** 軍略に使う気力（P56：特性で増減。満足は軍略の気力が減り、優しいは味方への補助の気力が減る） */
export function tacticCost(u: BUnit, tac: TacticDef): number {
  const pct = (u.mpCostPct ?? 0) + (tacticSide(tac) === 'ally' ? u.supportMpCostPct ?? 0 : 0);
  // 直伝の借り物は、気力が多くかかる（P68）
  const base = u.borrowed?.includes(tac.id) ? tac.mp * (u.borrowMult ?? 1) : tac.mp;
  return Math.max(0, Math.round(base * (1 + pct / 100)));
}

/** 軍略を使えるか（気力がある、攪乱されていない、まだ移動していない） */
export function canUseTactic(u: BUnit, tac: TacticDef): boolean {
  return u.mp >= tacticCost(u, tac) && !has(u, 'silence') && !u.moved;
}

/** 軍略の対象に選べるマス */
export function tacticTargetCells(st: BattleState, u: BUnit, tac: TacticDef): number[] {
  const g = st.map.grid;
  if (tac.kind === 'revive') return st.units.some((x) => !x.alive && !x.retreated && x.kind === 'troop') ? [u.pos] : [];
  if (tac.kind === 'pull') return st.units.filter((x) => x.alive && x.leader === u.id && x.id !== u.id).map((x) => x.pos);
  if (tac.area > 0 && !tac.range) return [u.pos];
  const range = tac.range ?? 0;
  if (tac.area > 0) return g.range(u.pos, range);
  const side = tacticSide(tac);
  return g.range(u.pos, range).filter((i) => {
    const t = unitAt(st, i);
    if (!t) return false;
    return side === 'any' || (side === 'ally') === !isEnemy(u, t);
  });
}

/** 軍略が及ぶ相手 */
export function tacticVictims(st: BattleState, u: BUnit, tac: TacticDef, target: number): BUnit[] {
  const g = st.map.grid;
  const side = tacticSide(tac);
  const okSide = (t: BUnit) => tac.friendlyFire || side === 'any' || (side === 'ally') === !isEnemy(u, t);
  if (tac.area > 0) {
    const center = tac.range ? target : u.pos;
    return g.range(center, tac.area).map((i) => unitAt(st, i)).filter((t): t is BUnit => !!t && okSide(t) && !(tac.friendlyFire && t.id === u.id));
  }
  const t = unitAt(st, target);
  return t && okSide(t) ? [t] : [];
}

// ---------------------------------------------------------------- 予測（画面と敵の思考で使う）

export interface Forecast {
  damage: number;
  hit: number;
  crit: number;
  /** 反撃される場合の、反撃のダメージと命中率 */
  counter: { damage: number; hit: number } | null;
}

/** t が u に反撃できるか（生きていて、行動不能でなく、通常攻撃の射程内） */
export function canCounter(st: BattleState, attacker: BUnit, skill: SkillDef, t: BUnit, basic: SkillDef | undefined): boolean {
  if (!basic || skill.noCounter || skill.shape.type !== 'single') return false;
  if (disabled(t) || has(t, 'defect')) return false;
  const d = st.map.grid.distance(attacker.pos, t.pos);
  const [min, max] = skillRange(st, t, basic);
  if (d < min || d > max) return false;
  return markFor(basic, attacker) !== 'x';
}

export function forecastSkill(st: BattleState, a: BUnit, skill: SkillDef, t: BUnit, basicOfTarget: SkillDef | undefined): Forecast {
  const counter = canCounter(st, a, skill, t, basicOfTarget)
    ? { damage: skillDamage(st, t, basicOfTarget!, a, true), hit: hitChance(st, t, basicOfTarget!, a) }
    : null;
  return { damage: skillDamage(st, a, skill, t), hit: hitChance(st, a, skill, t), crit: critChance(a), counter };
}

// ---------------------------------------------------------------- 造りを壊す（門・砦の門・柵）

/** 壊せる造りのマス：攻め手の駒の、通常攻撃の届くマスにある、だれもいない造り。守り手の駒は壊さない */
export function breachTargets(st: BattleState, u: BUnit): number[] {
  if (u.side !== 0 || !st.structures) return [];
  const s = basicSkill(u);
  if (!s || s.noDamage) return [];
  const [min, max] = skillRange(st, u, s);
  return st.map.grid.range(u.pos, max, min).filter((i) => st.structures![i] && !unitAt(st, i));
}

/** 造りを壊すダメージの内訳：通常攻撃の威力 × 攻撃 ÷ 造りの防御 × 攻城（石火矢・大筒の系統）× 火 */
export interface BreachParts { base: number; power: number; atk: number; def: number; siege: number; fire: number }

export function breachParts(st: BattleState, u: BUnit, cell: number): BreachParts {
  const s = basicSkill(u)!, str = st.structures![cell], S = BM.structures;
  const line = u.kind === 'troop' ? D.byUnit[u.defId]?.line : undefined;
  const p: BreachParts = {
    base: 0, power: s.power, atk: attackPower(st, u), def: str.def,
    siege: line !== undefined && S.siegeLines.includes(line) ? S.siegeMult : 1,
    fire: attackKinds(u, s.id, s.range, false).includes('fire') ? S.fireMult : 1,
  };
  p.base = Math.max(1, Math.floor(p.power * p.atk / p.def * p.siege * p.fire));
  return p;
}