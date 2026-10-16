// 移動範囲。優先度付きキューでの最短距離の計算は hist-sim/src/sim/military/movement.ts の reach / routeTo の形にならう。

import type { BUnit, BattleState } from '../battle/types';
import { MinHeap } from '../core/heap';
import { D } from '../data/db';
import { affinityOf, moveOf } from './stats';

export interface Reach {
  /** 各マスまでの移動コスト（届かないマスは Infinity） */
  dist: Float64Array;
  prev: Int32Array;
  /** 止まれるマス */
  cells: number[];
}

export function unitAt(st: BattleState, pos: number): BUnit | undefined {
  return st.units.find((u) => u.alive && u.pos === pos);
}

/** 移動コスト（入れない地形は null） */
export function stepCost(st: BattleState, u: BUnit, pos: number): number | null {
  const k = st.map.terrain[pos];
  const c = D.terrain.moveCost[k][affinityOf(u)];
  // 雪：道と建物のほかは、少し重くなる
  if (c !== null && st.weather === 'snow' && !D.terrain.snowFree.includes(k)) return c + D.combat.weather.snowMoveCost;
  return c;
}

/**
 * u が budget の移動力で行けるマス。敵のいるマスには入れない。味方のマスは通れるが止まれない。
 */
export function reach(st: BattleState, u: BUnit, budget = moveOf(u)): Reach {
  const g = st.map.grid;
  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = new Int32Array(g.n).fill(-1);
  const occupied = new Map<number, BUnit>();
  for (const o of st.units) if (o.alive && o.id !== u.id) occupied.set(o.pos, o);
  const heap = new MinHeap();
  dist[u.pos] = 0;
  heap.push(0, u.pos);
  while (heap.size) {
    const d = heap.peekKey();
    const i = heap.pop();
    if (d > dist[i]) continue;
    for (const j of g.neighbors(i)) {
      const c = stepCost(st, u, j);
      if (c === null) continue;
      const o = occupied.get(j);
      if (o && o.side !== u.side) continue;
      const nd = d + c;
      if (nd > budget + 1e-9 || nd >= dist[j]) continue;
      dist[j] = nd; prev[j] = i;
      heap.push(nd, j);
    }
  }
  const cells: number[] = [];
  for (let i = 0; i < g.n; i++) if (dist[i] < Infinity && (i === u.pos || !occupied.has(i))) cells.push(i);
  return { dist, prev, cells };
}

/** 出発点から goal までの道のり（出発点は含まない） */
export function routeTo(r: Reach, goal: number): number[] {
  const out: number[] = [];
  for (let i = goal; r.prev[i] >= 0; i = r.prev[i]) out.push(i);
  return out.reverse();
}
