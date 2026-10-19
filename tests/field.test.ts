// 戦場の厚み（城攻め・新しい地形・天気）と、演出の組み立てのテスト。
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/ai/ai';
import { apply, startTurn } from '../src/battle/engine';
import { mapFromProvince, mapToText, parseMap, type BattleMap } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { seasonOf, skyEffects, skyFor } from '../src/battle/weather';
import { convert, generalsOf, makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import type { Affinity, TerrainKind, Weather } from '../src/data/types';
import { hitChance, skillDamage, skillTargetCells, tacticDamage } from '../src/rules/combat';
import { reach, stepCost } from '../src/rules/move';
import { skillOf, skillRange } from '../src/rules/stats';
import { before, cues, notePath } from '../src/ui/battleFx';
import { attackStart, loadFixture } from './helpers';

function troop(st: BattleState, unitId: string, side: Side, pos: number): BUnit {
  const def = D.byUnit[unitId];
  const t = makeTroop(def, 1);
  const u: BUnit = {
    id: st.units.length, side, home: side, kind: 'general', generalId: `t${st.units.length}`, leader: st.units.length, troopIndex: -1,
    defId: unitId, name: def.name.jp, level: 1, pos, hp: t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp,
    str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: def.def, move: def.move, affinity: def.affinity, commandRange: 9,
    passives: [...def.passives], skills: [...def.skills], tactics: [...def.tactics], critPct: 0, healPct: 0,
    statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0,
  };
  st.units.push(u);
  return u;
}
function field(text: string, weather?: Weather, night = false): BattleState {
  const map: BattleMap = parseMap(text);
  return { map, units: [], turn: 0, round: 1, maxRounds: 20, winner: null, rng: new RNG(7), log: [], sideNames: ['攻', '守'], weather, night };
}
const PLAIN = Array.from({ length: 7 }, () => '. . . . . . . . .').join('\n');
const basic = (u: BUnit) => skillOf(u.skills[0]);
/** 射程2以上の、単体を狙う技を持つ兵種 */
const ARCHER = D.units.find((u) => u.skills.some((id) => { const s = D.bySkill[id]; return s.basic && s.range[1] >= 2 && s.shape.type === 'single' && !s.needsWater; }))!.id;

/** その得意地形の兵が、from から歩いて行けるマス（ほかのユニットは無視） */
function reachable(map: BattleMap, aff: Affinity, from: number): Set<number> {
  const seen = new Set([from]), queue = [from];
  while (queue.length) {
    const i = queue.pop()!;
    for (const j of map.grid.neighbors(i)) {
      if (seen.has(j) || D.terrain.moveCost[map.terrain[j]][aff] === null) continue;
      seen.add(j); queue.push(j);
    }
  }
  return seen;
}

describe('new terrain', () => {
  it('every kind has costs and modifiers for every affinity', () => {
    for (const k of D.terrain.kinds) for (const a of D.terrain.affinities) {
      expect(D.terrain.moveCost[k], k).toHaveProperty(a);
      expect(typeof D.terrain.hitMod[k][a], `${k} ${a}`).toBe('number');
    }
    for (const k of ['camp', 'fort', 'paddy', 'wall', 'gate', 'tower'] as TerrainKind[]) expect(D.terrain.kinds).toContain(k);
  });

  it('reads and writes the new kinds in text maps', () => {
    const m = parseMap('. A F P\nH G Y .');
    expect(m.terrain).toEqual(['plain', 'camp', 'fort', 'paddy', 'wall', 'gate', 'tower', 'plain']);
    expect(mapToText(m)).toBe('.AFP\nHGY.');
    expect(m.siege).toBe(true);
    expect(parseMap(PLAIN).siege).toBe(false);
  });

  it('paddy is slow, walls stop riders, camps heal', () => {
    const st = field('. P H G A .\n. . . . . .');
    const g = st.map.grid;
    const foot = troop(st, 'u01a', 0, g.idx(0, 0)), rider = troop(st, 'u13a', 0, g.idx(0, 1));
    expect(stepCost(st, foot, g.idx(1, 0))).toBeGreaterThan(stepCost(st, foot, g.idx(0, 0))!);
    expect(stepCost(st, rider, g.idx(2, 0))).toBeNull();
    expect(stepCost(st, foot, g.idx(2, 0))).toBeGreaterThanOrEqual(2);
    expect(stepCost(st, rider, g.idx(3, 0))).not.toBeNull();
    // 陣にいると、番の始まりに回復する
    foot.pos = g.idx(4, 0); foot.hp = 1; rider.hp = 1;
    startTurn(st, 0);
    expect(foot.hp).toBe(1 + Math.round(foot.maxHp * D.terrain.regen.camp! / 100));
    expect(rider.hp).toBe(1);
  });

  it('towers give ranged attacks reach and accuracy', () => {
    const st = field('Y . . . . .\n. . . . . .');
    const g = st.map.grid;
    const a = troop(st, ARCHER, 0, g.idx(0, 0)), s = basic(a);
    const far = troop(st, 'u01a', 1, g.idx(s.range[1] + 1, 0));
    expect(skillRange(st, a, s)[1]).toBe(s.range[1] + 1);
    expect(skillTargetCells(st, a, s)).toContain(far.pos);
    const onTower = hitChance(st, a, s, far);
    st.map.terrain[0] = 'plain';
    expect(skillTargetCells(st, a, s)).not.toContain(far.pos);
    far.pos = g.idx(s.range[1], 0);
    const hitPlain = hitChance(st, a, s, far);
    st.map.terrain[0] = 'tower';
    const diff = D.terrain.hitMod.tower[a.affinity] - D.terrain.hitMod.plain[a.affinity] + D.terrain.ranged.tower!.hit;
    expect(hitChance(st, a, s, far)).toBe(Math.min(100, hitPlain + diff));
    expect(onTower).toBeGreaterThan(0);
  });
});

describe('siege maps', () => {
  it('walls always leave a way in, for every kind of unit', async () => {
    for (const f of ['sengoku_fid5_1575', 'invented_archipelago_y30']) {
      const w = (await loadFixture(f)).world;
      for (const p of w.provinces) {
        const m = mapFromProvince(w, p.id, { capital: true, walls: true });
        expect(m.siege, `${f} ${p.id}`).toBe(true);
        expect(m.terrain.filter((k) => k === 'gate').length).toBe(3);
        expect(m.terrain.filter((k) => k === 'tower').length).toBe(2);
        expect(m.spawn[1].length, `${f} ${p.id}`).toBeGreaterThanOrEqual(15);
        const castle = m.terrain.indexOf('castle');
        expect(castle).toBe(m.seat);
        for (const a of D.terrain.affinities) expect(reachable(m, a, attackStart(m)).has(castle), `${f} ${p.id} ${a}`).toBe(true);
        // 同じ領からは同じ戦場になる
        if (p.id < 4) expect(mapToText(mapFromProvince(w, p.id, { capital: true, walls: true }))).toBe(mapToText(m));
      }
    }
    // すべての領の城の戦場を作るので、ほかのテストと並んで重いときに時間切れにならないよう、長めに待つ
  }, 60000);

  it('weaker places get a fort or a camp instead of a castle', async () => {
    const w = (await loadFixture('sengoku_fid5_1575')).world;
    const seat = (opts: { capital?: boolean; walls?: boolean; fort?: number }) => {
      const m = mapFromProvince(w, 3, opts);
      return { kind: m.terrain[m.seat!], siege: m.siege };
    };
    expect(seat({ fort: 0 })).toEqual({ kind: 'camp', siege: false });
    expect(seat({ fort: 0.4 })).toEqual({ kind: 'fort', siege: false });
    expect(seat({ fort: 0.65 })).toEqual({ kind: 'castle', siege: false });
    expect(seat({ fort: 0.85 })).toEqual({ kind: 'castle', siege: true });
    expect(seat({ fort: 0, walls: true })).toEqual({ kind: 'camp', siege: false });
  });

  it('auto battles on walled maps always end, in every weather, and walls can be taken', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    const base = convert(save);
    const facs = Object.values(base.factions).filter((f) => generalsOf(base, f.id).length >= 2).slice(0, 6);
    let attackerWins = 0, stalled = 0, n = 0;
    const skies: Weather[] = ['clear', 'rain', 'fog', 'snow'];
    for (let i = 0; i + 1 < facs.length; i++) for (const flip of [false, true]) {
      const gs = convert(save);
      const [atk, def] = flip ? [facs[i + 1], facs[i]] : [facs[i], facs[i + 1]];
      const pick = (id: number) => generalsOf(gs, id).sort((a, b) => b.level - a.level).slice(0, 3).map((g) => g.id);
      const map = mapFromProvince(save.world, def.capital, { capital: true, walls: true });
      const sky = { weather: skies[n % skies.length], night: n % 3 === 0 };
      const st = createBattle(gs, map, [pick(atk.id), pick(def.id)], `siege${n++}`, undefined, undefined, sky);
      const wallD = map.depth![map.terrain.indexOf('wall')];
      let entered = false;
      for (let k = 0; k < 200 && st.winner === null; k++) {
        runAiTurn(st);
        entered ||= st.units.some((u) => u.alive && u.home === 0 && map.depth![u.pos] > wallD);
      }
      expect(st.winner, `${atk.name.ja} → ${def.name.ja}`).not.toBeNull();
      if (st.winner === 0) attackerWins++;
      // 城壁の中に一度も入れないまま時間切れになった戦い（守り手が打って出て外で決着するのは数えない）
      if (!entered && st.log.some((l) => l.key === 'timeup')) stalled++;
    }
    expect(stalled).toBeLessThanOrEqual(1);
    expect(attackerWins).toBeGreaterThan(0);
  });

  it('riders cannot climb the wall, so they go round through a gate', () => {
    const rows = Array.from({ length: 11 }, (_, r) => Array.from({ length: 15 }, (_, c) =>
      c === 10 ? (r === 2 || r === 5 || r === 8 ? 'G' : 'H') : c === 13 && r === 5 ? 'C' : '.').join(' '));
    const st = field(rows.join('\n'));
    const g = st.map.grid;
    expect(st.map.siege).toBe(true);
    const rider = troop(st, 'u13a', 0, g.idx(8, 0)), foot = troop(st, 'u01a', 0, g.idx(8, 10));
    const def = troop(st, 'u01a', 1, g.idx(13, 5));
    // 守り手は動かさない（攻め手の道の選び方だけを見る）
    def.statuses.push({ id: 'stun', turns: -1 });
    def.hp = def.maxHp = 99999;
    let riderIn = -1, footIn = -1;
    for (let round = 1; round <= 8 && (riderIn < 0 || footIn < 0); round++) {
      runAiTurn(st);
      expect(st.map.terrain[rider.pos]).not.toBe('wall');
      if (riderIn < 0 && g.col(rider.pos) > 10) riderIn = round;
      if (footIn < 0 && g.col(foot.pos) > 10) footIn = round;
      runAiTurn(st);
    }
    expect(riderIn).toBeGreaterThan(0);
    expect(footIn).toBeGreaterThan(0);
  });
});

describe('weather', () => {
  it('is decided by month and seed, deterministically', () => {
    for (let i = 0; i < 50; i++) expect(skyFor(1 + i % 12, `s${i}`)).toEqual(skyFor(1 + i % 12, `s${i}`));
    const count = (month: number) => {
      const c: Record<string, number> = { clear: 0, rain: 0, fog: 0, snow: 0, night: 0 };
      for (let i = 0; i < 400; i++) { const s = skyFor(month, `w${i}`); c[s.weather]++; if (s.night) c.night++; }
      return c;
    };
    const jan = count(1), jul = count(7);
    expect(jan.snow).toBeGreaterThan(60);
    expect(jul.snow).toBe(0);
    expect(jul.rain).toBeGreaterThan(jan.rain);
    for (const c of [jan, jul]) { expect(c.clear).toBeGreaterThan(150); expect(c.night).toBeGreaterThan(15); expect(c.night).toBeLessThan(100); }
    expect([1, 4, 7, 10, 12].map(seasonOf)).toEqual(['winter', 'spring', 'summer', 'autumn', 'winter']);
    expect(skyEffects({ weather: 'clear', night: false })).toEqual([]);
    expect(skyEffects({ weather: 'rain', night: true }).length).toBe(3);
  });

  it('battles get the same weather from the same seed, and it can be fixed', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    const gs = convert(save);
    const [fa, fb] = Object.values(gs.factions).filter((f) => generalsOf(gs, f.id).length >= 1);
    const map = mapFromProvince(save.world, fb.capital, { capital: true });
    const make = (seed: string, sky?: { weather?: Weather; night?: boolean }) =>
      createBattle(gs, map, [[generalsOf(gs, fa.id)[0].id], [generalsOf(gs, fb.id)[0].id]], seed, undefined, undefined, sky);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const a = make(`k${i}`), b = make(`k${i}`);
      expect([a.weather, a.night]).toEqual([b.weather, b.night]);
      expect([a.weather, a.night]).toEqual(Object.values(skyFor(gs.month, `${gs.seed}:${gs.tick}:k${i}`)));
      seen.add(a.weather!);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(make('k0', { weather: 'fog', night: true })).toMatchObject({ weather: 'fog', night: true });
    // 雪の日は、戦いの上限が少し延びる
    expect(make('k0', { weather: 'snow' }).maxRounds).toBe(make('k0', { weather: 'clear' }).maxRounds + D.combat.weather.snowExtraRounds);
  });

  it('clear weather changes nothing; rain, fog, snow and night each do one small thing', () => {
    const W = D.combat.weather;
    const build = (weather?: Weather, night = false) => {
      const st = field(`${PLAIN}\n= = = = = = = = =`, weather, night);
      const g = st.map.grid;
      const archer = troop(st, ARCHER, 0, g.idx(2, 3)), foot = troop(st, 'u01a', 0, g.idx(2, 4));
      const near = troop(st, 'u01a', 1, g.idx(3, 3)), far = troop(st, 'u01a', 1, g.idx(4, 3));
      const s = basic(archer);
      return {
        st, g, foot,
        shotFar: hitChance(st, archer, s, far), shotNear: hitChance(st, archer, s, near), melee: hitChance(st, foot, basic(foot), near),
        fire: tacticDamage(st, archer, D.byTactic[W.fireTactics[0]], far), other: tacticDamage(st, archer, D.byTactic.x07, far), water: tacticDamage(st, archer, D.byTactic.x03, far),
        fireSkill: skillDamage(st, archer, D.bySkill[W.fireSkills[0]], far),
        plainCost: stepCost(st, foot, g.idx(0, 0)), roadCost: stepCost(st, foot, g.idx(0, 7)), cells: reach(st, foot).cells.length,
      };
    };
    const none = build(), clear = build('clear'), rain = build('rain'), fog = build('fog'), snow = build('snow'), night = build('clear', true);
    const { st: _a, g: _b, foot: _c, ...plain } = none;
    expect(clear).toMatchObject(plain);
    // 雨：飛び道具の命中が下がり、火は弱まる。近接とほかの軍略はそのまま
    expect(rain.shotFar).toBe(none.shotFar + W.rainRangedHit);
    expect(rain.melee).toBe(none.melee);
    expect(rain.fire).toBeLessThan(none.fire);
    expect(rain.fire).toBeGreaterThanOrEqual(Math.floor(none.fire * W.rainFireMult) - 1);
    expect(rain.fireSkill).toBeLessThan(none.fireSkill);
    expect(rain.other).toBe(none.other);
    // 雨：水の軍略は強まる（地形と天気の倍率）
    expect(rain.water).toBeGreaterThan(none.water);
    // 霧：離れた相手にだけ当たりにくい
    expect(fog.shotFar).toBe(none.shotFar + W.fogFarHit);
    expect(fog.shotNear).toBe(none.shotNear);
    expect(fog.melee).toBe(none.melee);
    // 雪：道のほかは歩きにくい
    expect(snow.plainCost).toBe(none.plainCost! + W.snowMoveCost);
    expect(snow.roadCost).toBe(none.roadCost);
    expect(snow.cells).toBeLessThan(none.cells);
    expect(snow.shotFar).toBe(none.shotFar);
    // 夜：どの技も少し当たりにくい
    expect(night.shotFar).toBe(none.shotFar + W.nightHit);
    expect(night.melee).toBe(none.melee + W.nightHit);
  });
});

describe('battle effects', () => {
  it('are built from the log without touching the state', () => {
    const st = field(PLAIN);
    const g = st.map.grid;
    const a = troop(st, 'u01a', 0, g.idx(1, 3)), d = troop(st, 'u01a', 1, g.idx(5, 3));
    const b = before(st);
    const acts = [{ type: 'move' as const, unit: a.id, to: g.idx(4, 3) }, { type: 'skill' as const, unit: a.id, skill: a.skills[0], target: d.pos }];
    for (const act of acts) { notePath(st, b, act); expect(apply(st, act)).toBe(true); }
    const frozen = JSON.stringify(st.units);
    const c = cues(st, b, 1, 1000);
    expect(JSON.stringify(st.units)).toBe(frozen);
    const slide = c.fx.find((f) => f.kind === 'slide');
    expect(slide && slide.kind === 'slide' && slide.pts.length).toBe(4);
    expect(c.fx.some((f) => f.kind === 'lunge' && f.unit === a.id)).toBe(true);
    // 当たりか外れのどちらかが、相手のところに出る
    expect(c.fx.some((f) => f.kind === 'text')).toBe(true);
    expect(c.sounds.map((s) => s.id)).toContain('move');
    expect(c.dur).toBeGreaterThan(200);
    for (const f of c.fx) { expect(f.t0).toBeGreaterThanOrEqual(1000); expect(f.dur).toBeGreaterThan(0); }
    // 速いほど短く、いちばん速い設定では演出なし
    expect(cues(st, b, 0.3, 1000).dur).toBeLessThan(c.dur);
    expect(cues(st, b, 0, 1000)).toEqual({ fx: [], sounds: [], dur: 0 });
  });

  it('fades out a unit that falls', () => {
    const st = field(PLAIN);
    const g = st.map.grid;
    const a = troop(st, 'u01a', 0, g.idx(1, 3)), d = troop(st, 'u01a', 1, g.idx(2, 3));
    d.hp = 1; d.agi = -999;
    const b = before(st);
    expect(apply(st, { type: 'skill', unit: a.id, skill: a.skills[0], target: d.pos })).toBe(true);
    expect(d.alive).toBe(false);
    const c = cues(st, b, 1, 0);
    const ghost = c.fx.find((f) => f.kind === 'ghost');
    expect(ghost && ghost.kind === 'ghost' && ghost.u.id).toBe(d.id);
    expect(c.fx.some((f) => f.kind === 'hp' && f.unit === d.id && f.hp === 1)).toBe(true);
    expect(c.sounds.map((s) => s.id)).toContain('defeat');
  });
});
