// 徴兵した兵のレベル：徴兵する時点の国どうしの技術と威信の位置で、1〜8 に決まる
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { newCampaign, recruitLevel } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

describe('recruit level', () => {
  it('the most advanced house recruits at 8, the most backward at 1, others in between (even when every house has high tech)', async () => {
    const save = await loadFixture('shunju_fid5_259bc'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    const fs = Object.values(gs.factions);
    // 特色の加点を外して比べる
    const unit = 'u01a';
    for (const f of fs) { f.economy = 'agrarian'; f.government = 'monarchy'; }
    const top = fs.reduce((a, b) => (b.tech + b.prestige > a.tech + a.prestige ? b : a));
    for (const f of fs) { f.tech = 5; f.prestige = 10; }
    top.tech = 20; top.prestige = 90;
    fs.find((f) => f !== top)!.tech = 1;
    const levels = fs.map((f) => recruitLevel(c, unit, f));
    expect(recruitLevel(c, unit, top)).toBe(8);
    expect(Math.min(...levels)).toBe(1);
    expect(levels.every((l) => l >= 1 && l <= 8)).toBe(true);
    // 難しさの加点を足しても 8 を超えない
    expect(recruitLevel(c, unit, top, 1)).toBe(8);
  });

  it('when every house is equal, recruits are in the middle', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    for (const f of Object.values(gs.factions)) { f.tech = 1.2; f.prestige = 20; f.economy = 'agrarian'; f.government = 'monarchy'; }
    const f = Object.values(gs.factions)[0];
    expect(recruitLevel(c, 'u01a', f)).toBe(5);
  });
});
