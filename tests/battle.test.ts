import { describe, expect, it } from 'vitest';
import { autoBattle } from '../src/ai/ai';
import { addStatus, apply, canMove, moveCells, startTurn } from '../src/battle/engine';
import { mapFromProvince, parseMap, type BattleMap } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { convert, generalsOf, makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { damageParts, hitChance, skillDamage, tacticDamage, tacticSuccess } from '../src/rules/combat';
import { reach } from '../src/rules/move';
import { FIELD, skillOf } from '../src/rules/stats';
import { loadFixture } from './helpers';

/** テスト用：兵種 unitId の兵を1隊、pos に置く（武将なし。率いる武将は自分自身にしておく） */
function troop(st: BattleState, unitId: string, side: Side, pos: number): BUnit {
  const def = D.byUnit[unitId];
  const t = makeTroop(def, 1);
  const u: BUnit = {
    id: st.units.length, side, home: side, kind: 'general', generalId: `t${st.units.length}`, leader: st.units.length, troopIndex: -1,
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
const basic = (u: BUnit) => skillOf(u.skills[0]);

describe('combat formulas (docs/12 の計算例)', () => {
  it('雑兵 → 雑兵', () => {
    const st = field(PLAIN);
    const a = troop(st, 'u01a', 0, st.map.grid.idx(2, 3)), d = troop(st, 'u01a', 1, st.map.grid.idx(3, 3));
    expect(skillDamage(st, a, basic(a), d)).toBe(95);
    expect(hitChance(st, a, basic(a), d)).toBe(86);
    addStatus(st, a, 'atkNext');
    // 次の攻撃アップは攻撃 +40%（0.8.0。前は +49 で 146）
    expect(skillDamage(st, a, basic(a), d)).toBe(133);
    a.statuses = [];
    addStatus(st, d, 'defUp', 3);
    // 防御アップは防御 +25%（0.8.0。前は +31 で 70）
    expect(skillDamage(st, a, basic(a), d)).toBe(76);
  });

  it('焙烙衆 → 雑兵・黒鍬衆', () => {
    const st = field(PLAIN);
    const a = troop(st, 'u15a', 0, 10), g = troop(st, 'u01a', 1, 11), b = troop(st, 'u10a', 1, 12);
    expect(skillDamage(st, a, basic(a), g)).toBe(139);
    expect(hitChance(st, a, basic(a), g)).toBe(94);
    expect(skillDamage(st, a, basic(a), b)).toBe(97);
    expect(hitChance(st, a, basic(a), b)).toBe(100);
  });

  it('terrain: defender in forest / castle', () => {
    const st = field('. . T C . .\n. . . . . .\n. . . . . .');
    const g = st.map.grid;
    const cav = troop(st, 'u07a', 0, g.idx(1, 0)), nobuse = troop(st, 'u14a', 1, g.idx(2, 0));
    // 計算例の基準 97 は、地形と天気の倍率（0.5.0 で追加）を掛ける前の値。森の相手への騎馬の突撃は、そこに ×0.75
    const p = damageParts(st, cav, basic(cav), nobuse);
    expect(Math.floor(p.power * p.atk / p.def * p.bane * p.counter * p.fire)).toBe(97);
    expect(p.field).toBeCloseTo(FIELD.terrain.forest!.target!.charge, 5);
    expect(skillDamage(st, cav, basic(cav), nobuse)).toBe(Math.max(1, Math.floor(p.power * p.atk / p.def * p.bane * p.counter * p.fire * p.field)));
    expect(hitChance(st, cav, basic(cav), nobuse)).toBe(93);
    const a = troop(st, 'u01a', 0, g.idx(4, 0)), d = troop(st, 'u01a', 1, g.idx(3, 0));
    expect(hitChance(st, a, basic(a), d)).toBe(60);
  });

  it('riders: melee is △, bows are ○', () => {
    const st = field(PLAIN);
    const zohyo = troop(st, 'u01a', 0, 10), yumi = troop(st, 'u06a', 0, 12), rider = troop(st, 'u13a', 1, 11);
    expect(skillDamage(st, zohyo, basic(zohyo), rider)).toBe(82);
    expect(hitChance(st, zohyo, basic(zohyo), rider)).toBe(50);
    // 弓足軽は騎馬特効（+10%）を持つので、表の基準値 91 より高くなる
    expect(hitChance(st, yumi, basic(yumi), rider)).toBe(62);
    expect(skillDamage(st, yumi, basic(yumi), rider)).toBeGreaterThan(91);
  });

  it('tactics', () => {
    const st = field(PLAIN);
    const mage = troop(st, 'u01a', 0, 10); mage.int = 70;
    const zohyo = troop(st, 'u01a', 1, 11), fire = troop(st, 'u15a', 1, 12), top = troop(st, 'u18c', 1, 13);
    const hiya = D.tactics.find((t) => t.name.jp === '火矢')!;
    expect(tacticDamage(st, mage, hiya, zohyo)).toBe(159);
    expect(tacticDamage(st, mage, hiya, fire)).toBe(99);
    expect(tacticSuccess(st, mage, zohyo)).toBe(95);
    expect(tacticSuccess(st, mage, fire)).toBe(67);
    expect(tacticSuccess(st, mage, top)).toBe(18);
    addStatus(st, fire, 'resistUp', 3);
    expect(tacticDamage(st, mage, hiya, fire)).toBeLessThan(99);
  });
});

describe('movement', () => {
  it('terrain cost depends on affinity', () => {
    const st = field('. T T T . .\n. . . . . .\n. ^ ^ ^ . .');
    const g = st.map.grid;
    const plain = troop(st, 'u01a', 0, g.idx(0, 0));     // 平地が得意、移動4
    const forest = troop(st, 'u05a', 0, g.idx(0, 2));    // 森が得意
    expect(reach(st, plain).dist[g.idx(2, 0)]).toBe(4);  // 森2マス = 2+2
    expect(reach(st, plain).dist[g.idx(3, 0)]).toBeGreaterThan(4);
    forest.pos = g.idx(0, 0);
    plain.pos = g.idx(5, 2);
    expect(reach(st, forest).dist[g.idx(3, 0)]).toBe(2.25);
  });

  it('riders cannot enter water; enemies block, allies do not', () => {
    const st = field('. ~ . . .\n. ~ . . .\n. . . . .');
    const g = st.map.grid;
    const rider = troop(st, 'u13a', 0, g.idx(0, 0));
    const r = reach(st, rider, 99);
    expect(r.dist[g.idx(1, 0)]).toBe(Infinity);
    expect(r.dist[g.idx(2, 0)]).toBeLessThan(Infinity);   // 下を回って行ける
    const ally = troop(st, 'u01a', 0, g.idx(0, 2)), foe = troop(st, 'u01a', 1, g.idx(1, 2));
    const r2 = reach(st, rider, 99);
    expect(r2.cells).not.toContain(ally.pos);
    expect(r2.dist[foe.pos]).toBe(Infinity);
  });

  it('move then act; re-move only with the passive', () => {
    const st = field(PLAIN);
    const g = st.map.grid;
    const zohyo = troop(st, 'u01a', 0, g.idx(1, 3)), cav = troop(st, 'u07a', 0, g.idx(1, 1));
    troop(st, 'u01a', 1, g.idx(8, 3));
    expect(moveCells(st, zohyo).length).toBeGreaterThan(10);
    expect(apply(st, { type: 'move', unit: zohyo.id, to: g.idx(2, 3) })).toBe(true);
    expect(canMove(st, zohyo)).toBe(false);
    expect(apply(st, { type: 'wait', unit: zohyo.id })).toBe(true);
    expect(canMove(st, zohyo)).toBe(false);
    expect(apply(st, { type: 'move', unit: cav.id, to: g.idx(2, 1) })).toBe(true);
    expect(apply(st, { type: 'wait', unit: cav.id })).toBe(true);
    expect(canMove(st, cav)).toBe(true);                 // 再移動
    expect(apply(st, { type: 'move', unit: cav.id, to: g.idx(3, 1) })).toBe(true);
    expect(canMove(st, cav)).toBe(false);
  });
});

describe('battle flow', () => {
  it('attack, counter, defeat and victory', () => {
    const st = field(PLAIN);
    const g = st.map.grid;
    const a = troop(st, 'u15c', 0, g.idx(2, 3)), d = troop(st, 'u01a', 1, g.idx(3, 3));
    const hp0 = a.hp;
    let rounds = 0;
    while (st.winner === null && rounds++ < 30) {
      if (st.turn === 0) apply(st, { type: 'skill', unit: a.id, skill: a.skills[0], target: d.pos });
      apply(st, { type: 'endTurn' });
    }
    expect(st.winner).toBe(0);
    expect(d.alive).toBe(false);
    expect(a.hp).toBeLessThanOrEqual(hp0);
    expect(st.log.some((l) => l.key === 'defeat')).toBe(true);
  });

  it('a unit that counters gains experience too, hit or miss (0.9.1)', () => {
    const st = field(PLAIN);
    const g = st.map.grid;
    // 雑兵どうし：攻めても1撃では倒れず、相手は反撃する
    const a = troop(st, 'u01a', 0, g.idx(2, 3)), d = troop(st, 'u01a', 1, g.idx(3, 3));
    apply(st, { type: 'skill', unit: a.id, skill: a.skills[0], target: d.pos });
    expect(d.alive).toBe(true);
    const counter = st.log.find((l) => l.key === 'strike' && (l.d as { counter?: boolean }).counter);
    expect(counter).toBeTruthy();
    expect(d.expGained).toBe(D.combat.counterExp);
    expect(counter!.vars.exp).toBe(D.combat.counterExp);
    expect(a.expGained).toBeGreaterThanOrEqual(D.combat.useExp);
  });

  it('rejects illegal actions', () => {
    const st = field(PLAIN);
    const a = troop(st, 'u01a', 0, 10), d = troop(st, 'u01a', 1, 40);
    expect(apply(st, { type: 'skill', unit: a.id, skill: a.skills[0], target: d.pos })).toBe(false);   // 射程外
    expect(apply(st, { type: 'wait', unit: d.id })).toBe(false);                                       // 相手の番
    expect(apply(st, { type: 'move', unit: a.id, to: d.pos })).toBe(false);
  });

  it('poison and timed statuses tick at the start of the side turn', () => {
    const st = field(PLAIN);
    const a = troop(st, 'u01a', 0, 10); troop(st, 'u01a', 1, 40);
    addStatus(st, a, 'poison'); addStatus(st, a, 'defUp', 2);
    const hp = a.hp;
    startTurn(st, 0);
    expect(a.hp).toBe(hp - Math.round(a.maxHp * 0.1));
    expect(a.statuses.some((s) => s.id === 'defUp')).toBe(true);
    startTurn(st, 0);
    expect(a.statuses.some((s) => s.id === 'defUp')).toBe(false);
  });

  it('time limit: the defender wins', () => {
    const st = field(PLAIN);
    troop(st, 'u01a', 0, 0); troop(st, 'u01a', 1, 62);
    st.maxRounds = 2;
    for (let i = 0; i < 4; i++) apply(st, { type: 'endTurn' });
    expect(st.winner).toBe(1);
  });
});

describe('auto battle from real saves', () => {
  for (const f of ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'sangoku_fid5_212', 'rome_fid3_212bc', 'invented_archipelago_y30']) {
    it(f, async () => {
      const save = await loadFixture(f);
      const gs = convert(save);
      const facs = Object.values(gs.factions).sort((x, y) => generalsOf(gs, y.id).length - generalsOf(gs, x.id).length);
      const [fa, fb] = facs;
      const pick = (id: number) => generalsOf(gs, id).sort((x, y) => y.level - x.level).slice(0, 3).map((g) => g.id);
      const map = mapFromProvince(save.world, fb.capital, { capital: true });
      const run = () => autoBattle(createBattle(gs, map, [pick(fa.id), pick(fb.id)], 'test', [fa.name.ja, fb.name.ja]));
      const st = run();
      expect(st.winner, f).not.toBeNull();
      expect(st.units.length).toBeGreaterThanOrEqual(6);
      // 位置の重なりが無い
      const pos = st.units.filter((u) => u.alive).map((u) => u.pos);
      expect(new Set(pos).size).toBe(pos.length);
      // 同じ条件なら同じ結果
      const st2 = run();
      expect(st2.winner).toBe(st.winner);
      expect(st2.log.length).toBe(st.log.length);
    });
  }
});
