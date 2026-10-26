// 深手の記録に「負わされた相手」（とどめの将を先に、あとはダメージの多い順に3人まで）
import { describe, expect, it } from 'vitest';
import { autoBattle } from '../src/ai/ai';
import { applyBattleResult } from '../src/battle/result';
import { convert } from '../src/convert/convert';
import { battleFor, newCampaign, planAttack, provincesOf, resolveBattle, neighborsOf, generalsAt } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

describe('who wounded a general', () => {
  it('beaten generals carry up to 3 enemy generals, the finisher first, and the wound log names them', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    let checked = 0;
    for (let seed = 0; seed < 12 && checked < 2; seed++) {
      const gs = convert(structuredClone(save));
      const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!.id;
      const c = newCampaign(gs, save.world, 0);
      // 織田家の領から、隣の他家の領へ、武将3人で攻める
      let pb = null;
      for (const p of provincesOf(c, me)) {
        const to = neighborsOf(c, p.id).find((n) => gs.provinces[n].owner && gs.provinces[n].owner !== me && generalsAt(c, n, gs.provinces[n].owner).length);
        const atk = generalsAt(c, p.id, me).slice(0, 3).map((g) => g.id);
        if (to !== undefined && atk.length) { pb = planAttack(c, me, p.id, to, atk); if (pb) break; }
      }
      expect(pb).toBeTruthy();
      const st = autoBattle(battleFor(c, pb!));
      const sides = new Map(st.units.map((u) => [u.generalId, u.side]));
      const sum = applyBattleResult(structuredClone(gs), structuredClone(st));
      for (const id of sum.beatenIds) {
        const by = sum.beatenBy?.[id] ?? [];
        expect(by.length).toBeLessThanOrEqual(3);
        for (const x of by) expect(sides.get(x)).not.toBe(sides.get(id));
        const u = st.units.find((v) => v.generalId === id && v.kind === 'general')!;
        if (u.killedBy) expect(by[0]).toBe(u.killedBy);
        if (by.length) checked++;
      }
      // 戦略の記録にも出る
      const mark = c.log.length;
      resolveBattle(c, pb!, st);
      const w = c.log.slice(mark).filter((e) => e.key === 'wounded');
      if (w.some((e) => String(e.vars.by).startsWith('・相手：'))) checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 60000);
});
