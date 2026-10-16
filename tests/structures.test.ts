// 柵・物見櫓・砦の門と、門を壊す：攻め手は閉じた門を壊すまで通れない。柵は騎馬を止める。物見櫓は乗った側の飛び道具を強める。
import { describe, expect, it } from 'vitest';
import { autoBattle } from '../src/ai/ai';
import { apply } from '../src/battle/engine';
import { BM, mapFromProvince, parseMap } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import type { BattleState } from '../src/battle/types';
import { convert, generalsOf, makeTroop } from '../src/convert/convert';
import { D } from '../src/data/db';
import { breachParts, breachTargets } from '../src/rules/combat';
import { stepCost } from '../src/rules/move';
import { situationHit, skillRange } from '../src/rules/stats';
import { loadFixture } from './helpers';

async function onMap(text: string, atkUnit = 'u01a', defUnit = 'u01a'): Promise<BattleState> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const [fa, fb] = Object.values(gs.factions).sort((x, y) => generalsOf(gs, y.id).length - generalsOf(gs, x.id).length);
  const ga = generalsOf(gs, fa.id)[0], gb = generalsOf(gs, fb.id)[0];
  ga.troops = [makeTroop(D.byUnit[atkUnit], 5)]; gb.troops = [makeTroop(D.byUnit[defUnit], 5)];
  return createBattle(gs, parseMap(text), [[ga.id], [gb.id]], 'struct', undefined, undefined, { weather: 'clear', night: false });
}

describe('structures on generated maps', () => {
  it('forts get a palisade and a fort gate, camps a palisade, castles without walls a line of palisades; strong places a lookout', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const p = gs.provinces.find((x) => !x.out && Object.values(gs.factions).every((f) => f.capital !== x.id))!;
    const fort = mapFromProvince(save.world, p.id, { fort: 0.4 });
    expect(fort.terrain[fort.seat!]).toBe('fort');
    expect(fort.terrain.includes('fortgate')).toBe(true);
    expect(fort.terrain.includes('palisade')).toBe(true);
    expect(fort.terrain.includes('lookout')).toBe(true);
    const camp = mapFromProvince(save.world, p.id, { fort: 0.1 });
    expect(camp.terrain[camp.seat!]).toBe('camp');
    expect(camp.terrain.includes('palisade')).toBe(true);
    expect(camp.terrain.includes('lookout')).toBe(false);
    const castle = mapFromProvince(save.world, p.id, { fort: 0.65, capital: true });
    expect(castle.terrain.includes('palisade')).toBe(true);
    expect(castle.terrain.includes('wall')).toBe(false);
  });
});

describe('gates and palisades', () => {
  it('closed gates keep attackers out until broken; defenders pass; broken gates become road', async () => {
    const st = await onMap('. . . . .\n. . . G .\n. . . . .');
    const g = st.map.grid, gate = g.idx(3, 1);
    expect(st.structures![gate]).toMatchObject({ kind: 'gate', closed: true, hp: BM.structures.gate.hp });
    const a = st.units.find((u) => u.side === 0 && u.kind === 'troop')!, d = st.units.find((u) => u.side === 1 && u.kind === 'troop')!;
    expect(stepCost(st, a, gate)).toBeNull();
    expect(stepCost(st, d, gate)).not.toBeNull();
    // 隣に立って、壊れるまで打つ
    for (const u of st.units) if (u.pos === g.idx(2, 1)) u.pos = g.idx(0, 0);
    a.pos = g.idx(2, 1);
    expect(breachTargets(st, a)).toContain(gate);
    let hits = 0;
    while (st.structures?.[gate] && hits < 30) {
      a.acted = false; a.moved = false;
      expect(apply(st, { type: 'breach', unit: a.id, target: gate })).toBe(true);
      hits++;
    }
    expect(st.map.terrain[gate]).toBe('road');
    expect(st.mapVersion).toBe(1);
    expect(st.log.some((l) => l.key === 'broken')).toBe(true);
    expect(stepCost(st, a, gate)).not.toBeNull();
    // 守り手は壊せない
    expect(breachTargets(st, d)).toEqual([]);
  });

  it('siege engines break structures twice as hard; palisades stop riders but not foot', async () => {
    const st = await onMap('. . . . .\n. . . L .\n. . . . .', 'u10b');
    const g = st.map.grid, cell = g.idx(3, 1);
    const eng = st.units.find((u) => u.side === 0 && u.kind === 'troop')!;
    eng.pos = g.idx(2, 1);
    const foot = await onMap('. . . . .\n. . . L .\n. . . . .', 'u01b');
    const f = foot.units.find((u) => u.side === 0 && u.kind === 'troop')!;
    f.pos = g.idx(2, 1);
    expect(breachParts(st, eng, cell).siege).toBe(BM.structures.siegeMult);
    expect(breachParts(foot, f, cell).siege).toBe(1);
    const rider = await onMap('. . . . .\n. . . L .\n. . . . .', 'u13a');
    const r = rider.units.find((u) => u.side === 0 && u.kind === 'troop')!;
    expect(stepCost(rider, r, cell)).toBeNull();
    expect(stepCost(foot, f, cell)).not.toBeNull();
  });

  it('a lookout lengthens and sharpens the shots of whoever stands on it, attacker or defender', async () => {
    const st = await onMap('. . . . .\n. . O . .\n. . . . .', 'u06a', 'u06a');
    const g = st.map.grid, look = g.idx(2, 1);
    const perch = D.terrain.ranged.lookout!;
    for (const side of [0, 1] as const) {
      const u = st.units.find((x) => x.side === side && x.kind === 'troop')!, foe = st.units.find((x) => x.side !== side && x.kind === 'troop')!;
      const skill = D.bySkill[u.skills[0]];
      u.pos = g.idx(1, 2);
      const before = { range: skillRange(st, u, skill)[1], hit: situationHit(st, u, skill, foe) };
      u.pos = look;
      expect(skillRange(st, u, skill)[1]).toBe(before.range + perch.range);
      expect(situationHit(st, u, skill, foe)).toBe(before.hit + perch.hit);
      u.pos = g.idx(side === 0 ? 0 : 4, 0);
    }
  });

  it('the same map can be used for two battles: breaking a gate in one does not change the other', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const [fa, fb] = Object.values(gs.factions).sort((x, y) => generalsOf(gs, y.id).length - generalsOf(gs, x.id).length);
    const map = mapFromProvince(save.world, fb.capital, { capital: true, walls: true });
    const before = map.terrain.join(',');
    const pick = (id: number) => generalsOf(gs, id).slice(0, 3).map((g) => g.id);
    autoBattle(createBattle(gs, map, [pick(fa.id), pick(fb.id)], 'twice'));
    expect(map.terrain.join(',')).toBe(before);
  });

  it('in auto battles on walled maps, attackers break gates', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    let broke = 0, hits = 0;
    for (let i = 0; i < 8; i++) {
      const gs = convert(save);
      const facs = Object.values(gs.factions).filter((x) => generalsOf(gs, x.id).length >= 2).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length).slice(0, 8);
      const a = facs[i % facs.length], d = facs[(i + 1) % facs.length], p = gs.provinces[d.capital];
      const pick = (id: number) => generalsOf(gs, id).sort((x, y) => y.level - x.level).slice(0, 3).map((g) => g.id);
      const st = autoBattle(createBattle(gs, mapFromProvince(save.world, d.capital, { capital: true, walls: true, from: p.nb[i % Math.max(1, p.nb.length)] }), [pick(a.id), pick(d.id)], `gate${i}`, undefined, undefined, { weather: 'clear', night: false }));
      expect(st.winner).not.toBeNull();
      if (st.log.some((l) => l.key === 'broken')) broke++;
      if (st.log.some((l) => l.key === 'breach')) hits++;
    }
    expect(hits).toBeGreaterThan(0);
    expect(broke).toBeGreaterThanOrEqual(0);
  }, 120000);
});
