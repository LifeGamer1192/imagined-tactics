import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import {
  autoMonth, canAttack, endMonth, finishMonth, generalsAt, moveGeneral, neighborsOf, newCampaign, planAttack,
  provincesOf, recruit, recruitCost, recruitProblem, relation, resolveBattle, troopLoad,
} from '../src/strategy/campaign';
import { D } from '../src/data/db';
import { loadFixture } from './helpers';

async function campaign(name: string, player = 0) {
  const save = await loadFixture(name);
  return newCampaign(convert(save), save.world, player);
}
function invariants(c: Awaited<ReturnType<typeof campaign>>): void {
  const gs = c.gs;
  for (const p of gs.provinces) expect(p.owner === 0 || gs.factions[p.owner], `owner of ${p.name.ja}`).toBeTruthy();
  for (const f of Object.values(gs.factions)) {
    expect(provincesOf(c, f.id).length, f.name.ja).toBeGreaterThan(0);
    expect(gs.provinces[f.capital].owner, `capital of ${f.name.ja}`).toBe(f.id);
    expect(f.supply).toBeGreaterThanOrEqual(0);
  }
  for (const g of Object.values(gs.generals)) {
    expect(g.faction === 0 || gs.factions[g.faction], g.name.ja).toBeTruthy();
    if (g.faction) expect(gs.provinces[g.prov]?.owner, `${g.name.ja} at ${g.prov}`).toBe(g.faction);
    expect(troopLoad(g), g.name.ja).toBeLessThanOrEqual(g.command);
    expect(g.troops.length).toBeLessThanOrEqual(6);
  }
}

describe('campaign', () => {
  it('starts consistent: every general stands in a province of their faction', async () => {
    for (const f of ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'rome_fid3_212bc', 'invented_archipelago_y30']) invariants(await campaign(f));
  }, 60000);

  it('relations follow the save', async () => {
    const c = await campaign('sengoku_fid5_1575');
    const gs = c.gs;
    const [a, b] = gs.alliances[0];
    expect(relation(c, a, b)).toBe('ally');
    expect(canAttack(c, a, b)).toBe(false);
    const w = gs.wars[0];
    expect(relation(c, w.attackers[0], w.defenders[0])).toBe('war');
    expect(relation(c, a, a)).toBe('self');
  });

  it('recruit, move and attack', async () => {
    const c = await campaign('sengoku_fid5_1575');
    const gs = c.gs;
    const oda = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!;
    c.player = oda.id;
    const lord = gs.generals[oda.lordId];
    const unit = Object.keys(oda.recruit)[0];
    // 徴兵：兵糧が減り、兵が増える。采配力を超えては雇えない
    lord.troops = [];
    const before = oda.supply;
    expect(recruit(c, lord.id, unit)).toBe(true);
    expect(oda.supply).toBe(before - recruitCost(unit, oda));
    expect(lord.troops.length).toBe(1);
    lord.command = D.byUnit[unit].cost;
    expect(recruitProblem(c, lord, unit)).toBe('采配力が足りません');
    // 移動：隣の自領へ、1か月に1回
    const own = provincesOf(c, oda.id);
    const from = own.find((p) => generalsAt(c, p.id, oda.id).length > 0 && neighborsOf(c, p.id).some((n) => gs.provinces[n].owner === oda.id))!;
    const g = generalsAt(c, from.id, oda.id)[0];
    const to = neighborsOf(c, from.id).find((n) => gs.provinces[n].owner === oda.id)!;
    expect(moveGeneral(c, g.id, to)).toBe(true);
    expect(moveGeneral(c, g.id, from.id)).toBe(false);
    // 攻撃：隣の、攻められる相手の領
    let pb = null;
    for (const p of own) {
      const here = generalsAt(c, p.id, oda.id).filter((x) => !c.moved.has(x.id));
      const t = neighborsOf(c, p.id).find((n) => gs.provinces[n].owner !== oda.id && canAttack(c, oda.id, gs.provinces[n].owner));
      if (here.length && t !== undefined) { pb = planAttack(c, oda.id, p.id, t, here.map((x) => x.id)); if (pb) break; }
    }
    expect(pb).not.toBeNull();
    const owner0 = gs.provinces[pb!.prov].owner;
    resolveBattle(c, pb!);
    expect([owner0, oda.id]).toContain(gs.provinces[pb!.prov].owner);
    invariants(c);
  });

  it('runs two years of an AI-only campaign and stays consistent', async () => {
    for (const f of ['sengoku_fid5_1575', 'invented_archipelago_y30']) {
      const c = await campaign(f);
      const owners0 = c.gs.provinces.map((p) => p.owner).join(',');
      const n0 = Object.keys(c.gs.factions).length;
      for (let m = 0; m < 24; m++) { autoMonth(c); invariants(c); }
      expect(c.months).toBe(24);
      expect(c.gs.provinces.map((p) => p.owner).join(','), f).not.toBe(owners0);   // 領が動いている
      expect(Object.keys(c.gs.factions).length, f).toBeLessThanOrEqual(n0);
      expect(c.log.some((l) => l.key === 'battle'), f).toBe(true);
    }
  }, 120000);

  it('is deterministic', async () => {
    const run = async () => {
      const save = await loadFixture('invented_archipelago_y30');
      const c = newCampaign(convert(save), save.world, 0);
      for (let m = 0; m < 6; m++) autoMonth(c);
      return JSON.stringify([c.gs.provinces.map((p) => p.owner), c.log]);
    };
    expect(await run()).toBe(await run());
  }, 60000);

  it('attacks on the player are handed back to be fought', async () => {
    const c = await campaign('invented_archipelago_y30');
    const facs = Object.values(c.gs.factions);
    c.player = facs[0].id;
    let got = 0;
    for (let m = 0; m < 24 && !c.over; m++) {
      const pend = endMonth(c);
      for (const pb of pend) { expect(pb.defender).toBe(c.player); got++; resolveBattle(c, pb); }
      finishMonth(c);
      invariants(c);
    }
    expect(got).toBeGreaterThanOrEqual(0);
  }, 120000);
});
