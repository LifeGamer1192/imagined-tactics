// 戦闘の結果を、ゲームのデータ（武将・兵）に反映する：経験値、レベルアップ、兵の損失。

import type { GameStart, Taught } from '../convert/model';
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
  /** 倒された武将ごとの、負わされた相手の将（とどめを刺した将を先に、あとは与えたダメージの多い順に3人まで） */
  beatenBy?: Record<string, string[]>;
  /** 勝った側の駒すべてに足した経験値（0.9.0）。rout：敵の武将をみな倒すか退かせて勝った */
  winExp?: { amount: number; rout: boolean };
}

export function applyBattleResult(gs: GameStart, st: BattleState): BattleSummary {
  if (st.winner === null) throw new Error('戦闘がまだ終わっていません');
  const rng = new RNG(codeToSeed(`${gs.seed}:${gs.tick}:result:${st.round}:${st.units.filter((u) => u.alive).length}`));
  // 勝利の経験値（0.9.0）：勝った側の駒すべてに。敵の武将をみな倒すか退かせて勝ったら多く、天守・時間切れなどの勝ちは少し
  const rout = st.log.some((l) => l.key === 'win');
  const winExp = rout ? D.combat.winExp.rout : D.combat.winExp.other;
  const sum: BattleSummary = { winner: st.winner, rounds: st.round, levelUps: [], lost: [], beaten: [], beatenSides: [], beatenIds: [], winExp: { amount: winExp, rout } };
  const expOf = (u: (typeof st.units)[number]): number => u.expGained * D.combat.expGain + (u.home === st.winner ? winExp : 0);
  const remove = new Map<string, Set<number>>();
  // 同じ武将に同じ名前の兵が2隊以上いるときは「（2隊目）」を添える（失った兵と、上がった兵を見分けられるように）
  const troopUnits = st.units.filter((u) => u.kind !== 'general');
  const label = (u: (typeof st.units)[number]): string => {
    const same = troopUnits.filter((x) => x.generalId === u.generalId && x.name === u.name).sort((a, b) => a.troopIndex - b.troopIndex);
    return same.length > 1 ? `${u.name}（${same.indexOf(u) + 1}隊目）` : u.name;
  };
  for (const u of st.units) {
    const g = gs.generals[u.generalId];
    if (!g) continue;
    // 直伝の借り物を使った回数を足す（5回で身につく。P68）
    const addUses = (ts: Taught[] | undefined): void => { for (const [id, n] of Object.entries(u.artUses ?? {})) { const x = ts?.find((q) => q.id === id); if (x) x.uses += n; } };
    if (u.kind === 'general') {
      // 退却した武将は、倒されたのではない（深手にしない）
      if (!u.alive && !st.withdrawn?.includes(u.id)) {
        sum.beaten.push(g.name.ja); sum.beatenSides.push(u.home); sum.beatenIds.push(g.id);
        const by = [...(u.killedBy ? [u.killedBy] : []), ...Object.entries(u.hurtBy ?? {}).sort((a, b) => b[1] - a[1]).map(([id]) => id)];
        (sum.beatenBy ??= {})[g.id] = [...new Set(by)].filter((id) => id !== g.id).slice(0, 3);
      }
      addUses(g.taught);
      const from = g.level;
      if (expOf(u) > 0 && gainGeneralExp(g, expOf(u), rng) > 0) sum.levelUps.push({ name: g.name.ja, from, to: g.level, side: u.home });
      continue;
    }
    const t = g.troops[u.troopIndex];
    if (!t) continue;
    // 倒れた兵は失われる。撤退した兵は残る。寝返ったまま・収容されたままの兵も失われる
    const lost = (!u.alive && !u.retreated) || u.side !== u.home;
    if (lost) {
      if (!remove.has(g.id)) remove.set(g.id, new Set());
      remove.get(g.id)!.add(u.troopIndex);
      sum.lost.push({ general: g.name.ja, unit: `${label(u)} Lv${t.level}`, side: u.home });
      continue;
    }
    addUses(t.taught);
    const from = t.level;
    if (expOf(u) > 0 && gainTroopExp(t, expOf(u), rng) > 0) sum.levelUps.push({ name: `${g.name.ja}の${label(u)}`, from, to: t.level, side: u.home });
  }
  for (const [gid, idxs] of remove) gs.generals[gid].troops = gs.generals[gid].troops.filter((_t, i) => !idxs.has(i));
  return sum;
}
