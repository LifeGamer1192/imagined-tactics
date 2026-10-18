// hist-sim のセーブ → ゲーム開始データ（docs/13_実装計画 の P4）。
// 係数と対応表は data/system/convert.json。同じセーブと同じ設定からは必ず同じ結果になる。

import cfgJson from '../../data/system/convert.json';
import {
  ageOf, aliveNations, buildingsOf, monthOf, yearOf,
  type HNation, type HPerson, type HPersonRec, type HSave, type HWorld, type Name, type NotableRole, offstageCells,
} from '../bridge/histsim';
import { RNG, codeToSeed } from '../core/rng';
import { D } from '../data/db';
import type { ClassDef, Passive, StatBlock, UnitDef, Variant } from '../data/types';
import { armShares } from '../bridge/arms';
import { applyStartLevels } from '../rules/growth';
import type { GFaction, GGeneral, GProvince, GRole, GTroop, GameStart, GrowthRank } from './model';

type TraitRule = { str?: number; int?: number; agi?: number; command?: number; commandRange?: number; passive?: string; expPct?: number; healPct?: number; critPct?: number; loyalty?: number };
type Weights = Record<string, number>;
interface Cfg {
  minAge: number; defaultFame: number; staleAge: { over: number; from: number; span: number };
  stats: {
    str: { base: number; mil: number }; int: { base: number; adminDip: number }; agi: { base: number; mil: number; cha: number };
    hp: { base: number; mil: number; cha: number; healthMin: number; healthSpan: number }; mpPerInt: number;
    command: { base: number; cha: number; fame: number }; commandRange: { base: number; cha7: number; cha9: number; max: number };
  };
  traits: Record<string, TraitRule>;
  growthRank: { S: number; A: number; B: number };
  level: { base: number; perFame: number; yearsDiv: number; adultAge: number; maxYears: number; rulerBonus: number; min: number; max: number };
  classPick: { martial: string[]; tactical: string[]; roleBonus: number; kenshiAgi: number; gedoTraits: string[] };
  lordClass: { when: { government?: string; governmentIn?: string[]; economy?: string; sex?: string; maxAge?: number }; line: string }[];
  lordTopLevel: number; lordTopProvinceShare: number; lordCommandBonus: number; lordFamePrestigeDiv: number;
  troops: {
    maxPerGeneral: number; fillNoArmy: number; fillMin: number; base: Weights; economy: Record<string, Weights>;
    /** hist-sim の兵種の見た目の種類 → hex-sim の兵種。割合に掛ける重み、拾う最小の割合、ほかの決まりを混ぜる割合 */
    glyph: Record<string, string>; armsScale: number; armsMinShare: number; armsOtherMult: number;
    armyRole: Record<string, Weights>; theocracy: Weights; rich: Weights; richTreasury: number; mountainBiome: Weights; forestBiome: Weights;
    levelFromTech: { base: number; techOrigin: number; techScale: number; prestigeDiv: number; max: number };
    unlock: Record<Variant, Record<string, { fromYear?: number; untilYear?: number }>>;
  };
  supply: { treasuryScale: number; perPop: number };
  variantByScenario: Record<string, Variant>;
}
export const CFG = cfgJson as unknown as Cfg;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const ab4 = (p: HPerson): [number, number, number, number] => [
  clamp(p.admin ?? 5, 0, 10), clamp(p.military ?? 5, 0, 10), clamp(p.diplomacy ?? 5, 0, 10), clamp(p.charisma ?? 5, 0, 10),
];
/** 1つの領から出る海路の数の上限 */
const SEA_LINKS = 2;
const MOUNTAIN_BIOMES = new Set([14]);
const FOREST_BIOMES = new Set([4, 5, 7, 8, 9]);

/** 版（日本版・中国版）：シナリオから決める。決められないときは引数の既定値 */
export function variantOf(save: HSave, fallback: Variant = 'jp'): Variant {
  const id = save.world.scenario?.id;
  return (id && CFG.variantByScenario[id]) || fallback;
}

// ---------------------------------------------------------------- 能力値（4-3）

export function rankOf(v: number): GrowthRank {
  const r = CFG.growthRank;
  return v >= r.S ? 'S' : v >= r.A ? 'A' : v >= r.B ? 'B' : 'C';
}

export interface ConvertedStats {
  stats: StatBlock; command: number; commandRange: number;
  growth: { str: GrowthRank; int: GrowthRank; agi: GrowthRank };
  passives: Passive[]; expPct: number; healPct: number; critPct: number; loyalty: number;
}

/** hist-sim の能力4つ・健康・特性・名声 → ゲームの能力値 */
export function convertStats(ab: [number, number, number, number], health: number, traits: string[], fame: number): ConvertedStats {
  const [a, m, d, c] = ab;
  const s = CFG.stats;
  let str = s.str.base + s.str.mil * m;
  let int = Math.round(s.int.base + s.int.adminDip * (a + d));
  let agi = s.agi.base + s.agi.mil * m + s.agi.cha * c;
  const hp = Math.round((s.hp.base + s.hp.mil * m + s.hp.cha * c) * (s.hp.healthMin + s.hp.healthSpan * clamp(health, 0, 1)));
  let command = s.command.base + s.command.cha * c + s.command.fame * (fame - CFG.defaultFame);
  let range = s.commandRange.base + (c >= 7 ? s.commandRange.cha7 : 0) + (c >= 9 ? s.commandRange.cha9 : 0);
  const passives: Passive[] = [];
  let expPct = 0, healPct = 0, critPct = 0, loyalty = 0;
  for (const t of traits) {
    const r = CFG.traits[t];
    if (!r) continue;
    str += r.str ?? 0; int += r.int ?? 0; agi += r.agi ?? 0;
    command += r.command ?? 0; range += r.commandRange ?? 0;
    expPct += r.expPct ?? 0; healPct += r.healPct ?? 0; critPct += r.critPct ?? 0; loyalty += r.loyalty ?? 0;
    if (r.passive === 'counterDamage') passives.push({ type: 'counterDamage', pct: 20 });
    if (r.passive === 'evade') passives.push({ type: 'evade', pct: 10 });
    if (r.passive === 'hit') passives.push({ type: 'hit', pct: 10 });
  }
  str = clamp(str, 1, 150); int = clamp(int, 1, 150); agi = clamp(agi, 1, 150);
  return {
    stats: { hp, mp: Math.round(int * s.mpPerInt), str, int, agi },
    command: Math.round(Math.max(40, command)),
    commandRange: clamp(range, 1, s.commandRange.max),
    growth: { str: rankOf(m), int: rankOf((a + d) / 2), agi: rankOf((m + c) / 2) },
    passives, expPct, healPct, critPct, loyalty,
  };
}

/** 開始時のレベル：名声と、成人してからの年数 */
export function startLevel(fame: number, age: number, isRuler: boolean): number {
  const l = CFG.level;
  const years = clamp(age - l.adultAge, 0, l.maxYears);
  return clamp(Math.round(l.base + (fame - CFG.defaultFame) * l.perFame + years / l.yearsDiv + (isRuler ? l.rulerBonus : 0)), l.min, l.max);
}

// ---------------------------------------------------------------- 役職（4-4・4-5）

/** 記録の無い人物の役割：能力4つのうち最も高いもので決める */
export function inferRole(ab: [number, number, number, number]): NotableRole {
  const [a, m, d, c] = ab;
  const top = Math.max(a, m, d, c);
  if (m === top) return 'general';
  if (a === top || d === top) return 'minister';
  return 'hero';
}

function aptitude(cid: string, ab: [number, number, number, number], role: GRole, traits: string[]): number {
  const [a, m, d, c] = ab;
  const has = (t: string) => traits.includes(t);
  let v: number;
  switch (cid) {
    case 'ashigaru': case 'naginata': v = m + a / 2; break;
    case 'nobushi': v = m * 1.2 + (has('brave') || has('warrior') ? 2 : 0); break;
    case 'rappa': v = (m + c) / 2 + (role === 'hero' || role === 'explorer' ? 2 : 0); break;
    case 'sohei': v = m + (has('pious') ? 2 : 0); break;
    case 'gunbaisha': case 'onna_gunbaisha': v = a + d; break;
    case 'so': case 'ama': v = (a + d + c) / 2 + (has('pious') ? 2 : 0) + (role === 'saint' ? 3 : 0); break;
    case 'yumime': v = m + c / 2; break;
    case 'aruki_miko': v = c + m / 2 + (role === 'hero' ? 2 : 0); break;
    case 'shirabyoshi': v = c + d / 2 + (role === 'artist' ? 3 : 0); break;
    default: v = 0;
  }
  const p = CFG.classPick;
  if (role === 'general' && p.martial.includes(cid)) v += p.roleBonus;
  if ((role === 'minister' || role === 'scholar') && p.tactical.includes(cid)) v += p.roleBonus;
  return v;
}

const BASE_CLASSES = D.classes.filter((c) => c.tier === 1 && !c.unique);
const meets = (c: ClassDef, s: StatBlock): boolean =>
  s.str >= (c.req.str ?? 0) && s.int >= (c.req.int ?? 0) && s.agi >= (c.req.agi ?? 0);

/** 下級の役職を決める。条件を満たすものが無ければ、適性が最も高い役職の条件まで能力値を引き上げる（stats を書き換える） */
export function pickBaseClass(sex: 'm' | 'f', ab: [number, number, number, number], role: GRole, traits: string[], stats: StatBlock): { cls: ClassDef; raised: boolean } {
  const cands = BASE_CLASSES.filter((c) => c.sex === sex)
    .map((c, i) => ({ c, i, v: aptitude(c.id, ab, role, traits) }))
    .sort((x, y) => y.v - x.v || x.i - y.i);
  const ok = cands.find((x) => meets(x.c, stats));
  if (ok) return { cls: ok.c, raised: false };
  const best = cands[0].c;
  stats.str = Math.max(stats.str, best.req.str ?? 0);
  stats.int = Math.max(stats.int, best.req.int ?? 0);
  stats.agi = Math.max(stats.agi, best.req.agi ?? 0);
  return { cls: best, raised: true };
}

/** レベルに応じて上級・最上級にする（熟練度は満たしたものとみなす） */
export function advanceClass(base: ClassDef, level: number, stats: StatBlock, traits: string[]): ClassDef {
  let cur = base;
  for (const [tier, lv] of [[2, 10], [3, 20]] as const) {
    if (level < lv) break;
    const next = D.classes.filter((c) => c.from === cur.id && c.tier === tier);
    if (!next.length) break;
    let pick = next[0];
    if (cur.id === 'ashigaru') pick = next.find((c) => c.id === (stats.agi >= CFG.classPick.kenshiAgi ? 'kenshi' : 'samurai')) ?? pick;
    if (cur.id === 'samurai') pick = next.find((c) => c.id === (traits.some((t) => CFG.classPick.gedoTraits.includes(t)) ? 'gedo_musha' : 'samurai_taisho')) ?? pick;
    cur = pick;
  }
  return cur;
}

/** 当主の固有役職の系統を決める */
export function lordLine(n: Pick<HNation, 'government' | 'economy'>, sex: 'm' | 'f', age: number): string {
  for (const r of CFG.lordClass) {
    const w = r.when;
    if (w.government && w.government !== n.government) continue;
    if (w.governmentIn && !w.governmentIn.includes(n.government)) continue;
    if (w.economy && w.economy !== n.economy) continue;
    if (w.sex && w.sex !== sex) continue;
    if (w.maxAge !== undefined && age > w.maxAge) continue;
    return r.line;
  }
  return 'daimyo';
}

function lordClass(line: string, level: number, provinceShare: number): ClassDef {
  const chain = D.classes.filter((c) => c.line === line).sort((x, y) => x.tier - y.tier);
  const top = level >= CFG.lordTopLevel || provinceShare >= CFG.lordTopProvinceShare;
  if (chain[0].tier === 1) {
    // 3段階ある系統（国人）：レベルで段階を決める
    return top ? chain[chain.length - 1] : level >= 10 ? chain[1] : chain[0];
  }
  return top ? chain[chain.length - 1] : chain[0];
}

// ---------------------------------------------------------------- 兵（4-7）

/** レベル1の能力値から、指定レベルまで成長幅の中央値で伸ばした兵 */
export function makeTroop(unit: UnitDef, level: number): GTroop {
  const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
  const n = level - 1;
  return {
    unitId: unit.id, level, exp: 0,
    stats: {
      hp: Math.round(unit.hp + mid(unit.growth.hp) * n), mp: Math.round(unit.mp + mid(unit.growth.mp) * n),
      str: Math.round(unit.str + mid(unit.growth.str) * n), int: Math.round(unit.int + mid(unit.growth.int) * n),
      agi: Math.round(unit.agi + mid(unit.growth.agi) * n),
    },
  };
}

function unlocked(unitId: string, variant: Variant, year: number): boolean {
  const u = CFG.troops.unlock[variant]?.[unitId];
  if (!u) return true;
  if (u.fromYear !== undefined && year < u.fromYear) return false;
  if (u.untilYear !== undefined && year > u.untilYear) return false;
  return true;
}

function addWeights(into: Weights, add: Weights | undefined): void {
  if (!add) return;
  for (const [k, v] of Object.entries(add)) into[k] = (into[k] ?? 0) + v;
}

/** レベルに応じて昇進させた兵種（品が要る昇進、解禁前の兵種は除く） */
function promotedUnit(unit: UnitDef, level: number, variant: Variant, year: number, rng: RNG): UnitDef {
  let cur = unit;
  for (;;) {
    const next = cur.promote.filter((p) => p.lv !== undefined && level >= p.lv && unlocked(p.to, variant, year));
    if (!next.length) return cur;
    cur = D.byUnit[rng.pick(next).to];
  }
}

function pickTroops(weights: Weights, budget: number, level: number, variant: Variant, year: number, rng: RNG): GTroop[] {
  const out: GTroop[] = [];
  let left = budget;
  while (out.length < CFG.troops.maxPerGeneral) {
    const cands = Object.entries(weights)
      .map(([id, w]) => ({ u: promotedUnit(D.byUnit[id], level, variant, year, rng.fork(`p:${id}:${out.length}`)), w }))
      .filter((x) => x.w > 0 && x.u.cost <= left);
    if (!cands.length) break;
    let r = rng.float() * cands.reduce((s, x) => s + x.w, 0);
    let pick = cands[cands.length - 1];
    for (const x of cands) { r -= x.w; if (r < 0) { pick = x; break; } }
    out.push(makeTroop(pick.u, level));
    left -= pick.u.cost;
  }
  return out;
}

// ---------------------------------------------------------------- 全体

export function convert(save: HSave, opts: { variant?: Variant } = {}): GameStart {
  const w: HWorld = save.world;
  const variant = opts.variant ?? variantOf(save);
  const year = yearOf(w), tick = w.tick;
  const log: string[] = [];
  const nations = aliveNations(w);
  const aliveIds = new Set(nations.map((n) => n.id));
  const totalProvinces = Math.max(1, nations.reduce((s, n) => s + (n.provinceCount || 0), 0));

  // ---- 領
  const provinces: GProvince[] = w.provinces.map((p) => ({
    id: p.id, name: w.provinceName[p.id] ?? { ja: `第${p.id}領`, en: `Province ${p.id}` },
    owner: w.ps.owner[p.id] ?? 0, controller: w.ps.controller[p.id] ?? 0,
    nb: [...p.nb], sea: [...(w.seaLinks[p.id] ?? [])],
    pop: w.ps.pop[p.id] ?? 0,
    income: (w.ps.pop[p.id] ?? 0) * (w.ps.prosperity[p.id] ?? 0.5) * (1 - (w.ps.devastation[p.id] ?? 0)) * CFG.supply.perPop,
    fort: w.ps.fort[p.id] ?? 0, buildings: buildingsOf(w.ps.buildings[p.id] ?? 0),
    biome: p.biome, elevation: p.elevation, river: !!p.river, coastal: !!p.coastal,
    unrest: w.ps.unrest[p.id] ?? 0, cx: p.cx, cy: p.cy,
  }));

  // 海路：hist-sim では海沿いの領どうしが広くつながっている。戦略マップでは、近い順に2つまでに絞る（相手側からも同じ線でつながる）
  const seaPairs = new Set<string>();
  for (const p of provinces) {
    const near = p.sea.filter((j) => provinces[j] && !p.nb.includes(j))
      .sort((a, b) => Math.hypot(provinces[a].cx - p.cx, provinces[a].cy - p.cy) - Math.hypot(provinces[b].cx - p.cx, provinces[b].cy - p.cy) || a - b)
      .slice(0, SEA_LINKS);
    for (const j of near) seaPairs.add(p.id < j ? `${p.id}-${j}` : `${j}-${p.id}`);
  }
  for (const p of provinces) p.sea = [];
  for (const k of seaPairs) { const [a, b] = k.split('-').map(Number); provinces[a].sea.push(b); provinces[b].sea.push(a); }
  // 舞台の外の領（どの勢力の領も無い陸のかたまり）は、遊びから外す：隣どうしのつながりを切る
  const off = offstageCells(w);
  if (off.some((v) => v)) {
    for (const p of provinces) if (w.provinces[p.id].cells.length && w.provinces[p.id].cells.every((c) => off[c])) p.out = true;
    for (const p of provinces) {
      if (p.out) { p.nb = []; p.sea = []; continue; }
      p.nb = p.nb.filter((j) => !provinces[j].out); p.sea = p.sea.filter((j) => !provinces[j].out);
    }
  }

  // ---- 勢力
  const factions: Record<number, GFaction> = {};
  /**
   * 雇える兵種と選ばれやすさ。セーブに「記録にある兵種」が入っていれば、その国がその年に使っていた兵種の割合を土台にする。
   * 無ければ（架空の世界、古いセーブ）、経済などから決めるこれまでの決まりだけを使う。
   * land：土地の兵（山・森）を足す領。勢力の一覧では国の領ぜんぶ（山が1つでもあれば山の兵、半分以上が森なら森の兵）、
   * 領の一覧（P37）ではその領だけ
   */
  const weightsFor = (n: HNation | null, land: GProvince[], perProvince: boolean): Weights => {
    const recruit: Weights = {};
    const shares = n ? armShares(w, n, year) : null;
    const other: Weights = {};
    if (!shares) addWeights(other, CFG.troops.base);
    if (n) {
      addWeights(other, CFG.troops.economy[n.economy]);
      if (n.government === 'theocracy' || n.ruler.traits?.includes('pious')) addWeights(other, CFG.troops.theocracy);
      if (n.treasury >= CFG.troops.richTreasury) addWeights(other, CFG.troops.rich);
    }
    if (land.some((p) => MOUNTAIN_BIOMES.has(p.biome))) addWeights(other, CFG.troops.mountainBiome);
    if (perProvince ? land.some((p) => FOREST_BIOMES.has(p.biome)) : land.filter((p) => FOREST_BIOMES.has(p.biome)).length * 2 >= Math.max(1, land.length)) addWeights(other, CFG.troops.forestBiome);
    if (shares) {
      for (const [glyph, share] of Object.entries(shares)) {
        const id = CFG.troops.glyph[glyph];
        if (id && share >= CFG.troops.armsMinShare) recruit[id] = (recruit[id] ?? 0) + share * CFG.troops.armsScale;
      }
      for (const [id, v] of Object.entries(other)) recruit[id] = (recruit[id] ?? 0) + v * CFG.troops.armsOtherMult;
    } else addWeights(recruit, other);
    // 記録にある兵種は、年代の条件（記録の側で決まっている）を重ねて確かめない
    for (const id of Object.keys(recruit)) {
      const fromArms = !!shares && Object.entries(shares).some(([g, sh]) => CFG.troops.glyph[g] === id && sh >= CFG.troops.armsMinShare);
      if (!D.byUnit[id] || (!fromArms && !unlocked(id, variant, year))) delete recruit[id];
    }
    return recruit;
  };
  // 領ごとの雇える兵種（P37）：はじめの持ち主の国の土台に、その領の土地の兵を足す。領を奪えば、その領の兵種も雇える
  const nationById = new Map(nations.map((n) => [n.id, n]));
  for (const p of provinces) if (!p.out) p.recruit = weightsFor(nationById.get(p.owner) ?? null, [p], true);
  for (const n of nations) {
    const own = provinces.filter((p) => p.owner === n.id);
    const recruit = weightsFor(n, own, false);
    const lt = CFG.troops.levelFromTech;
    factions[n.id] = {
      id: n.id, name: n.label ?? n.root, color: n.color, government: n.government, economy: n.economy,
      capital: n.capital, overlord: aliveIds.has(n.overlord) ? n.overlord : 0,
      supply: Math.round(n.treasury * CFG.supply.treasuryScale),
      income: Math.round(own.reduce((s, p) => s + p.income, 0)),
      lordId: '', tech: n.tech, prestige: n.prestige, stability: n.stability, reforms: n.reforms ?? [],
      // 心証は戦略パートで書き換えるので、セーブのものとは別に持つ
      opinions: { ...(n.opinions ?? {}) }, recruit,
      troopLevel: clamp(Math.round(lt.base + (n.tech - lt.techOrigin) * lt.techScale + n.prestige / lt.prestigeDiv), 1, lt.max),
    };
  }

  // ---- 武将
  const generals: Record<string, GGeneral> = {};
  const byPid = new Map<number, string>();
  const byKey = new Map<string, string>();
  const keyOf = (p: HPerson) => `${p.name?.ja}|${p.born}`;
  const add = (id: string, p: HPerson, faction: number, role: GRole, rec: HPersonRec | undefined, isLord: boolean, prov: number): GGeneral | null => {
    if (p.pid !== undefined && byPid.has(p.pid)) return null;
    if (byKey.has(keyOf(p))) return null;
    const age = ageOf(p, tick);
    if (age < CFG.minAge) return null;
    const ab = ab4(p);
    if (p.admin === undefined || p.military === undefined) log.push(`${p.name?.ja ?? id}：能力が無いため既定値（5）で補った`);
    const traits = p.traits ?? [];
    const sex = p.sex ?? 'm';
    // 名声：記録上の人物（役割がある）はその名声。当主は勢力の威信から。それ以外は標準
    const fame = isLord
      ? Math.max(rec?.fame ?? 0, CFG.defaultFame + (w.nations[faction]?.prestige ?? 0) / CFG.lordFamePrestigeDiv)
      : rec?.role ? Math.max(1, rec.fame) : CFG.defaultFame;
    const cs = convertStats(ab, p.health ?? 1, traits, fame);
    const level = startLevel(fame, age, isLord);
    let cls: ClassDef;
    if (isLord) {
      const n = w.nations[faction]!;
      cls = lordClass(lordLine(n, sex, age), level, (n.provinceCount || 0) / totalProvinces);
      cs.command += CFG.lordCommandBonus;
    } else {
      const r = pickBaseClass(sex, ab, role, traits, cs.stats);
      if (r.raised) log.push(`${p.name?.ja ?? id}：条件を満たす役職が無いため、${r.cls.name[variant]}の条件まで能力値を引き上げた`);
      cls = advanceClass(r.cls, level, cs.stats, traits);
    }
    const g: GGeneral = {
      id, pid: p.pid, name: p.name ?? { ja: '名無し', en: 'Nameless' }, house: p.house ?? { ja: '', en: '' },
      faction, sex, age, role, isLord, fame, office: rec?.office, traits, ab,
      classId: cls.id, level, exp: 0, learned: [], mastery: { [cls.id]: 0 },
      stats: cs.stats, command: cs.command, commandRange: cs.commandRange, growth: cs.growth,
      passives: cs.passives, expPct: cs.expPct, healPct: cs.healPct, critPct: cs.critPct, loyalty: cs.loyalty,
      ties: [], prov, troops: [],
    };
    applyStartLevels(g);
    generals[id] = g;
    if (p.pid !== undefined) byPid.set(p.pid, id);
    byKey.set(keyOf(p), id);
    return g;
  };

  const armyFill = new Map<string, { fill: number; role: string }>();
  for (const n of nations) {
    const rulerPid = n.ruler.pid ?? w.reigning[n.id];
    const rec = rulerPid !== undefined ? w.people[rulerPid] : undefined;
    const g = add(rulerPid !== undefined ? `p${rulerPid}` : `r${n.id}`, { ...n.ruler, pid: rulerPid }, n.id, 'ruler', rec, true, n.capital);
    if (g) factions[n.id].lordId = g.id;
    else {
      // 幼い当主など：当主は必ず武将にする
      const forced = { ...n.ruler, pid: rulerPid, born: tick - CFG.minAge * 12 };
      const g2 = add(`r${n.id}`, forced, n.id, 'ruler', rec, true, n.capital);
      if (g2) { factions[n.id].lordId = g2.id; log.push(`${n.ruler.name?.ja}：${CFG.minAge}歳未満の当主を、${CFG.minAge}歳として武将にした`); }
    }
    for (const [tag, p] of [['h', n.heir], ['c', n.coRuler]] as const) {
      if (p) add(p.pid !== undefined ? `p${p.pid}` : `${tag}${n.id}`, p, n.id, tag === 'h' ? 'heir' : inferRole(ab4(p)), p.pid !== undefined ? w.people[p.pid] : undefined, false, n.capital);
    }
  }
  for (const a of w.armies) {
    if (!aliveIds.has(a.nation) || !a.general) continue;
    let p = a.general;
    const rec = p.pid !== undefined ? w.people[p.pid] : undefined;
    const id = p.pid !== undefined ? `p${p.pid}` : `a${a.id}`;
    // 長い年月を進めたセーブでは、軍の大将が昔の人のまま残っていることがある（何百歳にもなる）。
    // 記録の上で亡くなっている人は武将にしない。記録の無い大将は、生まれた月が古いままなので、働き盛りの歳に直す
    if (rec && rec.died !== -1) { log.push(`${p.name?.ja ?? id}：すでに亡くなっているため、武将にしなかった（軍の大将の欄に残っていた）`); continue; }
    if (!rec && ageOf(p, tick) > CFG.staleAge.over) {
      const age = CFG.staleAge.from + ((a.id * 7 + a.nation * 3) % CFG.staleAge.span);
      log.push(`${p.name?.ja ?? id}：${ageOf(p, tick)}歳になっていたため、${age}歳に直した（軍の大将の生まれた月が古いまま）`);
      p = { ...p, born: tick - age * 12 };
    }
    const g = add(id, p, a.nation, rec?.role ?? 'general', rec, false, a.prov);
    const gid = g?.id ?? (p.pid !== undefined ? byPid.get(p.pid) : byKey.get(keyOf(p)));
    if (gid) {
      generals[gid].prov = a.prov;
      const fill = clamp(a.maxTroops > 0 ? a.troops / a.maxTroops : CFG.troops.fillNoArmy, CFG.troops.fillMin, 1);
      const prev = armyFill.get(gid);
      if (!prev || fill > prev.fill) armyFill.set(gid, { fill, role: a.role });
    }
  }
  for (const rec of Object.values(w.people)) {
    if (rec.died !== -1) continue;
    const serving = aliveIds.has(rec.court) ? rec.court : 0;
    const role: GRole = rec.role ?? inferRole(ab4(rec.p));
    add(`p${rec.id}`, { ...rec.p, pid: rec.id }, serving, role, rec, false, serving ? w.nations[serving]!.capital : -1);
  }

  // ---- 人物どうしの関係
  for (const rec of Object.values(w.people)) {
    const me = byPid.get(rec.id);
    if (!me) continue;
    for (const t of rec.ties ?? []) {
      const other = byPid.get(t.with);
      if (other && !t.settled) generals[me].ties.push({ kind: t.kind, with: other });
    }
  }

  // ---- 開始時の兵
  for (const g of Object.values(generals)) {
    const f = factions[g.faction];
    if (!f) continue;
    const af = armyFill.get(g.id);
    const weights: Weights = { ...f.recruit };
    if (af) {
      addWeights(weights, CFG.troops.armyRole[af.role]);
      for (const id of Object.keys(weights)) if (!D.byUnit[id] || !unlocked(id, variant, year)) delete weights[id];
    }
    const budget = g.command * (af?.fill ?? CFG.troops.fillNoArmy);
    g.troops = pickTroops(weights, budget, f.troopLevel, variant, year, new RNG(codeToSeed(`${w.seed}:${tick}:troops:${g.id}`)));
  }

  // ---- 外交
  const pair = (k: string): [number, number] => k.split('-').map(Number) as [number, number];
  const bothAlive = ([a, b]: [number, number]) => aliveIds.has(a) && aliveIds.has(b);
  return {
    seed: w.seed, scenario: w.scenario?.id ?? null, variant, worldName: w.name,
    year, month: monthOf(tick), tick,
    factions, generals, provinces,
    wars: w.wars.map((x) => ({ attackers: x.attackers.filter((i) => aliveIds.has(i)), defenders: x.defenders.filter((i) => aliveIds.has(i)) }))
      .filter((x) => x.attackers.length && x.defenders.length),
    alliances: Object.keys(w.alliances).map(pair).filter(bothAlive),
    truces: Object.entries(w.truces).map(([k, v]) => ({ a: pair(k)[0], b: pair(k)[1], until: v.until }))
      .filter((t) => t.until > tick && aliveIds.has(t.a) && aliveIds.has(t.b)),
    log,
  };
}

/**
 * 開始後に加わる人物（元服した一族など）を武将にする。変換の決まりは開始時と同じ（当主ではない人物として扱う）。
 * 年齢が足りない、またはすでに武将になっているときは null。
 */
export function newcomer(gs: GameStart, rec: HPersonRec, faction: number, prov: number): GGeneral | null {
  const id = `p${rec.id}`;
  if (gs.generals[id]) return null;
  const p = rec.p;
  const age = ageOf(p, gs.tick);
  if (age < CFG.minAge) return null;
  const ab = ab4(p), traits = p.traits ?? [], sex = p.sex ?? 'm';
  const role: GRole = rec.role ?? inferRole(ab);
  const fame = rec.role ? Math.max(1, rec.fame) : CFG.defaultFame;
  const cs = convertStats(ab, p.health ?? 1, traits, fame);
  const level = startLevel(fame, age, false);
  const cls = advanceClass(pickBaseClass(sex, ab, role, traits, cs.stats).cls, level, cs.stats, traits);
  const g: GGeneral = {
    id, pid: rec.id, name: p.name ?? { ja: '名無し', en: 'Nameless' }, house: p.house ?? { ja: '', en: '' },
    faction, sex, age, role, isLord: false, fame, office: rec.office, traits, ab,
    classId: cls.id, level, exp: 0, learned: [], mastery: { [cls.id]: 0 },
    stats: cs.stats, command: cs.command, commandRange: cs.commandRange, growth: cs.growth,
    passives: cs.passives, expPct: cs.expPct, healPct: cs.healPct, critPct: cs.critPct, loyalty: cs.loyalty,
    ties: [], prov, troops: [],
  };
  applyStartLevels(g);
  gs.generals[id] = g;
  return g;
}

/**
 * 守る武将のいない領を守る、守備兵の頭（その戦いのあいだだけ居る仮の武将）。
 * 記録に残る人物ではないので、名前は役目の名、能力は並より低く、特性も縁も持たない。戦いが済んだら呼んだ側が消す。
 */
export function makeGarrison(gs: GameStart, id: string, faction: number, prov: number, level: number, units: string[], troopLevel: number): GGeneral {
  const ab: [number, number, number, number] = [3, 4, 3, 3];
  const cs = convertStats(ab, 1, [], 1);
  const cls = advanceClass(pickBaseClass('m', ab, 'general', [], cs.stats).cls, level, cs.stats, []);
  const g: GGeneral = {
    id, name: gs.variant === 'cn' ? { ja: '守将', en: 'Garrison captain' } : { ja: '守備頭', en: 'Garrison captain' }, house: { ja: '', en: '' },
    faction, sex: 'm', age: 30, role: 'general', isLord: false, fame: 1, traits: [], ab,
    classId: cls.id, level, exp: 0, learned: [], mastery: { [cls.id]: 0 },
    stats: cs.stats, command: 999, commandRange: cs.commandRange, growth: cs.growth,
    passives: [], expPct: 0, healPct: 0, critPct: 0, loyalty: 0, ties: [], prov,
    troops: units.filter((u) => D.byUnit[u]).map((u) => makeTroop(D.byUnit[u], troopLevel)),
  };
  applyStartLevels(g);
  gs.generals[id] = g;
  return g;
}

/**
 * 兵から取り立てた武将。記録に残る人物ではないので、能力は並、特性も縁も持たない。レベルは、もとの兵のレベルを引き継ぐ。
 */
export function makeOfficer(gs: GameStart, id: string, name: string | Name, faction: number, prov: number, level: number, traits: string[] = [],
  rec: { ab?: [number, number, number, number]; age?: number; fame?: number; house?: Name } = {}): GGeneral {
  const ab: [number, number, number, number] = rec.ab ?? [4, 5, 3, 4], fame = rec.fame ?? 1;
  const cs = convertStats(ab, 1, traits, fame);
  const cls = advanceClass(pickBaseClass('m', ab, 'general', traits, cs.stats).cls, level, cs.stats, rec.ab ? traits : []);
  const g: GGeneral = {
    id, name: typeof name === 'string' ? { ja: name, en: name } : name, house: rec.house ?? { ja: '', en: '' },
    faction, sex: 'm', age: rec.age ?? 25, role: 'general', isLord: false, fame, traits: [...traits], ab,
    classId: cls.id, level, exp: 0, learned: [], mastery: { [cls.id]: 0 },
    stats: cs.stats, command: cs.command, commandRange: cs.commandRange, growth: cs.growth,
    passives: cs.passives, expPct: cs.expPct, healPct: cs.healPct, critPct: cs.critPct, loyalty: cs.loyalty,
    ties: [], prov, troops: [],
  };
  applyStartLevels(g);
  gs.generals[id] = g;
  return g;
}

/** 勢力の武将（浪人は faction 0） */
export function generalsOf(gs: GameStart, faction: number): GGeneral[] {
  return Object.values(gs.generals).filter((g) => g.faction === faction);
}
