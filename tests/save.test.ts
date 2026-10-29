import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { fromJSON, HexSaveError, restore, snapshot, summaryText, toJSON, type HexSave } from '../src/persist/save';
import { autoMonth, battleFor, newCampaign, planAttack, provincesOf, generalsAt, neighborsOf, canAttack } from '../src/strategy/campaign';
import { mapToText } from '../src/battle/map';
import { loadFixture } from './helpers';

async function start(name: string, player = 0) {
  const save = await loadFixture(name);
  return newCampaign(convert(save), save.world, player);
}
const state = (c: Awaited<ReturnType<typeof start>>) => JSON.stringify([c.gs.provinces.map((p) => p.owner), c.gs.factions, c.gs.generals, c.gs.tick, c.months, c.log]);

describe('hex-sim save', () => {
  it('round-trips through the file format', async () => {
    const c = await start('invented_archipelago_y30');
    for (let m = 0; m < 3; m++) autoMonth(c);
    const text = toJSON(snapshot(c));
    const back = restore(fromJSON(text));
    expect(state(back)).toBe(state(c));
    expect(back.rng.state).toBe(c.rng.state);
    // 型付き配列が戻っている（戦場マップを作るのに使う）
    expect(back.world.map.biome).toBeInstanceOf(Uint8Array);
    expect(back.world.ps.fort).toBeInstanceOf(Float32Array);
    expect(summaryText(fromJSON(text))).toContain('3か月');
  });

  it('skills removed from the data (0.13.0: 蹂躙) are dropped from old saves', async () => {
    const c = await start('sengoku_fid5_1575');
    const g = Object.values(c.gs.generals).find((x) => x.troops.length)!;
    g.taught = [{ id: 'k058', kind: 'skill', from: 'x', uses: 0 }, { id: 'k001', kind: 'skill', from: 'x', uses: 0 }];
    g.troops[0].extraSkills = ['k061', 'k002'];
    const back = restore(fromJSON(toJSON(snapshot(c))));
    const h = back.gs.generals[g.id];
    expect(h.taught!.map((t) => t.id)).toEqual(['k001']);
    expect(h.troops[0].extraSkills).toEqual(['k002']);
  });

  it('continuing from a save gives the same history as playing straight through', async () => {
    const straight = await start('invented_archipelago_y30');
    for (let m = 0; m < 8; m++) autoMonth(straight);

    const first = await start('invented_archipelago_y30');
    for (let m = 0; m < 4; m++) autoMonth(first);
    const resumed = restore(fromJSON(toJSON(snapshot(first))));
    for (let m = 0; m < 4; m++) autoMonth(resumed);
    expect(state(resumed)).toBe(state(straight));
  }, 120000);

  it('battle maps are the same after loading', async () => {
    const c = await start('sengoku_fid5_1575');
    const oda = Object.values(c.gs.factions).find((f) => f.name.ja === '織田家')!;
    const find = (cc: typeof c) => {
      for (const p of provincesOf(cc, oda.id)) {
        const here = generalsAt(cc, p.id, oda.id);
        const t = neighborsOf(cc, p.id).find((n) => cc.gs.provinces[n].owner !== oda.id && canAttack(cc, oda.id, cc.gs.provinces[n].owner) && generalsAt(cc, n, cc.gs.provinces[n].owner).length);
        if (here.length && t !== undefined) return planAttack(cc, oda.id, p.id, t, here.map((g) => g.id));
      }
      return null;
    };
    const pb = find(c)!;
    expect(pb).not.toBeNull();
    const back = restore(fromJSON(toJSON(snapshot(c))));
    const pb2 = find(back)!;
    expect(pb2).toEqual(pb);
    const a = battleFor(c, pb), b = battleFor(back, pb2);
    expect(mapToText(b.map)).toBe(mapToText(a.map));
    expect(b.units.map((u) => [u.name, u.pos, u.hp])).toEqual(a.units.map((u) => [u.name, u.pos, u.hp]));
  });

  it('rejects other files and newer versions', async () => {
    expect(() => fromJSON('nope')).toThrow(HexSaveError);
    expect(() => fromJSON('{"format":"hist-sim"}')).toThrow(HexSaveError);
    const c = await start('invented_archipelago_y30');
    const s: HexSave = { ...snapshot(c), version: 99 };
    expect(() => restore(s)).toThrow(HexSaveError);
  });
});
