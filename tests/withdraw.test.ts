// 部隊ごとの退却：初期配置のマスにいる武将は、配下の兵と必ず退ける。兵は失わず深手にもならず、翌月いっぱい休養（守りには出られる）
import { describe, expect, it } from 'vitest';
import { apply, canWithdraw } from '../src/battle/engine';
import { convert, generalsOf } from '../src/convert/convert';
import { battleFor, finishMonth, generalsAt, isResting, moveGeneral, neighborsOf, newCampaign, planAttack, recruitProblem, resolveBattle, type Campaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

async function attack(): Promise<{ c: Campaign; pb: NonNullable<ReturnType<typeof planAttack>> }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  const c = newCampaign(gs, save.world, f.id);
  for (const p of gs.provinces) {
    if (!p.owner || p.owner === f.id || p.out || !generalsAt(c, p.id, p.owner).length) continue;
    const from = neighborsOf(c, p.id).find((n) => gs.provinces[n].owner === f.id && generalsAt(c, n, f.id).length >= 2);
    if (from === undefined) continue;
    gs.wars.push({ attackers: [f.id], defenders: [p.owner] });
    const pb = planAttack(c, f.id, from, p.id, generalsAt(c, from, f.id).slice(0, 2).map((g) => g.id));
    if (pb && pb.atk.length === 2) return { c, pb };
  }
  throw new Error('攻める組が無い');
}

describe('withdrawing a unit from the deployment zone', () => {
  it('a general on a deployment cell withdraws with their troops; troops are kept and the general is not wounded', async () => {
    const { c, pb } = await attack(), gs = c.gs;
    const st = battleFor(c, pb);
    const gen = st.units.find((u) => u.kind === 'general' && u.side === 0)!;
    const troops = gs.generals[gen.generalId].troops.length;
    expect(st.map.spawn[0].includes(gen.pos)).toBe(true);
    expect(canWithdraw(st, gen)).toBe(true);
    // 初期配置のマスの外では退けない
    const away = st.map.grid.neighbors(gen.pos).find((i) => !st.map.spawn[0].includes(i) && st.map.terrain[i] !== 'void');
    if (away !== undefined) { const keep = gen.pos; gen.pos = away; expect(canWithdraw(st, gen)).toBe(false); gen.pos = keep; }
    expect(apply(st, { type: 'withdraw', unit: gen.id })).toBe(true);
    expect(gen.alive).toBe(false);
    expect(st.units.filter((u) => u.leader === gen.id && u.id !== gen.id).every((u) => !u.alive && u.retreated)).toBe(true);
    expect(st.winner).toBeNull();
    st.winner = 0;
    resolveBattle(c, pb, st);
    expect(gs.generals[gen.generalId].troops.length).toBe(troops);
    expect(gen.generalId in c.wounded).toBe(false);
    expect(isResting(c, gen.generalId)).toBe(true);
  });

  it('resting lasts through next month: no moving or recruiting, but the general can still defend', async () => {
    const { c, pb } = await attack(), gs = c.gs;
    const st = battleFor(c, pb);
    const gen = st.units.find((u) => u.kind === 'general' && u.side === 0)!;
    apply(st, { type: 'withdraw', unit: gen.id });
    st.winner = 1;
    resolveBattle(c, pb, st);
    const g = gs.generals[gen.generalId];
    finishMonth(c);
    expect(isResting(c, g.id)).toBe(true);
    expect(c.moved.has(g.id)).toBe(true);
    const to = [...neighborsOf(c, g.prov)].find((n) => gs.provinces[n].owner === c.player);
    if (to !== undefined) expect(moveGeneral(c, g.id, to)).toBe(false);
    expect(recruitProblem(c, g, Object.keys(gs.factions[c.player].recruit)[0])).toBe('退却して休養中です');
    // 守り：自分の領を攻められたら、守り手に入る
    expect(generalsAt(c, g.prov, c.player).some((x) => x.id === g.id)).toBe(true);
    // その次の月には、また動ける
    finishMonth(c);
    expect(isResting(c, g.id)).toBe(false);
    expect(c.moved.has(g.id)).toBe(false);
  });

  it('when every general withdraws, that side loses; a side retreat keeps the heavy penalty only for units outside the zone', async () => {
    const { c, pb } = await attack();
    const st = battleFor(c, pb);
    for (const g of st.units.filter((u) => u.kind === 'general' && u.side === 0 && u.alive)) apply(st, { type: 'withdraw', unit: g.id });
    expect(st.winner).toBe(1);
    const supply = c.gs.factions[c.player].supply;
    st.retreat = 0;
    resolveBattle(c, pb, st);
    // 全員がマスの中から退いたので、兵糧は減らない
    expect(c.gs.factions[c.player].supply).toBeGreaterThanOrEqual(supply);
  });
});
