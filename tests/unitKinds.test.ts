// 歩兵・槍・長槍・戟と、騎馬武者・盾・陣太鼓・黒鍬の特徴（0.11.0）
import { describe, expect, it } from 'vitest';
import { addStatus, apply, startTurn } from '../src/battle/engine';
import { parseMap, type BattleMap } from '../src/battle/map';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { capLines, convert, makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { aimChance, blastCells, breachParts, damageParts, skillDamage, skillTargetCells } from '../src/rules/combat';
import { reach } from '../src/rules/move';
import { has, isCavalry, skillOf, terrainMod } from '../src/rules/stats';
import { loadFixture } from './helpers';

/** 兵を1隊置く（兵として扱う。率いる武将は自分自身） */
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
const basicOf = (u: BUnit) => skillOf(u.skills[0]);
const fxOf = (st: BattleState, a: BUnit, t: BUnit, counter = false) => Object.fromEntries(damageParts(st, a, basicOf(a), t, counter).fx ?? []);

describe('four kinds of infantry', () => {
  it('each beats one of the others by 25%: foot → pike → spear → halberd → foot', () => {
    const ids = { foot: 'u01a', pike: 'u20a', spear: 'u19a', halberd: 'u21a' } as const;
    const cycle: [keyof typeof ids, keyof typeof ids][] = [['foot', 'pike'], ['pike', 'spear'], ['spear', 'halberd'], ['halberd', 'foot']];
    for (const [a, b] of cycle) {
      const st = field(PLAIN), g = st.map.grid;
      const x = troop(st, ids[a], 0, g.idx(2, 3)), y = troop(st, ids[b], 1, g.idx(3, 3));
      expect(Object.entries(fxOf(st, x, y)).find(([k]) => k.startsWith('相性'))?.[1], `${a}→${b}`).toBeCloseTo(1.25, 6);
      // 逆向きには付かない
      expect(Object.keys(fxOf(st, y, x)).some((k) => k.startsWith('相性')), `${b}→${a}`).toBe(false);
    }
  });

  it('foot: +5% per neighbouring friendly foot (up to 15%), and forest/mountain/swamp hurt half as much', () => {
    const st = field(PLAIN), g = st.map.grid;
    const a = troop(st, 'u01a', 0, g.idx(3, 3)), t = troop(st, 'u06a', 1, g.idx(4, 3));
    expect(fxOf(st, a, t)['数の利（1）']).toBeUndefined();
    const free = g.neighbors(a.pos).filter((i) => i !== t.pos);
    for (const i of free.slice(0, 4)) troop(st, 'u01a', 0, i);
    expect(fxOf(st, a, t)['数の利（4）']).toBeCloseTo(1.15, 6);
    const wood = field('. T T T . .\n. . . . . .');
    const f = troop(wood, 'u01a', 0, wood.map.grid.idx(0, 0)), r = troop(wood, 'u07a', 0, wood.map.grid.idx(0, 1));
    expect(reach(wood, f).dist[wood.map.grid.idx(2, 0)]).toBe(3);
    f.pos = wood.map.grid.idx(1, 0); r.pos = wood.map.grid.idx(2, 0);
    expect(terrainMod(wood, f)).toBe(terrainMod(wood, r) / 2);
  });

  it('spear: counters cavalry 1.5 times as hard', () => {
    const st = field(PLAIN), g = st.map.grid;
    const s = troop(st, 'u19a', 1, g.idx(3, 3)), h = troop(st, 'u07a', 0, g.idx(2, 3)), f = troop(st, 'u01a', 0, g.idx(4, 3));
    expect(isCavalry(h)).toBe(true);
    expect(fxOf(st, s, h, true)['迎え撃ち']).toBe(1.5);
    expect(fxOf(st, s, h, false)['迎え撃ち']).toBeUndefined();
    expect(fxOf(st, s, f, true)['迎え撃ち']).toBeUndefined();
  });

  it('pike: reaches two hexes (and counters there), +10% defence next to another pike, −30% in forest', () => {
    const st = field('. . . . . .\n. . . . . .\n. . T . . .'), g = st.map.grid;
    const p = troop(st, 'u20a', 1, g.idx(3, 0)), e = troop(st, 'u06a', 0, g.idx(1, 0));
    expect(basicOf(p).range).toEqual([1, 2]);
    expect(fxOf(st, e, p)['隊列']).toBeUndefined();
    troop(st, 'u20a', 1, g.idx(4, 0));
    expect(fxOf(st, e, p)['隊列']).toBeCloseTo(1 / 1.1, 6);
    p.pos = g.idx(2, 2);
    expect(fxOf(st, p, e)['足場が悪い']).toBeCloseTo(0.7, 6);
  });

  it('halberd: shields do not work, and the higher tiers unhorse cavalry they hit', () => {
    const st = field(PLAIN), g = st.map.grid;
    const n = troop(st, 'u21b', 0, g.idx(2, 3)), h = troop(st, 'u13a', 1, g.idx(3, 3));
    n.passives.push({ type: 'hit', pct: 100 });
    apply(st, { type: 'skill', unit: n.id, skill: n.skills[0], target: h.pos });
    const d = [...st.log].reverse().find((e) => e.key === 'strike' && e.d?.type === 'strike' && !e.d.counter)?.d;
    expect(d && d.type === 'strike' && d.landed).toBe(true);
    expect(has(h, 'grounded')).toBe(true);
    expect(isCavalry(h)).toBe(false);
    // 盾が効かない：鉄盾衆を何度叩いても、盾の記録が出ない
    const st2 = field(PLAIN), g2 = st2.map.grid;
    const a = troop(st2, 'u21a', 0, g2.idx(2, 3)), s = troop(st2, 'u09c', 1, g2.idx(3, 3));
    a.passives.push({ type: 'hit', pct: 100 }); s.hp = s.maxHp = 1e6;
    for (let k = 0; k < 30; k++) { a.acted = false; a.moved = false; apply(st2, { type: 'skill', unit: a.id, skill: a.skills[0], target: s.pos }); }
    expect(st2.log.some((e) => e.key === 'shield' && e.vars.sid === s.id)).toBe(false);
  });
});

describe('cavalry charge, shields against missiles, drums, sappers', () => {
  it('mounted warriors hit 5% harder per hex moved this turn, up to 20%, not on the counter', () => {
    const st = field(PLAIN), g = st.map.grid;
    const c = troop(st, 'u13a', 0, g.idx(0, 3)), t = troop(st, 'u06a', 1, g.idx(5, 3));
    expect(fxOf(st, c, t)['突撃（3マス）']).toBeUndefined();
    apply(st, { type: 'move', unit: c.id, to: g.idx(3, 3) });
    expect(c.moveSteps).toBe(3);
    expect(fxOf(st, c, t)['突撃（3マス）']).toBeCloseTo(1.15, 6);
    c.moveSteps = 6;
    expect(fxOf(st, c, t)['突撃（6マス）']).toBeCloseTo(1.2, 6);
    expect(Object.keys(fxOf(st, c, t, true)).some((k) => k.startsWith('突撃'))).toBe(false);
    startTurn(st, 0);
    expect(c.moveSteps).toBe(0);
  });

  it('shield troops halve shots from two hexes or more 40% of the time, shown as 盾', () => {
    const st = field(PLAIN), g = st.map.grid;
    const b = troop(st, 'u06a', 0, g.idx(1, 3)), s = troop(st, 'u09a', 1, g.idx(3, 3));
    s.passives = s.passives.filter((p) => p.type !== 'shield');   // 受け止めを外して、飛び道具の盾だけを見る
    b.passives.push({ type: 'hit', pct: 100 }); s.hp = s.maxHp = 1e6;
    let tries = 0, guarded = 0;
    for (let k = 0; k < 200; k++) {
      b.acted = false; b.moved = false;
      apply(st, { type: 'skill', unit: b.id, skill: b.skills[0], target: s.pos });
      const d = [...st.log].reverse().find((e) => e.key === 'strike' && e.d?.type === 'strike' && !e.d.counter)?.d;
      if (d?.type === 'strike' && d.dmg) { tries++; if (d.dmg.shield?.ok) { guarded++; expect(d.dmg.shield.missile).toBe(true); } }
    }
    expect(guarded / tries).toBeGreaterThan(0.3);
    expect(guarded / tries).toBeLessThan(0.5);
    // 隣からの攻撃には効かない
    b.pos = g.idx(2, 3);
    const before = st.log.filter((e) => e.key === 'shield').length;
    for (let k = 0; k < 40; k++) { b.acted = false; apply(st, { type: 'skill', unit: b.id, skill: b.skills[0], target: s.pos }); }
    expect(st.log.filter((e) => e.key === 'shield').length).toBe(before);
  });

  it('a war drum gives neighbouring allies +10% (not stacking), and sappers break gates in one blow', () => {
    const st = field(PLAIN), g = st.map.grid;
    const a = troop(st, 'u01a', 0, g.idx(3, 3)), t = troop(st, 'u06a', 1, g.idx(4, 3));
    expect(fxOf(st, a, t)['鼓舞']).toBeUndefined();
    const free = g.neighbors(a.pos).filter((i) => i !== t.pos);
    troop(st, 'u02a', 0, free[0]); troop(st, 'u02b', 0, free[1]);
    expect(fxOf(st, a, t)['鼓舞']).toBeCloseTo(1.1, 6);
    // 黒鍬衆（Lv1）は、城の門を一撃で壊す
    st.structures = { [g.idx(6, 3)]: { kind: 'gate', hp: 150, max: 150, def: 140, closed: true, rubble: 'road' } } as unknown as BattleState['structures'];
    const s = troop(st, 'u10a', 0, g.idx(5, 3));
    expect(breachParts(st, s, g.idx(6, 3)).base * 0.9).toBeGreaterThan(150);
  });
});

describe('recruiting', () => {
  it('no single line takes more than 30% of a pool when there are enough lines', () => {
    const w: Record<string, number> = { u01a: 10, u19a: 1, u20a: 1, u21a: 1, u06a: 1 };
    capLines(w, 0.3);
    const total = Object.values(w).reduce((s, v) => s + v, 0);
    expect(w.u01a / total).toBeCloseTo(0.3, 3);
    const few: Record<string, number> = { u01a: 10, u06a: 1 };
    capLines(few, 0.3);
    expect(few.u01a).toBe(10);
  });

  it('the starting armies are no longer half foot soldiers', async () => {
    for (const name of ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'sangoku_fid5_212', 'rome_fid3_212bc']) {
      const gs = convert(await loadFixture(name));
      const lines = new Map<number, number>();
      let n = 0;
      for (const g of Object.values(gs.generals)) if (g.faction) for (const t of g.troops) { const l = D.byUnit[t.unitId].line; lines.set(l, (lines.get(l) ?? 0) + 1); n++; }
      const top = Math.max(...lines.values()) / n;
      expect(top, name).toBeLessThan(0.4);
      expect([19, 20, 21].some((l) => lines.has(l)), name).toBe(true);
    }
  });
});

describe('catapults drop stones on a chosen hex (0.12.0)', () => {
  it('the middle and top tiers can aim at any hex in range, even an empty one', () => {
    const st = field(PLAIN), g = st.map.grid;
    for (const id of ['u10b', 'u10c']) {
      const c = troop(st, id, 0, g.idx(1, 3));
      const s = D.byUnit[id].skills.map((k) => skillOf(k)).find((k) => k.bombard)!;
      expect(s, id).toBeTruthy();
      const cells = skillTargetCells(st, c, s);
      expect(cells).toContain(g.idx(1 + s.range[1], 3));
      expect(cells.every((i) => g.distance(c.pos, i) >= s.range[0] && g.distance(c.pos, i) <= s.range[1])).toBe(true);
      c.alive = false;
    }
    expect(D.byUnit.u10a.skills.some((k) => skillOf(k).bombard)).toBe(false);
  });

  it('a hit lands on the aimed hex: 100% there, 10-50% on the neighbours, friend or foe, never the thrower; no counter', () => {
    const st = field(PLAIN), g = st.map.grid;
    const c = troop(st, 'u10c', 0, g.idx(1, 3)), aim = g.idx(4, 3);
    const s = skillOf('k042');
    const foe = troop(st, 'u01a', 1, aim), [n1, n2] = g.neighbors(aim);
    const friend = troop(st, 'u01a', 0, n1), foe2 = troop(st, 'u06a', 1, n2);
    for (const u of [foe, friend, foe2]) { u.hp = u.maxHp = 1e5; u.passives = []; }
    c.critPct = -100;
    addStatus(st, c, 'sureNext');
    const base = { foe: skillDamage(st, c, s, foe), friend: skillDamage(st, c, s, friend), foe2: skillDamage(st, c, s, foe2) };
    apply(st, { type: 'skill', unit: c.id, skill: 'k042', target: aim });
    const b = st.log.find((e) => e.key === 'bombard')!;
    expect(b.vars.land).toBe(aim);
    const blast = (u: BUnit) => st.log.find((e) => e.key === 'blast' && e.vars.tid === u.id)!.vars;
    expect(blast(foe).pct).toBe(100);
    expect(1e5 - foe.hp).toBeGreaterThanOrEqual(Math.floor(base.foe * 0.9));
    for (const [u, d] of [[friend, base.friend], [foe2, base.foe2]] as const) {
      const v = blast(u);
      expect(v.pct).toBeGreaterThanOrEqual(10); expect(v.pct).toBeLessThanOrEqual(50);
      expect(1e5 - u.hp).toBeLessThanOrEqual(Math.ceil(d * 1.1 * 0.5) + 1);
    }
    expect(friend.hp).toBeLessThan(1e5);
    expect(st.log.some((e) => e.key === 'strike')).toBe(false);   // 反撃は無い
    // 撃った駒は、隣に落ちても巻き込まない
    const st2 = field(PLAIN), g2 = st2.map.grid;
    const c2 = troop(st2, 'u10b', 0, g2.idx(2, 3)); addStatus(st2, c2, 'sureNext');
    const hp = c2.hp;
    apply(st2, { type: 'skill', unit: c2.id, skill: 'k040', target: g2.idx(3, 3) });
    expect(c2.hp).toBe(hp);
  });

  it('a miss drifts to one of the neighbouring hexes, and the hit chance on an empty hex ignores evasion', () => {
    const st = field(PLAIN), g = st.map.grid;
    const c = troop(st, 'u10c', 0, g.idx(1, 3)), aim = g.idx(4, 3);
    c.passives.push({ type: 'hit', pct: -500 });
    expect(aimChance(st, c, skillOf('k042'), aim)).toBe(D.combat.hitMin);
    let drifted = 0;
    for (let k = 0; k < 20; k++) {
      c.acted = false; c.moved = false;
      apply(st, { type: 'skill', unit: c.id, skill: 'k042', target: aim });
      const b = [...st.log].reverse().find((e) => e.key === 'bombard')!;
      if (b.vars.land !== aim) { drifted++; expect(blastCells(st, aim)).toContain(b.vars.land); }
    }
    expect(drifted).toBeGreaterThan(15);
    c.passives = c.passives.filter((p) => p.type !== 'hit');
    expect(aimChance(st, c, skillOf('k042'), aim)).toBe(D.combat.hitBase + skillOf('k042').hit);
  });
});
