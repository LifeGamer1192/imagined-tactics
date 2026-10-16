// 戦闘の結果を、ゲームのデータ（武将・兵）に反映する：経験値、レベルアップ、兵の損失。

import type { GameStart } from '../convert/model';
import { RNG, codeToSeed } from '../core/rng';
import { D } from '../data/db';
import { gainGeneralExp, gainTroopExp } from '../rules/growth';
import type { BattleState } from './types';

export interface BattleSummary {
  winner: 0 | 1;
  rounds: number;
  /** レベルが上がったもの。side は、もとの陣営（0 = 攻め手、1 = 守り手） */
  levelUps: { name: string; from: number; to: number; side: 0 | 1 }[];
  /** 壊滅して失われた兵 */
  lost: { general: string; unit: string; side: 0 | 1 }[];
  /** 倒された武将（生きてはいるが、この戦いからは退いた） */
  beaten: string[];
  /** beaten と同じ並びで、その武将の陣営 */
  beatenSides: (0 | 1)[];
  /** 倒された武将の番号（戦略パートで、しばらく戦えなくするのに使う） */
  beatenIds: string[];
}

export function applyBattleResult(gs: GameStart, st: BattleState): BattleSummary {
  if (st.winner === null) throw new Error('戦闘がまだ終わっていません');
  const rng = new RNG(codeToSeed(`${gs.seed}:${gs.tick}:result:${st.round}:${st.units.filter((u) => u.alive).length}`));
  const sum: BattleSummary = { winner: st.winner, rounds: st.round, levelUps: [], lost: [], beaten: [], beatenSides: [], beatenIds: [] };
  const remove = new Map<string, Set<number>>();
  for (const u of st.units) {
    const g = gs.generals[u.generalId];
    if (!g) continue;
    if (u.kind === 'general') {
      if (!u.alive) { sum.beaten.push(g.name.ja); sum.beatenSides.push(u.home); sum.beatenIds.push(g.id); }
      const from = g.level;
      if (u.expGained > 0 && gainGeneralExp(g, u.expGained * D.combat.expGain, rng) > 0) sum.levelUps.push({ name: g.name.ja, from, to: g.level, side: u.home });
      continue;
    }
    const t = g.troops[u.troopIndex];
    if (!t) continue;
    // 倒れた兵は失われる。撤退した兵は残る。寝返ったまま・収容されたままの兵も失われる
    const lost = (!u.alive && !u.retreated) || u.side !== u.home;
    if (lost) {
      if (!remove.has(g.id)) remove.set(g.id, new Set());
      remove.get(g.id)!.add(u.troopIndex);
      sum.lost.push({ general: g.name.ja, unit: u.name, side: u.home });
      continue;
    }
    const from = t.level;
    if (u.expGained > 0 && gainTroopExp(t, u.expGained * D.combat.expGain, rng) > 0) sum.levelUps.push({ name: `${g.name.ja}の${u.name}`, from, to: t.level, side: u.home });
  }
  for (const [gid, idxs] of remove) gs.generals[gid].troops = gs.generals[gid].troops.filter((_t, i) => !idxs.has(i));
  return sum;
}
