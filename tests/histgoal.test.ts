// 史実の目標（P76）：自分の家が仕掛ける史実の戦は、戦を起こさず目標になる。期限までに相手の領を取ればほうび、過ぎれば消える
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { generalDies } from '../src/strategy/events';
import { goalsMonth, historyMonth } from '../src/strategy/history';
import { newCampaign, note, provincesOf, relation, S, type Campaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

async function setup() {
  const save = structuredClone(await loadFixture('sengoku_fid5_1575')), gs = convert(save);
  const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!.id;
  const foe = Object.values(gs.factions).find((f) => f.name.ja === '武田家')!.id;
  const c = newCampaign(gs, save.world, me);
  const sc = (c.world as unknown as { scenario: { data: { events: unknown[] }; nationOf: Record<string, number> } }).scenario;
  const key = (id: number) => Object.entries(sc.nationOf).find(([, v]) => v === id)![0];
  sc.data.events.push({ id: 'test_goal', y: gs.year, m: gs.month, imp: 3, ja: 'ためしの戦', do: [['war', key(me), key(foe), { ja: 'ためし攻め', en: '' }]] });
  return { c, me, foe };
}
const hooks = (c: Campaign) => ({ dies: (g: Parameters<typeof generalDies>[1]) => generalDies(c, g), note: (k: string, v: Record<string, string | number>) => note(c, k, v) });

describe('historical goals', () => {
  it("the player's historical war becomes a goal instead of a war; taking one province pays the reward", async () => {
    const { c, me, foe } = await setup();
    historyMonth(c, hooks(c));
    expect(relation(c, me, foe)).not.toBe('war');
    const g = c.history.goals?.[0];
    expect(g?.name).toBe('ためし攻め');
    expect(g?.target).toBe(foe);
    const p0 = c.gs.factions[me].prestige ?? 0, s0 = c.gs.factions[me].supply;
    goalsMonth(c);
    expect(c.history.goals).toHaveLength(1);
    c.gs.provinces[provincesOf(c, foe)[0].id].owner = me;
    goalsMonth(c);
    expect(c.history.goals).toHaveLength(0);
    expect(c.gs.factions[me].prestige).toBe(p0 + S.histGoal.prestige);
    expect(c.gs.factions[me].supply).toBe(s0 + S.histGoal.supply);
    expect(c.log.some((e) => e.key === 'histGoalDone')).toBe(true);
  });

  it('a goal disappears without penalty when the time runs out', async () => {
    const { c, me } = await setup();
    historyMonth(c, hooks(c));
    const p0 = c.gs.factions[me].prestige ?? 0;
    c.gs.tick += S.histGoal.months;
    goalsMonth(c);
    expect(c.history.goals).toHaveLength(0);
    expect(c.gs.factions[me].prestige ?? 0).toBe(p0);
    expect(c.log.some((e) => e.key === 'histGoalMissed')).toBe(true);
  });
});
