// 武将の特性の、戦場での効き目（P56）。将本人と、配下のすべての兵に効く（兵に関係の無いもの＝采配・経験・忠誠は将だけ）。
// 数は data/system/convert.json の traits（strPct など）。戦闘を作るとき（battle/setup.ts）に駒へ当てる。

import cfgJson from '../../data/system/convert.json';
import type { BUnit } from '../battle/types';
import type { Passive } from '../data/types';

/** 特性1つぶんの決まり（convert.json の traits の1項目） */
export interface TraitRule {
  /** 武力・知略・機敏・体力・気力・防御の増減（％） */
  strPct?: number; intPct?: number; agiPct?: number; hpPct?: number; mpPct?: number; defPct?: number;
  /** 移動の増減 */
  move?: number;
  /** 回復の量（％）・会心（％ポイント）・反撃の威力（％）・命中（％）・回避（％）・軍略で受けるダメージと成功率を下げる（％） */
  healPct?: number; critPct?: number; counterPct?: number; hitPct?: number; evadePct?: number; resistPct?: number;
  /** 状態・弱化の軍略の成功率（％ポイント）・軍略の気力（％）・味方への補助の軍略の気力（％） */
  statusPct?: number; mpCostPct?: number; supportMpCostPct?: number;
  /** 戦略：領にこの特性の武将がいると普請の費用に掛ける数・この武将（または当主）が雇うときの兵糧に掛ける数 */
  buildCostMult?: number; recruitCostMult?: number;
  /** 以下は将だけ（変換のときに入る）：采配・采配の範囲・得る経験（％）・忠誠 */
  command?: number; commandRange?: number; expPct?: number; loyalty?: number;
}

export const TRAITS = (cfgJson as unknown as { traits: Record<string, TraitRule> }).traits;

/** 特性を足し合わせた、戦場の効き目 */
export interface TraitMods {
  strPct: number; intPct: number; agiPct: number; hpPct: number; mpPct: number; defPct: number; move: number;
  healPct: number; critPct: number; counterPct: number; hitPct: number; evadePct: number; resistPct: number;
  statusPct: number; mpCostPct: number; supportMpCostPct: number;
}

export function traitMods(traits: string[]): TraitMods {
  const m: TraitMods = { strPct: 0, intPct: 0, agiPct: 0, hpPct: 0, mpPct: 0, defPct: 0, move: 0, healPct: 0, critPct: 0, counterPct: 0, hitPct: 0, evadePct: 0, resistPct: 0, statusPct: 0, mpCostPct: 0, supportMpCostPct: 0 };
  for (const t of traits) {
    const r = TRAITS[t];
    if (!r) continue;
    for (const k of ['strPct', 'intPct', 'agiPct', 'hpPct', 'mpPct', 'defPct', 'move', 'healPct', 'critPct', 'counterPct', 'hitPct', 'evadePct', 'resistPct', 'statusPct', 'mpCostPct', 'supportMpCostPct'] as const) m[k] += r[k] ?? 0;
  }
  return m;
}

/** 前の版で、変換のときに将へ付けていた特性の特技（新しい版では戦場で付けるので、重ならないよう外す） */
const OLD_PASSIVE: Record<string, Passive> = { brave: { type: 'counterDamage', pct: 20 }, craven: { type: 'evade', pct: 10 }, warrior: { type: 'hit', pct: 10 } };
export function withoutOldTraitPassives(passives: Passive[], traits: string[]): Passive[] {
  const out = [...passives];
  for (const t of traits) {
    const old = OLD_PASSIVE[t];
    if (!old) continue;
    const i = out.findIndex((p) => p.type === old.type && 'pct' in p && 'pct' in old && p.pct === old.pct);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

const pct = (v: number, p: number): number => Math.max(1, Math.round(v * (1 + p / 100)));

/**
 * 駒に特性の効き目を当てる（戦闘を作るときに1度だけ）。traits を渡すと、何がどう変わったかを u.traitFx に書き留める（P58）
 */
export function applyTraitMods(u: BUnit, m: TraitMods, traits: string[] = []): void {
  const fx: NonNullable<BUnit['traitFx']> = [];
  const who = (k: keyof TraitRule): string[] => traits.filter((t) => TRAITS[t]?.[k]);
  const note = (stat: string, k: keyof TraitRule, v: number, unit: string, from?: number, to?: number): void => {
    if (v) fx.push({ stat, from, to, value: `${v > 0 ? '+' : ''}${v}${unit}`, traits: who(k) });
  };
  const scale = (stat: 'str' | 'int' | 'agi' | 'def', k: keyof TraitRule, p: number): void => {
    if (!p) return;
    const from = u[stat];
    u[stat] = pct(from, p);
    note(stat, k, p, '%', from, u[stat]);
  };
  scale('str', 'strPct', m.strPct); scale('int', 'intPct', m.intPct); scale('agi', 'agiPct', m.agiPct); scale('def', 'defPct', m.defPct);
  if (m.hpPct) { const from = u.maxHp; u.maxHp = pct(u.maxHp, m.hpPct); u.hp = u.maxHp; note('hp', 'hpPct', m.hpPct, '%', from, u.maxHp); }
  if (m.mpPct && u.maxMp > 0) { const from = u.maxMp; u.maxMp = pct(u.maxMp, m.mpPct); u.mp = u.maxMp; note('mp', 'mpPct', m.mpPct, '%', from, u.maxMp); }
  if (m.move) { const from = u.move; u.move = Math.max(1, u.move + m.move); note('move', 'move', m.move, '', from, u.move); }
  note('heal', 'healPct', m.healPct, '%'); note('crit', 'critPct', m.critPct, '');
  note('counter', 'counterPct', m.counterPct, '%'); note('hit', 'hitPct', m.hitPct, '%'); note('evade', 'evadePct', m.evadePct, '%'); note('resist', 'resistPct', m.resistPct, '%');
  note('status', 'statusPct', m.statusPct, ''); note('mpCost', 'mpCostPct', m.mpCostPct, '%'); note('supportCost', 'supportMpCostPct', m.supportMpCostPct, '%');
  if (fx.length) u.traitFx = fx;
  u.healPct += m.healPct;
  u.critPct += m.critPct;
  if (m.counterPct) u.passives.push({ type: 'counterDamage', pct: m.counterPct });
  if (m.hitPct) u.passives.push({ type: 'hit', pct: m.hitPct });
  if (m.evadePct) u.passives.push({ type: 'evade', pct: m.evadePct });
  if (m.resistPct) u.passives.push({ type: 'tacticResist', pct: m.resistPct });
  if (m.statusPct) u.statusPct = (u.statusPct ?? 0) + m.statusPct;
  if (m.mpCostPct) u.mpCostPct = (u.mpCostPct ?? 0) + m.mpCostPct;
  if (m.supportMpCostPct) u.supportMpCostPct = (u.supportMpCostPct ?? 0) + m.supportMpCostPct;
}
