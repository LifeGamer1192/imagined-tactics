// 戦略パートの調整値と、勢力の特色。campaign.ts と events.ts の両方から使う。

import strategyJson from '../../data/system/strategy.json';
import type { GFaction } from '../convert/model';

/** 戦略パートの調整値（data/system/strategy.json） */
export const S = strategyJson as unknown as {
  siege: { base: number; perFort: number; unownedMult: number; idleDecay: number };
  move: { range: number };
  /** 本拠を移す：兵糧（少なくとも costMin、収入の costIncomeMonths か月ぶん）と、かかる月（本拠とつながった領 monthsNear・飛び地 monthsFar） */
  capital: { costMin: number; costIncomeMonths: number; monthsNear: number; monthsFar: number };
  /** 戦いから退いたときの罰：体力がこの割合を切った兵は失う・ほかの兵も見込みで失う・兵糧を失う（%）・武将の深手（月） */
  retreat: { troopLossBelowHp: number; troopLossChance: number; supplyLossPct: number; woundMonths: number };
  /** 飛び地（本拠と自分の領づたいにつながっていない領）の重い罰：収入・守備兵・徴兵の値段・戦うときの攻撃と防御（%） */
  /** 初めから雇えた兵種でない兵を雇うときの、兵糧の倍率（P37） */
  newUnitCostMult: number;
  /** 敵の兵を捕まえる（P37）：寝返り・敗残兵収容でこちらに付いた兵が、勝った戦いの終わりまでこちらにいたとき、残る見込みと、下がるレベル */
  capture: { chance: number; levelDrop: number };
  chainCapture: { enabled: boolean; bySea: boolean };
  /** 使者と土産（P34）：外交1あたりの心証の上乗せ（5を超えたぶん）・心証1あたりの兵糧・停戦の基準のゆるみ（上乗せ÷）・土産の選択肢（兵糧） */
  envoy: { perDiplomacy: number; supplyPerOpinion: number; truceRelaxPer: number; gifts: number[] };
  /**
   * 偵察度（P33）：始めの隣の領・味方の領の下限・毎月の隣の上がりと、ほかの薄れ・偵察の上がり（基本＋知略×）・相国（外交×、届く歩数）・見える量の境（すべて・名前・おおまか）
   */
  scout: { start: number; allyFloor: number; adjacentGain: number; decay: number; missionBase: number; missionPerInt: number; officeGain: number; officeRange: number; full: number; names: number; rough: number };
  /**
   * 訓練（P30）：1回で得る経験値（次のレベルまでの割合：武将・兵）、倍率（特性・軍事・規律の性格のどれかで bonusMult 倍）、
   * まれな出来事の確率、出来事で上がる倍率（1回ぶん・上限）
   */
  train: { generalShare: number; troopShare: number; bonusMult: number; bonusTraits: string[]; bonusMilitary: number; bonusDiscipline: number; eventChance: number; bonusStep: number; bonusMax: number };
  /** 徴兵した兵のレベル：徴兵する時点の国どうしの技術と威信の位置（重み）から、minLevel〜maxLevel で決める */
  recruit: { minLevel: number; maxLevel: number; techWeight: number; prestigeWeight: number };
  /**
   * 史実の領の動き（P28）：自分の家にかかわるときに選べる月数・断ったときの相手の心証と領の不満・
   * 新しく起きる家の兵糧・当主の兵（領1つあたり・最少・最多）・当主の名声
   */
  history: { choiceMonths: number; refuseOpinion: number; refuseUnrest: number; newRealmSupply: number; newRealmTroopsPerProv: number; newRealmTroopsMin: number; newRealmTroopsMax: number; newRealmFame: number };
  exclave: { incomeMult: number; garrisonLevel: number; garrisonTroops: number; recruitCostMult: number; battleAtkDefPct: number };
  /** 兵⇔武将の、近い役職・兵種の対応（P59） */
  officerMap: { raiseClass: Record<string, string>; lowerLine: Record<string, number> };
  officer: { minTroopLevel: number; nameMax: number; unit: string; raiseCostBase: number; raiseCostPerLevel: number; lowerRefund: number; leaderTraits: string[] };
  reserve: { max: number };
  garrison: {
    levelBase: number; levelPerFort: number; levelTown: number; levelCity: number; levelCapital: number; levelMax: number;
    troopsBase: number; troopsPerFort: number; troopsTown: number; troopsMax: number; townPop: number; cityPop: number;
    units: string[]; skipLines: number[];
  };
  quest: { months: number; item: number; ronin: number; exp: number; expAmount: number };
  people: {
    oldAge: number; deathPerYearOver: number; comingOfAge: number;
    wound: { months: number; short: number; shortTraits: string[]; long: number; longTraits: string[] }; defectLoyalty: number; defectChance: number;
    surrenderChance: number; tieJoinChance: number; roninJoinChance: number; joinTies: string[];
    strongTies: string[]; oldLordTies: string[]; rivalExp: number; rivalLoserExp: number; avengeKillChance: number; avengeExp: number;
    mentorExp: number; bondLoyalty: number; grudgeLoyalty: number;
  };
  diplomacy: {
    allianceOpinion: number; truceMonths: number; truceStrengthRatio: number; aiTruceAfter: number; aiTruceChance: number;
    opinionOnWar: number; opinionOnBreak: number; opinionOnAlliance: number;
    opinionAllyOfVictim: number; opinionSharedEnemy: number; opinionDrift: number; opinionOnRefuse: number; opinionOnTruce: number;
    offerChance: number; offerMonths: number; vassalStrengthRatio: number; vassalOpinion: number; callToArmsOpinion: number;
  };
  ai: {
    attackRatio: number; attackChance: number; neutralMult: number; aggressionRatio: number; cautionRatio: number; aggressionChance: number;
    cunningEmptyBonus: number; honorNeutralPenalty: number; warBonus: number; emptyDefenseShare: number; reserveSupply: number;
  };
  /**
   * 難しさ。aiIncome：相手の勢力の収入に掛ける数、aiGeneralLevel：始めに相手の武将のレベルに足す数、
   * aiGangUp：自分が最も大きい国のとき、相手どうしが組んで自分を攻める強さ（0〜1）、warn：選ぶときの注意（P64）
   */
  difficulty: Record<Difficulty, { name: string; playerIncome: number; playerSiege: number; aiVsPlayer: number; aiTroopLevel: number; aiEmptyChance: number; aiIncome?: number; aiGeneralLevel?: number; aiGangUp?: number; warn?: string }>;
  supply: { capMonths: number; capMin: number };
  tactical: { lines: number[]; capPerGeneral: number };
  traits: { economy: Record<string, FactionTrait>; government: Record<string, FactionTrait> };
};

export type Difficulty = 'easy' | 'normal' | 'hard' | 'veryHard' | 'oni';
/** 難しさの並び（選ぶ所に出す順） */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'veryHard', 'oni'];
/** セーブなどから読んだ難しさ。知らない値は「ふつう」 */
export const validDifficulty = (d: unknown): Difficulty => (DIFFICULTIES as readonly unknown[]).includes(d) ? (d as Difficulty) : 'normal';

/** 勢力の特色（経済と政体から決まる） */
export interface FactionTrait {
  name: string; text: string;
  incomeMult?: number; troopLevel?: number; siegeMult?: number; defectMult?: number;
  cost?: { lines: number[]; mult: number }; level?: { lines: number[]; add: number };
}
export const traitsOf = (f: GFaction): FactionTrait[] =>
  [S.traits.economy[f.economy], S.traits.government[f.government]].filter((t): t is FactionTrait => !!t);
