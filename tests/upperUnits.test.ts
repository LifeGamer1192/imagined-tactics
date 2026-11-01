// 上級の8兵種（P106）：鼓舞の距離・地の利・騎馬殺し・回復の名手・加持・山の回復・新しい軍略
import { describe, expect, it } from 'vitest';
import { apply, startTurn } from '../src/battle/engine';
import { parseMap, type BattleMap } from '../src/battle/map';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { damageParts, healAmount, hitParts, tacticVictims } from '../src/rules/combat';
import { has, moveOf, skillOf, tacticResist } from '../src/rules/stats';

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
function field(text: string): BattleState {
  const map: BattleMap = parseMap(text);
  return { map, units: [], turn: 0, round: 1, maxRounds: 20, winner: null, rng: new RNG(7), log: [], sideNames: ['攻', '守'] };
}
const PLAIN = Array.from({ length: 7 }, () => '. . . . . . . . .').join('\n');
const fxOf = (st: BattleState, a: BUnit, t: BUnit) => Object.fromEntries(damageParts(st, a, skillOf(a.skills[0]), t).fx ?? []);

describe('upper units (P106)', () => {
  it('every T2 of the 8 lines promotes at Lv20 into the new T3', () => {
    const pairs: [string, string][] = [['u02b', 'u02c'], ['u03b', 'u03c'], ['u04b', 'u04c'], ['u06b', 'u06c'], ['u08b', 'u08c'], ['u08b2', 'u08c2'], ['u12b', 'u12c'], ['u12b2', 'u12c2']];
    for (const [a, b] of pairs) {
      expect(D.byUnit[a].promote, a).toEqual([{ to: b, lv: 20 }]);
      expect(D.byUnit[b].tier, b).toBe(3);
      expect(D.byUnit[b].line).toBe(D.byUnit[a].line);
    }
  });

  it('大太鼓衆: rally reaches allies 2 hexes away, does not stack with 法螺貝衆', () => {
    const st = field(PLAIN), g = st.map.grid;
    const a = troop(st, 'u01a', 0, g.idx(3, 3)), t = troop(st, 'u06a', 1, g.idx(4, 3));
    const drum = troop(st, 'u02c', 0, g.idx(1, 3));
    expect(g.distance(drum.pos, a.pos)).toBe(2);
    expect(fxOf(st, a, t)['鼓舞']).toBeCloseTo(1.1, 6);
    drum.pos = g.idx(0, 3);
    expect(fxOf(st, a, t)['鼓舞']).toBeUndefined();
    troop(st, 'u02b', 0, g.idx(2, 3));
    drum.pos = g.idx(1, 3);
    expect(fxOf(st, a, t)['鼓舞']).toBeCloseTo(1.1, 6);
  });

  it('大太鼓衆: 勢い太鼓 and 早鼓 hit the target hex and its neighbours (allies only)', () => {
    const st = field(PLAIN), g = st.map.grid;
    const drum = troop(st, 'u02c', 0, g.idx(1, 3));
    const c = g.idx(4, 3);
    const mates = g.neighbors(c).slice(0, 3).map((i) => troop(st, 'u01a', 0, i));
    const foe = troop(st, 'u01a', 1, g.neighbors(c)[3]);
    const tac = D.byTactic.x40;
    const v = tacticVictims(st, drum, tac, c);
    expect(v.map((x) => x.id).sort()).toEqual(mates.map((x) => x.id).sort());
    drum.mp = 999;
    expect(apply(st, { type: 'tactic', unit: drum.id, tactic: 'x40', target: c })).toBe(true);
    for (const m of mates) expect(has(m, 'atkUp')).toBe(true);
    expect(has(foe, 'atkUp')).toBe(false);
  });

  it('警固衆: on water move +1 and evade +10, not on land', () => {
    const st = field('~ ~ ~ ~ ~\n. . . . .'), g = st.map.grid;
    const ship = troop(st, 'u03c', 0, g.idx(1, 0)), foe = troop(st, 'u06a', 1, g.idx(2, 0));
    const base = D.byUnit.u03c.move;
    expect(moveOf(ship, st)).toBe(base + 1);
    expect(hitParts(st, foe, skillOf(foe.skills[0]), ship).passEvade).toBe(10);
    ship.pos = g.idx(1, 1);
    expect(moveOf(ship, st)).toBe(base);
    expect(hitParts(st, foe, skillOf(foe.skills[0]), ship).passEvade).toBe(0);
  });

  it('雑賀衆: 狙撃 needs loading, range 3, hit +10', () => {
    const k = D.bySkill.k106;
    expect(k.reload).toBe(true);
    expect(k.range).toEqual([1, 3]);
    expect(k.hit).toBe(10);
    expect(D.byUnit.u04c.skills).toContain('k106');
  });

  it('大弓衆: +40% against any cavalry, nothing against foot', () => {
    const st = field(PLAIN), g = st.map.grid;
    const bow = troop(st, 'u06c', 0, g.idx(2, 3));
    const rider = troop(st, 'u07a', 1, g.idx(4, 3)), foot = troop(st, 'u01a', 1, g.idx(5, 3));
    expect(damageParts(st, bow, skillOf('k107'), rider).bane).toBeCloseTo(1.4, 6);
    expect(damageParts(st, bow, skillOf('k107'), foot).bane).toBeCloseTo(1, 6);
    expect(skillOf('k107').range).toEqual([1, 3]);
  });

  it('御典医: heals 30% more; 施薬 heals the hex and its neighbours, allies only', () => {
    const st = field(PLAIN), g = st.map.grid;
    const doc = troop(st, 'u08c', 0, g.idx(3, 3)), plain = troop(st, 'u08b', 0, g.idx(0, 0));
    plain.int = doc.int;
    expect(healAmount(doc, 100) / healAmount(plain, 100)).toBeCloseTo(1.3, 1);
    const tac = D.byTactic.x42;
    expect(tac.range).toBe(1);
    expect(tac.area).toBe(1);
    const ally = troop(st, 'u01a', 0, g.neighbors(doc.pos)[0]), foe = troop(st, 'u01a', 1, g.neighbors(doc.pos)[1]);
    expect(tacticVictims(st, doc, tac, doc.pos).map((x) => x.id).sort()).toEqual([doc.id, ally.id].sort());
    expect(tacticVictims(st, doc, tac, doc.pos)).not.toContain(foe);
  });

  it('高僧: adjacent allies get +20% tactic resist', () => {
    const st = field(PLAIN), g = st.map.grid;
    const a = troop(st, 'u01a', 0, g.idx(3, 3));
    const r0 = tacticResist(st, a);
    const monk = troop(st, 'u08c2', 0, g.idx(4, 3));
    expect(tacticResist(st, a) - r0).toBeCloseTo(0.2, 6);
    monk.pos = g.idx(6, 3);
    expect(tacticResist(st, a)).toBeCloseTo(r0, 6);
    expect(tacticResist(st, monk)).toBeCloseTo(r0, 6);
  });

  it('修験者: regenerates an extra 10% on mountains only', () => {
    const st = field('^ ^ .\n. . .'), g = st.map.grid;
    const u = troop(st, 'u12c', 0, g.idx(0, 0));
    troop(st, 'u01a', 1, g.idx(2, 1));
    u.hp = 100;
    startTurn(st, 0);
    const mtn = u.hp - 100;
    u.pos = g.idx(2, 0); u.hp = 100;
    startTurn(st, 0);
    const flat = u.hp - 100;
    expect(mtn).toBeGreaterThan(flat);
    expect(mtn).toBe(Math.round(u.maxHp * 0.2));
  });

  it('天狗衆: +60% against a target on a mountain', () => {
    const st = field('. ^ .\n. . .'), g = st.map.grid;
    const t = troop(st, 'u12c2', 0, g.idx(0, 0)), foe = troop(st, 'u01a', 1, g.idx(1, 0));
    expect(damageParts(st, t, skillOf('k108'), foe).bane).toBeCloseTo(1.6, 6);
    foe.pos = g.idx(0, 1);
    expect(damageParts(st, t, skillOf('k108'), foe).bane).toBeCloseTo(1, 6);
    expect(skillOf('k108').power).toBeGreaterThan(skillOf('k054').power);
  });
});
