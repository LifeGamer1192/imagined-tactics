// 城を取って勝つ：攻め手が天守（城のマス）を決まった巡だけ押さえ続けるか、時間切れのとき押さえていれば攻め手の勝ち。
import { describe, expect, it } from 'vitest';
import { autoBattle, nextAiActions } from '../src/ai/ai';
import { apply } from '../src/battle/engine';
import { attackPower, defense } from '../src/rules/stats';
import { applyBattleResult } from '../src/battle/result';
import { D } from '../src/data/db';
import { endTurn } from '../src/battle/engine';
import { mapFromProvince , BM } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import type { BattleState } from '../src/battle/types';
import { convert, generalsOf } from '../src/convert/convert';
import { loadFixture } from './helpers';

async function castleBattle(opts: { walls?: boolean; fort?: number } = {}, maxRounds?: number): Promise<BattleState> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const [fa, fb] = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
  const map = mapFromProvince(save.world, fb.capital, { capital: true, ...opts });
  const pick = (id: number) => generalsOf(gs, id).slice(0, 2).map((g) => g.id);
  return createBattle(gs, map, [pick(fa.id), pick(fb.id)], 'castle', undefined, maxRounds);
}

/** 天守に攻め手の駒を置き、守り手の駒をどかす */
function occupy(st: BattleState): void {
  const cell = st.hold!.cell;
  for (const u of st.units) if (u.pos === cell) u.pos = st.map.spawn[1].find((i) => !st.units.some((x) => x.pos === i))!;
  st.units.find((u) => u.side === 0 && u.alive)!.pos = cell;
}
/** 1巡進める（攻め手の番を終え、守り手の番を終える）。守り手は何もしない */
const round = (st: BattleState) => { endTurn(st); endTurn(st); };

describe('taking the castle', () => {
  it('castle maps need 2 to 4 rounds of holding the keep; more with walls and a strong castle', async () => {
    expect((await castleBattle({ fort: 0.6 })).hold?.need).toBe(2);
    expect((await castleBattle({ fort: 0.85, walls: true })).hold?.need).toBe(3);
    expect((await castleBattle({ fort: 0.95, walls: true })).hold?.need).toBe(4);
    // 砦や陣の戦場は、要のマス（砦の本丸・本陣）を holdOther 巡押さえれば勝ち（P39）
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const p = gs.provinces.find((x) => !x.out && Object.values(gs.factions).every((f) => f.capital !== x.id))!;
    const fm = mapFromProvince(save.world, p.id, { fort: 0.4 });
    expect(fm.holdTurns).toBe(BM.holdOther);
    expect(['fort', 'camp']).toContain(fm.terrain[fm.seat!]);
    expect(mapFromProvince(save.world, p.id, { fort: 0 }).holdTurns).toBe(BM.holdOther);
  });

  it('holding the keep for the needed rounds wins; leaving it resets the count', async () => {
    const st = await castleBattle({ fort: 0.85, walls: true });
    const need = st.hold!.need;
    occupy(st);
    round(st);
    expect(st.hold!.count).toBe(1);
    expect(st.winner).toBeNull();
    // 追い出されると数が戻る
    const u = st.units.find((x) => x.pos === st.hold!.cell)!;
    u.pos = st.map.spawn[0][0];
    round(st);
    expect(st.hold!.count).toBe(0);
    expect(st.log.some((l) => l.key === 'holdLost')).toBe(true);
    // 押さえ直して、続けて need 巡で勝つ
    u.pos = st.hold!.cell;
    for (let k = 0; k < need; k++) round(st);
    expect(st.winner).toBe(0);
    expect(st.log.some((l) => l.key === 'castleTaken')).toBe(true);
  });

  it('when time runs out, the attackers win if they are in the keep, otherwise the defenders', async () => {
    const held = await castleBattle({ fort: 0.95, walls: true }, 1);
    occupy(held);
    endTurn(held);     // 攻め手の番を終える
    endTurn(held);     // 守り手の番を終える → 巡の上限を越える
    expect(held.winner).toBe(0);
    expect(held.log.some((l) => l.key === 'timeupHeld')).toBe(true);
    const empty = await castleBattle({ fort: 0.95, walls: true }, 1);
    endTurn(empty); endTurn(empty);
    expect(empty.winner).toBe(1);
  });

  it('auto battles on castle maps still end, and the attackers go for the keep', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    let fights = 0;
    for (let i = 0; i < 10; i++) {
      const gs = convert(save);
      const facs = Object.values(gs.factions).filter((x) => generalsOf(gs, x.id).length >= 2).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length).slice(0, 8);
      const a = facs[i % facs.length], d = facs[(i + 1) % facs.length], p = gs.provinces[d.capital];
      const pick = (id: number) => generalsOf(gs, id).sort((x, y) => y.level - x.level).slice(0, 3).map((g) => g.id);
      const map = mapFromProvince(save.world, d.capital, { capital: true, walls: i % 2 === 0, from: p.nb[i % Math.max(1, p.nb.length)] });
      const st = autoBattle(createBattle(gs, map, [pick(a.id), pick(d.id)], `keep${i}`, undefined, undefined, { weather: 'clear', night: false }));
      expect(st.winner).not.toBeNull();
      if (st.log.some((l) => l.key === 'hold' || l.key === 'castleTaken' || l.key === 'timeupHeld')) fights++;
    }
    expect(fights).toBeGreaterThanOrEqual(1);
  }, 120000);

  // 守り手の天守の守り（P88）
  it('the defenders start with their strongest troop in the keep and the same company around it', async () => {
    const st = await castleBattle({ fort: 0.85, walls: true });
    const h = st.hold!, g = st.map.grid;
    const troops = st.units.filter((u) => u.side === 1 && u.kind === 'troop').sort((a, b) => b.hp * attackPower(st, b) - a.hp * attackPower(st, a));
    const keeper = st.units.find((u) => u.pos === h.cell)!;
    expect(keeper.side).toBe(1);
    expect(keeper).toBe(troops[0]);
    const ring = st.units.filter((u) => g.distance(u.pos, h.cell) === 1);
    expect(ring.length).toBeGreaterThan(0);
    expect(ring.every((u) => u.side === 1)).toBe(true);
    // 寄せた兵は、将の采配の範囲から外れない
    for (const u of [keeper, ...ring.filter((x) => x.kind === 'troop')]) expect(st.map.grid.distance(u.pos, st.units[u.leader].pos)).toBeLessThanOrEqual(st.units[u.leader].commandRange);
    // 駒が重なっていない
    expect(new Set(st.units.map((u) => u.pos)).size).toBe(st.units.length);
  });

  it('when the attackers hold the keep, the defenders go to take it back, harder as they near winning', async () => {
    const st = await castleBattle({ fort: 0.85, walls: true });
    const h = st.hold!, g = st.map.grid;
    occupy(st);
    const holder = st.units.find((u) => u.pos === h.cell)!;
    st.turn = 1;
    const dist0 = st.units.filter((u) => u.side === 1 && u.alive && u.kind === 'troop').reduce((s, u) => s + g.distance(u.pos, h.cell), 0);
    h.count = h.need - 1;
    const hp0 = holder.hp;
    for (let k = 0; k < 40 && st.turn === 1 && st.winner === null; k++) for (const a of nextAiActions(st)) apply(st, a);
    const dist1 = st.units.filter((u) => u.side === 1 && u.alive && u.kind === 'troop').reduce((s, u) => s + g.distance(u.pos, h.cell), 0);
    // 守り手の兵は天守へ寄り、天守の上の攻め手を叩く
    expect(dist1).toBeLessThan(dist0);
    expect(!holder.alive || holder.hp < hp0 || holder.pos !== h.cell).toBe(true);
  });

  // 0.9.0：要のマスの防御、勝利の経験値
  it('a unit on the keep gets +15% defence, whichever side it is on', async () => {
    const st = await castleBattle({ fort: 0.85, walls: true });
    const u = st.units.find((x) => x.side === 0 && x.kind === 'troop')!;
    const off = defense(st, u);
    occupy(st);
    const on = st.units.find((x) => x.pos === st.hold!.cell)!;
    expect(on.side).toBe(0);
    expect(defense(st, on)).toBeCloseTo(on.def * (1 + D.combat.seatDefPct / 100), 6);
    expect(off).toBe(u.def);
  });

  it('every unit of the winning side gets the victory experience: more for routing the enemy than for the keep', async () => {
    for (const how of ['keep', 'rout'] as const) {
      const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
      const [fa, fb] = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
      const map = mapFromProvince(save.world, fb.capital, { capital: true, fort: 0.6 });
      const pick = (id: number) => generalsOf(gs, id).slice(0, 2).map((g) => g.id);
      const st = createBattle(gs, map, [pick(fa.id), pick(fb.id)], 'winexp');
      const atk = pick(fa.id).map((id) => gs.generals[id]);
      const before = atk.map((g) => ({ lv: g.level, exp: g.exp, troops: g.troops.map((t) => ({ lv: t.level, exp: t.exp })) }));
      if (how === 'keep') { occupy(st); for (let k = 0; k < st.hold!.need; k++) round(st); }
      else { for (const u of st.units) if (u.side === 1 && u.kind === 'general') u.alive = false; endTurn(st); }
      expect(st.winner).toBe(0);
      const sum = applyBattleResult(gs, st);
      const want = how === 'rout' ? D.combat.winExp.rout : D.combat.winExp.other;
      expect(sum.winExp).toEqual({ amount: want, rout: how === 'rout' });
      atk.forEach((g, i) => {
        // 何もしていない駒も、経験値が増える（レベルが上がったか、経験が増えた）
        expect(g.level > before[i].lv || g.exp > before[i].exp).toBe(true);
        g.troops.forEach((t, j) => expect(t.level > before[i].troops[j].lv || t.exp > before[i].troops[j].exp).toBe(true));
      });
    }
  });
});
