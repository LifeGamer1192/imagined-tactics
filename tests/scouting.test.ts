// 偵察度（P33）：隣は毎月上がり、離れた領は薄れる。偵察させると上がる。相国はまわりを上げる。見える量は偵察度で決まる
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { finishMonth, neighborsOf, newCampaign, type Campaign } from '../src/strategy/campaign';
import { S } from '../src/strategy/config';
import { appointChancellor, missionGain, scoutOf, scoutProblem, scoutTier, sendScout } from '../src/strategy/scouting';
import { restore, snapshot } from '../src/persist/save';
import { loadFixture } from './helpers';

async function setup(): Promise<Campaign> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  return newCampaign(gs, save.world, f.id);
}
const near = (c: Campaign): number => { for (const p of c.gs.provinces) if (p.owner === c.player) for (const n of neighborsOf(c, p.id)) if (c.gs.provinces[n].owner && c.gs.provinces[n].owner !== c.player) return n; return -1; };
const far = (c: Campaign): number => {
  const close = new Set<number>();
  for (const p of c.gs.provinces) if (p.owner === c.player) { close.add(p.id); for (const n of neighborsOf(c, p.id)) { close.add(n); for (const m of neighborsOf(c, n)) close.add(m); } }
  return c.gs.provinces.find((p) => p.owner && !close.has(p.id) && !p.out)!.id;
};

describe('scouting', () => {
  it('own provinces are fully known; neighbours start known and rise each month; far ones start unknown', async () => {
    const c = await setup();
    const own = c.gs.factions[c.player].capital, n = near(c), x = far(c);
    expect(scoutOf(c, own)).toBe(100);
    expect(scoutOf(c, n)).toBe(S.scout.start);
    expect(scoutTier(c, n)).toBe('names');
    expect(scoutTier(c, x)).toBe('none');
    finishMonth(c);
    expect(scoutOf(c, n)).toBe(Math.min(100, S.scout.start + S.scout.adjacentGain));
    expect(scoutTier(c, n)).toBe('full');
  });

  it('sending a general to scout uses them for the month and raises that province at month end', async () => {
    const c = await setup();
    const x = far(c), g = generalsOf(c.gs, c.player).find((y) => !y.isLord)!;
    expect(scoutProblem(c, g, x)).toBeNull();
    expect(sendScout(c, g.id, x)).toBe(true);
    expect(c.moved.has(g.id)).toBe(true);
    const before = scoutOf(c, x);
    finishMonth(c);
    expect(scoutOf(c, x)).toBe(Math.min(100, Math.max(0, before - S.scout.decay) + missionGain(g)));
    expect(c.log.some((l) => l.key === 'scouted')).toBe(true);
  });

  it('a chancellor raises provinces up to two steps away every month, depending on diplomacy', async () => {
    const c = await setup();
    const g = generalsOf(c.gs, c.player).find((y) => !y.isLord)!;
    g.ab = [5, 5, 9, 5];
    // 2歩先の他国の領
    let two = -1;
    for (const p of c.gs.provinces) if (p.owner === c.player) for (const n of neighborsOf(c, p.id)) for (const m of neighborsOf(c, n)) {
      if (two < 0 && c.gs.provinces[m].owner && c.gs.provinces[m].owner !== c.player && !neighborsOf(c, m).some((k) => c.gs.provinces[k].owner === c.player)) two = m;
    }
    expect(two).toBeGreaterThanOrEqual(0);
    const without = await setup();
    finishMonth(without);
    expect(appointChancellor(c, g.id)).toBe(true);
    finishMonth(c);
    expect(scoutOf(c, two)).toBeGreaterThan(scoutOf(without, two));
    expect(appointChancellor(c, g.id)).toBe(false);
  });

  it('is kept in saves, and old saves start from neighbours', async () => {
    const c = await setup();
    const x = far(c), g = generalsOf(c.gs, c.player).find((y) => !y.isLord)!;
    sendScout(c, g.id, x); finishMonth(c);
    const back = restore(JSON.parse(JSON.stringify(snapshot(c))));
    expect(scoutOf(back, x)).toBe(scoutOf(c, x));
    const old = JSON.parse(JSON.stringify(snapshot(c)));
    delete old.campaign.scout;
    const o = restore(old);
    expect(scoutOf(o, near(o))).toBeGreaterThanOrEqual(S.scout.start);
  });
});
