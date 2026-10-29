// 状態変化を含めた、いまの能力値。期限付きの補正を重ねる考え方は rts-mons/web/src/rules.js の applyEffects にならう。

import fieldJson from '../../data/system/field.json';
import type { BStatus, BUnit, BattleState } from '../battle/types';
import { D } from '../data/db';
import type { Affinity, Passive, SkillDef, StatusId, TerrainKind, UnitKind } from '../data/types';

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

// 強化・弱化は、もとの能力に対する％の増減（0.8.0。前は決まった数の足し引き）。重なったら％を足し合わせる（下は −90% まで）
/** ％の足し合わせを掛け目にする */
export const pctMult = (pcts: number[]): number => Math.max(0.1, 1 + pcts.reduce((a, b) => a + b, 0) / 100);
/** 攻撃に効く強化・弱化の％ */
export function atkPcts(u: BUnit): number[] {
  const S = D.status, out: number[] = [];
  if (has(u, 'atkNext')) out.push(S.atkNext.atkPct);
  if (has(u, 'atkUp')) out.push(S.atkUp.atkPct);
  if (has(u, 'weaken')) out.push(S.weaken.atkPct);
  if (has(u, 'atkDown')) out.push(S.atkDown.atkPct);
  return out;
}
/** 防御に効く強化・弱化の％ */
export function defPcts(u: BUnit): number[] {
  const S = D.status, out: number[] = [];
  if (has(u, 'defUp')) out.push(S.defUp.defPct);
  if (has(u, 'weaken')) out.push(S.weaken.defPct);
  return out;
}
/** 機敏に効く強化・弱化の％ */
export function agiPcts(u: BUnit): number[] {
  const S = D.status, out: number[] = [];
  if (has(u, 'agiUp')) out.push(S.agiUp.agiPct);
  if (has(u, 'grounded')) out.push(S.grounded.agiPct);
  return out;
}

export function attackPower(st: BattleState, u: BUnit): number {
  const S = D.status;
  let v = u.str * D.combat.atkPerStr * pctMult(atkPcts(u));
  if (outOfCommand(st, u)) v *= 1 + S.outOfCommand.atkDefPct / 100;
  v *= supplyMultOf(st, u);
  return Math.max(1, v);
}

/** 陣営の攻撃・防御の掛け目（飛び地で戦う側は 1 未満）。BattleState.supplyMult */
export function supplyMultOf(st: BattleState, u: BUnit): number { return st.supplyMult?.[u.home] ?? 1; }

/** 天守・砦の本丸・本陣（勝ち負けに関わる要のマス）に立つ駒の防御の掛け目（0.9.0。どちらの陣営でも） */
export function seatDefMult(st: BattleState, u: BUnit): number {
  return st.hold && u.pos === st.hold.cell ? 1 + D.combat.seatDefPct / 100 : 1;
}

export function defense(st: BattleState, u: BUnit): number {
  const S = D.status;
  if (has(u, 'confuse')) return S.confuse.def;
  let v = u.def * pctMult(defPcts(u)) * seatDefMult(st, u);
  if (outOfCommand(st, u)) v *= 1 + S.outOfCommand.atkDefPct / 100;
  v *= supplyMultOf(st, u);
  return Math.max(1, v);
}

export function agility(u: BUnit): number {
  return Math.round(u.agi * pctMult(agiPcts(u)));
}

export function intellect(u: BUnit): number {
  return Math.max(1, Math.round(u.int * pctMult(has(u, 'intDown') ? [D.status.intDown.intPct] : [])));
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
  const k = terrainAt(st, u.pos), v = D.terrain.hitMod[k][affinityOf(u)] ?? 0;
  // 歩兵（0.11.0）：森・山・沼での下がりは半分
  return v < 0 && ROUGH.has(k) && rugged(u) ? v / 2 : v;
}

// ---- 兵種の分類（0.11.0）
/** 森・山・沼（足場の悪い地形） */
export const ROUGH: ReadonlySet<string> = new Set(['forest', 'mountain', 'swamp']);
/** 森・山・沼での不利が半分の駒（歩兵） */
export const rugged = (u: BUnit): boolean => u.passives.some((p) => p.type === 'rugged');
/** 兵の分類（武将は無し） */
export function unitKind(u: BUnit): UnitKind | undefined {
  return u.kind === 'troop' ? D.byUnit[u.defId]?.kind : undefined;
}
/** 騎馬か（騎馬の兵、または騎の駒。下馬・落馬していれば違う） */
export function isCavalry(u: BUnit): boolean {
  if (has(u, 'grounded')) return false;
  return unitKind(u) === 'cavalry' || affinityOf(u) === 'rider';
}
export const KIND_NAME: Record<UnitKind, string> = { foot: '歩兵', spear: '槍', pike: '長槍', halberd: '戟', cavalry: '騎馬' };

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

/** 地形と天気の、攻撃の種類ごとの強まる・弱まる（data/system/field.json） */
export const FIELD = fieldJson as unknown as {
  kinds: Record<string, { jp: string; cn: string }>;
  tags: Record<string, string[]>;
  native: Partial<Record<TerrainKind, Affinity>>;
  terrain: Partial<Record<TerrainKind, { target?: Record<string, number>; attacker?: Record<string, number> }>>;
  weather: Record<string, Record<string, number>>;
};
const TAGSETS = Object.entries(FIELD.tags).map(([k, ids]) => [k, new Set(ids)] as const);

/**
 * 攻撃の種類（いくつも当てはまる）。火・水・鉄砲・騎馬の突撃・奇襲・夜襲は技の番号で決まる（field.json の tags）。
 * ほかは、軍略なら「軍略」、射程2以上なら「弓・投げ物」、射程1なら「近接」（得意地形が騎の兵・武将なら「騎馬の突撃」）
 */
export function attackKinds(a: BUnit, id: string, range: [number, number] | null, isTactic: boolean): string[] {
  const out: string[] = [];
  for (const [k, set] of TAGSETS) if (set.has(id)) out.push(k);
  if (isTactic) out.push('tactic');
  else if (!out.includes('gun') && !out.includes('charge')) {
    if ((range?.[1] ?? 1) >= 2) out.push('bow');
    else out.push(affinityOf(a) === 'rider' ? 'charge' : 'melee');
  }
  return out;
}

/** 地形と天気の倍率の内訳：倍率と、何が効いたか（[どこ・何, 種類, 倍率]） */
export interface FieldParts { mult: number; notes: [string, string, number][] }

/**
 * 地形と天気の倍率（ダメージに掛ける）。相手のいる地形（target）・攻める側のいる地形（attacker）・天気・夜を、攻撃の種類ごとに掛け合わせる。
 * 攻める側の弱まる値（1未満）は、その地形が得意な兵（field.json の native）には掛けない
 */
export function fieldMult(st: BattleState, a: BUnit, id: string, range: [number, number] | null, isTactic: boolean, t: BUnit): FieldParts {
  const kinds = attackKinds(a, id, range, isTactic);
  const p: FieldParts = { mult: 1, notes: [] };
  const add = (where: string, table: Record<string, number> | undefined, skipPenalty = false) => {
    if (!table) return;
    for (const k of kinds) {
      const v = table[k];
      if (v === undefined || v === 1 || (skipPenalty && v < 1)) continue;
      p.mult *= v; p.notes.push([where, k, v]);
    }
  };
  const tt = terrainAt(st, t.pos), at = terrainAt(st, a.pos);
  add(`相手が${TERRAIN_LABEL[tt] ?? tt}`, FIELD.terrain[tt]?.target);
  add(`自分が${TERRAIN_LABEL[at] ?? at}`, FIELD.terrain[at]?.attacker, FIELD.native[at] === affinityOf(a));
  add(WEATHER_LABEL[st.weather ?? 'clear'], FIELD.weather[st.weather ?? 'clear']);
  if (st.night) add('夜', FIELD.weather.night);
  return p;
}
const TERRAIN_LABEL: Partial<Record<TerrainKind, string>> = {
  plain: '草原', road: '道', bridge: '橋', forest: '森', mountain: '山', swamp: '湿地', water: '水の上', castle: '城', town: '街', cliff: '段差',
  camp: '陣', fort: '砦', paddy: '棚田', wall: '城壁', gate: '門', tower: '櫓', desert: '荒れ地', snowfield: '雪原', palisade: '柵', lookout: '物見櫓', fortgate: '砦の門',
};
const WEATHER_LABEL: Record<string, string> = { clear: '晴れ', rain: '雨', fog: '霧', snow: '雪' };

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
