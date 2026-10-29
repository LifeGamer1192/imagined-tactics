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
  difficulty: Record<Difficulty, { startMonths: number; name: string; playerIncome: number; playerSiege: number; aiVsPlayer: number; aiTroopLevel: number; aiEmptyChance: number; aiIncome?: number; aiGeneralLevel?: number; aiGangUp?: number; warn?: string }>;
  /** aiStartMonths・startMin：始めの蓄え（相手の勢力は月収の何か月ぶん・最低額。自分の家は難しさの startMonths。P96） */
  supply: { capMonths: number; capMin: number; aiStartMonths: number; startMin: number };
  /**
   * 直伝（P68）：slotsByInt：知略がこの値以下なら、この枠数（それより上は maxSlots）。troopSlots：兵の枠。
   * months：当主→将・将→将・将→兵にかかる月。borrowedMpMult：借り物の気力の倍率。masterUses：身につくまでに戦いで使う回数。
   * aiChance：相手の国が1か月に教え始める見込み（難しさごと）
   */
  teach: { slotsByInt: [number, number][]; maxSlots: number; troopSlots: number; months: { lord: number; general: number; troop: number }; borrowedMpMult: number; masterUses: number; aiChance: Record<string, number> };
  /** 捕虜（P72）：捕まる見込み・逃げる見込み・登用の見込みの足し引き・解き放つ／処断の効き目・身代金・相手の国の判断 */
  captive: {
    base: number; lordBase: number; noRetreat: number; provLost: number; cravenEscape: number; escape: number;
    recruit: { base: number; perLoyalty: number; honorTraits: string[]; honor: number; greedyTraits: string[]; greedy: number; tieKinds: string[]; tie: number; perCha: number; fallen: number; retry: number; debt: number; min: number; max: number };
    releasePrestige: number; releaseOpinion: number; executeOpinion: number; ransomBase: number; ransomPerLevel: number; recruitLoyalty: number;
    ai: { executeCruelty: number; executeChance: number; retry: number; release: number; releaseCare: number };
  };
  /**
   * 相国（P77）：内政（政治×incomePerAdmin の収入）・外交（使者に（外交−5）×envoyPerDip、戦をしていない隣の国の心証が毎月（外交−driftFrom）÷driftDiv、driftCap まで）・
   * 家中（寝返り −魅力×defectPerCha、捕虜の登用 +外交×recruitPerDip）・訓練（訓練の経験値 +軍事×trainPerMil）。相国のいる領とその隣は、収入と訓練がさらに local〜 ぶん
   */
  office: { incomePerAdmin: number; envoyPerDip: number; driftFrom: number; driftDiv: number; driftCap: number; defectPerCha: number; recruitPerDip: number; trainPerMil: number; localIncomePerAdmin: number; localTrainPerMil: number };
  /** 本拠：本拠の領の収入の上乗せ、本拠で雇う兵のレベルの上乗せ（守備兵の上乗せは garrison.levelCapital） */
  capitalBonus: { incomeBonus: number; recruitLevel: number };
  auto: { roles: { front: number; ranged: number; cavalry: number; support: number }; lines: { front: number[]; ranged: number[]; cavalry: number[]; support: number[] }; skipLines: number[]; attackRatio: number; attackRatioPeace: number; build: boolean; train: boolean; move: boolean };
  /** 史実の目標（P76）：期限の月数、果たしたときの名声と兵糧 */
  histGoal: { months: number; prestige: number; supply: number };
  /** 史実の合戦（P75）：勝った家の名声、負けた家の名声の減り、勝ったときに相手の軍が残る割合（出来事に無いとき）、選べる月 */
  histBattle: { prestige: number; prestigeLoss: number; foeKeep: number; months: number };
  /** 史実の兆し（P74）：何か月前に出すか、備えたときに防げる見込み、備える兵糧、兆しを出す死因 */
  omen: { lead: number; avert: number; cost: number; violent: string[] };
  /** 当主を譲る（P71）：継げる歳、次に譲れるまでの月、忠誠が下がる名声の差（と大きい差）、下がる量 */
  abdicate: { minAge: number; cooldown: number; fameGap: number; fameGapBig: number; drop: number; dropBig: number };
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
