// 兆し（P74）：自分の家の人が史実で非業の死を遂げる出来事の前に兆しが出て、備える／史実のままで運命が変わる
import { afterEach, describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { generalDies } from '../src/strategy/events';
import { chooseOmen, historyMonth } from '../src/strategy/history';
import { newCampaign, note, S, type Campaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

const saved = structuredClone(S.omen);
afterEach(() => { Object.assign(S.omen, structuredClone(saved)); });

/** 織田家で始め、in か月後に、自分の家の将（または当主）が cause で世を去る出来事を足す */
async function setup(op: 'dies' | 'rulerDies', cause = 'assassination', inMonths = 2) {
  const save = structuredClone(await loadFixture('sengoku_fid5_1575')), gs = convert(save);
  const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!.id;
  const c = newCampaign(gs, save.world, me);
  const sc = (c.world as unknown as { scenario: { data: { events: unknown[] }; nationOf: Record<string, number> } }).scenario;
  const key = Object.entries(sc.nationOf).find(([, v]) => v === me)?.[0] ?? 'oda';
  const target = op === 'dies' ? Object.values(gs.generals).find((g) => g.faction === me && !g.isLord)! : gs.generals[gs.factions[me].lordId];
  const at = gs.year * 12 + gs.month + inMonths, y = Math.floor((at - 1) / 12), m = ((at - 1) % 12) + 1;
  sc.data.events.push({ id: 'test_omen', y, m, imp: 3, ja: 'ためしの出来事', do: [op === 'dies' ? ['dies', target.name.ja, cause] : ['rulerDies', key, cause, target.name.ja]] });
  return { c, target };
}
const hooks = (c: Campaign) => ({ dies: (g: Parameters<typeof generalDies>[1]) => generalDies(c, g), note: (k: string, v: Record<string, string | number>) => note(c, k, v) });
/** 月を1つ進めて、史実の出来事を見る */
const step = (c: Campaign): void => { const gs = c.gs; gs.month++; if (gs.month > 12) { gs.month = 1; gs.year++; } gs.tick++; historyMonth(c, hooks(c)); };

describe('omens', () => {
  it('an omen appears before the event; choosing history lets it happen', async () => {
    const { c, target } = await setup('dies');
    historyMonth(c, hooks(c));
    const o = c.history.omens?.find((x) => x.ev === 'test_omen');
    expect(o?.gid).toBe(target.id);
    expect(c.log.some((e) => e.key === 'omen')).toBe(true);
    expect(chooseOmen(c, 'test_omen', target.id, 'accept')).toBe(true);
    step(c); step(c);
    expect(c.gs.generals[target.id]).toBeUndefined();
    expect(c.log.some((e) => e.key === 'omenFell')).toBe(true);
  });

  it('guarding costs supply, uses up the month, and (when it works) averts the death as a divergence', async () => {
    const { c, target } = await setup('dies');
    S.omen.avert = 1;
    historyMonth(c, hooks(c));
    const me = c.gs.factions[c.player], supply = me.supply;
    expect(chooseOmen(c, 'test_omen', target.id, 'guard')).toBe(true);
    expect(me.supply).toBe(supply - S.omen.cost);
    expect(c.moved.has(target.id)).toBe(true);
    step(c); step(c);
    expect(c.gs.generals[target.id]).toBeTruthy();
    expect(c.history.diverged).toContain('test_omen');
    expect(c.history.omens ?? []).toHaveLength(0);
  });

  it('unanswered omens count as guarding; a failed guard still kills', async () => {
    const a = await setup('dies');
    S.omen.avert = 1;
    historyMonth(a.c, hooks(a.c)); step(a.c); step(a.c);
    expect(a.c.gs.generals[a.target.id]).toBeTruthy();
    const b = await setup('dies');
    S.omen.avert = 0;
    historyMonth(b.c, hooks(b.c)); chooseOmen(b.c, 'test_omen', b.target.id, 'guard'); step(b.c); step(b.c);
    expect(b.c.gs.generals[b.target.id]).toBeUndefined();
  });

  it('the player lord gets an omen too; when it falls the house succeeds; other deaths of the player stay spared', async () => {
    const { c, target } = await setup('rulerDies', 'battle_wound');
    S.omen.avert = 0;
    historyMonth(c, hooks(c));
    expect(c.history.omens?.[0]?.gid).toBe(target.id);
    step(c); step(c);
    const f = c.gs.factions[c.player];
    expect(c.gs.generals[target.id]).toBeUndefined();
    expect(f.lordId).not.toBe(target.id);
    // 非業でない死（例：病）は今までどおり起きない
    const d = await setup('dies', 'illness');
    historyMonth(d.c, hooks(d.c)); step(d.c); step(d.c);
    expect(d.c.history.omens ?? []).toHaveLength(0);
    expect(d.c.gs.generals[d.target.id]).toBeTruthy();
  });
});
