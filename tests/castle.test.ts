// 城を取って勝つ：攻め手が天守（城のマス）を決まった巡だけ押さえ続けるか、時間切れのとき押さえていれば攻め手の勝ち。
import { describe, expect, it } from 'vitest';
import { autoBattle } from '../src/ai/ai';
import { endTurn } from '../src/battle/engine';
import { mapFromProvince } from '../src/battle/map';
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
    // 砦や陣の戦場には天守が無い
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const p = gs.provinces.find((x) => !x.out && Object.values(gs.factions).every((f) => f.capital !== x.id))!;
    expect(mapFromProvince(save.world, p.id, { fort: 0.4 }).holdTurns).toBeUndefined();
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
});
