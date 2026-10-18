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
  difficulty: Record<Difficulty, { name: string; playerIncome: number; playerSiege: number; aiVsPlayer: number; aiTroopLevel: number; aiEmptyChance: number }>;
  supply: { capMonths: number; capMin: number };
  tactical: { lines: number[]; capPerGeneral: number };
  traits: { economy: Record<string, FactionTrait>; government: Record<string, FactionTrait> };
};

export type Difficulty = 'easy' | 'normal' | 'hard';

/** 勢力の特色（経済と政体から決まる） */
export interface FactionTrait {
  name: string; text: string;
  incomeMult?: number; troopLevel?: number; siegeMult?: number; defectMult?: number;
  cost?: { lines: number[]; mult: number }; level?: { lines: number[]; add: number };
}
export const traitsOf = (f: GFaction): FactionTrait[] =>
  [S.traits.economy[f.economy], S.traits.government[f.government]].filter((t): t is FactionTrait => !!t);
