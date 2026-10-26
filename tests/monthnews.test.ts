// 月の知らせ（P79）：療養明け・昇進できる（1回だけ）・遷都を書き留める
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { generalPromotions } from '../src/rules/growth';
import { finishMonth, newCampaign, provincesOf, startRelocation, type Campaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

async function setup(): Promise<{ c: Campaign; me: number }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(structuredClone(save));
  const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!.id;
  return { c: newCampaign(gs, save.world, me), me };
}
const keys = (c: Campaign, from: number, key: string) => c.log.slice(from).filter((e) => e.key === key);

describe('month news', () => {
  it('notes recovery from wounds for own generals only', async () => {
    const { c, me } = await setup();
    const mine = Object.values(c.gs.generals).find((g) => g.faction === me)!;
    const other = Object.values(c.gs.generals).find((g) => g.faction && g.faction !== me)!;
    c.wounded[mine.id] = c.gs.tick + 1; c.wounded[other.id] = c.gs.tick + 1;
    const mark = c.log.length;
    finishMonth(c);
    expect(keys(c, mark, 'recovered').map((e) => e.vars.name)).toEqual([mine.name.ja]);
  });

  it('tells once that a general can be promoted', async () => {
    const { c, me } = await setup();
    for (const x of Object.values(c.gs.generals)) if (x.faction === me) { x.level = 99; x.mastery[x.classId] = 99; }
    const g = Object.values(c.gs.generals).find((x) => x.faction === me && generalPromotions(x).some((p) => p.ok))!;
    expect(g).toBeTruthy();
    let mark = c.log.length;
    finishMonth(c);
    expect(keys(c, mark, 'canPromote').some((e) => e.vars.name === g.name.ja)).toBe(true);
    mark = c.log.length;
    finishMonth(c);
    expect(keys(c, mark, 'canPromote').some((e) => e.vars.name === g.name.ja)).toBe(false);
  });

  it('notes when the capital move is finished', async () => {
    const { c, me } = await setup();
    const f = c.gs.factions[me];
    f.supply = 999999;
    const to = provincesOf(c, me).find((p) => p.id !== f.capital)!.id;
    expect(startRelocation(c, me, to)).toBe(true);
    const mark = c.log.length;
    for (let i = 0; i < 4 && f.capital !== to; i++) finishMonth(c);
    expect(f.capital).toBe(to);
    expect(keys(c, mark, 'capitalMoved').length).toBe(1);
  });
});
