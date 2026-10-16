// ゲーム開始データの武将と兵から、戦闘の初期状態を作る。

import type { GGeneral, GameStart } from '../convert/model';
import { personalityOf } from '../ai/personality';
import { RNG, codeToSeed } from '../core/rng';
import { D, L } from '../data/db';
import { stepCost } from '../rules/move';
import type { BattleMap } from './map';
import type { BUnit, BattleState, Side } from './types';
import { skyFor, type Sky } from './weather';

export const MAX_GENERALS = 3;
/** 戦闘の長さの上限（巡）。過ぎたら守り手の勝ち */
export const MAX_ROUNDS = 20;

function blank(id: number, side: Side): Pick<BUnit, 'id' | 'side' | 'home' | 'statuses' | 'moveSpent' | 'moved' | 'postMoved' | 'acted' | 'extraUsed' | 'alive' | 'retreated' | 'expGained' | 'pos'> {
  return { id, side, home: side, statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0, pos: -1 };
}

export function generalUnit(g: GGeneral, id: number, side: Side): BUnit {
  const c = D.byClass[g.classId];
  const hp = g.stats.hp + c.mod.hp, mp = g.stats.mp + c.mod.mp;
  return {
    ...blank(id, side), kind: 'general', generalId: g.id, leader: id, troopIndex: -1, defId: c.id,
    name: g.name.ja, level: g.level, hp, maxHp: hp, mp, maxMp: mp,
    str: g.stats.str + c.mod.str, int: g.stats.int + c.mod.int, agi: g.stats.agi + c.mod.agi, def: c.def,
    move: c.move, affinity: c.affinity, commandRange: g.commandRange,
    passives: [...g.passives], skills: [`atk:${c.id}`], tactics: [...new Set([...c.tactics, ...g.learned])],
    critPct: g.critPct, healPct: g.healPct, persona: personalityOf(g.traits, g.ab),
  };
}

export function troopUnits(g: GGeneral, firstId: number, leader: number, side: Side): BUnit[] {
  return g.troops.map((t, i) => {
    const u = D.byUnit[t.unitId];
    return {
      ...blank(firstId + i, side), kind: 'troop' as const, generalId: g.id, leader, troopIndex: i, defId: u.id,
      name: t.name ?? L(u.name), level: t.level, hp: t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp,
      str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: u.def,
      move: u.move, affinity: u.affinity, commandRange: 0,
      passives: [...u.passives], skills: [...u.skills], tactics: [...u.tactics],
      critPct: 0, healPct: 0,
    };
  });
}

/**
 * 戦闘を作る。sides[0] が攻め手、sides[1] が守り手（武将の id、それぞれ最大3人）。
 * 天気は、月と種から決まる（同じ種なら同じ天気）。sky を渡すと、その天気にする。
 */
export function createBattle(gs: GameStart, map: BattleMap, sides: [string[], string[]], seed = 'battle', sideNames: [string, string] = ['攻め手', '守り手'], maxRounds = MAX_ROUNDS, sky?: Partial<Sky>): BattleState {
  const code = `${gs.seed}:${gs.tick}:${seed}`;
  // 古いデータで月が無くても動くよう、無ければ春（4月）として扱う
  const auto = skyFor(gs.month ?? 4, code);
  const weather = sky?.weather ?? auto.weather;
  const st: BattleState = {
    // 雪の日は足が遅くなるぶん、戦いの上限を少し延ばす（攻め手が時間切れで負けやすくなりすぎないように）
    map, units: [], turn: 0, round: 1, maxRounds: maxRounds + (weather === 'snow' ? D.combat.weather.snowExtraRounds : 0), winner: null,
    rng: new RNG(codeToSeed(code)), log: [], sideNames,
    weather, night: sky?.night ?? auto.night,
  };
  const g = map.grid;
  const taken = new Set<number>();
  const free = (u: BUnit, i: number) => !taken.has(i) && stepCost({ ...st, units: [] } as BattleState, u, i) !== null && map.terrain[i] !== 'water' && map.terrain[i] !== 'wall';
  const nearest = (u: BUnit, from: number, pool: number[]): number => {
    let best = -1, bestD = Infinity;
    for (const i of pool) {
      if (!free(u, i)) continue;
      const d = g.distance(from, i);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const all = Array.from({ length: g.n }, (_, i) => i);
  for (const side of [0, 1] as Side[]) {
    const ids = sides[side].slice(0, MAX_GENERALS);
    ids.forEach((gid, k) => {
      const gen = gs.generals[gid];
      const leader = generalUnit(gen, st.units.length, side);
      // 配置場所の側（攻め手は左とは限らない：東から攻めるときは右）の、内から2列目を目安にする
      const zone = map.spawn[side], zc = zone.length ? zone.reduce((s, i) => s + g.col(i), 0) / zone.length : (side === 0 ? 1 : g.w - 2);
      const anchor = g.idx(zc < g.w / 2 ? 1 : g.w - 2, Math.min(g.h - 1, Math.round((k + 1) * g.h / (ids.length + 1))));
      let pos = nearest(leader, anchor, map.spawn[side]);
      if (pos < 0) pos = nearest(leader, anchor, all);
      leader.pos = pos; taken.add(pos);
      st.units.push(leader);
      for (const t of troopUnits(gen, st.units.length, leader.id, side)) {
        // 兵は武将のそばに置く。水上が得意な兵でも、開始時は陸に置く
        let p = nearest(t, leader.pos, map.spawn[side]);
        if (p < 0 || g.distance(p, leader.pos) > 3) { const q = nearest(t, leader.pos, all); if (q >= 0) p = q; }
        if (p < 0) continue;
        t.id = st.units.length; t.pos = p; taken.add(p);
        st.units.push(t);
      }
    });
  }
  return st;
}
