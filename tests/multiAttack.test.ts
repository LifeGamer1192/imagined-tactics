// 複数の領から1つの領を攻める（P35）：隣り合う自分の領ならどこからでも出られる。向きはどれか1つ。負けたらそれぞれの領に残り、勝ったらみな攻め取った領へ
import { describe, expect, it } from 'vitest';
import type { BattleState } from '../src/battle/types';
import { convert, generalsOf } from '../src/convert/convert';
import { battleFor, generalsAt, neighborsOf, newCampaign, planAttack, resolveBattle, type Campaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

/** 自分の領2つに隣り合う、攻められる敵の領と、その2つの領から1人ずつ */
function setup(c: Campaign): { to: number; a: number; b: number; ga: string; gb: string } | null {
  const gs = c.gs, me = c.player;
  for (const p of gs.provinces) {
    if (!p.owner || p.owner === me || p.out) continue;
    const mine = neighborsOf(c, p.id).filter((n) => gs.provinces[n].owner === me && generalsAt(c, n, me).length);
    if (mine.length < 2) continue;
    const [a, b] = mine;
    gs.wars.push({ attackers: [me], defenders: [p.owner] });
    return { to: p.id, a, b, ga: generalsAt(c, a, me)[0].id, gb: generalsAt(c, b, me)[0].id };
  }
  return null;
}

async function campaign(): Promise<Campaign> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  // 武将をばらけさせ、自分の領に1人ずつ置く（2つの領から攻められる形を作りやすくする）
  const c = newCampaign(gs, save.world, f.id);
  const provs = gs.provinces.filter((p) => p.owner === f.id).map((p) => p.id);
  generalsOf(gs, f.id).forEach((g, i) => { g.prov = provs[i % provs.length]; });
  return c;
}

const finish = (st: BattleState, winner: 0 | 1): BattleState => { st.winner = winner; return st; };

describe('attacking one province from several', () => {
  it('generals from two neighbouring provinces attack together; on a loss each stays home', async () => {
    const c = await campaign(), s = setup(c);
    expect(s).toBeTruthy();
    const pb = planAttack(c, c.player, s!.a, s!.to, [s!.ga, s!.gb])!;
    expect(pb.atk.sort()).toEqual([s!.ga, s!.gb].sort());
    expect(pb.from).toBe(s!.a);
    resolveBattle(c, pb, finish(battleFor(c, pb), 1));
    expect(c.gs.generals[s!.ga].prov).toBe(s!.a);
    expect(c.gs.generals[s!.gb].prov).toBe(s!.b);
  });

  it('on a win every general moves into the taken province', async () => {
    const c = await campaign(), s = setup(c)!;
    const pb = planAttack(c, c.player, s.b, s.to, [s.ga, s.gb])!;
    expect(pb.from).toBe(s.b);
    resolveBattle(c, pb, finish(battleFor(c, pb), 0));
    expect(c.gs.provinces[s.to].owner).toBe(c.player);
    expect(c.gs.generals[s.ga].prov).toBe(s.to);
    expect(c.gs.generals[s.gb].prov).toBe(s.to);
  });

  it('generals not next to the target cannot join, and the direction must be next to the target', async () => {
    const c = await campaign(), s = setup(c)!;
    const far = c.gs.provinces.find((p) => p.owner === c.player && !neighborsOf(c, s.to).includes(p.id) && generalsAt(c, p.id, c.player).length);
    if (far) {
      const gf = generalsAt(c, far.id, c.player)[0].id;
      const pb = planAttack(c, c.player, s.a, s.to, [s.ga, gf])!;
      expect(pb.atk).toEqual([s.ga]);
      expect(planAttack(c, c.player, far.id, s.to, [s.ga])).toBeNull();
    }
  });
});
