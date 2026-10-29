// 収入の正規化と始めの蓄え（P96）：世界ごとに1領の平均収入がそろう・始めの蓄えは月収の何か月ぶん・戦場の道や田は変わらない
import { describe, expect, it } from 'vitest';
import convertJson from '../data/system/convert.json';
import { convert } from '../src/convert/convert';
import { lookIncome, newCampaign, S, startSupply } from '../src/strategy/campaign';
import { FIXTURES, loadFixture } from './helpers';

const CFG = (convertJson as unknown as { supply: { perPop: number; refPop: number; incomeMult: number } }).supply;

describe('income normalization', () => {
  it('average province income per world is close to refPop × perPop × incomeMult × prosperity', async () => {
    for (const name of FIXTURES) {
      const gs = convert(await loadFixture(name));
      const inside = gs.provinces.filter((p) => !p.out);
      const avgPop = inside.reduce((s, p) => s + p.pop, 0) / inside.length;
      expect(gs.incomeScale).toBeCloseTo(CFG.incomeMult * CFG.refPop / avgPop, 6);
      // 人口の多い世界も少ない世界も、1領の平均収入はだいたい同じ桁（繁栄・荒廃で上下する）
      const avgInc = inside.reduce((s, p) => s + p.income, 0) / inside.length;
      const ref = CFG.refPop * CFG.perPop * CFG.incomeMult;
      expect(avgInc, name).toBeGreaterThan(ref * 0.2);
      expect(avgInc, name).toBeLessThan(ref * 1.2);
    }
  });

  it('battle maps use the income before normalization', async () => {
    const gs = convert(await loadFixture('shunju_fid5_259bc'));
    const p = gs.provinces.find((x) => !x.out && x.pop > 0)!;
    expect(gs.incomeScale).toBeLessThan(1);
    expect(lookIncome(gs, p.income)).toBeCloseTo(p.income / gs.incomeScale!, 6);
    // 古いセーブ（倍率が無い）はそのまま
    expect(lookIncome({ ...gs, incomeScale: undefined }, 123)).toBe(123);
  });
});

describe('starting supply', () => {
  it('player gets income × months by difficulty, rivals always the same months, at least startMin', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    const player = Object.values(convert(save).factions)[0].id;
    for (const [d, months] of [['easy', 8], ['normal', 5], ['hard', 3], ['veryHard', 2], ['oni', 1]] as const) {
      expect(S.difficulty[d].startMonths).toBe(months);
      const c = newCampaign(convert(save), save.world, player, d);
      for (const f of Object.values(c.gs.factions)) {
        const m = f.id === player ? months : S.supply.aiStartMonths;
        expect(f.supply, `${d} ${f.name.ja}`).toBe(Math.max(S.supply.startMin, Math.round(f.income * m)));
      }
    }
  });

  it('small houses get the minimum', () => {
    const f = { income: 10 } as Parameters<typeof startSupply>[0];
    expect(startSupply(f, 5)).toBe(S.supply.startMin);
    expect(startSupply({ ...f, income: 300 }, 5)).toBe(1500);
  });
});
