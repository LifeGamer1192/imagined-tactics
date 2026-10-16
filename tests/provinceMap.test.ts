// 領ごとの戦場：地形と領のようす（人口・収入・不穏・城・建物）から作り、ようすが変われば戦場も変わる。
import { describe, expect, it } from 'vitest';
import { BM, BOARD_R, edgeFor, mapFromProvince, mapToText, type BattleMap } from '../src/battle/map';
import { convert } from '../src/convert/convert';
import type { Affinity } from '../src/data/types';
import { D } from '../src/data/db';
import { fromJSON, restore, snapshot, toJSON } from '../src/persist/save';
import { attackPower, defense } from '../src/rules/stats';
import { battleFor, battleSupply, build, buildCost, buildProblem, exclaveLink, exclavesOf, finishMonth, garrisonOf, newCampaign, provinceLook, provinceMap, provincesOf, recruitCost } from '../src/strategy/campaign';
import { createBattle } from '../src/battle/setup';
import { applyBattleResult } from '../src/battle/result';
import { generalsOf, makeTroop } from '../src/convert/convert';
import { attackStart, FIXTURES, loadFixture } from './helpers';

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
          const seat = m.seat!;
          expect(m.spawn[0].length, `${f} ${p.id}`).toBeGreaterThanOrEqual(15);
          expect(m.spawn[1].length, `${f} ${p.id}`).toBeGreaterThanOrEqual(15);
          for (const a of D.terrain.affinities) expect(reachable(m, a, attackStart(m)).has(seat), `${f} ${p.id} fort${fort} ${a}`).toBe(true);
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
    const seatOf = (m: BattleMap) => m.terrain[m.seat!];
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

describe('the battle map faces the way the attack comes (six sides of a hexagonal board)', () => {
  it('attackers come in on the side they came from; the seat and walls are on the far side; everyone can reach it', async () => {
    for (const f of ['sengoku_fid5_1575', 'invented_archipelago_y30']) {
      const save = await loadFixture(f), gs = convert(save);
      const c = newCampaign(gs, save.world, 0);
      const edges = new Set<number>();
      for (const p of gs.provinces.filter((x) => !x.out && x.nb.length)) {
        for (const from of p.nb.slice(0, 3)) {
          const m = provinceMap(c, p.id, from);
          const q = gs.provinces[from], label = `${f} ${p.id}<-${from}`;
          // 攻め手が入る辺は、攻めてきた領の方角（6つに分けたうちの1つ）
          expect(m.edge, label).toBe(edgeFor(q.cx - p.cx, q.cy - p.cy));
          edges.add(m.edge!);
          // 盤は六角形：169マス。外は 'void'
          expect(m.terrain.filter((k) => k !== 'void').length).toBe(3 * BOARD_R * (BOARD_R + 1) + 1);
          // 攻め手の配置場所は浅い側、守り手と拠点は深い側
          const dep = m.depth!;
          expect(Math.max(...m.spawn[0].map((i) => dep[i]))).toBeLessThan(0);
          expect(Math.min(...m.spawn[1].map((i) => dep[i]))).toBeGreaterThan(0);
          expect(dep[m.seat!]).toBe(BOARD_R - 1);
          expect(['castle', 'fort', 'camp']).toContain(m.terrain[m.seat!]);
          // 拠点は、攻め手の入った辺の反対の方角にある（画面の上で、攻めてきた向きと逆）
          const [sx, sy] = m.grid.center(m.seat!, 1), az = m.spawn[0].map((i) => m.grid.center(i, 1));
          const ax = az.reduce((s, v) => s + v[0], 0) / az.length, ay = az.reduce((s, v) => s + v[1], 0) / az.length;
          expect((sx - ax) * (p.cx - q.cx) + (sy - ay) * (p.cy - q.cy), label).toBeGreaterThan(0);
          for (const a of D.terrain.affinities) expect(reachable(m, a, attackStart(m)).has(m.seat!), `${label} ${a}`).toBe(true);
          // 川・海は上限まで
          const water = m.terrain.filter((k) => k === 'water').length;
          expect(water, label).toBeLessThanOrEqual(Math.ceil((BM.water.seaMax + BM.water.riverMax) * 169) + 40);
        }
      }
      // 6つの向きがどれも使われる
      expect(edges.size, f).toBeGreaterThanOrEqual(5);
    }
  }, 120000);

  it('the walls cut the board in two, with three gates, whichever side the attack comes from', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    const p = gs.provinces[Object.values(gs.factions)[0].capital];
    for (const from of p.nb) {
      const m = mapFromProvince(save.world, p.id, { ...provinceLook(c, p.id), walls: true, capital: true, from });
      const wallD = m.depth![m.terrain.indexOf('wall')];
      // 城壁の深さのマスは、すべて城壁か門
      expect(m.terrain.filter((k, i) => m.depth![i] === wallD).every((k) => k === 'wall' || k === 'gate')).toBe(true);
      expect(m.terrain.filter((k) => k === 'gate').length).toBe(3);
      // 騎馬は門を通らなければ入れない：門をふさぐと、城に届かない
      const shut = { ...m, terrain: m.terrain.map((k) => (k === 'gate' ? 'wall' : k)) } as BattleMap;
      expect(reachable(shut, 'rider', attackStart(m)).has(m.seat!)).toBe(false);
    }
  });

  it('places each side in its own zone', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    const [fa, fb] = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
    const p = gs.provinces[fb.capital];
    for (const from of p.nb) {
      const m = provinceMap(c, p.id, from);
      const st = createBattle(gs, m, [generalsOf(gs, fa.id).slice(0, 3).map((g) => g.id), generalsOf(gs, fb.id).slice(0, 3).map((g) => g.id)], `edge${from}`);
      for (const u of st.units.filter((x) => x.kind === 'general')) expect(m.spawn[u.side].includes(u.pos), `${m.edgeName} ${u.name}`).toBe(true);
      for (const u of st.units) expect(u.side === 0 ? m.depth![u.pos] < 0 : m.depth![u.pos] > 0, `${m.edgeName} ${u.name}`).toBe(true);
    }
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
    // 戦い：飛び地を守る側は攻撃・防御が下がる。攻め手（本拠とつながった領から出る）は下がらない
    const atkFrom = [...target.nb, ...target.sea].find((n) => gs.provinces[n].owner === other.id)!;
    const pb = { attacker: other.id, defender: f.id, prov: target.id, from: atkFrom, atk: generalsOf(gs, other.id).slice(0, 1).map((g) => g.id), def: [] as string[] };
    const sup = battleSupply(c, pb);
    expect(sup[1]).toBeCloseTo(0.9, 5);
    expect(sup[0]).toBe(exclavesOf(c, other.id).has(atkFrom) ? sup[1] : 1);
    if (pb.atk.length) {
      const st = battleFor(c, pb);
      expect(st.supplyMult?.[1]).toBeCloseTo(0.9, 5);
      const u = st.units.find((x) => x.home === 1)!;
      const plain = attackPower({ ...st, supplyMult: undefined }, u), cut = attackPower(st, u);
      expect(cut).toBeCloseTo(Math.max(1, plain * 0.9), 5);
      expect(defense(st, u)).toBeLessThan(defense({ ...st, supplyMult: undefined }, u) + 1e-9);
    }
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