// 戦闘中の状態。画面には依存しない。

import type { RNG } from '../core/rng';
import type { Affinity, Passive, StatusId, TacticKind, TerrainKind, Weather } from '../data/types';
import type { DamageParts, HealParts, HitParts, StatParts, SuccessParts, TacticParts } from '../rules/combat';
import type { AutoPlan, Personality } from '../ai/personality';
import type { BattleMap } from './map';

export type Side = 0 | 1;

export interface BStatus {
  id: StatusId;
  /** 残りの巡（-1 = 戦闘終了まで、または条件で解除） */
  turns: number;
  /** 敗残兵収容：もとの陣営 */
  origSide?: Side;
}

export interface BUnit {
  id: number;
  /** いま属している陣営（寝返り・敗残兵収容で一時的に変わる） */
  side: Side;
  /** もとの陣営 */
  home: Side;
  kind: 'general' | 'troop';
  /** 武将：GGeneral.id。兵：率いている武将の GGeneral.id */
  generalId: string;
  /** 兵：率いている武将のユニット番号（武将なら自分） */
  leader: number;
  /** 兵：GGeneral.troops の中の位置 */
  troopIndex: number;
  /** 武将：役職の id。兵：兵種の id */
  defId: string;
  name: string;
  level: number;
  pos: number;
  hp: number; maxHp: number;
  mp: number; maxMp: number;
  str: number; int: number; agi: number; def: number;
  move: number;
  affinity: Affinity;
  /** 武将の采配範囲（兵は 0） */
  commandRange: number;
  passives: Passive[];
  skills: string[];
  tactics: string[];
  critPct: number;
  healPct: number;
  /** 特性（P56）：状態・弱化の軍略の成功率（％ポイント）、軍略の気力（％）、味方への補助の軍略の気力（％） */
  statusPct?: number;
  mpCostPct?: number;
  supportMpCostPct?: number;
  /** 戦いの始めに特性で変わった能力の書き留め（P58）。stat：能力の名前の鍵、value：「+12%」など、traits：効いた特性の id */
  /** 将が受けたダメージを、相手の将（兵なら率いる将）ごとに足したもの、と倒したとどめの相手の将（深手の記録で「負わされた相手」に出す） */
  hurtBy?: Record<string, number>;
  killedBy?: string;
  /** 直伝で教わった技・軍略（P68）。taught：すべて、borrowed：まだ身についていない借り物（気力が borrowMult 倍）、artUses：この戦いで借り物を使った回数 */
  taught?: string[];
  borrowed?: string[];
  borrowMult?: number;
  artUses?: Record<string, number>;
  traitFx?: { stat: string; from?: number; to?: number; value: string; traits: string[]; /** 特性でないときの原因（「難しさ（鬼）」など） */ why?: string }[];
  /** 武将の性格（敵の思考で使う。兵は率いる武将の性格で動く） */
  persona?: Personality;
  statuses: BStatus[];
  /** この番、移動に使った移動力（再移動の残りの計算用） */
  moveSpent: number;
  /** その手番に動く前の位置から進んだマス数（突撃。0.11.0。動いてから行動する前まで数える） */
  moveSteps?: number;
  moved: boolean;
  /** 行動のあとの再移動を済ませたか */
  postMoved: boolean;
  /** 行動（技・軍略・待機）を済ませたか */
  acted: boolean;
  /** 2回行動・号令で、この番すでに追加で動いたか */
  extraUsed: boolean;
  alive: boolean;
  /** 撤退した（倒れたのではない） */
  retreated: boolean;
  /** この戦闘で得た経験値 */
  expGained: number;
}

/** 状態異常が付くかどうかの判定（確率、出目、付いたか。immune は無効の特性で防がれた） */
export interface StatusTry { status: StatusId; chance: number; roll: number; ok: boolean; immune: boolean; /** いっしょに付く状態 */ also?: StatusId }

/** 技の1撃の内訳（記録のキー 'strike'）。計算で実際に使った値をそのまま入れる */
export interface StrikeDetail {
  type: 'strike';
  counter: boolean;
  hit: HitParts;
  /** 命中の出目（0〜100）。これが命中率より小さければ当たり */
  roll: number;
  landed: boolean;
  dmg?: {
    parts: DamageParts; atk: StatParts; def: StatParts;
    rnd: number;
    critPct: number; critRoll: number; crit: boolean; critMult: number;
    /** 会心のときに威力が増す技の倍率（無ければ 1） */
    critBonus: number;
    /** 盾で受けたか（確率、出目）。判定しなかったら無し */
    /** 盾で受けたか。missile：飛び道具の盾（0.11.0） */
    shield?: { chance: number; roll: number; ok: boolean; missile?: boolean };
    /** 丸める前の値と、与えたダメージ */
    raw: number; final: number;
  };
  /** 相手の体力（前 → 後） */
  hp?: [number, number];
  tries: StatusTry[];
  /** 吸収した体力、半分にした気力、技での回復、押し出し（それぞれ 前 → 後） */
  steal?: [number, number]; mpHalf?: [number, number]; heal?: [number, number]; knock?: [number, number];
  /** 押し出す技で、押す先が塞がっていて押し付けた（0.10.0）：塞いでいるマスと、ダメージの倍率 */
  knockWall?: { cell: number; mult: number };
  /** 押し出す技で、後ろの駒にぶつけた（0.10.0）：その駒と、与えたダメージ・体力（前 → 後） */
  collide?: { uid: number; dmg: number; hp: [number, number] };
  /** 落馬させた（0.11.0）：何巡 */
  unhorse?: number;
}

/** 軍略の、相手ひとりぶんの内訳（記録のキー 'tactic.on'） */
export interface TacticDetail {
  type: 'tactic';
  kind: TacticKind;
  /** 用心（軍略無効）で防がれた */
  ward?: boolean;
  /** 収容された敗残兵が、そのまま失われた */
  purged?: boolean;
  dmg?: { parts: TacticParts; rnd: number; raw: number; final: number };
  hp?: [number, number];
  heal?: { parts: HealParts; got: number };
  /** 確率型の成否（成功率の内訳、出目） */
  success?: { parts: SuccessParts; roll: number; ok: boolean };
  tries: StatusTry[];
  /** 付けようとした状態と、付いたか */
  status?: { id: StatusId; applied: boolean };
  /** 解けた状態 */
  removed?: StatusId[];
  mp?: [number, number];
  /** 動かされたマス（前 → 後） */
  moved?: [number, number];
}

export type LogDetail = StrikeDetail | TacticDetail;

/**
 * 戦闘の記録。key と vars から、画面で文章にする。
 * 細かい記録（通常・詳細）用に、あとから足したキー：
 *   act（行動の見出し。vars.n が、この行動で続けて出た記録の数）、move、strike、tactic.on。簡易の記録には出さない。
 */
export interface BattleLogEntry { key: string; vars: Record<string, string | number>; d?: LogDetail }

export interface BattleState {
  map: BattleMap;
  units: BUnit[];
  /** いま動かせる陣営 */
  turn: Side;
  /** 何巡目か（両陣営が1回ずつ動いて1巡） */
  round: number;
  maxRounds: number;
  /** null = 続行中 */
  winner: Side | null;
  rng: RNG;
  log: BattleLogEntry[];
  /** 陣営の名前（表示用） */
  sideNames: [string, string];
  /** 天気（無ければ晴れ）。戦いの間は変わらない */
  weather?: Weather;
  /** 夜戦か */
  night?: boolean;
  /**
   * 陣営ごとの攻撃・防御の掛け目（[攻め手, 守り手]、無ければ 1）。戦略で、飛び地で戦う側（兵糧や援軍が届きにくい）が下がる。
   * 寝返った兵も、もとの陣営（home）の掛け目のまま
   */
  supplyMult?: [number, number];
  /**
   * 天守（城のマス）の占拠。攻め手の番の始めに攻め手の駒が天守にいれば count が1増え、いなければ0に戻る。
   * count が need に届くか、時間切れのとき天守に攻め手がいれば、攻め手の勝ち。城のある戦場だけ
   */
  hold?: { cell: number; need: number; count: number };
  /**
   * 壊せる造り（門・砦の門・柵）：マス → 種類・残りの耐久・もとの耐久・防御・閉じているか（閉じた造りは、攻め手は通れない）。
   * 耐久が0になると、決まった地形（門は道、柵は平地）に変わる
   */
  structures?: Record<number, { kind: TerrainKind; hp: number; max: number; def: number; closed: boolean; rubble: TerrainKind }>;
  /** 戦場の地形が変わった回数（造りが壊れると増える。描き直しの合図） */
  mapVersion?: number;
  /** 部隊ごとの退却で戦場から退いた駒（武将と兵の番号）。兵は失わず、武将は深手にならない（戦略で翌月の休養） */
  withdrawn?: number[];
  /** 退いた陣営（国モードの「退く」）。退いた陣営の負けで、初期配置のマスの外にいた部隊だけが重い罰を受ける */
  retreat?: Side;
  /** 戦闘の難しさ：自分と戦う相手の陣営（side）の、思考の賢さ（やさしい・ふつう・むずかしい）。数値は変えない */
  aiLevel?: { side: Side; level: 'easy' | 'normal' | 'hard' | 'veryHard' | 'oni' };
  /** 味方のおまかせの方針（P50）：陣営ごと。ある陣営は、武将の性格の代わりにこれで動く */
  autoPlan?: [AutoPlan | null, AutoPlan | null];
}

export type Action =
  | { type: 'move'; unit: number; to: number }
  | { type: 'skill'; unit: number; skill: string; target: number }
  | { type: 'tactic'; unit: number; tactic: string; target: number }
  | { type: 'wait'; unit: number }
  /** 部隊ごとの退却：初期配置のマスにいる武将が、配下の兵を連れて戦場から退く */
  | { type: 'withdraw'; unit: number }
  /** 造り（門・砦の門・柵）を壊す。通常攻撃の届くマスの、だれもいない造り */
  | { type: 'breach'; unit: number; target: number }
  | { type: 'endTurn' };
