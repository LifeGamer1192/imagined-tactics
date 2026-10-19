// 地形と天気の厚み：攻撃の種類（近接・弓・鉄砲・騎馬の突撃・火・水・軍略・奇襲・夜襲）ごとに、地形と天気で強まる・弱まる。
import { describe, expect, it } from 'vitest';
import { mapFromProvince, parseMap } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import type { BUnit, BattleState } from '../src/battle/types';
import { convert, generalsOf, makeTroop } from '../src/convert/convert';
import { D } from '../src/data/db';
import { damageParts, tacticParts } from '../src/rules/combat';
import { attackKinds, FIELD, fieldMult, skillOf } from '../src/rules/stats';
import { loadFixture } from './helpers';

async function duel(text: string, unitA: string, unitT: string, sky: { weather?: 'clear' | 'rain' | 'fog' | 'snow'; night?: boolean } = {}): Promise<{ st: BattleState; a: BUnit; t: BUnit }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const [fa, fb] = Object.values(gs.factions).sort((x, y) => generalsOf(gs, y.id).length - generalsOf(gs, x.id).length);
  const ga = generalsOf(gs, fa.id)[0], gb = generalsOf(gs, fb.id)[0];
  ga.troops = [makeTroop(D.byUnit[unitA], 5)]; gb.troops = [makeTroop(D.byUnit[unitT], 5)];
  const st = createBattle(gs, parseMap(text), [[ga.id], [gb.id]], 'field', undefined, undefined, { weather: sky.weather ?? 'clear', night: !!sky.night });
  const a = st.units.find((u) => u.side === 0 && u.kind !== 'general')!, t = st.units.find((u) => u.side === 1 && u.kind !== 'general')!;
  a.pos = st.map.grid.idx(2, 1); t.pos = st.map.grid.idx(3, 1);
  return { st, a, t };
}
const MAP = (row1: string) => ['.....', row1, '.....'].join('\n');

describe('kinds of attack', () => {
  it('classifies skills: melee, charge for riders, bow for range 2+, gun, fire, water, ambush, night, tactic', async () => {
    const { st, a } = await duel(MAP('.....'), 'u01a', 'u01a');
    expect(attackKinds(a, 'k001', [1, 1], false)).toEqual(['melee']);
    expect(attackKinds(a, 'k024', [1, 2], false)).toEqual(['bow']);
    expect(attackKinds(a, 'k014', [1, 2], false)).toEqual(['gun']);
    expect(attackKinds(a, 'k072', [1, 1], false)).toEqual(['fire', 'melee']);
    expect(attackKinds(a, 'x03', null, true)).toEqual(['water', 'tactic']);
    expect(attackKinds(a, 'x05', null, true)).toEqual(['night', 'tactic']);
    const { a: rider } = await duel(MAP('.....'), 'u07a', 'u01a');
    expect(attackKinds(rider, 'k026', [1, 1], false)).toEqual(['charge']);
    expect(st.units.length).toBeGreaterThan(0);
  });
});

describe('terrain and weather change damage by kind of attack', () => {
  it('arrows lose against a target in the forest; fire gains there', async () => {
    const { st, a, t } = await duel(MAP('..TT.'), 'u06a', 'u01a');
    const bow = fieldMult(st, a, 'k024', [1, 2], false, t);
    expect(bow.mult).toBeCloseTo(FIELD.terrain.forest!.target!.bow, 5);
    const fire = fieldMult(st, a, 'k072', [1, 1], false, t);
    expect(fire.mult).toBeCloseTo(FIELD.terrain.forest!.target!.fire, 5);
    // ダメージにも入っている
    const plain = await duel(MAP('.....'), 'u06a', 'u01a');
    const s = skillOf('k024');
    const inForest = damageParts(st, a, s, t), onPlain = damageParts(plain.st, plain.a, s, plain.t);
    expect(inForest.field).toBeLessThan(1);
    expect(inForest.base).toBeLessThan(onPlain.base + 1);
  });

  it('a charge bogs down in a swamp; rain weakens guns; night strengthens night raids', async () => {
    const sw = await duel(MAP('...,.'), 'u07a', 'u01a');
    expect(fieldMult(sw.st, sw.a, 'k026', [1, 1], false, sw.t).mult).toBeCloseTo(FIELD.terrain.swamp!.target!.charge, 5);
    const rain = await duel(MAP('.....'), 'u04a', 'u01a', { weather: 'rain' });
    expect(fieldMult(rain.st, rain.a, 'k014', [1, 2], false, rain.t).mult).toBeCloseTo(FIELD.weather.rain.gun, 5);
    const night = await duel(MAP('.....'), 'u01a', 'u01a', { night: true });
    const tac = D.byTactic.x05;
    expect(tacticParts(night.st, night.a, tac, night.t).field).toBeCloseTo(FIELD.weather.night.night, 5);
  });

  it('attackers are not held back by their own favourite ground', async () => {
    // 森の兵が森から近接で攻める：森の「自分がいる」の弱まり（騎馬）だけがあり、森の兵には掛からない
    const { st, a, t } = await duel(MAP('..T..'), 'u07a', 'u01a');
    const r = fieldMult(st, a, 'k026', [1, 1], false, t);
    expect(r.notes.some(([w]) => w.startsWith('自分が'))).toBe(FIELD.native.forest !== 'rider');
    // 水の兵が水の上から攻めても、水の上の弱まりは掛からない
    const w = await duel(MAP('..~..'), 'u03a', 'u01a');
    expect(fieldMult(w.st, w.a, 'k008', [1, 1], false, w.t).notes.some(([x]) => x.startsWith('自分が'))).toBe(false);
  });

  it('every terrain kind except the void outside the board has effects in field.json', () => {
    for (const k of D.terrain.kinds) if (k !== 'void') expect(FIELD.terrain[k], k).toBeTruthy();
    // 晴れは補正なし。ほかの天気と夜は、何かが強まる・弱まる
    expect(Object.keys(FIELD.weather.clear).length).toBe(0);
    for (const k of ['rain', 'fog', 'snow', 'night']) expect(Object.keys(FIELD.weather[k]).length).toBeGreaterThan(0);
  });
});

describe('new terrain: barren land and snowfields', () => {
  it('deserts and tundra become barren land, glaciers become snowfields, on generated maps', async () => {
    const save = await loadFixture('shunju_fid5_259bc'), gs = convert(save);
    let desert = 0;
    for (const p of gs.provinces.filter((x) => !x.out).slice(0, 80)) desert += mapFromProvince(save.world, p.id).terrain.filter((k) => k === 'desert').length;
    expect(desert).toBeGreaterThan(0);
    const arch = await loadFixture('invented_archipelago_y30'), ga = convert(arch);
    let snow = 0;
    for (const p of ga.provinces.filter((x) => !x.out)) snow += mapFromProvince(arch.world, p.id).terrain.filter((k) => k === 'snowfield').length;
    expect(snow).toBeGreaterThan(0);
    // 雪原は騎馬に重く、荒れ地は騎馬に軽い
    expect(D.terrain.moveCost.snowfield.rider!).toBeGreaterThan(D.terrain.moveCost.plain.rider!);
    expect(D.terrain.moveCost.desert.rider!).toBeLessThan(D.terrain.moveCost.desert.plain!);
    // 百近い領の戦場を作るので、ほかのテストと並んで重いときに時間切れにならないよう、長めに待つ
  }, 60000);
});
