// 最上級の3兵種（P107）：馬廻衆の身代わり・騎馬軍団の追い討ち・上忍の隠密
import { describe, expect, it } from 'vitest';
import { addStatus, apply, canMove, moveLeft } from '../src/battle/engine';
import { parseMap, type BattleMap } from '../src/battle/map';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { hitParts, tacticVictims } from '../src/rules/combat';
import { troopPromotions } from '../src/rules/growth';
import { has, skillOf } from '../src/rules/stats';

function troop(st: BattleState, unitId: string, side: Side, pos: number): BUnit {
  const def = D.byUnit[unitId], t = makeTroop(def, 1);
  const u: BUnit = {
    id: st.units.length, side, home: side, kind: 'troop', generalId: `t${st.units.length}`, leader: st.units.length, troopIndex: 0,
    defId: unitId, name: def.name.jp, level: 1, pos, hp: t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp,
    str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: def.def, move: def.move, affinity: def.affinity, commandRange: 9,
    passives: [...def.passives], skills: [...def.skills], tactics: [...def.tactics], critPct: 0, healPct: 0,
    statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0,
  };
  st.units.push(u);
  return u;
}
/** 将として置く（勝ち負けが決まらないよう、両陣営に1人ずつ置く） */
function general(st: BattleState, unitId: string, side: Side, pos: number): BUnit {
  const u = troop(st, unitId, side, pos);
  u.kind = 'general';
  return u;
}
function field(text: string): BattleState {
  const map: BattleMap = parseMap(text);
  return { map, units: [], turn: 0, round: 1, maxRounds: 20, winner: null, rng: new RNG(7), log: [], sideNames: ['攻', '守'] };
}
const PLAIN = Array.from({ length: 7 }, () => '. . . . . . . . .').join('\n');

describe('top-tier units (P107)', () => {
  it('promote from the T3 at Lv35 with an item; hp growth of 上忍 is the lowest rank', () => {
    for (const [a, b, item] of [['u01e', 'u01f', 'item_elite'], ['u07c', 'u07d', 'item_elite'], ['u05c', 'u05d', 'item_elite']]) {
      expect(D.byUnit[a].promote).toEqual([{ to: b, lv: 35, item }]);
      expect(D.byUnit[b].tier).toBe(4);
      expect(D.items[item]?.jp).toBeTruthy();
      const t = makeTroop(D.byUnit[a], 35);
      expect(troopPromotions(t, {})[0].ok, b).toBe(false);
      expect(troopPromotions(t, { [item]: 1 })[0].ok, b).toBe(true);
      expect(troopPromotions(makeTroop(D.byUnit[a], 34), { [item]: 1, item_promote: 1 })[0].ok, b).toBe(false);
    }
    expect(D.byUnit.u05d.growth.hp).toEqual([1, 4]);
  });

  it('馬廻衆: takes 30% of the damage its adjacent general receives from enemies', () => {
    const st = field(PLAIN), g = st.map.grid;
    const gen = general(st, 'u01a', 1, g.idx(4, 3));
    gen.hp = gen.maxHp = 5000;
    const guard = troop(st, 'u01f', 1, g.idx(5, 3));
    guard.leader = gen.id;
    general(st, 'u01a', 0, g.idx(0, 0));
    const foe = troop(st, 'u01a', 0, g.idx(3, 3));
    addStatus(st, foe, 'sureNext', -1);
    const g0 = gen.hp, k0 = guard.hp;
    expect(apply(st, { type: 'skill', unit: foe.id, skill: foe.skills[0], target: gen.pos })).toBe(true);
    const shared = st.log.find((e) => e.key === 'guard');
    expect(shared).toBeTruthy();
    const total = (g0 - gen.hp) + (k0 - guard.hp) - 0;
    // 反撃で兵は傷つかない（将が反撃する）。身代わりの量はおよそ3割
    expect(k0 - guard.hp).toBe(shared!.vars.dmg);
    expect((k0 - guard.hp) / total).toBeCloseTo(0.3, 1);
    // 離れていれば、かばわない
    guard.pos = g.idx(7, 3);
    st.log = [];
    foe.acted = false; foe.moved = false;
    addStatus(st, foe, 'sureNext', -1);
    expect(apply(st, { type: 'skill', unit: foe.id, skill: foe.skills[0], target: gen.pos })).toBe(true);
    expect(st.log.some((e) => e.key === 'guard')).toBe(false);
  });

  it('騎馬軍団: after a kill it may move 1 more hex, even with no move left', () => {
    const st = field(PLAIN), g = st.map.grid;
    general(st, 'u01a', 0, g.idx(0, 0)); general(st, 'u01a', 1, g.idx(8, 6));
    const cav = troop(st, 'u07d', 0, g.idx(3, 3));
    const foe = troop(st, 'u01a', 1, g.idx(4, 3));
    foe.hp = 1;
    cav.moved = true; cav.moveSpent = cav.move;
    addStatus(st, cav, 'sureNext', -1);
    expect(apply(st, { type: 'skill', unit: cav.id, skill: 'k029', target: foe.pos })).toBe(true);
    expect(foe.alive).toBe(false);
    expect(canMove(st, cav)).toBe(true);
    expect(moveLeft(st, cav)).toBe(1);
    expect(apply(st, { type: 'move', unit: cav.id, to: g.idx(3, 2) })).toBe(true);
    expect(canMove(st, cav)).toBe(false);
    // 赤備え（追い討ちなし）は、残りが無ければ動けない
    const st2 = field(PLAIN), g2 = st2.map.grid;
    general(st2, 'u01a', 0, g2.idx(0, 0)); general(st2, 'u01a', 1, g2.idx(8, 6));
    const red = troop(st2, 'u07c', 0, g2.idx(3, 3)), f2 = troop(st2, 'u01a', 1, g2.idx(4, 3));
    f2.hp = 1; red.moved = true; red.moveSpent = red.move;
    addStatus(st2, red, 'sureNext', -1);
    expect(apply(st2, { type: 'skill', unit: red.id, skill: 'k029', target: f2.pos })).toBe(true);
    expect(canMove(st2, red)).toBe(false);
  });

  it('上忍: waiting in a forest hides it; one ranged attack misses, then it is gone', () => {
    const st = field('T T T . . .\n. . . . . .\n. . . . . .'), g = st.map.grid;
    general(st, 'u01a', 0, g.idx(5, 2)); general(st, 'u01a', 1, g.idx(0, 2));
    const nin = troop(st, 'u05d', 1, g.idx(1, 0));
    st.turn = 1;
    expect(apply(st, { type: 'wait', unit: nin.id })).toBe(true);
    expect(has(nin, 'hidden')).toBe(true);
    st.turn = 0;
    const bow = troop(st, 'u06b', 0, g.idx(3, 0));
    expect(g.distance(bow.pos, nin.pos)).toBe(2);
    expect(hitParts(st, bow, skillOf('k025'), nin).fixed).toBe('hidden');
    const hp0 = nin.hp;
    expect(apply(st, { type: 'skill', unit: bow.id, skill: 'k025', target: nin.pos })).toBe(true);
    expect(nin.hp).toBe(hp0);
    expect(st.log.some((e) => e.key === 'stealth')).toBe(true);
    expect(has(nin, 'hidden')).toBe(false);
    // 隣からの攻撃・軍略は当たる
    addStatus(st, nin, 'hidden', -1);
    const near = troop(st, 'u01a', 0, g.idx(2, 0));
    expect(hitParts(st, near, skillOf(near.skills[0]), nin).fixed).not.toBe('hidden');
    expect(tacticVictims(st, near, { ...D.byTactic.x04 }, nin.pos)).toContain(nin);
    // 森から出ると解ける
    st.turn = 1; nin.acted = false; nin.moved = false;
    expect(apply(st, { type: 'move', unit: nin.id, to: g.idx(1, 1) })).toBe(true);
    expect(has(nin, 'hidden')).toBe(false);
    // 森でない所で待っても隠れない
    nin.acted = false;
    expect(apply(st, { type: 'wait', unit: nin.id })).toBe(true);
    expect(has(nin, 'hidden')).toBe(false);
  });

  it('上忍: attacking ends hiding', () => {
    const st = field('T T . . .\n. . . . .'), g = st.map.grid;
    general(st, 'u01a', 0, g.idx(4, 1)); general(st, 'u01a', 1, g.idx(0, 1));
    const nin = troop(st, 'u05d', 1, g.idx(0, 0));
    const foe = troop(st, 'u01a', 0, g.idx(1, 0));
    addStatus(st, nin, 'hidden', -1);
    st.turn = 1;
    expect(apply(st, { type: 'skill', unit: nin.id, skill: nin.skills[0], target: foe.pos })).toBe(true);
    expect(has(nin, 'hidden')).toBe(false);
  });
});
