// 仕組みのデータ（data/system/*.json）の型。

/** 日本版・中国版の名前 */
export interface Loc { jp: string; cn: string }
export type Variant = 'jp' | 'cn';

export type Affinity = 'plain' | 'forest' | 'mountain' | 'swamp' | 'water' | 'rider';
export type TerrainKind = 'plain' | 'road' | 'bridge' | 'forest' | 'mountain' | 'swamp' | 'water' | 'castle' | 'town' | 'cliff'
  | 'camp' | 'fort' | 'paddy' | 'wall' | 'gate' | 'tower'
  /** 荒れ地（砂漠・寒冷砂漠・ツンドラ）と雪原（氷河） */
  | 'desert' | 'snowfield'
  /** 柵（騎馬は通れない。攻め手が壊せる）・物見櫓（乗った側の飛び道具が強まる）・砦の門（攻め手は壊さないと通れない） */
  | 'palisade' | 'lookout' | 'fortgate'
  /** 六角形の盤の外（長方形の隅）。入れず、描かない */
  | 'void';
/** 天気。晴れは補正なし */
export type Weather = 'clear' | 'rain' | 'fog' | 'snow';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
/** 対地・対騎の記号：sure=◎必中、o=○、tri=△、x=使えない */
export type Mark = 'sure' | 'o' | 'tri' | 'x';
export type StatusId =
  | 'poison' | 'daze' | 'silence' | 'defect' | 'stun' | 'confuse'
  | 'weaken' | 'atkNext' | 'moveUp' | 'resistUp' | 'defUp' | 'atkUp' | 'agiUp' | 'atkDown' | 'intDown'
  | 'grounded' | 'mounted' | 'regen' | 'ward' | 'sureNext' | 'extraAct' | 'routed' | 'loaded';

export interface StatBlock { hp: number; mp: number; str: number; int: number; agi: number }

export interface ClassDef {
  id: string;
  name: Loc;
  sex: 'm' | 'f' | 'any';
  tier: 1 | 2 | 3;
  from: string | null;
  /** 系統の下級役職の id */
  line: string;
  unique: null | 'lord' | 'feature';
  req: { str?: number; int?: number; agi?: number; lv?: number; mastery?: number };
  mod: StatBlock;
  def: number;
  move: number;
  affinity: Affinity;
  attack: { kind: 'melee' | 'bow'; power: number; range: [number, number]; hit: number };
  tactics: string[];
}

export type SkillEffect =
  | { type: 'status'; status: StatusId; chance: number }
  | { type: 'lifesteal'; rate: number }
  | { type: 'weakenStun'; chance: number }
  | { type: 'mpHalf' } | { type: 'heal' } | { type: 'knockback' } | { type: 'critBonus' };

export interface SkillDef {
  id: string;
  name: Loc;
  mp: number;
  power: number;
  range: [number, number];
  hit: number;
  vsGround: Mark;
  vsRider: Mark;
  afterMove: boolean;
  counter: boolean;
  /** 通常攻撃（反撃に使う） */
  basic: boolean;
  shape: { type: 'single' } | { type: 'line'; n: number } | { type: 'around'; n: number };
  targets: 'enemy' | 'all';
  effects: SkillEffect[];
  noDamage?: boolean;
  needsWater?: boolean;
  /** 撃つには装填（状態 loaded）が要る。撃つと外れ、待機すると装填する（弩・鉄砲の必中技） */
  reload?: boolean;
  noCounter?: boolean;
}

export type Passive =
  | { type: 'remove' } | { type: 'doubleAct' }
  | { type: 'regen'; pct: number; on?: 'forest' | 'water' }
  | { type: 'evade'; pct: number } | { type: 'hit'; pct: number }
  | { type: 'shield'; chance: number }
  | { type: 'immune'; statuses: StatusId[] }
  | { type: 'tacticResist'; pct: number }
  | { type: 'counterDamage'; pct: number } | { type: 'crit'; pct: number }
  | { type: 'bane'; vs: Affinity; pct: number }
  | { type: 'baneOnTerrain'; terrain: TerrainKind; pct: number };

export interface UnitDef extends StatBlock {
  id: string;
  name: Loc;
  line: number;
  tier: 1 | 2 | 3;
  cost: number;
  def: number;
  move: number;
  affinity: Affinity;
  speed: string;
  growth: { hp: [number, number]; mp: [number, number]; str: [number, number]; int: [number, number]; agi: [number, number] };
  skills: string[];
  tactics: string[];
  passives: (Passive & { rank?: string | null })[];
  promote: { to: string; lv?: number; item?: string }[];
}

export type TacticKind = 'damage' | 'heal' | 'cure' | 'mpRestore' | 'buff' | 'debuff' | 'status' | 'dispel' | 'pull' | 'revive' | 'displace';

export interface TacticDef {
  id: string;
  name: Loc;
  mp: number;
  power: number;
  /** null = 射程なし（自部隊・戦場全体が対象） */
  range: number | null;
  /** 0 = 単体。1以上 = 効果の半径 */
  area: number;
  sure: boolean;
  kind: TacticKind;
  status?: StatusId | { status: StatusId; chance: number };
  turns?: number;
  value?: number;
  pct?: number;
  atk?: number;
  def?: number;
  amount?: number;
  purge?: boolean;
  friendlyFire?: boolean;
  anyTarget?: boolean;
}

export interface TerrainData {
  affinities: Affinity[];
  kinds: TerrainKind[];
  moveCost: Record<TerrainKind, Record<Affinity, number | null>>;
  hitMod: Record<TerrainKind, Record<Affinity, number>>;
  /** 番の始まりに回復する地形（最大体力に対する％） */
  regen: Partial<Record<TerrainKind, number>>;
  /** 射程2以上の技を、その地形から使うときの補正（櫓） */
  ranged: Partial<Record<TerrainKind, { hit: number; range: number }>>;
  /** 雪でも歩きやすさが変わらない地形（道や建物） */
  snowFree: TerrainKind[];
}

export interface WeatherConfig {
  /** 雨：射程2以上の技の命中 */
  rainRangedHit: number;
  /** 雨：火の技・火の軍略の威力の倍率 */
  rainFireMult: number;
  /** 霧：2マス以上離れた相手への技の命中 */
  fogFarHit: number;
  /** 雪：1マスごとに増える移動コスト */
  snowMoveCost: number;
  /** 雪：戦いの長さの上限に足す巡の数 */
  snowExtraRounds: number;
  /** 夜：技の命中 */
  nightHit: number;
  /** 夜戦になる確率 */
  nightChance: number;
  fireSkills: string[];
  fireTactics: string[];
  /** 季節ごとの天気の出やすさ（重み） */
  odds: Record<Season, Record<Weather, number>>;
}

export interface KillExp { base: number; perLv: number }
export interface ExpData {
  /** 次のレベルまでの必要経験値 ＝ K ×（1 ＋（LV−1）² ÷ div）。K は役職・兵種ごと（レベルに上限は無い） */
  curve: { div: number };
  k: { units: Record<string, number>; classes: Record<string, number>; unique: number };
  kill: { units: Record<string, KillExp>; classGeneric: KillExp[]; classUnique: KillExp[] };
}

export interface CombatConfig {
  atkPerStr: number; hitBase: number; triPenalty: number; hitMin: number; hitMax: number;
  critRate: number; critMult: number; randomMin: number; randomMax: number;
  tacticIntMult: number; tacticDefInDenominator: boolean;
  statusBase: number; statusMin: number; statusMax: number;
  counterMult: number; healIntScale: number; useExp: number; healExp: number; expGain: number;
  /** 勝った側の駒すべてに足す経験値（0.9.0） */
  winExp: { rout: number; other: number };
  /** 天守・本丸・本陣に立つ駒の防御の上乗せ（％。0.9.0） */
  seatDefPct: number; escapeChance: number;
  weather: WeatherConfig;
}

/** 強化・弱化（weaken・atkNext・defUp・atkUp・agiUp・atkDown・intDown・grounded）は、もとの能力に対する％の増減（0.8.0） */
export interface StatusConsts {
  weaken: { atkPct: number; defPct: number; turns: number };
  atkNext: { atkPct: number };
  moveUp: { move: number; turns: number };
  resistUp: { pct: number; turns: number };
  defUp: { defPct: number; turns: number };
  atkUp: { atkPct: number; turns: number };
  agiUp: { agiPct: number; turns: number };
  atkDown: { atkPct: number; turns: number };
  intDown: { intPct: number; turns: number };
  grounded: { agiPct: number; turns: number };
  regen: { pct: number; turns: number };
  poison: { pct: number };
  daze: { turns: [number, number] };
  silence: { turns: [number, number] };
  defect: { turns: [number, number] };
  stun: { turns: [number, number] };
  confuse: { def: number };
  outOfCommand: { atkDefPct: number; tacticDamagePct: number };
  noSupply: { hpMpPct: number };
}
