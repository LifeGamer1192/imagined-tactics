// 史実の出来事（P26）：hist-sim のシナリオの、まだ起きていない出来事を、年月が来たら起こす。勢力がそろわなければ起きない。
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { finishMonth, newCampaign, relation, type Campaign } from '../src/strategy/campaign';
import { acceptOffer, generalDies } from '../src/strategy/events';
import { historyMonth, historyText, pendingEvents, type HEvent } from '../src/strategy/history';
import { loadFixture } from './helpers';

const hooks = (c: Campaign) => ({ dies: (g: Parameters<typeof generalDies>[1]) => generalDies(c, g), note: (key: string, vars: Record<string, string | number>) => { c.log.push({ key, vars }); } });
const nationOf = (c: Campaign) => (c.world as unknown as { scenario: { nationOf: Record<string, number> } }).scenario.nationOf;

type Sc = { nationOf: Record<string, number>; data: { events: HEvent[] } };
let seq = 0;
/** いまの月に起きる出来事を1つ足して起こす（見本のセーブは書き換えない） */
function fire(c: Campaign, ops: unknown[][]): void {
  const sc = (c.world as unknown as { scenario: Sc }).scenario;
  const ev: HEvent = { id: `test_${seq++}`, y: c.gs.year, m: c.gs.month, do: ops, ja: '試しの出来事' };
  c.world = { ...c.world, scenario: { ...sc, data: { ...sc.data, events: [...sc.data.events, ev] } } } as unknown as Campaign['world'];
  historyMonth(c, hooks(c));
}
/** 互いに中立の2家を選ぶ。player が 1 なら、1つめの家を自分の家にする */
async function diplomacyCampaign(player: 0 | 1): Promise<{ c: Campaign; keys: [string, string] }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const N = (save.world as unknown as { scenario: Sc }).scenario.nationOf;
  const ks = Object.keys(N).filter((k) => gs.factions[N[k]] && !gs.factions[N[k]].overlord).sort();
  const probe = newCampaign(gs, save.world, 0);
  for (const x of ks) for (const y of ks) {
    if (x === y || relation(probe, N[x], N[y]) !== 'neutral') continue;
    if (Object.values(gs.factions).some((f) => f.overlord === N[x] || f.overlord === N[y])) continue;
    const c = newCampaign(gs, save.world, player ? N[x] : 0);
    c.history.done = pendingEvents(save.world).map((e) => e.id);
    return { c, keys: [x, y] };
  }
  throw new Error('中立の2家が無い');
}

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

  it('P27: diplomacy between other houses happens as written (war, truce, alliance, its end, vassal, freedom, new name)', async () => {
    const { c, keys } = await diplomacyCampaign(0);
    const [ka, kb] = keys, N = nationOf(c), a = N[ka], b = N[kb];
    fire(c, [['war', ka, kb, { ja: '試しの戦', en: 'Test war' }]]);
    expect(relation(c, a, b)).toBe('war');
    expect(String(c.log.filter((l) => l.key === 'history').at(-1)!.vars.effects)).toContain('試しの戦');
    fire(c, [['truce', ka, kb, 2]]);
    expect(relation(c, a, b)).toBe('truce');
    expect(c.gs.truces.find((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a))!.until).toBe(c.gs.tick + 24);
    fire(c, [['ally', ka, kb]]);
    expect(relation(c, a, b)).toBe('ally');
    fire(c, [['unally', ka, kb]]);
    expect(relation(c, a, b)).toBe('neutral');
    fire(c, [['vassal', ka, kb]]);
    expect(c.gs.factions[b].overlord).toBe(a);
    fire(c, [['free', kb]]);
    expect(c.gs.factions[b].overlord).toBe(0);
    fire(c, [['relabel', ka, { ja: '試し家', en: 'Test clan' }]]);
    expect(c.gs.factions[a].name.ja).toBe('試し家');
  });

  it("P27: when the player's house is on the receiving side, it comes as an offer to accept or refuse; the player's own choices are not made for them", async () => {
    const { c, keys } = await diplomacyCampaign(1);
    const N = nationOf(c), me = c.player, [kme, ko] = [keys[0], keys[1]], other = N[ko];
    // 自分の家から仕掛ける戦は起こさない
    fire(c, [['war', kme, ko]]);
    expect(relation(c, me, other)).toBe('neutral');
    expect(c.log.filter((l) => l.key === 'history').at(-1)!.vars.spared).toBe(1);
    // 相手から仕掛けられる戦は起きる。停戦は申し込みとして来て、受けると史実の長さで結ばれる
    fire(c, [['war', ko, kme]]);
    expect(relation(c, me, other)).toBe('war');
    fire(c, [['truce', ko, kme, 3]]);
    expect(relation(c, me, other)).toBe('war');
    const o = c.offers.find((x) => x.from === other)!;
    expect(o).toMatchObject({ kind: 'truce', months: 36, hist: 1 });
    expect(acceptOffer(c, other)).toBe(true);
    expect(c.gs.truces.find((t) => t.a === other || t.b === other)!.until).toBe(c.gs.tick + 36);
    // 自分の家が他家に従うことは起こさない。他家が従ってくるときは申し込み（戦のあとでも受けられる）
    fire(c, [['vassal', ko, kme]]);
    expect(c.gs.factions[me].overlord).toBe(0);
    c.gs.truces = []; fire(c, [['war', ko, kme]]);
    fire(c, [['vassal', kme, ko]]);
    expect(c.offers.find((x) => x.from === other)?.kind).toBe('vassal');
    expect(acceptOffer(c, other)).toBe(true);
    expect(c.gs.factions[other].overlord).toBe(me);
    // 自分の家の名は変えない
    const name = c.gs.factions[me].name.ja;
    fire(c, [['relabel', kme, { ja: '試し家', en: 'Test clan' }]]);
    expect(c.gs.factions[me].name.ja).toBe(name);
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
