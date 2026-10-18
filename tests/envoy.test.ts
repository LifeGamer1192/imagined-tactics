// 使者と土産（P34）：使者は行動済みになり、外交の能力と土産で心証が上がる。見込みは上乗せしたあとの心証で決まる
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { declareWar, newCampaign, relation, type Campaign } from '../src/strategy/campaign';
import { S } from '../src/strategy/config';
import { envoyBonus, envoyPlan, giftBonus, sendEnvoy } from '../src/strategy/envoy';
import { loadFixture } from './helpers';

async function setup(): Promise<{ c: Campaign; other: number; envoy: string }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  const c = newCampaign(gs, save.world, f.id);
  const other = Object.values(gs.factions).find((x) => x.id !== f.id && relation(c, f.id, x.id) === 'neutral' && !x.overlord)!.id;
  const g = generalsOf(gs, f.id).find((x) => !x.isLord)!;
  g.ab = [5, 5, 9, 5];
  gs.factions[f.id].supply = 5000;
  return { c, other, envoy: g.id };
}

describe('envoys and gifts', () => {
  it('the envoy’s diplomacy and the gift raise the opinion; acceptance is judged on the raised opinion', async () => {
    const { c, other, envoy } = await setup();
    c.gs.factions[other].opinions[c.player] = 0;
    const g = c.gs.generals[envoy];
    expect(envoyBonus(g)).toBe(4 * S.envoy.perDiplomacy);
    const low = envoyPlan(c, 'ally', other, envoy, 0);
    expect(low.blocked).toBeNull();
    expect(low.refused).toMatch(/心証/);
    // 土産で心証が同盟の基準を超えれば、受けてもらえる見込みになる
    const gift = S.envoy.gifts[S.envoy.gifts.length - 1];
    const rich = envoyPlan(c, 'ally', other, envoy, gift);
    expect(rich.opinionAfter).toBe(Math.min(100, envoyBonus(g) + giftBonus(gift)));
    if (rich.opinionAfter >= S.diplomacy.allianceOpinion) expect(rich.refused).toBeNull();
    // 見込みを出しても、心証は変わらない
    expect(c.gs.factions[other].opinions[c.player]).toBe(0);
  });

  it('sending an envoy uses the general for the month and the gift, and leaves the raised opinion even if refused', async () => {
    const { c, other, envoy } = await setup();
    c.gs.factions[other].opinions[c.player] = -60;
    const supply = c.gs.factions[c.player].supply;
    const r = sendEnvoy(c, 'ally', other, envoy, 100);
    expect(r).toEqual({ sent: true, accepted: false });
    expect(c.moved.has(envoy)).toBe(true);
    expect(c.gs.factions[c.player].supply).toBe(supply - 100);
    expect(c.gs.factions[other].opinions[c.player]).toBe(-60 + envoyBonus(c.gs.generals[envoy]) + giftBonus(100));
    // 同じ使者は、今月はもう出せない
    expect(envoyPlan(c, 'goodwill', other, envoy, 0).blocked).toBe('今月は行動済みです');
  });

  it('a truce the enemy would refuse for being stronger can be bought with envoys and gifts', async () => {
    const { c, other, envoy } = await setup();
    declareWar(c, c.player, other);
    // 相手を少しだけ優勢にする
    for (const g of generalsOf(c.gs, other)) g.level += 6;
    const plain = envoyPlan(c, 'truce', other, envoy, 0);
    const bought = envoyPlan(c, 'truce', other, envoy, S.envoy.gifts[S.envoy.gifts.length - 1]);
    if (plain.refused) expect(bought.refused === null || bought.bonus > plain.bonus).toBe(true);
    if (!bought.refused) {
      expect(sendEnvoy(c, 'truce', other, envoy, S.envoy.gifts[S.envoy.gifts.length - 1]).accepted).toBe(true);
      expect(relation(c, c.player, other)).toBe('truce');
    }
  });
});
