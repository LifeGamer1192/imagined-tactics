// 仕組みのデータを読み込み、id で引けるようにする（rts-mons/web/src/data.js の形にならう）。

import classesJson from '../../data/system/classes.json';
import unitsJson from '../../data/system/units.json';
import skillsJson from '../../data/system/skills.json';
import tacticsJson from '../../data/system/tactics.json';
import terrainJson from '../../data/system/terrain.json';
import expJson from '../../data/system/exp.json';
import statusesJson from '../../data/system/statuses.json';
import combatJson from '../../data/system/combat.json';
import termsJson from '../../data/system/terms.json';
import westJson from '../../data/system/west.json';
import heroesJson from '../../data/system/heroes.json';
import type {
  ClassDef, CombatConfig, ExpData, Loc, SkillDef, StatusConsts, TacticDef, TerrainData, UnitDef, Variant,
} from './types';

function index<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list) out[x.id] = x;
  return out;
}

export const classes = classesJson as unknown as ClassDef[];
export const units = unitsJson as unknown as UnitDef[];
export const skills = skillsJson as unknown as SkillDef[];
export const tactics = tacticsJson as unknown as TacticDef[];

export const D = {
  classes, units, skills, tactics,
  byClass: index(classes),
  byUnit: index(units),
  bySkill: index(skills),
  byTactic: index(tactics),
  terrain: terrainJson as unknown as TerrainData,
  exp: expJson as unknown as ExpData,
  status: statusesJson as unknown as StatusConsts,
  combat: combatJson as unknown as CombatConfig,
  terms: (termsJson as { terms: Record<string, Loc> }).terms,
  items: (termsJson as { items: Record<string, Loc> }).items,
};

/**
 * 名将の特別技・特別軍略（P102。heroes.json。hex-sim だけ）：技・軍略の一覧（D.skills・D.tactics）には入れず、
 * id で引けるようにだけする（図鑑の技・軍略の表や、兵種の技には出ない。名将のタブに出る）
 */
const H = heroesJson as unknown as { skills: (SkillDef & { west?: string })[]; tactics: (TacticDef & { west?: string })[] };
export const heroSkills = H.skills as SkillDef[];
export const heroTactics = H.tactics as TacticDef[];
for (const s of heroSkills) D.bySkill[s.id] = s;
for (const t of heroTactics) D.byTactic[t.id] = t;

let variant: Variant = 'jp';
export function setVariant(v: Variant): void { variant = v; }
export function getVariant(): Variant { return variant; }
/**
 * 絵の版（P87）：日本版・中国版に加え、西洋の世界（ローマなど）は西洋版。名前の版（variant）とは別に持つ。
 * 西洋版の絵が無い所は、ほかの版の絵で代えない（ちょんまげの人物が出ないように。無ければ絵を出さない・コードの形で描く）
 */
export type ArtSet = Variant | 'west';
let artSet: ArtSet = 'jp';
export function setArtSet(a: ArtSet): void { artSet = a; }
export function getArtSet(): ArtSet { return artSet; }
/** 西洋版の名前（P88・P94。west.json）：兵種・技・軍略・役職の名前の入れ物 → 西洋の名前 */
const W = westJson as unknown as Record<'units' | 'skills' | 'tactics' | 'classes', Record<string, string>>;
const westNames = new Map<Loc, string>([
  ...Object.entries(W.units ?? {}).filter(([id]) => D.byUnit[id]).map(([id, n]): [Loc, string] => [D.byUnit[id].name, n]),
  ...Object.entries(W.skills ?? {}).filter(([id]) => D.bySkill[id]).map(([id, n]): [Loc, string] => [D.bySkill[id].name, n]),
  ...Object.entries(W.tactics ?? {}).filter(([id]) => D.byTactic[id]).map(([id, n]): [Loc, string] => [D.byTactic[id].name, n]),
  ...Object.entries(W.classes ?? {}).filter(([id]) => D.byClass[id]).map(([id, n]): [Loc, string] => [D.byClass[id].name, n]),
  ...[...H.skills, ...H.tactics].filter((x) => x.west).map((x): [Loc, string] => [x.name, x.west!]),
]);
/** 兵種の西洋の名前（対応表などで使う） */
export function westName(unitId: string): string | undefined { return D.byUnit[unitId] ? westNames.get(D.byUnit[unitId].name) : undefined; }
/** 名前の入れ物の西洋の名前（兵種・技・軍略・役職。無ければ undefined） */
export function westOf(name: Loc): string | undefined { return westNames.get(name); }
/** 今の版（日本版・中国版）の名前。絵が西洋版の世界（ローマなど）では、兵種・技・軍略・役職は西洋の名前 */
export function L(name: Loc): string { return (artSet === 'west' && westNames.get(name)) || name[variant]; }
/** 用語（体力・武力など）の今の版の名前 */
export function term(key: string): string { return D.terms[key]?.[variant] ?? key; }
