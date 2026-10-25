// 史実の合戦（P75）：自分の家が出る合戦の出来事は止まり、戦う（勝ち負けで置き換え、史実と逆なら違う道）か見送る（今までどおり）
import { describe, expect, it } from 'vitest';
import { autoBattle } from '../src/ai/ai';
import { convert } from '../src/convert/convert';
import { generalDies } from '../src/strategy/events';
import { historyMonth } from '../src/strategy/history';
import { endHistoricBattle, historicBattle, newCampaign, note, S, skipHistoricBattle, type Campaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

/** 織田家で始め、今月、織田家と武田家の合戦（史実の勝者 winner）の出来事を足す。出来事の残りとして武田家の兵糧 −50 */
async function setup(winner: 0 | 1) {
  const save = structuredClone(await loadFixture('sengoku_fid5_1575')), gs = convert(save);
  const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!.id;
  const foe = Object.values(gs.factions).find((f) => f.name.ja === '武田家')!.id;
  const c = newCampaign(gs, save.world, me);
  const sc = (c.world as unknown as { scenario: { data: { events: unknown[]; battles: Record<string, unknown> }; nationOf: Record<string, number>; placeProv: Record<string, number> } }).scenario;
  const key = (id: number) => Object.entries(sc.nationOf).find(([, v]) => v === id)![0];
  const at = Object.entries(sc.placeProv).find(([, p]) => gs.provinces[p]?.owner === me)![0];
  sc.data.battles.test_battle = { name: { ja: 'ためしの合戦', en: 'Test' }, at, sides: [{ realm: key(me), generals: [] }, { realm: key(foe), generals: [] }], winner, deploy: { ja: '布陣の説明', en: '' } };
  const y = gs.year, m = gs.month;
  sc.data.events.push({ id: 'test_hb', y, m, imp: 3, ja: 'ためしの合戦の出来事', at, do: [['battle', 'test_battle'], ['add', key(foe), 'treasury', -50], ['add', key(foe), 'prestige', 10]] });
  return { c, me, foe };
}
const hooks = (c: Campaign) => ({ dies: (g: Parameters<typeof generalDies>[1]) => generalDies(c, g), note: (k: string, v: Record<string, string | number>) => note(c, k, v) });
const supplyOf = (c: Campaign, f: number) => c.gs.factions[f].supply;

describe('historic battles', () => {
  it('the event waits for the player; skipping runs it as before', async () => {
    const { c, foe } = await setup(0);
    const s0 = supplyOf(c, foe);
    historyMonth(c, hooks(c));
    expect(c.history.battles?.[0]?.ev).toBe('test_hb');
    expect(supplyOf(c, foe)).toBe(s0);
    skipHistoricBattle(c, 'test_hb');
    expect(c.history.battles ?? []).toHaveLength(0);
    expect(supplyOf(c, foe)).toBe(s0 - 50);
  });

  it('fighting builds a battle with both houses; winning as history did keeps the rest of the event and costs the foe troops', async () => {
    const { c, me, foe } = await setup(0);
    historyMonth(c, hooks(c));
    const made = historicBattle(c, 'test_hb')!;
    expect(made).toBeTruthy();
    const sides = [made.atk, made.def].map((ids) => new Set(ids.map((id) => c.gs.generals[id].faction)));
    expect(sides[made.mySide].has(me) && sides[1 - made.mySide].has(foe)).toBe(true);
    const s0 = supplyOf(c, foe), p0 = c.gs.factions[me].prestige ?? 0;
    const troops0 = Object.values(c.gs.generals).filter((g) => g.faction === foe).reduce((n, g) => n + g.troops.length, 0);
    made.st.winner = made.mySide;
    endHistoricBattle(c, 'test_hb', made.st, made.mySide);
    expect(supplyOf(c, foe)).toBe(s0 - 50);
    expect(c.gs.factions[me].prestige).toBe(p0 + S.histBattle.prestige);
    const troops1 = Object.values(c.gs.generals).filter((g) => g.faction === foe).reduce((n, g) => n + g.troops.length, 0);
    expect(troops1).toBeLessThan(troops0);
    expect(c.history.diverged ?? []).not.toContain('test_hb');
  });

  it('a result against history skips the rest and records a divergence; unanswered battles are skipped next month', async () => {
    const { c, foe } = await setup(0);
    historyMonth(c, hooks(c));
    const made = historicBattle(c, 'test_hb')!;
    const s0 = supplyOf(c, foe);
    made.st.winner = (1 - made.mySide) as 0 | 1;
    endHistoricBattle(c, 'test_hb', made.st, made.mySide);
    expect(supplyOf(c, foe)).toBe(s0);
    expect(c.history.diverged).toContain('test_hb');
    // 選ばずに月が過ぎた
    const b = await setup(0);
    historyMonth(b.c, hooks(b.c));
    const s1 = supplyOf(b.c, b.foe);
    b.c.gs.tick++; b.c.gs.month++;
    historyMonth(b.c, hooks(b.c));
    expect(b.c.history.battles ?? []).toHaveLength(0);
    expect(supplyOf(b.c, b.foe)).toBe(s1 - 50);
  });

  it('the battle can actually be fought to the end by the AI', async () => {
    const { c } = await setup(1);
    historyMonth(c, hooks(c));
    const made = historicBattle(c, 'test_hb')!;
    autoBattle(made.st);
    expect(made.st.winner === 0 || made.st.winner === 1).toBe(true);
    endHistoricBattle(c, 'test_hb', made.st, made.mySide);
    expect(c.log.some((e) => e.key === 'histBattleResult')).toBe(true);
  });
});
