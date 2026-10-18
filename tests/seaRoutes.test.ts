// 隣り合う領（P36）：攻めと移動は、陸で隣り合う領か、海路（地図に点線で描く）でつながる領のあいだだけ
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { endMonth, finishMonth, neighborsOf, newCampaign, resolveBattle } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

describe('neighbours are land borders or drawn sea routes', () => {
  it('neighbours are exactly land borders plus sea routes, and sea routes go both ways', async () => {
    const save = await loadFixture('shunju_fid5_259bc'), gs = convert(save), c = newCampaign(gs, save.world, 0);
    for (const p of gs.provinces) {
      expect(new Set(neighborsOf(c, p.id))).toEqual(new Set([...p.nb, ...p.sea].filter((n) => !gs.provinces[n].out)));
      for (const q of p.sea) expect(gs.provinces[q].sea.includes(p.id) || gs.provinces[q].nb.includes(p.id)).toBe(true);
    }
    // 報告のあった宜城と萊は、海路でつながっている
    const a = gs.provinces.find((p) => p.name.ja === '宜城')!, b = gs.provinces.find((p) => p.name.ja === '萊')!;
    expect(a.nb.includes(b.id)).toBe(false);
    expect(a.sea.includes(b.id)).toBe(true);
  });

  it('every attack over a year of other houses goes between neighbours', async () => {
    const save = await loadFixture('shunju_fid5_259bc'), gs = convert(save);
    const me = Object.values(gs.factions)[0].id, c = newCampaign(gs, save.world, me);
    for (let m = 0; m < 12; m++) {
      c.reel = [];
      for (const pb of endMonth(c)) { expect(neighborsOf(c, pb.from)).toContain(pb.prov); resolveBattle(c, pb); }
      for (const r of c.reel ?? []) expect(neighborsOf(c, r.from)).toContain(r.prov);
      finishMonth(c);
    }
  });
});
