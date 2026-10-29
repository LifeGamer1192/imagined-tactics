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
/** 今の版（日本版・中国版）の名前 */
export function L(name: Loc): string { return name[variant]; }
/** 用語（体力・武力など）の今の版の名前 */
export function term(key: string): string { return D.terms[key]?.[variant] ?? key; }
