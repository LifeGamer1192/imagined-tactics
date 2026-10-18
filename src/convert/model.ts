// ゲーム開始データ（hist-sim のセーブを変換した結果）の型。

import type { Economy, Government, Name, NotableRole, TieKind } from '../bridge/histsim';
import type { Passive, StatBlock, Variant } from '../data/types';

export type GrowthRank = 'S' | 'A' | 'B' | 'C';
export type GRole = NotableRole | 'ruler' | 'heir';

/** 武将が率いる兵（1隊） */
export interface GTroop {
  unitId: string;
  level: number;
  exp: number;
  /** 今の能力値（レベルアップの伸びを含む） */
  stats: StatBlock;
  /** 付けた名前（無ければ兵種の名前で呼ぶ） */
  name?: string;
}

export interface GGeneral {
  id: string;
  /** hist-sim の人物ID（記録上の人物・当主） */
  pid?: number;
  name: Name;
  house: Name;
  /** 仕えている勢力（0 = 浪人） */
  faction: number;
  sex: 'm' | 'f';
  age: number;
  role: GRole;
  isLord: boolean;
  fame: number;
  office?: Name;
  traits: string[];
  /** hist-sim の能力：政治・軍事・外交・魅力 */
  ab: [number, number, number, number];
  classId: string;
  level: number;
  exp: number;
  /** 熟練度が上限になった役職から持ち越した軍略 */
  learned: string[];
  /** 役職ごとの熟練度（0〜5） */
  mastery: Record<string, number>;
  /** 今の能力値（役職の補正を足す前） */
  stats: StatBlock;
  command: number;
  commandRange: number;
  growth: { str: GrowthRank; int: GrowthRank; agi: GrowthRank };
  /** 特性から付いたパッシブ */
  passives: Passive[];
  expPct: number;
  healPct: number;
  critPct: number;
  loyalty: number;
  ties: { kind: TieKind; with: string }[];
  /** いる領（-1 = 不明） */
  prov: number;
  troops: GTroop[];
}

export interface GFaction {
  id: number;
  name: Name;
  color: [number, number, number];
  government: Government;
  economy: Economy;
  capital: number;
  /** 宗主（0 = 独立） */
  overlord: number;
  /** 兵糧（徴兵の資源） */
  supply: number;
  income: number;
  lordId: string;
  tech: number;
  prestige: number;
  stability: number;
  reforms: string[];
  opinions: Record<number, number>;
  /** 徴兵できる兵種（下級）と選ばれやすさ */
  recruit: Record<string, number>;
  /** 兵の開始レベル */
  troopLevel: number;
}

export interface GProvince {
  id: number;
  name: Name;
  owner: number;
  controller: number;
  nb: number[];
  sea: number[];
  pop: number;
  income: number;
  fort: number;
  buildings: string[];
  biome: number;
  elevation: number;
  river: boolean;
  coastal: boolean;
  unrest: number;
  cx: number;
  cy: number;
  /** 舞台の外（どの勢力の領も無い陸のかたまりにある領）。地図に描かず、行くことも攻めることもできない */
  out?: boolean;
  /** この領で雇える兵種と選ばれやすさ（P37。はじめの持ち主の国の土台＋この領の土地の兵）。無い古いセーブは持ち主の勢力の一覧 */
  recruit?: Record<string, number>;
}

export interface GameStart {
  seed: string;
  scenario: string | null;
  variant: Variant;
  worldName: Name;
  year: number;
  month: number;
  tick: number;
  factions: Record<number, GFaction>;
  generals: Record<string, GGeneral>;
  provinces: GProvince[];
  wars: { attackers: number[]; defenders: number[]; /** 始まった月（開始後に起きた戦争だけ） */ since?: number }[];
  alliances: [number, number][];
  truces: { a: number; b: number; until: number }[];
  /** 変換で起きたこと（既定値で埋めた、条件まで引き上げた、など） */
  log: string[];
}
