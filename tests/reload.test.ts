// 装填（2026-10-20）：弩・鉄砲の必中技は、装填済みのときだけ撃てる。撃つと外れ、待機（巡を終えるのも同じ）で込める。戦いの始めは空
import { describe, expect, it } from 'vitest';
import { planUnitDetailed } from '../src/ai/ai';
import { apply } from '../src/battle/engine';
import { parseMap } from '../src/battle/map';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { canUseSkill } from '../src/rules/combat';
import { has, skillOf } from '../src/rules/stats';

const OPEN = Array.from({ length: 7 }, () => '. . . . . . . . .').join('\n');
function field(): BattleState { return { map: parseMap(OPEN), units: [], turn: 0, round: 1, maxRounds: 20, winner: null, rng: new RNG(3), log: [], sideNames: ['攻', '守'] }; }
function put(st: BattleState, unitId: string, side: Side, c: number, r: number): BUnit {
  const def = D.byUnit[unitId], t = makeTroop(def, 10), id = st.units.length;
  const u: BUnit = {
    id, side, home: side, kind: 'general', generalId: `g${id}`, leader: id, troopIndex: -1, defId: unitId, name: `${def.name.jp}${id}`, level: 10, pos: st.map.grid.idx(c, r),
    hp: t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp, str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: def.def, move: def.move, affinity: def.affinity,
    commandRange: 3, passives: [...def.passives], skills: [...def.skills], tactics: [...def.tactics], critPct: 0, healPct: 0, statuses: [],
    moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0,
  };
  st.units.push(u);
  return u;
}

describe('crossbow reload', () => {
  it('starts empty; wait loads; firing unloads; cannot fire twice in a row', () => {
    const st = field();
    const gun = put(st, 'u04a', 0, 2, 3), foe = put(st, 'u01a', 1, 3, 3);
    const volley = skillOf('k014');
    expect(volley.reload).toBe(true);
    expect(has(gun, 'loaded')).toBe(false);
    expect(canUseSkill(st, gun, volley)).toBe(false);
    expect(apply(st, { type: 'skill', unit: gun.id, skill: 'k014', target: foe.pos })).toBe(false);
    expect(apply(st, { type: 'wait', unit: gun.id })).toBe(true);
    expect(has(gun, 'loaded')).toBe(true);
    expect(st.log.some((l) => l.key === 'status.add' && l.vars.status === 'loaded')).toBe(true);
    apply(st, { type: 'endTurn' }); apply(st, { type: 'endTurn' });
    expect(canUseSkill(st, gun, volley)).toBe(true);
    expect(apply(st, { type: 'skill', unit: gun.id, skill: 'k014', target: foe.pos })).toBe(true);
    expect(has(gun, 'loaded')).toBe(false);
  });

  it('ending the turn counts as waiting for units that did not act', () => {
    const st = field();
    const gun = put(st, 'u04b', 0, 1, 1);
    put(st, 'u01a', 1, 7, 5);
    apply(st, { type: 'endTurn' });
    expect(has(gun, 'loaded')).toBe(true);
  });

  it('the AI waits to reload when empty and fires when loaded', () => {
    const st = field();
    const gun = put(st, 'u04a', 0, 2, 3);
    put(st, 'u01a', 1, 4, 3);
    const empty = planUnitDetailed(st, gun).actions;
    expect(empty.some((a) => a.type === 'skill' && a.skill === 'k014')).toBe(false);
    gun.statuses.push({ id: 'loaded', turns: -1 });
    const loaded = planUnitDetailed(st, gun).actions;
    expect(loaded.some((a) => a.type === 'skill' && a.skill === 'k014')).toBe(true);
  });
});
