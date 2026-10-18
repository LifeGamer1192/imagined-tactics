// 雇える兵種を領ごとに（P37）：武将のいる領の一覧から雇う。初めから雇えた兵種でなければ兵糧2倍。敵の兵を捕まえる（条件は厳しい）
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { D } from '../src/data/db';
import { battleFor, generalsAt, handOver, isNativeUnit, neighborsOf, newCampaign, planAttack, provinceRecruit, recruitCost, recruitProblem, resolveBattle, reserveOf, type Campaign } from '../src/strategy/campaign';
import { S } from '../src/strategy/config';
import { loadFixture } from './helpers';

async function setup(): Promise<Campaign> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  const c = newCampaign(gs, save.world, f.id);
  gs.factions[f.id].supply = 99999;
  return c;
}

describe('recruitable units per province', () => {
  it('every province has its own list; the house list is unchanged', async () => {
    const c = await setup(), gs = c.gs, me = gs.factions[c.player];
    const mine = gs.provinces.filter((p) => p.owner === me.id);
    expect(mine.every((p) => p.recruit && Object.keys(p.recruit).length > 0)).toBe(true);
    // 自分の領の兵種は、初めの勢力の一覧に入っている（土地の兵の違いはありうる）
    for (const p of mine) for (const u of Object.keys(p.recruit!)) expect(D.byUnit[u]).toBeTruthy();
  });

  it('taking a province with a new unit type lets you recruit it there, at double cost', async () => {
    const c = await setup(), gs = c.gs, me = gs.factions[c.player];
    let found: { prov: number; unit: string } | null = null;
    for (const p of gs.provinces) {
      if (!p.owner || p.owner === me.id || p.out) continue;
      const u = Object.keys(provinceRecruit(c, p.id)).find((x) => !isNativeUnit(me, x));
      if (u) { found = { prov: p.id, unit: u }; break; }
    }
    expect(found).toBeTruthy();
    const g = generalsOf(gs, me.id).find((x) => !x.isLord && x.troops.length < 4)!;
    g.troops = g.troops.slice(0, 1);
    // 奪う前：自分の領にいる武将は、その兵種を雇えない（その領の一覧に無ければ）
    if (!(found!.unit in provinceRecruit(c, g.prov))) expect(recruitProblem(c, g, found!.unit)).toBe('この領では雇えない兵種です');
    handOver(c, [found!.prov], me.id);
    g.prov = found!.prov;
    expect(recruitProblem(c, g, found!.unit)).toBeNull();
    expect(recruitCost(found!.unit, me)).toBeGreaterThan(recruitCost(found!.unit) * 1.5);
  });
});

describe('catching enemy troops', () => {
  const fight = async (winner: 0 | 1) => {
    const c = await setup(), gs = c.gs, me = c.player;
    let pb = null;
    for (const p of gs.provinces) {
      if (!p.owner || p.owner === me || p.out || !generalsAt(c, p.id, p.owner).some((g) => g.troops.length)) continue;
      const from = neighborsOf(c, p.id).find((n) => gs.provinces[n].owner === me && generalsAt(c, n, me).length);
      if (from === undefined) continue;
      gs.wars.push({ attackers: [me], defenders: [p.owner] });
      pb = planAttack(c, me, from, p.id, generalsAt(c, from, me).map((g) => g.id));
      if (pb) break;
    }
    expect(pb).toBeTruthy();
    const st = battleFor(c, pb!);
    // 敵の兵を1隊、寝返らせてこちらに付けたまま終える
    const t = st.units.find((u) => u.kind === 'troop' && u.home === 1)!;
    t.statuses.push({ id: 'defect', turns: 3, origSide: 1 }); t.side = 0;
    st.winner = winner;
    const mineBefore = pb!.atk.reduce((s, id) => s + gs.generals[id].troops.length, 0) + reserveOf(c, pb!.from).length + reserveOf(c, pb!.prov).length;
    const keep = S.capture.chance;
    S.capture.chance = 1;
    try { resolveBattle(c, pb!, st); } finally { S.capture.chance = keep; }
    const mineAfter = pb!.atk.reduce((s, id) => s + (gs.generals[id]?.troops.length ?? 0), 0) + reserveOf(c, pb!.from).length + reserveOf(c, pb!.prov).length;
    return { c, gained: mineAfter - mineBefore };
  };

  it('a troop that came over by defection and stayed until a won battle can join you', async () => {
    const { c, gained } = await fight(0);
    expect(gained).toBeGreaterThanOrEqual(1);
    expect(c.log.some((l) => l.key === 'caught')).toBe(true);
  });

  it('nothing is caught when your side loses', async () => {
    const { c } = await fight(1);
    expect(c.log.some((l) => l.key === 'caught')).toBe(false);
  });
});
