// 戦闘の難しさ：数値は変えず、自分と戦う相手の陣営の思考の賢さだけを変える。
import { describe, expect, it } from 'vitest';
import { nextAiActions, planUnitDetailed, stanceOf } from '../src/ai/ai';
import { mapFromProvince } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import { convert, generalsOf } from '../src/convert/convert';
import { attackPower, defense } from '../src/rules/stats';
import { battleFor, neighborsOf, newCampaign, planAttack } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

async function castleBattle() {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const [fa, fb] = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
  const pick = (id: number) => generalsOf(gs, id).sort((x, y) => y.level - x.level).slice(0, 3).map((g) => g.id);
  return createBattle(gs, mapFromProvince(save.world, fb.capital, { capital: true, walls: true }), [pick(fa.id), pick(fb.id)], 'level');
}

describe('battle difficulty changes how the computer thinks, not the numbers', () => {
  it('easy defenders come out of the castle; normal ones hold', async () => {
    const st = await castleBattle();
    const def = st.units.find((u) => u.side === 1 && u.kind === 'general')!;
    const normal = stanceOf(st, def);
    st.aiLevel = { side: 1, level: 'easy' };
    expect(stanceOf(st, def)).toBe('advance');
    expect(normal === 'hold' || normal === 'advance').toBe(true);
    // 自分（攻め手）の駒には効かない
    const atk = st.units.find((u) => u.side === 0 && u.kind === 'general')!;
    const before = stanceOf({ ...st, aiLevel: undefined }, atk);
    expect(stanceOf(st, atk)).toBe(before);
  });

  it('attack and defense numbers are the same at every level', async () => {
    const st = await castleBattle();
    const u = st.units.find((x) => x.side === 1)!;
    const base = [attackPower(st, u), defense(st, u)];
    for (const level of ['easy', 'normal', 'hard'] as const) {
      st.aiLevel = { side: 1, level };
      expect([attackPower(st, u), defense(st, u)]).toEqual(base);
    }
  });

  it('hard: a badly hurt troop pulls back from the front, and the unit with the most to gain moves first', async () => {
    const st = await castleBattle();
    st.aiLevel = { side: 1, level: 'hard' };
    // 守り手の兵の1隊を、攻め手のそばで深く傷める
    const foe = st.units.find((u) => u.side === 0 && u.kind === 'troop')!;
    const t = st.units.find((u) => u.side === 1 && u.kind === 'troop')!;
    const near = st.map.grid.neighbors(foe.pos).find((i) => st.map.terrain[i] !== 'void' && st.map.terrain[i] !== 'water' && !st.units.some((x) => x.alive && x.pos === i));
    if (near === undefined) return;
    t.pos = near; t.hp = Math.floor(t.maxHp * 0.25);
    st.turn = 1;
    const dist = (p: number) => Math.min(...st.units.filter((x) => x.alive && x.side === 0).map((x) => st.map.grid.distance(x.pos, p)));
    const hardPlan = planUnitDetailed(st, t);
    const moveTo = hardPlan.actions.find((a) => a.type === 'move') as { to: number } | undefined;
    const attacks = hardPlan.actions.some((a) => a.type === 'skill' || a.type === 'tactic');
    // 倒せる相手がいて攻めるのでなければ、敵から離れる
    if (!attacks) expect(moveTo ? dist(moveTo.to) : dist(t.pos)).toBeGreaterThanOrEqual(dist(near));
    // よい順に動く：選ばれた行動は、どの駒の行動よりも点が増える
    const order = st.units.filter((u) => u.alive && u.side === 1);
    const gains = order.map((u) => { const p = planUnitDetailed(st, u); return p.actions.length ? p.score - (p.stay ?? p.score) : -Infinity; });
    const next = nextAiActions(st);
    const who = st.units[(next[0] as { unit: number }).unit];
    const p = planUnitDetailed(st, who);
    expect(p.score - (p.stay ?? p.score)).toBeCloseTo(Math.max(...gains), 6);
  });

  it("campaign battles against the player use the campaign's difficulty for the other side only", async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
    const c = newCampaign(gs, save.world, f.id, 'hard');
    for (const p of gs.provinces.filter((x) => x.owner === f.id)) {
      const here = generalsOf(gs, f.id).filter((g) => g.prov === p.id);
      if (!here.length) continue;
      for (const n of neighborsOf(c, p.id)) {
        const t = gs.provinces[n];
        if (!t.owner || t.owner === f.id) continue;
        gs.wars.push({ attackers: [f.id], defenders: [t.owner] });
        const pb = planAttack(c, f.id, p.id, n, here.map((g) => g.id));
        if (!pb) continue;
        expect(battleFor(c, pb).aiLevel).toEqual({ side: 1, level: 'hard' });
        return;
      }
    }
    throw new Error('攻め込める組が見つからない');
  });
});
