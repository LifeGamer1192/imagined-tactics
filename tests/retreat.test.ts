// 国モードの戦いから退く：退いた陣営の負けで、兵の一部・兵糧を失い、武将は深手を負う。守り手が退けば領を失う。
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { battleFor, neighborsOf, newCampaign, planAttack, resolveBattle, S, type Campaign, type PendingBattle } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

async function setup(): Promise<{ c: Campaign; pb: PendingBattle }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  const c = newCampaign(gs, save.world, f.id);
  // 武将のいる自分の領から、攻められる隣の領を探す
  for (const p of gs.provinces.filter((x) => x.owner === f.id)) {
    const here = generalsOf(gs, f.id).filter((g) => g.prov === p.id);
    if (!here.length) continue;
    for (const n of neighborsOf(c, p.id)) {
      const t = gs.provinces[n];
      if (!t.owner || t.owner === f.id) continue;
      // 戦争中でなくても、攻め込めば戦になる（planAttack は攻めてよい相手だけ通す）
      gs.wars.push({ attackers: [f.id], defenders: [t.owner] });
      const pb = planAttack(c, f.id, p.id, n, here.map((g) => g.id));
      if (pb && pb.def.length) return { c, pb };
    }
  }
  throw new Error('攻め込める組が見つからない');
}

describe('retreating from a battle', () => {
  it('the side that retreats loses: some troops, a tenth of its supply, and its generals are wounded', async () => {
    const { c, pb } = await setup();
    const gs = c.gs, f = gs.factions[pb.attacker];
    f.supply = 1000;
    const troopsBefore = pb.atk.reduce((s, id) => s + gs.generals[id].troops.length, 0);
    const st = battleFor(c, pb);
    // 攻め手の兵を半分ほど傷めておく（体力が半分を切った兵は必ず失う）
    const hurt = st.units.filter((u) => u.home === 0 && u.kind === 'troop').slice(0, 2);
    for (const u of hurt) u.hp = Math.floor(u.maxHp * 0.3);
    st.retreat = 0; st.winner = 1;
    const sum = resolveBattle(c, pb, st)!;
    expect(sum.winner).toBe(1);
    const troopsAfter = pb.atk.reduce((s, id) => s + (gs.generals[id]?.troops.length ?? 0), 0);
    expect(troopsAfter).toBeLessThanOrEqual(troopsBefore - hurt.length);
    expect(sum.lost.filter((l) => l.side === 0 && l.unit.includes('退くとき')).length).toBeGreaterThanOrEqual(hurt.length);
    expect(f.supply).toBe(1000 - Math.round(1000 * S.retreat.supplyLossPct / 100));
    for (const id of pb.atk) expect(c.wounded[id]).toBeGreaterThan(gs.tick);
    // 領は取れていない
    expect(gs.provinces[pb.prov].owner).toBe(pb.defender);
    expect(c.log.some((l) => l.key === 'retreated')).toBe(true);
  });

  it('a defender who retreats loses the province too', async () => {
    const { c, pb } = await setup();
    const st = battleFor(c, pb);
    st.retreat = 1; st.winner = 0;
    resolveBattle(c, pb, st);
    expect(c.gs.provinces[pb.prov].owner).toBe(pb.attacker);
  });
});
