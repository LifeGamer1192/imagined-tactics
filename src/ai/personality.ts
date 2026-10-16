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
  castle: { hold: number; approach: number; guard: number; guardRange: number; breach: number; breachKill: number; breachClosed: number };
}
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
