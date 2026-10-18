// 将の列伝：hist-sim の記録・すでに起きた史実の出来事・解説記事から集める。これから起きる出来事は出さない
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { biography } from '../src/strategy/biography';
import { generalDies } from '../src/strategy/events';
import { newCampaign } from '../src/strategy/campaign';
import { historyMonth, pendingEvents, type HEvent } from '../src/strategy/history';
import { loadFixture } from './helpers';

describe('biography', () => {
  it("builds a lord's biography from the records, and shows historical events only after they happen", async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    const g = Object.values(gs.generals).find((x) => x.name.ja === '織田信長')!;
    expect(g).toBeTruthy();
    const b = biography(c, g);
    expect(b.facts.join()).toContain('当主');
    expect(b.reigns.length).toBeGreaterThan(0);
    expect(b.family.join()).toContain('配偶者');
    // 縁の呼び名は hist-sim と同じ向き（信長は柴田勝家の主君なので、勝家は「家臣」）。書き添えに印は残さない
    expect(b.ties.some((t) => t.startsWith('家臣：柴田勝家'))).toBe(true);
    expect(b.ties.every((t) => !t.includes('[['))).toBe(true);
    // 解説記事に名前が出る（鉄砲の話など）
    expect(b.articles.length).toBeGreaterThan(0);
    expect(b.articles.every((a) => !a.text.includes('[['))).toBe(true);
    // 名前の出る史実の出来事は、起きるまでは出ず、起きたら出る
    const sc = (save.world as unknown as { scenario: { data: { events: HEvent[] } } }).scenario;
    const ev = pendingEvents(save.world).find((e) => e.ja.includes('[[p:') && Object.values(gs.generals).some((x) => e.ja.includes(`[[p:${x.name.ja}`)))!;
    const who = Object.values(gs.generals).find((x) => ev.ja.includes(`[[p:${x.name.ja}`))!;
    expect(sc.data.events.length).toBeGreaterThan(0);
    expect(biography(c, who).events.length).toBe(0);
    gs.year = ev.y; gs.month = ev.m ?? 1;
    historyMonth(c, { dies: (x) => generalDies(c, x), note: (key, vars) => { c.log.push({ key, vars }); } });
    const after = biography(c, who);
    expect(after.events.length).toBeGreaterThan(0);
    expect(after.events.every((e) => !/\{|\[\[/.test(e.text))).toBe(true);
  });

  it('works for generals with no hist-sim record (garrison captains, raised officers)', async () => {
    const save = await loadFixture('invented_archipelago_y30'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    for (const g of Object.values(gs.generals).slice(0, 20)) {
      const b = biography(c, g);
      expect(b.facts.length).toBeGreaterThan(0);
    }
  });
});
