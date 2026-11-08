// 0.16.4：昇格の品を「精鋭の証」1種にまとめた。古いセーブの品は、読み込むときに数を足して移す
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { restore, snapshot } from '../src/persist/save';
import { newCampaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

describe('old promotion items in a save', () => {
  it('are added up into 精鋭の証', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    const c = newCampaign(convert(save), save.world, 0);
    c.items = { item_promote: 2, item_guard_top: 1, item_horse_top: 2, item_shield_top: 1, item_elite: 1 };
    const back = restore(snapshot(c));
    expect(back.items).toEqual({ item_promote: 2, item_elite: 5 });
  });
});
