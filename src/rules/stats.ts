// 状態変化を含めた、いまの能力値。期限付きの補正を重ねる考え方は rts-mons/web/src/rules.js の applyEffects にならう。

import type { BStatus, BUnit, BattleState } from '../battle/types';
import { D } from '../data/db';
import type { Affinity, Passive, SkillDef, StatusId, TerrainKind } from '../data/types';

export const has = (u: BUnit, id: StatusId): boolean => u.statuses.some((s) => s.id === id);
export const statusOf = (u: BUnit, id: StatusId): BStatus | undefined => u.statuses.find((s) => s.id === id);
export function removeStatus(u: BUnit, id: StatusId): void { u.statuses = u.statuses.filter((s) => s.id !== id); }

/** 行動できない状態（怯み・気絶・混乱） */
export const disabled = (u: BUnit): boolean => has(u, 'daze') || has(u, 'stun') || has(u, 'confuse');
/** 反撃できない状態 */
export const cannotCounter = (u: BUnit): boolean => disabled(u) || has(u, 'defect');

export function passive<T extends Passive['type']>(u: BUnit, type: T): Extract<Passive, { type: T }>[] {
  return u.passives.filter((p) => p.type === type) as Extract<Passive, { type: T }>[];
}
export const passivePct = (u: BUnit, type: 'evade' | 'hit' | 'crit' | 'counterDamage' | 'tacticResist'): number =>
  passive(u, type).reduce((s, p) => s + p.pct, 0);

export function immune(u: BUnit, id: StatusId): boolean {
  return passive(u, 'immune').some((p) => p.statuses.includes(id));
}

/** いまの得意地形（騎乗・足止めで変わる） */
export function affinityOf(u: BUnit): Affinity {
  if (has(u, 'grounded')) return 'plain';
  if (has(u, 'mounted')) return 'rider';
  return u.affinity;
}

export function leaderOf(st: BattleState, u: BUnit): BUnit { return st.units[u.leader]; }

/** 采配範囲の外にいる兵か（率いる武将が戦場にいない兵も含む） */
export function outOfCommand(st: BattleState, u: BUnit): boolean {
  if (u.kind !== 'troop') return false;
  const l = leaderOf(st, u);
  if (!l.alive) return true;
  return st.map.grid.distance(u.pos, l.pos) > l.commandRange;
}

export function attackPower(st: BattleState, u: BUnit): number {
  const S = D.status;
  let v = u.str * D.combat.atkPerStr;
  if (has(u, 'atkNext')) v += S.atkNext.atk;
  if (has(u, 'atkUp')) v += S.atkUp.atk;
  if (has(u, 'weaken')) v += S.weaken.atk;
  if (has(u, 'atkDown')) v += S.atkDown.atk;
  if (outOfCommand(st, u)) v *= 1 + S.outOfCommand.atkDefPct / 100;
  return Math.max(1, v);
}

export function defense(st: BattleState, u: BUnit): number {
  const S = D.status;
  if (has(u, 'confuse')) return S.confuse.def;
  let v = u.def;
  if (has(u, 'defUp')) v += S.defUp.def;
  if (has(u, 'weaken')) v += S.weaken.def;
  if (outOfCommand(st, u)) v *= 1 + S.outOfCommand.atkDefPct / 100;
  return Math.max(1, v);
}

export function agility(u: BUnit): number {
  const S = D.status;
  let v = u.agi;
  if (has(u, 'agiUp')) v += S.agiUp.agi;
  if (has(u, 'grounded')) v += S.grounded.agi;
  return v;
}

export function intellect(u: BUnit): number {
  return Math.max(1, u.int + (has(u, 'intDown') ? D.status.intDown.int : 0));
}

export function moveOf(u: BUnit): number {
  return u.move + (has(u, 'moveUp') ? D.status.moveUp.move : 0);
}

/** 軍略への耐性（0〜1。負なら受けるダメージが増える） */
export function tacticResist(st: BattleState, u: BUnit): number {
  let r = passivePct(u, 'tacticResist') / 100;
  if (has(u, 'resistUp')) r += D.status.resistUp.pct / 100;
  if (outOfCommand(st, u)) r -= D.status.outOfCommand.tacticDamagePct / 100;
  return Math.min(0.9, r);
}

export function terrainAt(st: BattleState, pos: number): TerrainKind { return st.map.terrain[pos]; }

/** 地形による命中・回避の補正 */
export function terrainMod(st: BattleState, u: BUnit): number {
  return D.terrain.hitMod[terrainAt(st, u.pos)][affinityOf(u)] ?? 0;
}

/** その地形から射程2以上の技を使うときの補正（櫓）。無ければ null */
function rangedPerch(st: BattleState, u: BUnit, skill: SkillDef): { hit: number; range: number } | null {
  if (skill.range[1] < 2 || skill.shape.type !== 'single') return null;
  return D.terrain.ranged[terrainAt(st, u.pos)] ?? null;
}

/** いまの位置から使うときの技の射程（櫓の上では、射程2以上の技が1マス遠くまで届く） */
export function skillRange(st: BattleState, u: BUnit, skill: SkillDef): [number, number] {
  const p = rangedPerch(st, u, skill);
  return p ? [skill.range[0], skill.range[1] + p.range] : skill.range;
}

/** 地形と天気による、技の命中の補正（地形の命中・回避とは別のぶん）。晴れの昼で、櫓の上でなければ 0 */
export function situationHit(st: BattleState, a: BUnit, skill: SkillDef, t: BUnit): number {
  const W = D.combat.weather;
  let v = rangedPerch(st, a, skill)?.hit ?? 0;
  if (st.weather === 'rain' && skill.range[1] >= 2) v += W.rainRangedHit;
  if (st.weather === 'fog' && st.map.grid.distance(a.pos, t.pos) >= 2) v += W.fogFarHit;
  if (st.night) v += W.nightHit;
  return v;
}

/** 雨で弱まる火の技・火の軍略の、威力の倍率 */
export function fireMult(st: BattleState, id: string): number {
  const W = D.combat.weather;
  return st.weather === 'rain' && (W.fireSkills.includes(id) || W.fireTactics.includes(id)) ? W.rainFireMult : 1;
}

/** 武将の通常攻撃を、技と同じ形にしたもの（id は "atk:役職id"） */
export function skillOf(id: string): SkillDef {
  if (!id.startsWith('atk:')) return D.bySkill[id];
  const c = D.byClass[id.slice(4)];
  return {
    id, name: { jp: c.attack.kind === 'bow' ? '弓' : '通常攻撃', cn: c.attack.kind === 'bow' ? '射' : '攻撃' },
    mp: 0, power: c.attack.power, range: c.attack.range, hit: c.attack.hit,
    vsGround: 'o', vsRider: c.attack.kind === 'bow' ? 'o' : 'tri',
    afterMove: true, counter: true, basic: true, shape: { type: 'single' }, targets: 'enemy', effects: [],
  };
}

/** 反撃に使う通常攻撃 */
export function basicSkill(u: BUnit): SkillDef | undefined {
  return u.skills.map(skillOf).find((s) => s.basic && s.counter);
}
