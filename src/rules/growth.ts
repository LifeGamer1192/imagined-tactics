// 成長と昇進（docs/13_実装計画 の P10）。経験値の表は data/system/exp.json。
// 昇進の判定（条件を1つずつ調べ、何が足りないかを返す）は rts-mons/web/src/classchange.js の形にならう。

import growthJson from '../../data/system/growth.json';
import cfgJson from '../../data/system/convert.json';
import type { GGeneral, GTroop, GrowthRank } from '../convert/model';
import type { RNG } from '../core/rng';
import { D } from '../data/db';
import type { ClassDef, StatBlock, UnitDef } from '../data/types';

type Range = [number, number];
const G = growthJson as unknown as {
  general: { hp: Range; mp: Range; mpTactical: Range; str: Range; int: Range; agi: Range };
  tacticalLines: string[]; maxMastery: number;
};
const MULT = (cfgJson as unknown as { growthMult: Record<GrowthRank, number> }).growthMult;
/** 必要経験値の曲線（全員共通）：LV1 を1倍として、LV7で2倍、LV13で5倍、LV31で26倍… */
export const expCurve = (level: number): number => 1 + ((level - 1) ** 2) / D.exp.curve.div;
export const MAX_MASTERY = G.maxMastery;

/** 範囲から1つ取る。rng が無ければ中央値（開始時のレベルぶんの成長に使う） */
function roll(r: Range, rng: RNG | null): number {
  return rng ? rng.int(r[0], r[1]) : (r[0] + r[1]) / 2;
}

/** 武将が1レベル上がったときの上昇量 */
export function generalGain(g: Pick<GGeneral, 'classId' | 'growth'>, rng: RNG | null): StatBlock {
  const tactical = G.tacticalLines.includes(D.byClass[g.classId].line);
  return {
    hp: roll(G.general.hp, rng), mp: roll(tactical ? G.general.mpTactical : G.general.mp, rng),
    str: roll(G.general.str, rng) * MULT[g.growth.str], int: roll(G.general.int, rng) * MULT[g.growth.int],
    agi: roll(G.general.agi, rng) * MULT[g.growth.agi],
  };
}

export function troopGain(unit: UnitDef, rng: RNG | null): StatBlock {
  return {
    hp: roll(unit.growth.hp, rng), mp: roll(unit.growth.mp, rng), str: roll(unit.growth.str, rng),
    int: roll(unit.growth.int, rng), agi: roll(unit.growth.agi, rng),
  };
}

function addStats(s: StatBlock, d: StatBlock, times = 1): void {
  s.hp += d.hp * times; s.mp += d.mp * times; s.str += d.str * times; s.int += d.int * times; s.agi += d.agi * times;
}
function roundStats(s: StatBlock): void {
  s.hp = Math.round(s.hp); s.mp = Math.round(s.mp); s.str = Math.round(s.str); s.int = Math.round(s.int); s.agi = Math.round(s.agi);
}

/** 開始時のレベルぶんの成長を、中央値でまとめて足す */
export function applyStartLevels(g: GGeneral): void {
  addStats(g.stats, generalGain(g, null), g.level - 1);
  roundStats(g.stats);
}

// ---------------------------------------------------------------- 経験値

/** 次のレベルまでに必要な経験値（レベルに上限は無い。上がるほど必要な量が増える） */
export function generalExpToNext(g: Pick<GGeneral, 'classId' | 'level'>): number {
  const c = D.byClass[g.classId];
  const k = c.unique ? D.exp.k.unique : D.exp.k.classes[c.id];
  return Math.round(k * expCurve(g.level));
}
export function troopExpToNext(t: Pick<GTroop, 'unitId' | 'level'>): number {
  return Math.round(D.exp.k.units[t.unitId] * expCurve(t.level));
}

/** 倒したときに得られる経験値 */
export function killExp(victim: { kind: 'general' | 'troop'; defId: string; level: number }): number {
  const c = D.byClass[victim.defId];
  if (victim.kind === 'troop' || !c) { const k = D.exp.kill.units[victim.defId]; return k ? k.base + k.perLv * victim.level : 0; }
  const k = (c.unique ? D.exp.kill.classUnique : D.exp.kill.classGeneric)[c.tier - 1];
  return k.base + k.perLv * victim.level;
}

/** 武将に経験値を与える。戻り値：上がったレベル数 */
export function gainGeneralExp(g: GGeneral, amount: number, rng: RNG): number {
  g.exp += Math.round(amount * (1 + g.expPct / 100));
  let ups = 0;
  while (g.exp >= generalExpToNext(g)) {
    g.exp -= generalExpToNext(g);
    g.level++; ups++;
    addStats(g.stats, generalGain(g, rng));
    roundStats(g.stats);
    const m = g.mastery[g.classId] ?? 0;
    if (m < MAX_MASTERY) {
      g.mastery[g.classId] = m + 1;
      // 熟練度が上限になったら、その役職の軍略を持ち越せるようになる
      if (m + 1 === MAX_MASTERY) for (const t of D.byClass[g.classId].tactics) if (!g.learned.includes(t)) g.learned.push(t);
    }
  }
  return ups;
}

export function gainTroopExp(t: GTroop, amount: number, rng: RNG): number {
  t.exp += Math.round(amount);
  let ups = 0;
  while (t.exp >= troopExpToNext(t)) {
    t.exp -= troopExpToNext(t);
    t.level++; ups++;
    addStats(t.stats, troopGain(D.byUnit[t.unitId], rng));
    roundStats(t.stats);
  }
  return ups;
}

// ---------------------------------------------------------------- 昇進

export interface PromotionCheck<T> { to: T; ok: boolean; missing: string[] }

/** 武将の昇進先と、足りない条件 */
export function generalPromotions(g: GGeneral): PromotionCheck<ClassDef>[] {
  const cur = D.byClass[g.classId];
  return D.classes.filter((c) => c.from === cur.id).map((c) => {
    const missing: string[] = [];
    if (c.req.lv && g.level < c.req.lv) missing.push(`レベル${c.req.lv}`);
    if (c.req.mastery && (g.mastery[cur.id] ?? 0) < c.req.mastery) missing.push(`熟練度${c.req.mastery}`);
    return { to: c, ok: missing.length === 0, missing };
  });
}

export function promoteGeneral(g: GGeneral, to: string): boolean {
  const p = generalPromotions(g).find((x) => x.to.id === to);
  if (!p?.ok) return false;
  g.classId = to;
  g.mastery[to] ??= 0;
  return true;
}

/** 兵の昇進先と、足りない条件。items は持っている昇進の品（id → 個数） */
export function troopPromotions(t: GTroop, items: Record<string, number> = {}): PromotionCheck<UnitDef>[] {
  return D.byUnit[t.unitId].promote.map((p) => {
    const missing: string[] = [];
    // 練兵の書でレベルの不足を飛ばせるのは、品の要らない昇進だけ（品とレベルの両方が要る昇進は、レベルも必ず要る。鉄盾衆など）
    if (p.lv && t.level < p.lv && (p.item || !(items.item_promote > 0))) missing.push(`レベル${p.lv}`);
    if (p.item && !(items[p.item] > 0)) missing.push(D.items[p.item]?.jp ?? p.item);
    return { to: D.byUnit[p.to], ok: missing.length === 0, missing };
  });
}

/** 兵を昇進させる。能力値には、昇進先と今の兵種の基礎値の差を足す */
export function promoteTroop(t: GTroop, to: string, items: Record<string, number> = {}): boolean {
  const p = troopPromotions(t, items).find((x) => x.to.id === to);
  if (!p?.ok) return false;
  const rule = D.byUnit[t.unitId].promote.find((x) => x.to === to)!;
  if (rule.item) items[rule.item]--;
  else if (rule.lv && t.level < rule.lv) items.item_promote--;
  const from = D.byUnit[t.unitId], next = D.byUnit[to];
  for (const k of ['hp', 'mp', 'str', 'int', 'agi'] as const) t.stats[k] += next[k] - from[k];
  t.unitId = to;
  return true;
}
