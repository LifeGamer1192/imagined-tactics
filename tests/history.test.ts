// 史実の出来事（P26）：hist-sim のシナリオの、まだ起きていない出来事を、年月が来たら起こす。勢力がそろわなければ起きない。
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { finishMonth, newCampaign, provincesOf, relation, type Campaign } from '../src/strategy/campaign';
import { acceptOffer, generalDies } from '../src/strategy/events';
import { chooseHistory, choiceOutcome, eventMonth, historyMonth, historyText, pendingEvents, type HEvent } from '../src/strategy/history';
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
/** 勢力 f の領で、シナリオの地名があるもの（prefer があればそれ、avoid は除く） */
function placeOf(c: Campaign, f: number, prefer = -1, avoid = -1): { key: string; prov: number } {
  const pp = (c.world as unknown as { scenario: { placeProv: Record<string, number> } }).scenario.placeProv;
  const all = Object.entries(pp).filter(([, p]) => c.gs.provinces[p]?.owner === f && p !== avoid).sort(([x], [y]) => x.localeCompare(y));
  const hit = all.find(([, p]) => p === prefer) ?? all[0];
  if (!hit) throw new Error('地名のある領が無い');
  return { key: hit[0], prov: hit[1] };
}
/** まだ無い家で、本拠の地が、ほかに領を2つ以上持つ家の本拠でない領にあるもの */
function newRealmTarget(c: Campaign): { def: { id: string; label: { ja: string }; capital?: string }; parentKey: string } {
  const sc = (c.world as unknown as { scenario: { placeProv: Record<string, number>; nationOf: Record<string, number>; data: { realms: { id: string; label: { ja: string }; capital?: string }[] } } }).scenario;
  for (const def of [...sc.data.realms].sort((x, y) => x.id.localeCompare(y.id))) {
    const nid = c.history.nations?.[def.id] ?? sc.nationOf[def.id];
    if (nid !== undefined && c.gs.factions[nid]) continue;
    const prov = sc.placeProv[def.capital ?? ''];
    const owner = prov === undefined ? 0 : c.gs.provinces[prov].owner, f = c.gs.factions[owner];
    if (!f || f.capital === prov || owner === c.player || provincesOf(c, owner).length < 3) continue;
    const parentKey = Object.keys(sc.nationOf).find((k) => sc.nationOf[k] === owner && !c.history.nations?.[k]);
    if (parentKey) return { def, parentKey };
  }
  throw new Error('新しい家を起こせる所が無い');
}
/** 互いに中立の2家を選ぶ。player が 1 なら、1つめの家を自分の家にする */
async function diplomacyCampaign(player: 0 | 1): Promise<{ c: Campaign; keys: [string, string] }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const N = (save.world as unknown as { scenario: Sc }).scenario.nationOf;
  const ks = Object.keys(N).filter((k) => gs.factions[N[k]] && !gs.factions[N[k]].overlord && gs.provinces.filter((p) => p.owner === N[k]).length >= 3).sort();
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

  it('BC scenarios: years written as "years before Christ" fire in the right order and month', async () => {
    const save = await loadFixture('rome_fid3_212bc'), gs = convert(save);
    const sc = (save.world as unknown as { scenario: Sc & { data: { bc: boolean } } }).scenario;
    expect(sc.data.bc).toBe(true);
    const ev = pendingEvents(save.world);
    // 前213年が前201年より先
    expect(ev[0].y).toBeGreaterThan(ev.at(-1)!.y);
    const c = newCampaign(gs, save.world, 0);
    finishMonth(c);
    const now = c.gs.year * 12 + c.gs.month;
    for (const id of c.history.done) expect(eventMonth(sc, ev.find((e) => e.id === id)!)).toBeLessThanOrEqual(now);
    // 春秋：月の書かれていない出来事が、始めの月にまとめて起きることはない
    const s2 = await loadFixture('shunju_fid5_259bc'), c2 = newCampaign(convert(s2), s2.world, 0);
    finishMonth(c2);
    expect(c2.history.done.length).toBeLessThan(5);
  }, 30_000);

  it('P28: land moves between other houses (cede, strip, annex, partition, rise)', async () => {
    const { c, keys } = await diplomacyCampaign(0);
    const gs = c.gs, N = nationOf(c), [ka, kb] = keys, a = N[ka], b = N[kb];
    const place = placeOf(c, b);
    fire(c, [['cede', kb, ka, [place.key]]]);
    expect(gs.provinces[place.prov].owner).toBe(a);
    fire(c, [['cede', '*', kb, [place.key]]]);
    expect(gs.provinces[place.prov].owner).toBe(b);
    // 残す領のほかを渡す
    const keep = placeOf(c, b, gs.factions[b].capital);
    fire(c, [['strip', kb, ka, [keep.key]]]);
    expect(provincesOf(c, b).map((p) => p.id)).toEqual([keep.prov]);
    // 丸ごと併せる：武将も移る
    const theirs = generalsOf(gs, b).map((g) => g.id);
    fire(c, [['annex', ka, kb]]);
    expect(gs.factions[b]).toBeUndefined();
    expect(theirs.every((id) => !gs.generals[id] || gs.generals[id].faction === a)).toBe(true);
    // 新しい家が分かれて起こる：当主・兵・色・領を持ち、あとの出来事からも名で呼べる
    const r = newRealmTarget(c);
    fire(c, [['partition', r.parentKey, [r.def.id]], ['ally', r.def.id, r.parentKey]]);
    const nid = c.history.nations![r.def.id];
    const nf = gs.factions[nid];
    expect(nf.name.ja).toBe(r.def.label.ja);
    expect(provincesOf(c, nid).length).toBeGreaterThan(0);
    expect(gs.generals[nf.lordId]?.isLord).toBe(true);
    expect(gs.generals[nf.lordId].troops.length).toBeGreaterThan(0);
    expect(relation(c, nid, N[r.parentKey])).toBe('ally');
    expect(provincesOf(c, N[r.parentKey]).length).toBeGreaterThan(0);
    // 奪って起こる家は、奪われた家と戦になる
    const r2 = newRealmTarget(c);
    fire(c, [['rise', r2.def.id, [r2.def.capital]]]);
    const rid = c.history.nations![r2.def.id];
    expect(gs.factions[rid]).toBeTruthy();
    expect(relation(c, rid, N[r2.parentKey])).toBe('war');
    // 月を進めても壊れない
    for (let m = 0; m < 3; m++) finishMonth(c);
    expect(c.over).toBeNull();
    // 併せられて無くなった家も、本文では家の名で呼ぶ
    expect(historyText(c, { id: 'x', y: 0, m: 1, ja: '{n_' + kb + '}' }, N)).not.toBe(kb);
  });

  it("P28: land moves touching the player's house are a choice; refusing a demand means war, refusing a new house raises unrest", async () => {
    const { c, keys } = await diplomacyCampaign(1);
    const gs = c.gs, N = nationOf(c), me = c.player, [kme, ko] = keys, other = N[ko];
    // 求められる：断ると戦
    const mine = placeOf(c, me, -1, gs.factions[me].capital);
    fire(c, [['cede', kme, ko, [mine.key]]]);
    expect(gs.provinces[mine.prov].owner).toBe(me);
    const ch = c.history.choices!.at(-1)!;
    expect(ch).toMatchObject({ kind: 'cede', to: other, provs: [mine.prov] });
    expect(c.log.filter((l) => l.key === 'history').at(-1)!.vars.choice).toBe(1);
    chooseHistory(c, ch.id, false);
    expect(gs.provinces[mine.prov].owner).toBe(me);
    expect(relation(c, me, other)).toBe('war');
    // 受けると渡す
    fire(c, [['cede', kme, ko, [mine.key]]]);
    chooseHistory(c, c.history.choices!.at(-1)!.id, true);
    expect(gs.provinces[mine.prov].owner).toBe(other);
    // 受け取る：選べる
    fire(c, [['cede', ko, kme, [mine.key]]]);
    expect(c.history.choices!.at(-1)!.kind).toBe('give');
    chooseHistory(c, c.history.choices!.at(-1)!.id, true);
    expect(gs.provinces[mine.prov].owner).toBe(me);
    // 本拠は渡さない
    const cap = gs.factions[me].capital;
    fire(c, [['strip', kme, ko, []]]);
    chooseHistory(c, c.history.choices!.at(-1)!.id, true);
    expect(provincesOf(c, me).map((p) => p.id)).toEqual([cap]);
    // 選ばずに月が過ぎると断ったことになる。併せられるのを断れば戦、受ければ従う
    gs.truces = []; gs.wars = [];
    fire(c, [['annex', ko, kme]]);
    c.gs.tick += 99;
    historyMonth(c, hooks(c));
    expect(c.history.choices!.length).toBe(0);
    expect(relation(c, me, other)).toBe('war');
    expect(c.log.some((l) => l.key === 'historyChoice' && String(l.vars.result).includes('断った'))).toBe(true);
    fire(c, [['annex', ko, kme]]);
    chooseHistory(c, c.history.choices!.at(-1)!.id, true);
    expect(gs.factions[me].overlord).toBe(other);
    expect(gs.factions[me]).toBeTruthy();
  });

  it('P28: a new house rising from the player is a choice; refusing raises unrest', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const probe = newCampaign(gs, save.world, 0), r = newRealmTarget(probe);
    const c = newCampaign(gs, save.world, nationOf(probe)[r.parentKey]);
    c.history.done = pendingEvents(save.world).map((e) => e.id);
    const prov = (c.world as unknown as { scenario: { placeProv: Record<string, number> } }).scenario.placeProv[r.def.capital!];
    const before = gs.provinces[prov].unrest;
    fire(c, [['rise', r.def.id, [r.def.capital]]]);
    const ch = c.history.choices!.at(-1)!;
    expect(ch.kind).toBe('rise');
    expect(choiceOutcome(c, ch, false)).toContain('不満');
    chooseHistory(c, ch.id, false);
    expect(gs.provinces[prov].unrest).toBe(Math.min(100, before + 30));
    expect(gs.provinces[prov].owner).toBe(c.player);
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
