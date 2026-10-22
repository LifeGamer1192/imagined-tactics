// ima-rpg のセーブ（.imarpg）を読んで、主人公・仲間・ライバル・率いる兵を、武将と兵として世界に加える（P61）。
// 形は ima-rpg の docs/HEX.md、換算は docs/IMARPG.md、数は data/system/imarpg.json。戦いの結果は ima-rpg へ書き戻さない。

import imaJson from '../../data/system/imarpg.json';
import { advanceClass, CFG, crown, makeOfficer, makeTroop, pickBaseClass } from '../convert/convert';
import type { GGeneral, GTroop, GameStart } from '../convert/model';
import { D } from '../data/db';
import { fillLowerClasses } from '../rules/growth';
import type { Variant } from '../data/types';
import { gunzip, parseSave, SaveError, type HSave } from './histsim';

// ---------------------------------------------------------------- セーブの形（使うところだけ）

type SkillId = 'blade' | 'bow' | 'speech' | 'letters' | 'trade' | 'medicine' | 'stealth' | 'theft';
interface ImaLt { id?: number; name?: string; type: string; xp?: number; lv: number; hexUnit?: string }
interface ImaTroop { men?: number; loyalty?: number; lts?: ImaLt[] }
export interface ImaPlayer {
  name: string; sex?: 'm' | 'f'; origin?: string; hp?: number; maxHp?: number; fame?: number;
  skills?: Partial<Record<SkillId, { lv: number } | number>>;
  patron?: number; rank?: number; arts?: string[]; mp?: number; troop?: ImaTroop;
  companions?: ImaCompanion[]; jail?: { until: number; prov: number }; infamy?: number;
  throne?: { realm: number; how: string; since: number; pid?: number }; dead?: { day: number; prov: number; by: string };
}
interface ImaCompanion { id?: number; name: string; sex?: 'm' | 'f'; age?: number; job?: string; pid?: number; blade?: number; bow?: number; medicine?: number; speech?: number; hp?: number; maxHp?: number; loyalty?: number; arts?: string[]; rivalId?: number }
interface ImaRival { id: number; goal?: string; realm?: number; rel?: number; joined?: boolean; g?: { player?: ImaPlayer; place?: { prov?: number } } }
export interface ImaGame {
  version: number; eraId?: string; day?: number; place?: { prov?: number; mode?: string };
  player: ImaPlayer; rivals?: ImaRival[]; feats?: { id: string }[];
}
export interface ImaFile { game: ImaGame; save: HSave; warnings: string[] }

const I = imaJson as unknown as {
  stats: {
    str: Record<string, number>; int: Record<string, number>; agi: Record<string, number>; intCompanion: Record<string, number>; agiCompanion: Record<string, number>;
    hp: { base: number; maxHp: number }; mpBase: number; mpPerInt: number;
    command: { base: number; rank: number; famePer: number }; commandRange: { base: number; rank4: number; rank6: number; max: number };
    level: { base: number; skillDiv: number; fameDiv: number }; cap: number;
  };
  ab: Record<'admin' | 'military' | 'diplomacy' | 'charisma', (string | number)[]>;
  maxSkills: number; maxTactics: number; maxTraits: number;
  troop: { levelBase: number; levelPerLv: number };
  units: Record<Variant, Record<string, string>>;
  traitRules: { feat?: string; skill?: string; min?: number; infamy?: number; fame?: number; origin?: string; job?: string; trait: string }[];
  opposites: [string, string][];
};
export const IMA_KNOWN_VERSION = 1;

/** .imarpg（gzip した JSON）を読む。hist は hist-sim の .json のセーブと同じ形の文字列 */
export async function readImaFile(data: Blob | ArrayBuffer | Uint8Array): Promise<ImaFile> {
  let text: string;
  try { text = await gunzip(data as Blob); } catch { throw new SaveError('ima-rpg のセーブを展開できませんでした'); }
  let raw: { format?: string; game?: ImaGame; hist?: string };
  try { raw = JSON.parse(text); } catch { throw new SaveError('ima-rpg のセーブを読めませんでした'); }
  if (raw.format !== 'ima-rpg' || !raw.game || typeof raw.hist !== 'string') throw new SaveError('ima-rpg のセーブではありません');
  const { save, warnings } = parseSave(raw.hist);
  if (raw.game.version > IMA_KNOWN_VERSION) warnings.push(`ima-rpg のセーブの版 ${raw.game.version} は未確認です（確認済みは ${IMA_KNOWN_VERSION} まで）`);
  return { game: raw.game, save, warnings };
}

/** 版：戦国は日本版、春秋戦国は中国版、ほかは hist-sim のセーブの決まりどおり */
export function imaVariant(game: ImaGame): Variant | null {
  return game.eraId === 'sengoku' ? 'jp' : game.eraId === 'shunju' ? 'cn' : null;
}

// ---------------------------------------------------------------- 人を武将にする

const lvOf = (p: { skills?: ImaPlayer['skills'] } & Partial<Record<SkillId, number>>, k: SkillId): number => {
  const s = p.skills?.[k];
  if (typeof s === 'number') return s;
  if (s && typeof s === 'object') return s.lv ?? 0;
  return (p as Record<string, unknown>)[k] as number ?? 0;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const lin = (rule: Record<string, number>, get: (k: string) => number): number => Object.entries(rule).reduce((s, [k, v]) => s + (k === 'base' ? v : v * get(k)), 0);

/** 主人公・仲間の特性の見立て（特性を持たない人のため。上から順に、反対の特性と重ならないものを maxTraits まで） */
export function inferTraits(src: { feats?: string[]; skill?: (k: SkillId) => number; infamy?: number; fame?: number; origin?: string; job?: string }): string[] {
  const out: string[] = [];
  const clash = (t: string): boolean => I.opposites.some(([a, b]) => (a === t && out.includes(b)) || (b === t && out.includes(a)));
  for (const r of I.traitRules) {
    if (out.length >= I.maxTraits) break;
    const hit = (r.feat && src.feats?.includes(r.feat)) || (r.skill && src.skill && src.skill(r.skill as SkillId) >= (r.min ?? 101))
      || (r.infamy !== undefined && (src.infamy ?? 0) >= r.infamy) || (r.fame !== undefined && (src.fame ?? 0) >= r.fame)
      || (r.origin && src.origin === r.origin) || (r.job && src.job?.includes(r.job));
    if (hit && !out.includes(r.trait) && !clash(r.trait)) out.push(r.trait);
  }
  return out;
}

/** 技（k）と軍略（x）：hex-sim にあるものを、強い順に（maxSkills・maxTactics が 0 なら、すべて） */
export function pickArts(arts: string[] = []): { skills: string[]; tactics: string[] } {
  const skills = arts.filter((id) => id.startsWith('k') && D.bySkill[id]).sort((a, b) => D.bySkill[b].power - D.bySkill[a].power || a.localeCompare(b)).slice(0, I.maxSkills || undefined);
  const tactics = arts.filter((id) => id.startsWith('x') && D.byTactic[id]).sort((a, b) => (D.byTactic[b].power || D.byTactic[b].mp) - (D.byTactic[a].power || D.byTactic[a].mp) || a.localeCompare(b)).slice(0, I.maxTactics || undefined);
  return { skills, tactics };
}

interface PersonSrc {
  name: string; sex: 'm' | 'f'; age?: number; maxHp: number; fame: number; rank: number; mp?: number; arts?: string[];
  skill: (k: SkillId) => number; companion: boolean; traits: string[];
}

/** ima-rpg の人 → 武将（能力は IMARPG.md の換算） */
function personGeneral(gs: GameStart, id: string, p: PersonSrc, faction: number, prov: number): GGeneral {
  const S = I.stats, sk = (k: string) => p.skill(k as SkillId);
  const str = clamp(Math.round(lin(S.str, sk)), 1, S.cap);
  const int = clamp(Math.round(lin(p.companion ? S.intCompanion : S.int, sk)), 1, S.cap);
  const agi = clamp(Math.round(lin(p.companion ? S.agiCompanion : S.agi, sk)), 1, S.cap);
  const hp = Math.round(S.hp.base + S.hp.maxHp * p.maxHp);
  const sum = (['blade', 'bow', 'letters', 'speech', 'medicine'] as SkillId[]).reduce((s, k) => s + p.skill(k), 0);
  const level = Math.max(1, Math.round(S.level.base + Math.round(sum / S.level.skillDiv) + Math.floor(p.fame / S.level.fameDiv)));
  const abOf = (k: keyof typeof I.ab): number => {
    const r = I.ab[k];
    let v = 0;
    for (let i = 0; i < r.length; i += 2) v += (r[i] === 'fame' ? p.fame : p.skill(r[i] as SkillId)) * Number(r[i + 1]);
    return clamp(Math.round(v), 0, 10);
  };
  const ab: [number, number, number, number] = [abOf('admin'), abOf('military'), abOf('diplomacy'), abOf('charisma')];
  const g = makeOfficer(gs, id, p.name, faction, prov, level, p.traits, { ab, age: p.age ?? 25, fame: Math.max(1, Math.round(p.fame / 10)) });
  g.sex = p.sex;
  g.stats = { hp, mp: Math.round(p.mp ?? S.mpBase + int * S.mpPerInt), str, int, agi };
  g.command = Math.round(S.command.base + S.command.rank * p.rank + S.command.famePer * p.fame);
  g.commandRange = Math.min(S.commandRange.max, S.commandRange.base + (p.rank >= 4 ? S.commandRange.rank4 : 0) + (p.rank >= 6 ? S.commandRange.rank6 : 0));
  // 役職：能力の向きで選び、レベルで上の役職へ（女の人は女の役職から）
  const base = pickBaseClass(p.sex, ab, 'general', p.traits, { ...g.stats }).cls;
  const cls = advanceClass(base, level, g.stats, p.traits);
  g.classId = cls.id; g.mastery = { [cls.id]: 0 };
  fillLowerClasses(g);
  const arts = pickArts(p.arts);
  if (arts.skills.length) g.skills = arts.skills;
  g.learned = [...new Set([...g.learned, ...arts.tactics])];
  return g;
}

/** 部将 → 兵（兵種は hexUnit、無ければ版ごとの表。レベルは 1 ＋ 3 ×（lv − 1）） */
export function ltTroop(lt: ImaLt, variant: Variant): GTroop | null {
  const unitId = lt.hexUnit && D.byUnit[lt.hexUnit] ? lt.hexUnit : I.units[variant]?.[lt.type];
  const unit = unitId ? D.byUnit[unitId] : undefined;
  if (!unit) return null;
  const t = makeTroop(unit, Math.max(1, I.troop.levelBase + I.troop.levelPerLv * ((lt.lv ?? 1) - 1)));
  if (lt.name) t.name = lt.name;
  return t;
}

/** 武将に兵を入れられるだけ入れる（采配と、1人あたりの数の上限）。入らなかった兵を返す */
function fill(g: GGeneral, troops: GTroop[]): GTroop[] {
  const rest: GTroop[] = [];
  let load = g.troops.reduce((s, t) => s + D.byUnit[t.unitId].cost, 0);
  for (const t of troops) {
    const cost = D.byUnit[t.unitId].cost;
    if (g.troops.length < CFG.troops.maxPerGeneral && load + cost <= g.command) { g.troops.push(t); load += cost; } else rest.push(t);
  }
  return rest;
}

const playerSrc = (p: ImaPlayer, feats: string[]): PersonSrc => {
  const skill = (k: SkillId) => lvOf(p, k);
  return {
    name: p.name, sex: p.sex ?? 'm', maxHp: p.maxHp ?? p.hp ?? 60, fame: p.fame ?? 0, rank: p.rank ?? 0, mp: p.mp, arts: p.arts, skill, companion: false,
    traits: inferTraits({ feats, skill, infamy: p.infamy, fame: p.fame, origin: p.origin }),
  };
};

// ---------------------------------------------------------------- 世界に加える

export interface ImaOptions { faction: number; king: boolean }
export interface ImaResult {
  heroId: string | null; companionIds: string[]; rivalIds: string[];
  /** 入りきらなかった兵（始まりの領の予備兵にする） */
  reserve: GTroop[]; prov: number;
  /** 獄にいる主人公：戦えない月数 */
  jailMonths: number;
  /** 読み込んで起きたことの短い説明 */
  notes: string[];
}

/** 主人公の仕える国：王位があればその国、なければ仕える国（0 は浪人） */
export function imaRealm(game: ImaGame): number { return game.player.throne?.realm ?? game.player.patron ?? 0; }

export function applyIma(gs: GameStart, game: ImaGame, variant: Variant, opts: ImaOptions): ImaResult {
  const p = game.player, feats = (game.feats ?? []).map((f) => f.id);
  const f = gs.factions[opts.faction];
  const res: ImaResult = { heroId: null, companionIds: [], rivalIds: [], reserve: [], prov: -1, jailMonths: 0, notes: [] };
  if (!f) throw new SaveError('仕える国が見つかりません');
  const here = game.place?.prov;
  const prov = here !== undefined && gs.provinces[here]?.owner === f.id ? here : f.capital;
  res.prov = prov;
  const rivals = game.rivals ?? [];
  // 主人公
  let hero: GGeneral | null = null;
  if (p.dead) res.notes.push(`主人公の${p.name}は、すでに討たれている（連れてこない）`);
  else {
    hero = personGeneral(gs, 'ima_hero', playerSrc(p, feats), f.id, prov);
    hero.imarpg = 'hero';
    res.heroId = hero.id;
    if (opts.king) {
      const was = crown(gs, f.id, hero);
      res.notes.push(was ? `${hero.name.ja}が${f.name.ja}の当主となり、${was}は武将として仕える` : `${hero.name.ja}が${f.name.ja}の当主となる`);
    } else res.notes.push(`${hero.name.ja}が${f.name.ja}の武将として加わる`);
    if (p.jail && (game.day ?? 0) < p.jail.until) res.jailMonths = Math.max(1, Math.ceil((p.jail.until - (game.day ?? 0)) / 30));
  }
  // 仲間（記録の人物は、その武将を連れてくる。ライバルが仲間になっていれば、ライバルの詳しい状態から作る）
  for (const [i, c] of (p.companions ?? []).entries()) {
    const known = c.pid !== undefined ? Object.values(gs.generals).find((g) => g.pid === c.pid) : undefined;
    let g: GGeneral;
    if (known) {
      known.faction = f.id; known.prov = prov; known.isLord = false; if (known.role === 'ruler' || known.role === 'heir') known.role = 'general';
      g = known;
    } else {
      const rival = c.rivalId !== undefined ? rivals.find((r) => r.id === c.rivalId)?.g?.player : undefined;
      const src: PersonSrc = rival ? { ...playerSrc(rival, []), age: c.age } : {
        name: c.name, sex: c.sex ?? 'm', age: c.age, maxHp: c.maxHp ?? 60, fame: 0, rank: 0, arts: c.arts, companion: true,
        skill: (k) => (c as unknown as Record<string, number>)[k] ?? 0,
        traits: inferTraits({ job: c.job, skill: (k) => (c as unknown as Record<string, number>)[k] ?? 0 }),
      };
      g = personGeneral(gs, `ima_c${c.id ?? i}`, src, f.id, prov);
    }
    g.imarpg = 'companion';
    res.companionIds.push(g.id);
  }
  // 率いる兵：主人公の隊（剣術が弓術以上なら槍、下なら弓）と部将たち。主人公から順に、入りきらなければ仲間、それでも余れば予備兵
  const troops: GTroop[] = [];
  if (hero) {
    const own = lvOf(p, 'blade') >= lvOf(p, 'bow') ? I.units[variant].foot : I.units[variant].archer;
    if (own && D.byUnit[own]) troops.push(makeTroop(D.byUnit[own], Math.max(1, Math.round(hero.level * 0.8))));
  }
  for (const lt of p.troop?.lts ?? []) { const t = ltTroop(lt, variant); if (t) troops.push(t); }
  let rest = troops;
  for (const id of [res.heroId, ...res.companionIds]) if (id && gs.generals[id]) rest = fill(gs.generals[id], rest);
  res.reserve = rest;
  if (troops.length) res.notes.push(`率いる兵${troops.length}隊を連れてくる${rest.length ? `（${rest.length}隊は予備兵に）` : ''}`);
  // ライバル（仲間になっていない人）：仕える国の武将、または浪人。王位があれば、その国の当主
  for (const r of rivals) {
    const rp = r.g?.player;
    if (r.joined || !rp || rp.dead) continue;
    const realm = rp.throne?.realm ?? rp.patron ?? 0;
    const rf = gs.factions[realm];
    const rprov = rf ? (r.g?.place?.prov !== undefined && gs.provinces[r.g.place.prov]?.owner === rf.id ? r.g.place.prov : rf.capital) : r.g?.place?.prov ?? -1;
    const g = personGeneral(gs, `ima_r${r.id}`, playerSrc(rp, []), rf ? rf.id : 0, rprov);
    g.imarpg = 'rival';
    if (rf && rp.throne && !(opts.king && rf.id === f.id)) crown(gs, rf.id, g);
    const rt: GTroop[] = [];
    for (const lt of rp.troop?.lts ?? []) { const t = ltTroop(lt, variant); if (t) rt.push(t); }
    fill(g, rt);
    res.rivalIds.push(g.id);
    res.notes.push(`ライバルの${g.name.ja}は${rf ? `${rf.name.ja}の${rp.throne ? '当主' : '武将'}` : '浪人'}として世にいる`);
  }
  return res;
}
