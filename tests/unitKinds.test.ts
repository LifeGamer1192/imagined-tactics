// 歩兵・槍・戟の三すくみ（0.16.0 で槍と長槍を1つに）と、騎馬武者・盾・陣太鼓・黒鍬の特徴（0.11.0）
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
import { troopPromotions } from '../src/rules/growth';
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

describe('three kinds of infantry', () => {
  it('each beats one of the others by 25%: foot → spear → halberd → foot', () => {
    const ids = { foot: 'u01a', spear: 'u19a', halberd: 'u21a' } as const;
    const cycle: [keyof typeof ids, keyof typeof ids][] = [['foot', 'spear'], ['spear', 'halberd'], ['halberd', 'foot']];
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

  it('spear line (0.16.0): 三間槍衆 reaches two hexes; every spear gets formation next to another spear, −30% in forest, and brace', () => {
    const st = field('. . . . . .\n. . . . . .\n. . T . . .'), g = st.map.grid;
    const p = troop(st, 'u20b', 1, g.idx(3, 0)), e = troop(st, 'u06a', 0, g.idx(1, 0));
    expect(basicOf(p).range).toEqual([1, 2]);
    expect(fxOf(st, e, p)['隊列']).toBeUndefined();
    troop(st, 'u19a', 1, g.idx(4, 0));
    expect(fxOf(st, e, p)['隊列']).toBeCloseTo(1 / 1.1, 6);
    p.pos = g.idx(2, 2);
    expect(fxOf(st, p, e)['足場が悪い']).toBeCloseTo(0.7, 6);
    for (const id of ['u19a', 'u01b', 'u19c', 'u20b', 'u01c']) {
      const u = D.byUnit[id];
      expect(u.line, id).toBe(19);
      expect(u.kind, id).toBe('spear');
      for (const t of ['brace', 'formation', 'cramped']) expect(u.passives.some((x) => x.type === t), `${id} ${t}`).toBe(true);
    }
    // 素槍足軽から、中級で足軽槍組か三間槍衆を選ぶ。上級はそのまま
    expect(D.byUnit.u19a.promote.map((x) => x.to)).toEqual(['u01b', 'u20b']);
    expect(D.byUnit.u01b.promote.map((x) => x.to)).toEqual(['u19c']);
    expect(D.byUnit.u20b.promote.map((x) => x.to)).toEqual(['u01c']);
    expect(D.byUnit.u20a).toBeUndefined();
    // 昇格の選択肢：Lv10 の素槍足軽は、足軽槍組と三間槍衆の2つから選べる
    const opts = troopPromotions(makeTroop(D.byUnit.u19a, 10), {});
    expect(opts.filter((o) => o.ok).map((o) => o.to.id).sort()).toEqual(['u01b', 'u20b']);
  });

  it('halberd: shields do not work, and the higher tiers unhorse cavalry they hit', () => {
    const st = field(PLAIN), g = st.map.grid;
    const n = troop(st, 'u21b', 0, g.idx(2, 3)), h = troop(st, 'u13b', 1, g.idx(3, 3));
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

  it('0.16.0: 薙刀衆 also unhorses; a foot unit riding by the 騎乗 tactic loses it', () => {
    expect(D.byUnit.u21a.passives.some((p) => p.type === 'unhorse')).toBe(true);
    const st = field(PLAIN), g = st.map.grid;
    const n = troop(st, 'u21a', 0, g.idx(2, 3)), f = troop(st, 'u01a', 1, g.idx(3, 3));
    n.passives.push({ type: 'hit', pct: 100 });
    addStatus(st, f, 'mounted', -1);
    expect(isCavalry(f)).toBe(true);
    f.hp = f.maxHp = 1e6;
    apply(st, { type: 'skill', unit: n.id, skill: n.skills[0], target: f.pos });
    expect(has(f, 'grounded')).toBe(true);
    expect(has(f, 'mounted')).toBe(false);
    expect(isCavalry(f)).toBe(false);
  });
});

describe('0.16.0 skills and tactics', () => {
  it('総掛かり is gone, 騎馬突撃 reaches one hex less, 堅陣・軍律 last 4 turns, 号令 is renamed', () => {
    expect(D.bySkill.k031).toBeUndefined();
    expect(D.units.some((u) => u.skills.includes('k031'))).toBe(false);
    expect(D.bySkill.k030.range).toEqual([1, 2]);
    expect(D.bySkill.k030.shape).toEqual({ type: 'line', n: 2 });
    expect(D.byTactic.x25.turns).toBe(4);
    expect(D.byTactic.x23.turns).toBe(4);
    expect(D.byTactic.x30.name.jp).toBe('再行動の号令');
  });
});

describe('cavalry charge, shields against missiles, drums, sappers', () => {
  it('mounted warriors hit 5% harder per hex moved this turn, up to 20%, not on the counter', () => {
    const st = field(PLAIN), g = st.map.grid;
    const c = troop(st, 'u13b', 0, g.idx(0, 3)), t = troop(st, 'u06a', 1, g.idx(5, 3));
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

  it('shield troops halve shots from two hexes or more 80% of the time (0.16.1; was 40%), shown as 盾', () => {
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
    expect(guarded / tries).toBeGreaterThan(0.7);
    expect(guarded / tries).toBeLessThan(0.9);
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

describe('mountain troops on flat ground (0.13.0)', () => {
  it('lose 15% defence and 5 evasion on plain and road, not elsewhere', async () => {
    const { defense } = await import('../src/rules/stats');
    const { hitChance } = await import('../src/rules/combat');
    const st = field('. . . . .\n. ^ . . .'), g = st.map.grid;
    const m = troop(st, 'u12a', 1, g.idx(1, 0)), a = troop(st, 'u06a', 0, g.idx(3, 0));
    const flat = defense(st, m), hit = hitChance(st, a, skillOf('k024'), m);
    expect(flat).toBeCloseTo(m.def * 0.85, 6);
    m.passives = m.passives.filter((p) => p.type !== 'lowland');
    expect(hitChance(st, a, skillOf('k024'), m)).toBe(Math.min(D.combat.hitMax, hit - 5));
    expect(defense(st, m)).toBe(m.def);
    m.passives = [...D.byUnit.u12a.passives];
    m.pos = g.idx(1, 1);   // 山
    expect(defense(st, m)).toBe(m.def);
  });
});

describe('recruiting', () => {
  it('no single line takes more than 30% of a pool when there are enough lines', () => {
    const w: Record<string, number> = { u01a: 10, u19a: 1, u04a: 1, u21a: 1, u06a: 1 };
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
  it('stones need loading like crossbows (0.13.0): not without loaded, and firing unloads', () => {
    const st = field(PLAIN), g = st.map.grid;
    const c = troop(st, 'u10c', 0, g.idx(1, 3)), aim = g.idx(4, 3);
    expect(skillOf('k042').reload && skillOf('k040').reload).toBe(true);
    expect(apply(st, { type: 'skill', unit: c.id, skill: 'k042', target: aim })).toBe(false);
    addStatus(st, c, 'loaded', -1);
    expect(apply(st, { type: 'skill', unit: c.id, skill: 'k042', target: aim })).toBe(true);
    expect(has(c, 'loaded')).toBe(false);
  });

  it('gates and palisades in the blast are hit too (0.13.0)', () => {
    const st = field(PLAIN), g = st.map.grid;
    const c = troop(st, 'u10c', 0, g.idx(1, 3)), aim = g.idx(4, 3), side = g.neighbors(aim)[0];
    st.structures = { [aim]: { kind: 'gate', hp: 150, max: 150, def: 140, closed: true, rubble: 'road' }, [side]: { kind: 'palisade', hp: 1000, max: 1000, def: 80, closed: false, rubble: 'plain' } } as unknown as BattleState['structures'];
    addStatus(st, c, 'loaded', -1); addStatus(st, c, 'sureNext');
    apply(st, { type: 'skill', unit: c.id, skill: 'k042', target: aim });
    expect(st.structures![aim]).toBeUndefined();          // 落ちたマスの門は壊れた
    expect(st.map.terrain[aim]).toBe('road');
    const b = st.log.find((e) => e.key === 'breach' && e.vars.cell === side)!;
    expect(b.vars.pct).toBeGreaterThanOrEqual(10);
    expect(st.structures![side].hp).toBeLessThan(1000);
  });

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
    addStatus(st, c, 'sureNext'); addStatus(st, c, 'loaded', -1);
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
    const c2 = troop(st2, 'u10b', 0, g2.idx(2, 3)); addStatus(st2, c2, 'sureNext'); addStatus(st2, c2, 'loaded', -1);
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
      c.acted = false; c.moved = false; addStatus(st, c, 'loaded', -1);
      apply(st, { type: 'skill', unit: c.id, skill: 'k042', target: aim });
      const b = [...st.log].reverse().find((e) => e.key === 'bombard')!;
      if (b.vars.land !== aim) { drifted++; expect(blastCells(st, aim)).toContain(b.vars.land); }
    }
    expect(drifted).toBeGreaterThan(15);
    c.passives = c.passives.filter((p) => p.type !== 'hit');
    expect(aimChance(st, c, skillOf('k042'), aim)).toBe(D.combat.hitBase + skillOf('k042').hit);
  });
});

describe('0.16.2 adjustments', () => {
  it('siege troops resist only poison; 山岳精鋭・天狗衆 are tougher and 10% heavier; mounted warriors get 馬上弓', () => {
    for (const id of ['u10a', 'u10b', 'u10c']) expect(D.byUnit[id].passives.find((p) => p.type === 'immune')).toMatchObject({ statuses: ['poison'] });
    expect(D.byUnit.u12b2.hp).toBeGreaterThan(D.byUnit.u12b.hp);
    expect(D.byUnit.u12c2.hp).toBeGreaterThan(D.byUnit.u12c.hp);
    expect(D.byUnit.u12b2.cost).toBe(Math.round(D.byUnit.u12b.cost * 1.1));
    expect(D.byUnit.u12c2.cost).toBe(Math.round(D.byUnit.u12c.cost * 1.1));
    const k = D.bySkill.k109;
    expect(k).toMatchObject({ mp: 23, range: [1, 2], basic: false, counter: false });
    expect(k.power).toBeLessThan(D.bySkill.k024.power);
    expect(k.hit).toBeLessThan(D.bySkill.k024.hit);
    for (const id of ['u13b', 'u13c']) expect(D.byUnit[id].skills).toContain('k109');
    // 2マス先の相手を撃てる（馬上でも）
    const st = field(PLAIN), g = st.map.grid;
    const r = troop(st, 'u13b', 0, g.idx(2, 3)), e = troop(st, 'u01a', 1, g.idx(4, 3));
    expect(skillTargetCells(st, r, k)).toContain(e.pos);
  });
});

describe('0.17.0: cavalry lines merged', () => {
  it('軽騎 branches at 中級 into 騎馬隊 or 母衣衆; 騎馬武者 is gone', () => {
    expect(D.byUnit.u13a).toBeUndefined();
    expect(D.byUnit.u07a.promote.map((p) => p.to)).toEqual(['u07b', 'u13b']);
    expect(D.byUnit.u07b.promote.map((p) => p.to)).toEqual(['u07c']);
    expect(D.byUnit.u13b.promote.map((p) => p.to)).toEqual(['u13c']);
    for (const id of ['u07a', 'u07b', 'u07c', 'u07d', 'u13b', 'u13c']) { expect(D.byUnit[id].line, id).toBe(7); expect(D.byUnit[id].kind, id).toBe('cavalry'); }
    expect(D.units.some((u) => u.line === 13)).toBe(false);
    const opts = troopPromotions(makeTroop(D.byUnit.u07a, 10), {});
    expect(opts.filter((o) => o.ok).map((o) => o.to.id).sort()).toEqual(['u07b', 'u13b']);
  });
});

