// 何人かで遊ぶ（1台を交代で。P120・P121）：人の家の持ち物は家ごと、コンピュータは人の家を動かさない、勝ち負け
import { describe, expect, it } from 'vitest';
import { convert, generalsOf } from '../src/convert/convert';
import { restore, snapshot } from '../src/persist/save';
import { endMonth, extinguish, finishMonth, humansOf, isHuman, multiplayer, newCampaign, provincesOf, resolveBattle, seatOf, switchSeat, type Campaign } from '../src/strategy/campaign';
import { acceptOffer } from '../src/strategy/events';
import { envoyPlan, sendEnvoy } from '../src/strategy/envoy';
import { relation } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

async function start(n = 2): Promise<{ c: Campaign; hs: number[] }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const facs = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
  const hs = facs.slice(0, n).map((f) => f.id);
  return { c: newCampaign(gs, save.world, hs[0], 'normal', hs), hs };
}
/** 月を1つ進める（人の家への攻めは、その場でおまかせで決着） */
function month(c: Campaign): void {
  for (const pb of endMonth(c)) resolveBattle(c, pb);
  finishMonth(c);
}

describe('hot-seat campaign (P120)', () => {
  it('starts with the humans in order, the first one on turn', async () => {
    const { c, hs } = await start(3);
    expect(multiplayer(c)).toBe(true);
    expect(humansOf(c)).toEqual(hs);
    expect(c.player).toBe(hs[0]);
    for (const f of hs) expect(isHuman(c, f)).toBe(true);
    expect(c.victory).toEqual({ kind: 'last' });
    expect(c.seatsAtStart).toBe(3);
  });

  it('each house keeps its own items, offers and scouting; switching swaps them', async () => {
    const { c, hs } = await start(2);
    c.items = { item_elite: 2 };
    const scoutA = { ...c.scout };
    switchSeat(c, hs[1]);
    expect(c.player).toBe(hs[1]);
    expect(c.items).toEqual({});
    c.items.item_promote = 1;
    // 偵察度は、その家から見た値（自分の領は100）
    for (const p of provincesOf(c, hs[1])) expect(c.scout?.[p.id] ?? 100).toBeGreaterThanOrEqual(0);
    expect(c.scout).not.toEqual(scoutA);
    switchSeat(c, hs[0]);
    expect(c.items).toEqual({ item_elite: 2 });
    expect(seatOf(c, hs[1]).items).toEqual({ item_promote: 1 });
  });

  it('the computer never moves a human house, and its battles wait for the humans', async () => {
    const { c, hs } = await start(2);
    const before = new Map(hs.map((f) => [f, generalsOf(c.gs, f).map((g) => `${g.id}@${g.prov}:${g.troops.length}`).sort().join(',')]));
    const pend = endMonth(c);
    // 人の家への攻めは、戦わずに返る（人が戦う）
    for (const pb of pend) expect(isHuman(c, pb.defender)).toBe(true);
    for (const f of hs) expect(generalsOf(c.gs, f).map((g) => `${g.id}@${g.prov}:${g.troops.length}`).sort().join(',')).toBe(before.get(f));
  });

  it('runs a year without errors and keeps both seats', async () => {
    const { c, hs } = await start(2);
    for (let m = 0; m < 12 && !c.over; m++) month(c);
    expect(c.months).toBeGreaterThan(0);
    for (const f of hs.filter((x) => c.gs.factions[x])) expect(humansOf(c)).toContain(f);
    expect(c.player).toBe(humansOf(c)[0]);
  });

  it('save and load keep the humans, the seats and whose turn it is', async () => {
    const { c, hs } = await start(2);
    c.items = { item_elite: 1 };
    switchSeat(c, hs[1]);
    c.turnDone = [hs[0]];
    const back = restore(snapshot(c));
    expect(back.humans).toEqual(hs);
    expect(back.player).toBe(hs[1]);
    expect(back.turnDone).toEqual([hs[0]]);
    expect(back.seats?.[hs[0]]?.items).toEqual({ item_elite: 1 });
    expect(snapshot(c).summary.faction).toContain('2人');
  });
});

describe('victory with several humans (P121)', () => {
  it('when every other human house falls, the last one wins', async () => {
    const { c, hs } = await start(2);
    // 2人目の家が滅ぶ（跡継ぎが絶えた形で）。月の締めで勝ち負けを見る
    extinguish(c, hs[1], '');
    month(c);
    expect(c.gs.factions[hs[1]]).toBeUndefined();
    expect(humansOf(c)).toEqual([hs[0]]);
    expect(c.over).toBe('win');
    expect(c.victor).toBe(hs[0]);
  });

  it('with a time limit, the human house with the most provinces wins when it runs out', async () => {
    const { c, hs } = await start(2);
    c.victory = { kind: 'years', years: 10, until: c.gs.tick + 1 };
    month(c);
    month(c);
    expect(c.over).toBe('win');
    const best = [...hs].sort((a, b) => provincesOf(c, b).length - provincesOf(c, a).length)[0];
    expect(c.victor).toBe(best);
  });
});

describe('diplomacy between human houses (P121)', () => {
  it('an alliance request waits in the other house until its turn, and can be accepted there', async () => {
    const { c, hs } = await start(2);
    // 始めから同盟していれば解いておく（織田と徳川は同盟から始まる）
    c.gs.alliances = c.gs.alliances.filter(([a, b]) => !hs.includes(a) || !hs.includes(b));
    expect(relation(c, hs[0], hs[1])).toBe('neutral');
    const envoy = generalsOf(c.gs, hs[0]).find((g) => !g.isLord)!;
    expect(envoyPlan(c, 'call', hs[1], envoy.id, 0, hs[1]).blocked).toContain('人の家');
    const r = sendEnvoy(c, 'ally', hs[1], envoy.id, 0);
    expect(r).toMatchObject({ sent: true, pending: true });
    expect(relation(c, hs[0], hs[1])).toBe('neutral');
    // もう一度は出せない（返事待ち）
    const other = generalsOf(c.gs, hs[0]).find((g) => !g.isLord && g.id !== envoy.id)!;
    expect(envoyPlan(c, 'ally', hs[1], other.id, 0).blocked).toContain('返事');
    switchSeat(c, hs[1]);
    expect(c.offers.some((o) => o.from === hs[0] && o.kind === 'alliance')).toBe(true);
    expect(acceptOffer(c, hs[0])).toBe(true);
    expect(relation(c, hs[0], hs[1])).toBe('ally');
  });
});

