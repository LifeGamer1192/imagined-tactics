// 武将の性格。hist-sim の特性と能力から、戦い方を決める7つの軸（−1〜+1、0が標準）を出す。
// 兵は、率いる武将の性格で動く。係数は data/system/ai.json。

import aiJson from '../../data/system/ai.json';

export const AXES = ['aggression', 'caution', 'discipline', 'cunning', 'cruelty', 'care', 'honor'] as const;
export type Axis = (typeof AXES)[number];
export type Personality = Record<Axis, number>;

export interface AiConfig {
  weights: Record<string, number>;
  traits: Record<string, Partial<Personality>>;
  abilities: { aggressionPerMil: number; cunningPerAdminDip: number; disciplinePerCha: number };
  mods: Record<string, Partial<Personality>>;
  stance: {
    retreatHp: number; retreatHpCaution: number; retreatHpAggression: number; engageDistance: number;
    sallyAggression: number; sallyStrengthRatio: number; urgentFrom: number; generalJoinFrom: number;
    attackerApproachFloor: number; generalSpread: number;
  };
  /** 天守の取り合い：攻め手が天守にいる値・天守へ近づく重み、守り手が天守を守る値と、その気になる敵の近さ */
  /** 戦闘の難しさ：相手の思考の重みに掛ける数と、構えの決め方（数値の効き目は変えず、考え方の賢さだけを変える） */
  levels: Record<AiLevel, { weights: Record<string, number>; sallyAggression?: number; sallyStrengthRatio?: number; retreatHp?: number; engageDistance?: number; smart?: SmartConfig }>;
  castle: { hold: number; approach: number; guard: number; guardRange: number; breach: number; breachKill: number; breachClosed: number };
}
export type AiLevel = 'easy' | 'normal' | 'hard';
/**
 * むずかしいだけの考え方（どれも切り替えられる。値が 0 か false なら使わない）
 * bestFirst：決まった順番でなく、いちばん点の高い行動ができる駒から動く（とどめを刺せる駒が先に動く）
 * withdrawHp・withdraw：体力がこの割合を切った兵は、前線から下がる（回復できる地形・敵から遠い所を好む）
 * terrainAware：受けるダメージの見込みを、立つマスの地形と天気で計算し直す
 * surround・surrounded：味方が隣にいる敵をさらに囲む位置を好み、自分が囲まれる位置を避ける
 * mpThrift：気力を使う技・軍略は、効き目が大きいときに取っておく（気力の重みに掛ける）
 * attackerPush：攻め手は、時間が経つほど危険を恐れず押す（危険の重みを最大でこの割合まで下げる。終盤は傷んだ兵も下げない）
 * keepPush：攻め手は、天守を早めに強く目指す（天守へ近づく重みに掛ける）
 * decapitate：武将を全員倒せば勝ちなので、武将への攻撃と、武将を倒すことを、さらに重く見る（倍率）
 * leaderSafe：将が倒れると配下の兵がみな退くので、率いる兵が多い将ほど危険を重く見る（兵6隊で 1+この値 倍）
 * firstStrike：攻めずに敵の届く所に立つのを嫌う（届く敵1体ごとの減点。攻め手は半分、時間が押すほど小さく）
 * buddy：危ない場所に立つなら、味方の隣を好む（隣の味方1体ごとの加点、2体まで）
 * exactReach：敵の攻撃が届くかを、移動力＋射程の距離でなく、実際に歩ける道のり（城壁・川・山・壁になる駒）で読む
 * focus：この一撃で倒せなくても、まだ動いていない味方と合わせて倒せる相手なら、倒す価値のこの割合を見込む（集中攻撃）
 * leaderKill：将を倒すと配下の兵がみな退くので、配下の兵の価値を、将を倒す（削る）価値に足す（割合）
 */
export interface SmartConfig { bestFirst?: boolean; withdrawHp?: number; withdraw?: number; terrainAware?: boolean; surround?: number; surrounded?: number; mpThrift?: number; attackerPush?: number; keepPush?: number; decapitate?: number; leaderKill?: number; leaderSafe?: number; firstStrike?: number; buddy?: number; focus?: number; exactReach?: boolean }
export const AI = aiJson as unknown as AiConfig;

export const NEUTRAL: Personality = { aggression: 0, caution: 0, discipline: 0, cunning: 0, cruelty: 0, care: 0, honor: 0 };
const clamp = (v: number): number => Math.max(-1, Math.min(1, v));

/** 特性と能力（政治・軍事・外交・魅力）から性格を出す */
export function personalityOf(traits: string[], ab: [number, number, number, number] = [5, 5, 5, 5]): Personality {
  const p: Personality = { ...NEUTRAL };
  for (const t of traits) {
    const r = AI.traits[t];
    if (r) for (const a of AXES) p[a] += r[a] ?? 0;
  }
  const [admin, mil, dip, cha] = ab;
  p.aggression += (mil - 5) * AI.abilities.aggressionPerMil;
  p.cunning += ((admin + dip) / 2 - 5) * AI.abilities.cunningPerAdminDip;
  p.discipline += (cha - 5) * AI.abilities.disciplinePerCha;
  for (const a of AXES) p[a] = Math.round(clamp(p[a]) * 100) / 100;
  return p;
}

/** 性格を反映した重み：重み × (1 + Σ 軸の値 × 影響の大きさ)。負にはしない */
export function weightsFor(p: Personality): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, base] of Object.entries(AI.weights)) {
    let m = 1;
    const mod = AI.mods[k];
    if (mod) for (const a of AXES) m += p[a] * (mod[a] ?? 0);
    out[k] = base * Math.max(0.1, m);
  }
  return out;
}

const LABEL: Record<Axis, [string, string]> = {
  aggression: ['猛攻', '消極'], caution: ['慎重', '無謀'], discipline: ['統率', '放縦'], cunning: ['知略', '直情'],
  cruelty: ['苛烈', '寛容'], care: ['仁', '非情'], honor: ['武勇', '狡猾'],
};

/** 性格を表す言葉（目立つ軸を2つまで） */
export function personalityLabel(p: Personality): string {
  const top = AXES.map((a) => ({ a, v: p[a] })).filter((x) => Math.abs(x.v) >= 0.25)
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v)).slice(0, 2);
  return top.length ? top.map((x) => LABEL[x.a][x.v > 0 ? 0 : 1]).join('・') : '中庸';
}
