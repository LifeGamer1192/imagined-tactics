// 領ごとの戦場：地形と領のようす（人口・収入・不穏・城・建物）から作り、ようすが変われば戦場も変わる。
import { describe, expect, it } from 'vitest';
import { BM, mapFromProvince, mapToText, type BattleMap } from '../src/battle/map';
import { convert } from '../src/convert/convert';
import type { Affinity } from '../src/data/types';
import { D } from '../src/data/db';
import { fromJSON, restore, snapshot, toJSON } from '../src/persist/save';
import { build, buildCost, buildProblem, finishMonth, newCampaign, provinceLook, provinceMap, provincesOf } from '../src/strategy/campaign';
import { FIXTURES, loadFixture } from './helpers';

function reachable(map: BattleMap, aff: Affinity, from: number): Set<number> {
  const seen = new Set([from]), queue = [from];
  while (queue.length) {
    const i = queue.pop()!;
    for (const j of map.grid.neighbors(i)) {
      if (seen.has(j) || D.terrain.moveCost[map.terrain[j]][aff] === null) continue;
      seen.add(j); queue.push(j);
    }
  }
  return seen;
}
const ALL = Object.keys(BM.build.costs);

describe('battle map of each province', () => {
  it('every province gets its own map, and every kind of soldier can reach the defenders\' seat', async () => {
    for (const f of FIXTURES) {
      const save = await loadFixture(f), gs = convert(save);
      const land = gs.provinces.filter((p) => !p.out);
      const c = newCampaign(gs, save.world, 0);
      const texts = new Set(land.map((p) => mapToText(provinceMap(c, p.id))));
      expect(texts.size, f).toBe(land.length);
      for (const p of land) {
        // 建物を全部建て、城の強さを変えても、配置場所が足りて、どの兵も拠点まで行ける
        for (const fort of [0, 0.5, 0.7, 0.9]) {
          const m = mapFromProvince(save.world, p.id, { ...provinceLook(c, p.id), buildings: ALL.filter((b) => b !== 'walls' || fort === 0.9), fort });
          const g = m.grid, seat = g.idx(g.w - 2, Math.floor(g.h / 2));
          expect(m.spawn[0].length, `${f} ${p.id}`).toBeGreaterThanOrEqual(15);
          expect(m.spawn[1].length, `${f} ${p.id}`).toBeGreaterThanOrEqual(15);
          for (const a of D.terrain.affinities) expect(reachable(m, a, g.idx(1, Math.floor(g.h / 2))).has(seat), `${f} ${p.id} fort${fort} ${a}`).toBe(true);
        }
      }
    }
  }, 60000);

  it('follows the province: buildings, people, wealth, unrest and the castle show on the map', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    const p = gs.provinces.find((x) => !x.out && x.coastal)!;
    const base = provinceLook(c, p.id);
    const count = (m: BattleMap, k: string) => m.terrain.filter((t) => t === k).length;
    const m0 = mapFromProvince(save.world, p.id, { ...base, buildings: [], fort: 0.4, pop: 0, income: 0, unrest: 0 });
    // 寺は砦、市は町場、兵糧蔵は陣
    const m1 = mapFromProvince(save.world, p.id, { ...base, buildings: ['temple', 'market', 'granary'], fort: 0.4, pop: 0, income: 0, unrest: 0 });
    expect(count(m1, 'fort')).toBe(count(m0, 'fort') + 1);
    expect(count(m1, 'town')).toBeGreaterThan(count(m0, 'town'));
    expect(count(m1, 'camp')).toBeGreaterThan(count(m0, 'camp'));
    expect(m1.features).toEqual(expect.arrayContaining(['寺', '市', '兵糧蔵']));
    // 人が多いほど城下の街が広い。豊かなら棚田
    const big = mapFromProvince(save.world, p.id, { ...base, buildings: [], fort: 0.4, pop: 50000, income: 40, unrest: 0 });
    expect(count(big, 'town')).toBeGreaterThanOrEqual(count(m0, 'town') + BM.town.cityTiles);
    expect(count(big, 'paddy')).toBeGreaterThan(0);
    // 城の強さで拠点が変わる
    const seatOf = (m: BattleMap) => m.terrain[m.grid.idx(m.grid.w - 2, Math.floor(m.grid.h / 2))];
    expect(seatOf(mapFromProvince(save.world, p.id, { ...base, fort: 0.1 }))).toBe('camp');
    expect(seatOf(mapFromProvince(save.world, p.id, { ...base, fort: 0.4 }))).toBe('fort');
    expect(seatOf(mapFromProvince(save.world, p.id, { ...base, fort: 0.7 }))).toBe('castle');
    expect(mapFromProvince(save.world, p.id, { ...base, fort: 0.7, buildings: ['walls'] }).siege).toBe(true);
    // 建物が増えても、建物の無い所の形は変わらない（寺だけ足すと、変わるのは1マス）
    const m2 = mapFromProvince(save.world, p.id, { ...base, buildings: ['temple'], fort: 0.4, pop: 0, income: 0, unrest: 0 });
    expect(m2.terrain.filter((k, i) => k !== m0.terrain[i]).length).toBe(1);
  });

  it('building in a province changes the battle map there, once a month, for supply', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const player = Object.values(gs.factions).sort((a, b) => b.supply - a.supply)[0].id;
    const c = newCampaign(gs, save.world, player);
    const f = gs.factions[player];
    const p = provincesOf(c, player).find((x) => !x.buildings.includes('temple'))!;
    f.supply = 5000;
    const before = mapToText(provinceMap(c, p.id));
    const cost = buildCost(c, p.id, 'temple');
    expect(build(c, player, p.id, 'temple')).toBe(true);
    expect(f.supply).toBe(5000 - cost);
    expect(p.buildings).toContain('temple');
    expect(mapToText(provinceMap(c, p.id))).not.toBe(before);
    // 同じ月にもう一度はできない。翌月はできる
    expect(buildProblem(c, player, p.id, 'fort')).toMatch(/今月/);
    finishMonth(c);
    const fort = p.fort;
    expect(build(c, player, p.id, 'fort')).toBe(true);
    expect(p.fort).toBeCloseTo(Math.min(1, fort + BM.build.fortStep), 5);
    // 建っているもの・兵糧が足りない・海沿いでない港は断る
    finishMonth(c);
    expect(buildProblem(c, player, p.id, 'temple')).toMatch(/もう建って/);
    const inland = provincesOf(c, player).find((x) => !x.coastal);
    if (inland) expect(buildProblem(c, player, inland.id, 'harbor')).toMatch(/海沿い/);
    f.supply = 0;
    expect(buildProblem(c, player, p.id, 'market')).toMatch(/兵糧/);
    // セーブして読み込んでも、建てたものと戦場はそのまま
    const c2 = restore(fromJSON(toJSON(snapshot(c))));
    expect(mapToText(provinceMap(c2, p.id))).toBe(mapToText(provinceMap(c, p.id)));
    expect(c2.built[p.id]).toBe(c.built[p.id]);
  });
});
