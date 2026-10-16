// 本拠を移す：兵糧を多く使い、2〜3か月かかる。途中でその領を失うと取りやめ。
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { fromJSON, restore, snapshot, toJSON } from '../src/persist/save';
import { exclavesOf, finishMonth, newCampaign, provincesOf, relocationPlan, relocationProblem, S, startRelocation } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

async function camp() {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  return { c: newCampaign(gs, save.world, f.id), f };
}

describe('moving the capital', () => {
  it('costs much supply and takes months; the capital changes only when the time is up', async () => {
    const { c, f } = await camp();
    const to = provincesOf(c, f.id).find((p) => p.id !== f.capital && !exclavesOf(c, f.id).has(p.id))!;
    const plan = relocationPlan(c, f.id, to.id);
    expect(plan.cost).toBeGreaterThanOrEqual(S.capital.costMin);
    expect(plan.months).toBe(S.capital.monthsNear);
    f.supply = plan.cost - 1;
    expect(relocationProblem(c, f.id, to.id)).toMatch(/兵糧/);
    f.supply = plan.cost + 100;
    const old = f.capital;
    expect(startRelocation(c, f.id, to.id)).toBe(true);
    expect(f.supply).toBe(100);
    expect(relocationProblem(c, f.id, provincesOf(c, f.id).find((p) => p.id !== old && p.id !== to.id)!.id)).toMatch(/移している/);
    // セーブして読み込んでも続く
    const c2 = restore(fromJSON(toJSON(snapshot(c))));
    expect(c2.relocations[f.id]?.to).toBe(to.id);
    for (let m = 0; m < plan.months - 1; m++) { finishMonth(c); expect(c.gs.factions[f.id].capital).toBe(old); }
    finishMonth(c);
    expect(c.gs.factions[f.id].capital).toBe(to.id);
    expect(c.relocations[f.id]).toBeUndefined();
    expect(c.log.some((l) => l.key === 'capitalMoved')).toBe(true);
  });

  it('is called off if the new capital is lost on the way', async () => {
    const { c, f } = await camp();
    const to = provincesOf(c, f.id).find((p) => p.id !== f.capital)!;
    f.supply = 100000;
    expect(startRelocation(c, f.id, to.id)).toBe(true);
    const other = Object.values(c.gs.factions).find((x) => x.id !== f.id)!;
    c.gs.provinces[to.id].owner = other.id;
    const old = f.capital;
    finishMonth(c);
    expect(c.relocations[f.id]).toBeUndefined();
    expect(f.capital).toBe(old);
    expect(c.log.some((l) => l.key === 'capitalMoveFailed')).toBe(true);
  });

  it('refuses other factions\' provinces and the capital itself', async () => {
    const { c, f } = await camp();
    expect(relocationProblem(c, f.id, f.capital)).toMatch(/もう本拠/);
    const foreign = c.gs.provinces.find((p) => p.owner && p.owner !== f.id)!;
    expect(relocationProblem(c, f.id, foreign.id)).toMatch(/自分の領/);
  });
});
