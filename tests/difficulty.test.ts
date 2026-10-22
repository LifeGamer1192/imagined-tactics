// 難しさ「非常に難しい」「鬼」（P64）：相手の武将のレベル・相手の収入・戦闘での相手の能力（原因つき）・知らない値は「ふつう」
import { describe, expect, it } from 'vitest';
import { AI } from '../src/ai/personality';
import { createBattle, setAiLevel } from '../src/battle/setup';
import { mapFromProvince } from '../src/battle/map';
import { convert, generalsOf } from '../src/convert/convert';
import { newCampaign, S } from '../src/strategy/campaign';
import { DIFFICULTIES, validDifficulty } from '../src/strategy/config';
import { loadFixture } from './helpers';

const start = async (d: 'normal' | 'veryHard' | 'oni') => {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const player = Object.values(gs.factions)[0].id;
  return { c: newCampaign(gs, save.world, player, d), player };
};

describe('difficulty', () => {
  it('every difficulty has strategy numbers and a battle level', () => {
    for (const d of DIFFICULTIES) { expect(S.difficulty[d]?.name).toBeTruthy(); expect(AI.levels[d]).toBeTruthy(); }
    expect(validDifficulty('oni')).toBe('oni');
    expect(validDifficulty('nightmare')).toBe('normal');
    expect(validDifficulty(undefined)).toBe('normal');
  });

  it('oni raises the starting level of rival generals only, and their income', async () => {
    const a = await start('normal'), b = await start('oni');
    const add = S.difficulty.oni.aiGeneralLevel!;
    for (const g of Object.values(a.c.gs.generals)) {
      const h = b.c.gs.generals[g.id];
      if (!g.faction || !h) continue;
      expect(h.level).toBe(g.level + (g.faction === a.player ? 0 : add));
      if (g.faction !== a.player) expect(h.stats.str).toBeGreaterThanOrEqual(g.stats.str);
    }
    const rival = Object.values(a.c.gs.factions).find((f) => f.id !== a.player && f.income > 50)!;
    expect(b.c.gs.factions[rival.id].income / rival.income).toBeCloseTo(S.difficulty.oni.aiIncome!, 1);
    expect(b.c.gs.factions[a.player].income / a.c.gs.factions[a.player].income).toBeCloseTo(S.difficulty.oni.playerIncome, 1);
  });

  it('in battle, oni raises the rival side by statMult and says why', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const [f0, f1] = Object.values(gs.factions);
    const map = mapFromProvince(save.world, f1.capital, { capital: true, from: f0.capital });
    const sides: [string[], string[]] = [generalsOf(gs, f0.id).slice(0, 2).map((g) => g.id), generalsOf(gs, f1.id).slice(0, 2).map((g) => g.id)];
    const plain = createBattle(gs, map, sides, 'd'), hard = createBattle(gs, map, sides, 'd');
    setAiLevel(hard, 1, 'oni');
    const m = AI.levels.oni.statMult!;
    for (const u of plain.units) {
      const v = hard.units[u.id];
      if (u.side === 1) {
        expect(v.maxHp).toBe(Math.round(u.maxHp * m));
        expect(v.str).toBe(Math.round(u.str * m));
        expect(v.traitFx?.some((f) => f.why === '難しさ（鬼）' && f.stat === 'str')).toBe(true);
      } else expect(v.maxHp).toBe(u.maxHp);
    }
    const n = createBattle(gs, map, sides, 'd');
    setAiLevel(n, 1, 'hard');
    expect(n.units.map((u) => u.maxHp)).toEqual(plain.units.map((u) => u.maxHp));
  });
});
