// 史実の出来事（P26）：hist-sim のシナリオの、まだ起きていない出来事を、年月が来たら起こす。勢力がそろわなければ起きない。
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { finishMonth, newCampaign, type Campaign } from '../src/strategy/campaign';
import { generalDies } from '../src/strategy/events';
import { historyMonth, historyText, pendingEvents } from '../src/strategy/history';
import { loadFixture } from './helpers';

const hooks = (c: Campaign) => ({ dies: (g: Parameters<typeof generalDies>[1]) => generalDies(c, g), note: (key: string, vars: Record<string, string | number>) => { c.log.push({ key, vars }); } });
const nationOf = (c: Campaign) => (c.world as unknown as { scenario: { nationOf: Record<string, number> } }).scenario.nationOf;

describe('historical events', () => {
  it('reads the events that have not happened yet from the save', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    const ev = pendingEvents(save.world);
    expect(ev.length).toBeGreaterThan(50);
    expect(ev.every((e, i) => i === 0 || ev[i - 1].y * 12 + ev[i - 1].m <= e.y * 12 + e.m)).toBe(true);
    // シナリオの無い世界には無い
    expect(pendingEvents((await loadFixture('invented_archipelago_y30')).world)).toEqual([]);
  });

  it('fires an event when its month comes: Nagashino cuts the Takeda armies, and the text names the houses', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    const N = nationOf(c), takeda = gs.factions[N.takeda], oda = gs.factions[N.oda];
    expect(takeda && oda).toBeTruthy();
    const before = generalsOf(gs, takeda.id).reduce((s, g) => s + g.troops.length, 0);
    gs.year = 1575; gs.month = 6;
    historyMonth(c, hooks(c));
    const after = generalsOf(gs, takeda.id).reduce((s, g) => s + g.troops.length, 0);
    expect(after).toBeLessThan(before);
    const line = c.log.find((l) => l.key === 'history' && String(l.vars.text).includes('長篠'))!;
    expect(line).toBeTruthy();
    expect(String(line.vars.text)).toContain(oda.name.ja);
    expect(String(line.vars.text)).not.toMatch(/\{|\[\[/);
    // 二度は起きない
    const n = c.log.filter((l) => l.key === 'history').length;
    historyMonth(c, hooks(c));
    expect(c.log.filter((l) => l.key === 'history').length).toBe(n);
  });

  it("does not touch the player's own house (news only), and skips events whose houses are gone", async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const N0 = (save.world as unknown as { scenario: { nationOf: Record<string, number> } }).scenario.nationOf;
    const c = newCampaign(gs, save.world, N0.takeda);
    const before = generalsOf(gs, N0.takeda).reduce((s, g) => s + g.troops.length, 0);
    gs.year = 1575; gs.month = 6;
    historyMonth(c, hooks(c));
    expect(generalsOf(gs, N0.takeda).reduce((s, g) => s + g.troops.length, 0)).toBe(before);
    expect(c.log.some((l) => l.key === 'history' && l.vars.spared === 1)).toBe(true);
    // 畠山家が無ければ、畠山家にかかわる出来事は起きない
    const c2 = newCampaign(convert(save), save.world, 0);
    const hk = N0.hatakeyama;
    if (hk) delete c2.gs.factions[hk];
    c2.gs.year = 1575; c2.gs.month = 5;
    historyMonth(c2, hooks(c2));
    expect(c2.log.some((l) => l.key === 'history' && String(l.vars.text).includes('高屋'))).toBe(false);
  });

  it('runs inside the monthly turn without breaking the campaign', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    for (let m = 0; m < 8; m++) finishMonth(c);
    expect(c.log.filter((l) => l.key === 'history').length).toBeGreaterThan(0);
    expect(c.history.done.length).toBeGreaterThan(0);
    // 本文の書き方
    const ev = pendingEvents(save.world)[0];
    expect(historyText(c, ev, nationOf(c))).not.toMatch(/\{[nr]_/);
  });
});
