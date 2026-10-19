// 一気に取る（P48）：A家のB領を落とすと、Bに陸で直に隣り合うA家の領のうち、守る武将のいない領も手に入る。本拠と、武将のいる領は取らない
import { describe, expect, it } from 'vitest';
import type { BattleState } from '../src/battle/types';
import { convert, generalsOf } from '../src/convert/convert';
import { battleFor, chainTargets, generalsAt, newCampaign, planAttack, resolveBattle, type Campaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

const finish = (st: BattleState, winner: 0 | 1): BattleState => { st.winner = winner; return st; };

async function campaign(): Promise<Campaign> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  return newCampaign(gs, save.world, f.id);
}

/** 自分の領 from に隣り合う敵の領 to で、to の陸の隣に、本拠でない同じ家の領が2つ以上あるもの */
function setup(c: Campaign): { from: number; to: number; owner: number; others: number[] } | null {
  const gs = c.gs, me = c.player;
  for (const p of gs.provinces.filter((x) => x.owner === me && generalsAt(c, x.id, me).length)) {
    for (const to of p.nb) {
      const t = gs.provinces[to], o = t.owner;
      if (!o || o === me || t.out || gs.factions[o].capital === to) continue;
      const others = t.nb.filter((n) => gs.provinces[n].owner === o && gs.factions[o].capital !== n && !gs.provinces[n].out);
      if (others.length < 2) continue;
      gs.wars.push({ attackers: [me], defenders: [o] });
      return { from: p.id, to, owner: o, others };
    }
  }
  return null;
}

describe('chain capture after taking a province', () => {
  it('takes neighbouring provinces held only by garrison; not the capital, not ones with generals', async () => {
    const c = await campaign(), gs = c.gs, s = setup(c);
    expect(s).toBeTruthy();
    const { from, to, owner, others } = s!;
    const cap = gs.factions[owner].capital;
    // B の隣の A 家の領から武将をどかし（本拠へ）、1つにだけ武将を置く
    for (const g of Object.values(gs.generals)) if (g.faction === owner && others.includes(g.prov)) g.prov = cap;
    const manned = others[0], bare = others.slice(1);
    const sentry = Object.values(gs.generals).find((g) => g.faction === owner && g.prov === cap && !g.isLord)!;
    sentry.prov = manned;
    expect(chainTargets(c, to, owner).sort()).toEqual(bare.sort());
    // 本拠が B の隣にあっても取らない
    const capNear = gs.provinces[to].nb.includes(cap);
    const pb = planAttack(c, c.player, from, to, generalsAt(c, from, c.player).slice(0, 1).map((g) => g.id))!;
    resolveBattle(c, pb, finish(battleFor(c, pb), 0));
    expect(gs.provinces[to].owner).toBe(c.player);
    for (const n of bare) expect(gs.provinces[n].owner).toBe(c.player);
    expect(gs.provinces[manned].owner).toBe(owner);
    if (capNear) expect(gs.provinces[cap].owner).toBe(owner);
    expect(gs.factions[owner]).toBeTruthy();
    const log = c.log.find((l) => l.key === 'chainCapture');
    expect(log).toBeTruthy();
    expect(String(log!.vars.ids).split(',').map(Number).sort()).toEqual(bare.sort());
  });

  it('takes nothing more when the attack fails', async () => {
    const c = await campaign(), gs = c.gs, s = setup(c)!;
    for (const g of Object.values(gs.generals)) if (g.faction === s.owner && s.others.includes(g.prov)) g.prov = gs.factions[s.owner].capital;
    const pb = planAttack(c, c.player, s.from, s.to, generalsAt(c, s.from, c.player).slice(0, 1).map((g) => g.id))!;
    resolveBattle(c, pb, finish(battleFor(c, pb), 1));
    for (const n of [s.to, ...s.others]) expect(gs.provinces[n].owner).toBe(s.owner);
  });
});
