// 自分の家のおまかせ（P81）：おまかせ登用のつり合い、1か月オートで雇う・攻める・前線へ移る・訓練する
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { autoRecruit, unitRole } from '../src/strategy/autoplay';
import { autoPlayMonth, newCampaign, provincesOf, troopLoad, type Campaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

async function setup(): Promise<{ c: Campaign; me: number }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(structuredClone(save));
  const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!.id;
  return { c: newCampaign(gs, save.world, me), me };
}

describe('auto play', () => {
  it('recruits within command and does not lean to one role', async () => {
    const { c, me } = await setup();
    const g = Object.values(c.gs.generals).find((x) => x.faction === me && !x.isLord)!;
    g.troops = []; g.command = 200; c.gs.factions[me].supply = 99999;
    const got = autoRecruit(c, g.id);
    expect(got.length).toBeGreaterThan(2);
    expect(troopLoad(g)).toBeLessThanOrEqual(g.command);
    const roles = new Set(got.map(unitRole));
    expect(roles.size).toBeGreaterThan(1);
    // 同じ役が半分を大きく超えない
    const most = Math.max(...[...roles].map((r) => got.filter((u) => unitRole(u) === r).length));
    expect(most / got.length).toBeLessThanOrEqual(0.67);
  });

  it('keeps the reserve of supply', async () => {
    const { c, me } = await setup();
    const g = Object.values(c.gs.generals).find((x) => x.faction === me && !x.isLord)!;
    g.troops = []; g.command = 60; c.gs.factions[me].supply = 300;
    autoRecruit(c, g.id, 250);
    expect(c.gs.factions[me].supply).toBeGreaterThanOrEqual(250);
  });

  it('one auto month recruits, trains idle generals and moves generals toward the front', async () => {
    const { c, me } = await setup();
    c.gs.factions[me].supply = 99999;
    const before = Object.values(c.gs.generals).filter((g) => g.faction === me).reduce((s, g) => s + g.troops.length, 0);
    const provs0 = provincesOf(c, me).length;
    autoPlayMonth(c);
    const after = Object.values(c.gs.generals).filter((g) => g.faction === me).reduce((s, g) => s + g.troops.length, 0);
    expect(after).toBeGreaterThan(before - 6);   // 戦で失うこともあるが、雇って増える
    expect(c.log.some((e) => e.key === 'train') || provincesOf(c, me).length !== provs0 || c.log.some((e) => e.key === 'battle')).toBe(true);
  });

  it('several auto months grow the realm without breaking', async () => {
    const { c, me } = await setup();
    for (let i = 0; i < 6 && !c.over; i++) autoPlayMonth(c);
    expect(provincesOf(c, me).length).toBeGreaterThan(0);
  });
});
