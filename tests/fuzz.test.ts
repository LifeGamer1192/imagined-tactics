// 穴を探すためのテスト：いろいろな組み合わせを数多く回して、壊れないことと、状態のつじつまが合っていることを確かめる。
import { describe, expect, it } from 'vitest';
import { autoBattle } from '../src/ai/ai';
import { mapFromProvince } from '../src/battle/map';
import { applyBattleResult } from '../src/battle/result';
import { createBattle } from '../src/battle/setup';
import type { BattleState } from '../src/battle/types';
import { convert, generalsOf } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D, setVariant } from '../src/data/db';
import { fromJSON, restore, snapshot, toJSON } from '../src/persist/save';
import { autoMonth, newCampaign, provincesOf, troopLoad } from '../src/strategy/campaign';
import { FIXTURES, loadFixture } from './helpers';

function checkBattle(st: BattleState, label: string): void {
  expect(st.winner, label).not.toBeNull();
  const alive = st.units.filter((u) => u.alive);
  expect(new Set(alive.map((u) => u.pos)).size, `${label} 位置の重なり`).toBe(alive.length);
  for (const u of st.units) {
    for (const v of [u.hp, u.mp, u.pos, u.str, u.int, u.agi, u.def, u.expGained]) expect(Number.isFinite(v), `${label} ${u.name}`).toBe(true);
    expect(u.hp, `${label} ${u.name} 体力`).toBeGreaterThanOrEqual(0);
    expect(u.hp).toBeLessThanOrEqual(u.maxHp);
    expect(u.mp).toBeGreaterThanOrEqual(0);
    expect(u.mp).toBeLessThanOrEqual(u.maxMp);
    if (u.alive) {
      expect(u.pos, `${label} ${u.name} 盤の外`).toBeGreaterThanOrEqual(0);
      expect(u.pos).toBeLessThan(st.map.grid.n);
      // 入れない地形に立っていない
      expect(D.terrain.moveCost[st.map.terrain[u.pos]][u.affinity], `${label} ${u.name} が ${st.map.terrain[u.pos]} にいる`).not.toBeNull();
    }
  }
  // 勝った側には、生きている武将がいる（時間切れを除く）
  if (!st.log.some((l) => l.key === 'timeup')) expect(st.units.some((u) => u.alive && u.kind === 'general' && u.home === st.winner), label).toBe(true);
}

describe('fuzz: battles', () => {
  for (const f of FIXTURES) {
    it(`random pairs, sizes and battlefields: ${f}`, async () => {
      const save = await loadFixture(f);
      const rng = new RNG(4242);
      for (let i = 0; i < 24; i++) {
        const gs = convert(save, { variant: i % 2 ? 'cn' : 'jp' });
        const facs = Object.values(gs.factions);
        const fa = rng.pick(facs);
        let fb = rng.pick(facs);
        for (let k = 0; k < 8 && fb.id === fa.id; k++) fb = rng.pick(facs);
        if (fa.id === fb.id) continue;
        // 人数も戦場もばらばらにする（1人だけの出陣、相手の本拠でない領、など）
        const pick = (id: number) => rng.shuffle(generalsOf(gs, id).map((g) => g.id)).slice(0, rng.int(1, 3));
        const prov = rng.pick(gs.provinces).id;
        const st = createBattle(gs, mapFromProvince(save.world, prov, { capital: rng.chance(0.5), walls: rng.chance(0.3) }), [pick(fa.id), pick(fb.id)], `fuzz${i}`);
        const label = `${f}#${i} ${fa.name.ja} 対 ${fb.name.ja} @${prov}`;
        autoBattle(st);
        checkBattle(st, label);
        const sum = applyBattleResult(gs, st);
        for (const l of sum.levelUps) expect(l.to - l.from, `${label} ${l.name} のレベル上昇`).toBeGreaterThan(0);   // 上がり幅に上限は無い（大物を倒せば一気に上がる）
        for (const g of Object.values(gs.generals)) {
          expect(g.level).toBeLessThanOrEqual(30);
          for (const t of g.troops) { expect(t.level).toBeLessThanOrEqual(30); expect(Number.isFinite(t.stats.hp)).toBe(true); }
        }
      }
      setVariant('jp');
    }, 180000);
  }

  it('a general with no troops, and a general alone against a full army', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    const gs = convert(save);
    const [fa, fb] = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
    const a = generalsOf(gs, fa.id)[0], b = generalsOf(gs, fb.id).slice(0, 3);
    a.troops = [];
    const st = autoBattle(createBattle(gs, mapFromProvince(save.world, fb.capital, { capital: true }), [[a.id], b.map((g) => g.id)], 'alone'));
    checkBattle(st, 'alone');
    const st2 = autoBattle(createBattle(gs, mapFromProvince(save.world, fb.capital), [[a.id], [b[0].id]], 'duel'));
    checkBattle(st2, 'duel');
  });
});

describe('fuzz: campaign', () => {
  it('five years on every save, saving and loading on the way, stays consistent', async () => {
    for (const f of FIXTURES) {
      const save = await loadFixture(f);
      let c = newCampaign(convert(save), save.world, 0);
      for (let m = 0; m < 60; m++) {
        autoMonth(c);
        if (m % 20 === 19) c = restore(fromJSON(toJSON(snapshot(c))));   // 途中で保存して読み直す
        const gs = c.gs;
        for (const fac of Object.values(gs.factions)) {
          expect(provincesOf(c, fac.id).length, `${f} ${m} ${fac.name.ja}`).toBeGreaterThan(0);
          expect(gs.provinces[fac.capital].owner).toBe(fac.id);
          expect(Number.isFinite(fac.supply) && fac.supply >= 0, `${f} ${fac.name.ja} 兵糧`).toBe(true);
        }
        for (const g of Object.values(gs.generals)) {
          expect(g.faction === 0 || !!gs.factions[g.faction], `${f} ${m} ${g.name.ja}`).toBe(true);
          if (g.faction) expect(gs.provinces[g.prov]?.owner).toBe(g.faction);
          expect(troopLoad(g)).toBeLessThanOrEqual(g.command);
        }
      }
      expect(c.months).toBe(60);
      expect(c.gs.month).toBeGreaterThanOrEqual(1); expect(c.gs.month).toBeLessThanOrEqual(12);
    }
  }, 600000);
});
