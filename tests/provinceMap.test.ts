// 領ごとの戦場：地形と領のようす（人口・収入・不穏・城・建物）から作り、ようすが変われば戦場も変わる。
import { describe, expect, it } from 'vitest';
import { BM, mapFromProvince, mapToText, type BattleMap } from '../src/battle/map';
import { convert } from '../src/convert/convert';
import type { Affinity } from '../src/data/types';
import { D } from '../src/data/db';
import { fromJSON, restore, snapshot, toJSON } from '../src/persist/save';
import { build, buildCost, buildProblem, exclaveLink, exclavesOf, finishMonth, garrisonOf, newCampaign, provinceLook, provinceMap, provincesOf, recruitCost } from '../src/strategy/campaign';
import { createBattle } from '../src/battle/setup';
import { applyBattleResult } from '../src/battle/result';
import { generalsOf, makeTroop } from '../src/convert/convert';
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

describe('the battle map faces the way the attack comes', () => {
  it('attackers start on the side they came from; the seat is on the other side; everyone can reach it', async () => {
    for (const f of ['sengoku_fid5_1575', 'invented_archipelago_y30']) {
      const save = await loadFixture(f), gs = convert(save);
      const c = newCampaign(gs, save.world, 0);
      let flips = 0, n = 0;
      for (const p of gs.provinces.filter((x) => !x.out && x.nb.length)) {
        for (const from of p.nb.slice(0, 3)) {
          const m = provinceMap(c, p.id, from), g = m.grid, mid = Math.floor(g.h / 2);
          const q = gs.provinces[from];
          expect(m.flip, `${f} ${p.id}<-${from}`).toBe(p.cx - q.cx < -1e-9);
          const meanCol = (z: number[]) => z.reduce((s, i) => s + g.col(i), 0) / z.length;
          // 攻め手の配置場所は、攻めてきた側（flip なら右）
          expect(meanCol(m.spawn[0]) > g.w / 2, `${f} ${p.id}<-${from}`).toBe(!!m.flip);
          expect(meanCol(m.spawn[1]) > g.w / 2).toBe(!m.flip);
          const seat = g.idx(m.flip ? 1 : g.w - 2, mid);
          expect(['castle', 'fort', 'camp']).toContain(m.terrain[seat]);
          for (const a of D.terrain.affinities) expect(reachable(m, a, g.idx(m.flip ? g.w - 2 : 1, mid)).has(seat), `${f} ${p.id}<-${from} ${a}`).toBe(true);
          // 北の向きは単位ベクトル
          expect(Math.hypot(...m.north!)).toBeCloseTo(1, 5);
          if (m.flip) flips++;
          n++;
        }
      }
      // 東から攻める戦いも、西から攻める戦いもある
      expect(flips, f).toBeGreaterThan(n * 0.15);
      expect(flips, f).toBeLessThan(n * 0.85);
    }
  }, 60000);

  it('places each side in its own zone when the map is flipped', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    const p = gs.provinces.find((x) => !x.out && x.nb.some((n) => x.cx - gs.provinces[n].cx < -5))!;
    const from = p.nb.find((n) => p.cx - gs.provinces[n].cx < -5)!;
    const m = provinceMap(c, p.id, from);
    expect(m.flip).toBe(true);
    const [fa, fb] = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
    const st = createBattle(gs, m, [generalsOf(gs, fa.id).slice(0, 3).map((g) => g.id), generalsOf(gs, fb.id).slice(0, 3).map((g) => g.id)], 'flip');
    const g = m.grid;
    for (const u of st.units) expect(u.side === 0 ? g.col(u.pos) >= g.w / 2 : g.col(u.pos) < g.w / 2, `${u.name} side ${u.side} col ${g.col(u.pos)}`).toBe(true);
  });
});

describe('exclaves', () => {
  it('a province cut off from the capital earns less, is held by a weaker garrison and costs more to recruit in', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    // 本拠とつながった領を1つ、まわりの領ごと別の勢力のものにして、飛び地を作る
    const f = Object.values(gs.factions).sort((a, b) => provincesOf(c, b.id).length - provincesOf(c, a.id).length)[0];
    const capNb = new Set([...gs.provinces[f.capital].nb, ...gs.provinces[f.capital].sea]);
    const target = provincesOf(c, f.id).find((p) => p.id !== f.capital && !capNb.has(p.id) && !exclavesOf(c, f.id).has(p.id))!;
    const before = { garrison: garrisonOf(c, target.id), income: f.income };
    const other = Object.values(gs.factions).find((x) => x.id !== f.id)!;
    for (const n of [...target.nb, ...target.sea]) if (gs.provinces[n].owner === f.id) gs.provinces[n].owner = other.id;
    expect(exclavesOf(c, f.id).has(target.id)).toBe(true);
    // 直し方：示された領を取れば、つながって飛び地でなくなる
    const link = exclaveLink(c, target.id);
    expect(link.length).toBeGreaterThan(0);
    expect(link.every((id) => gs.provinces[id].owner !== f.id)).toBe(true);
    const saved = link.map((id) => gs.provinces[id].owner);
    for (const id of link) gs.provinces[id].owner = f.id;
    expect(exclavesOf(c, f.id).has(target.id)).toBe(false);
    link.forEach((id, k) => { gs.provinces[id].owner = saved[k]; });
    const after = garrisonOf(c, target.id);
    expect(after.level).toBeLessThan(before.garrison.level);
    expect(after.troops).toBeLessThanOrEqual(before.garrison.troops);
    expect(recruitCost('u01a', f, true)).toBeGreaterThan(recruitCost('u01a', f));
    // 収入：飛び地のぶんは ×0.4 で数える
    finishMonth(c);
    const lost = [...target.nb, ...target.sea].reduce((s, n) => s + (gs.provinces[n].owner === other.id ? gs.provinces[n].income : 0), 0);
    expect(f.income).toBeLessThan(before.income - lost + 0.5 - target.income * 0.5);
    // 始めの世界にも飛び地はあり、本拠は飛び地にならない
    for (const x of Object.values(gs.factions)) expect(exclavesOf(c, x.id).has(x.capital)).toBe(false);
  });
});

describe('battle result', () => {
  it('tells apart two troops of the same name, so a lost one is not mistaken for one that rose', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const [fa, fb] = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
    const a = generalsOf(gs, fa.id)[0], b = generalsOf(gs, fb.id)[0];
    const unit = D.byUnit[a.troops[0]?.unitId ?? 'u01a'];
    a.troops = [makeTroop(unit, 3), makeTroop(unit, 3)];
    const st = createBattle(gs, mapFromProvince(save.world, fb.capital), [[a.id], [b.id]], 'twins');
    const twins = st.units.filter((u) => u.generalId === a.id && u.kind !== 'general');
    twins[0].alive = false; twins[0].hp = 0;
    twins[1].expGained = 5000;
    st.winner = 1;
    const sum = applyBattleResult(gs, st);
    const lost = sum.lost.find((l) => l.general === a.name.ja)!;
    const up = sum.levelUps.find((l) => l.name.startsWith(`${a.name.ja}の`))!;
    expect(lost.unit).toContain('1隊目');
    expect(up.name).toContain('2隊目');
  });
});