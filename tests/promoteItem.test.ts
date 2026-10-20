// 品の要る昇進（鉄盾衆）：品「精鋭の証」に加えて Lv25 が要る。練兵の書でもレベルは飛ばせない（2026-10-20）
import { describe, expect, it } from 'vitest';
import { makeTroop } from '../src/convert/convert';
import { D } from '../src/data/db';
import { promoteTroop, troopPromotions } from '../src/rules/growth';

describe('iron shield needs the item and level 25', () => {
  it('cannot promote below Lv25 even with the item and a training book', () => {
    const t = makeTroop(D.byUnit.u09b, 24);
    const items = { item_shield_top: 1, item_promote: 1 };
    expect(troopPromotions(t, items)[0].missing).toEqual(['レベル25']);
    expect(promoteTroop(t, 'u09c', items)).toBe(false);
    expect(items).toEqual({ item_shield_top: 1, item_promote: 1 });
  });
  it('promotes at Lv25 with the item (the book is kept)', () => {
    const t = makeTroop(D.byUnit.u09b, 25);
    const items = { item_shield_top: 1, item_promote: 1 };
    expect(promoteTroop(t, 'u09c', items)).toBe(true);
    expect(t.unitId).toBe('u09c');
    expect(items).toEqual({ item_shield_top: 0, item_promote: 1 });
  });
  it('without the item it cannot promote at any level', () => {
    expect(troopPromotions(makeTroop(D.byUnit.u09b, 40), {})[0].missing).toContain('精鋭の証');
  });
  it('the training book still skips the level for promotions without an item', () => {
    const t = makeTroop(D.byUnit.u09a, 3);
    expect(troopPromotions(t, { item_promote: 1 })[0].ok).toBe(true);
  });
});
