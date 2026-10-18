// 月送りの演出（P31）：自分の勢力のかかわらない戦いを書き留める（攻めた領・守る領・顔ぶれ・勝った側・領が移ったか）
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { endMonth, finishMonth, newCampaign, resolveBattle } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

describe('month reel of other houses’ battles', () => {
  it('records battles between other houses, not the player’s, and not when only watching', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const me = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
    const c = newCampaign(gs, save.world, me.id);
    let seen = 0;
    for (let m = 0; m < 12 && !seen; m++) {
      c.reel = [];
      for (const pb of endMonth(c)) resolveBattle(c, pb);
      for (const b of c.reel ?? []) {
        seen++;
        expect(b.attacker).not.toBe(c.player);
        expect(b.defender).not.toBe(c.player);
        expect(b.atk.length).toBeGreaterThan(0);
        expect(b.def.length).toBeGreaterThan(0);
        expect(gs.provinces[b.from]).toBeTruthy();
        if (b.captured) expect(b.winner).toBe(0);
      }
      finishMonth(c);
    }
    expect(seen).toBeGreaterThan(0);
    // 観戦では書き留めない
    const s2 = await loadFixture('sengoku_fid5_1575'), c2 = newCampaign(convert(s2), s2.world, 0);
    c2.reel = [];
    for (const pb of endMonth(c2)) resolveBattle(c2, pb);
    expect(c2.reel.length).toBe(0);
  });
});
