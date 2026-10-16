// hist-sim の「記録にある兵種」（シナリオのデータの arms）を読む。
// どの国（または文化）が、いつから、軍のどれだけの割合でその兵種を使ったかが入っている。
// 計算は hist-sim/src/sim/arms.ts の armsOf・composition と同じ（ここでは人数ではなく、軍に占める割合だけを出す）。

import type { HNation, HWorld } from './histsim';

/** 兵種の見た目の種類（hist-sim の ArmGlyph）。hex-sim の兵種への対応は data/system/convert.json の troops.glyph */
export type ArmGlyph = 'foot' | 'spear' | 'halberd' | 'sword' | 'bow' | 'crossbow' | 'gun' | 'cannon' | 'sling' | 'javelin'
  | 'horse' | 'horse_archer' | 'chariot' | 'elephant' | 'boat' | 'pike' | 'guard' | 'siege';

export interface RecordedArm {
  /** 記事の番号（名前） */
  art: string;
  /** 誰がいつから持つか：[年（紀元前のシナリオでは正の数で書く）, 国の番号 | 'c:文化の番号' | '*'（すべての国）] */
  adopt: [number, string, string?][];
  /** 軍に占める割合（0〜1） */
  share?: number;
  /** または、軍の何人ごとに1つ（戦車・船・砲）。1つあたりの人数は crew */
  per?: number;
  crew?: number;
  /** 割合（または数）の年ごとの倍率：[年, 倍率]。間は直線でつなぐ */
  over?: [number, number][];
  /** 決まった大きさの隊：これより多くはならない（人数） */
  max?: number;
  /** その国のふつうの兵：残りをすべて受け持つ */
  rest?: boolean;
  glyph: ArmGlyph;
}

interface ScenarioArms { bc?: boolean; arms?: RecordedArm[]; cultures?: { id: string }[] }

const yearOf = (bc: boolean | undefined, y: number): number => (bc ? 1 - y : y);

function factor(a: RecordedArm, bc: boolean | undefined, year: number): number {
  const o = a.over;
  if (!o?.length) return 1;
  const pts = o.map(([y, f]) => [yearOf(bc, y), f] as const).sort((p, q) => p[0] - q[0]);
  if (year <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (year <= pts[i][0]) return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * ((year - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
  }
  return pts[pts.length - 1][1];
}

/** 見た目の種類ごとの、軍に占める割合（合計1）。兵種のデータが無いセーブや、当てはまる兵種が無い国は null */
export function armShares(w: HWorld, n: HNation, year: number, armySize = 10000): Partial<Record<ArmGlyph, number>> | null {
  const data = (w.scenario as { data?: ScenarioArms } | undefined)?.data;
  if (!data?.arms?.length) return null;
  const realm = (n as { realm?: string }).realm;
  const culture = data.cultures?.[n.culture]?.id;
  const mine = data.arms.filter((a) => a.adopt.some(([y, who]) => yearOf(data.bc, y) <= year && (who === '*' || who === realm || (culture !== undefined && who === `c:${culture}`))));
  if (!mine.length) return null;
  const raw: { glyph: ArmGlyph; men: number }[] = [];
  let rest: RecordedArm | undefined;
  for (const a of mine) {
    if (a.rest) { rest = a; continue; }
    const f = factor(a, data.bc, year);
    const men = a.per
      ? Math.min(a.max !== undefined ? Math.floor(a.max / (a.crew ?? 1)) : Infinity, Math.round((armySize / a.per) * f)) * (a.crew ?? 1)
      : Math.min(a.max ?? Infinity, armySize * (a.share ?? 0) * f);
    if (men >= 1) raw.push({ glyph: a.glyph, men });
  }
  // 名のある兵種は、軍の9割まで。残りはふつうの兵
  const sum = raw.reduce((t, r) => t + r.men, 0);
  const k = sum > armySize * 0.9 ? (armySize * 0.9) / sum : 1;
  const out: Partial<Record<ArmGlyph, number>> = {};
  let used = 0;
  for (const r of raw) { out[r.glyph] = (out[r.glyph] ?? 0) + (r.men * k) / armySize; used += r.men * k; }
  const left = Math.max(0, armySize - used) / armySize;
  if (left > 0) { const g = rest?.glyph ?? 'foot'; out[g] = (out[g] ?? 0) + left; }
  return out;
}
