// 品の要る昇進：品に加えてレベルも要る。練兵の書でもレベルは飛ばせない（2026-10-20）。
// 0.16.1：鉄盾衆は品（精鋭の証）が要らなくなり、ほかの上級と同じく Lv20 で昇格する。品の決まりは最上級（馬廻衆・Lv35）で確かめる
import { describe, expect, it } from 'vitest';
import { makeTroop } from '../src/convert/convert';
import { D } from '../src/data/db';
import { promoteTroop, troopPromotions } from '../src/rules/growth';

describe('promotions that need an item also need the level', () => {
  it('cannot promote below the level even with the item and a training book', () => {
    const t = makeTroop(D.byUnit.u01e, 34);
    const items = { item_guard_top: 1, item_promote: 1 };
    expect(troopPromotions(t, items)[0].missing).toEqual(['レベル35']);
    expect(promoteTroop(t, 'u01f', items)).toBe(false);
    expect(items).toEqual({ item_guard_top: 1, item_promote: 1 });
  });
  it('promotes at the level with the item (the book is kept)', () => {
    const t = makeTroop(D.byUnit.u01e, 35);
    const items = { item_guard_top: 1, item_promote: 1 };
    expect(promoteTroop(t, 'u01f', items)).toBe(true);
    expect(t.unitId).toBe('u01f');
    expect(items).toEqual({ item_guard_top: 0, item_promote: 1 });
  });
  it('without the item it cannot promote at any level', () => {
    expect(troopPromotions(makeTroop(D.byUnit.u01e, 60), {})[0].missing).toContain(D.items.item_guard_top.jp);
  });
  it('the training book still skips the level for promotions without an item', () => {
    const t = makeTroop(D.byUnit.u09a, 3);
    expect(troopPromotions(t, { item_promote: 1 })[0].ok).toBe(true);
  });
  it('0.16.1: 鉄盾衆 needs no item any more (Lv20 like the other upper units)', () => {
    expect(D.byUnit.u09b.promote).toEqual([{ to: 'u09c', lv: 20 }]);
    expect(D.items.item_shield_top).toBeUndefined();
    expect(troopPromotions(makeTroop(D.byUnit.u09b, 20), {})[0].ok).toBe(true);
    expect(D.byUnit.u09c.passives.some((p) => p.type === 'doubleAct')).toBe(false);
    for (const id of ['u09a', 'u09b', 'u09c']) expect(D.byUnit[id].passives.find((p) => p.type === 'missileGuard')).toMatchObject({ chance: 80 });
    const k = D.bySkill.k034;
    expect(k.effects).toEqual([{ type: 'status', status: 'daze', chance: 8 }]);
  });
});
