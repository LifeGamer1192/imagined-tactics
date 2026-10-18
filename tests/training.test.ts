// 訓練（P30）：1か月訓練・ずっと訓練で、武将と配下の兵に経験値が入る。特性などで1.5倍。まれに出来事
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { finishMonth, newCampaign, type Campaign } from '../src/strategy/campaign';
import { S } from '../src/strategy/config';
import { toggleTrainAlways, trainMult, trainOnce, trainProblem } from '../src/strategy/training';
import { loadFixture } from './helpers';

async function setup(): Promise<Campaign> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  return newCampaign(gs, save.world, f.id);
}
const expOf = (c: Campaign, id: string) => { const g = c.gs.generals[id]; return { lv: g.level, exp: g.exp, troops: g.troops.map((t) => t.level * 1e6 + t.exp) }; };

describe('training', () => {
  it('one month of training uses up the general this month and gives experience to the general and their troops', async () => {
    const c = await setup();
    const g = generalsOf(c.gs, c.player).find((x) => x.troops.length && !x.isLord)!;
    const before = expOf(c, g.id);
    expect(trainOnce(c, g.id)).toBe(true);
    expect(c.moved.has(g.id)).toBe(true);
    expect(trainProblem(c, g)).toBe('今月は行動済みです');
    finishMonth(c);
    const after = expOf(c, g.id);
    expect(after.lv * 1e6 + after.exp).toBeGreaterThan(before.lv * 1e6 + before.exp);
    expect(after.troops.every((v, i) => v > before.troops[i])).toBe(true);
    expect(c.log.some((l) => l.key === 'train')).toBe(true);
    // 1か月訓練は、翌月には続かない
    expect(c.training?.[g.id]).toBeUndefined();
  });

  it('always-training trains every month unless the general was used for something else', async () => {
    const c = await setup();
    const g = generalsOf(c.gs, c.player).find((x) => x.troops.length && !x.isLord)!;
    expect(toggleTrainAlways(c, g.id)).toBe(true);
    const n0 = c.log.filter((l) => l.key === 'train').length;
    finishMonth(c);
    expect(c.log.filter((l) => l.key === 'train').length).toBe(n0 + 1);
    c.moved.add(g.id);   // ほかの命令で動いた
    finishMonth(c);
    expect(c.log.filter((l) => l.key === 'train').length).toBe(n0 + 1);
    expect(toggleTrainAlways(c, g.id)).toBe(false);
  });

  it('a general with a fitting trait, high military or discipline gets 1.5x every time', async () => {
    const c = await setup();
    const g = generalsOf(c.gs, c.player).find((x) => !x.isLord)!;
    g.traits = []; g.ab = [5, 5, 5, 5];
    expect(trainMult(c, g).mult).toBe(1);
    g.traits = [S.train.bonusTraits[0]];
    expect(trainMult(c, g).mult).toBe(S.train.bonusMult);
    g.traits = []; g.ab = [5, S.train.bonusMilitary, 5, 5];
    expect(trainMult(c, g).mult).toBe(S.train.bonusMult);
  });

  it('rare events happen sometimes over many months', async () => {
    const c = await setup();
    const gens = generalsOf(c.gs, c.player).filter((x) => !x.isLord).slice(0, 4);
    for (const g of gens) toggleTrainAlways(c, g.id);
    for (let m = 0; m < 40; m++) finishMonth(c);
    expect(c.log.some((l) => l.key === 'trainEvent')).toBe(true);
  });
});
