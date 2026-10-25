// 捕虜と登用（P72）：捕まる・登用・解き放つ・処断（当主は代替わり）・取り返されて戻る・逃げる・身代金・相手の国の判断・セーブ
import { afterEach, describe, expect, it } from 'vitest';
import type { BattleSummary } from '../src/battle/result';
import { convert } from '../src/convert/convert';
import { restore, snapshot } from '../src/persist/save';
import { captiveOf, captivesMonth, executeCaptive, ransomCaptive, recruitCaptive, recruitChance, releaseCaptive, takeCaptives } from '../src/strategy/captive';
import { newCampaign, relation, S, type Campaign, type PendingBattle } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

const saved = structuredClone(S.captive);
afterEach(() => { Object.assign(S.captive, structuredClone(saved)); });

async function setup(): Promise<{ c: Campaign; me: number; foe: number; prov: number }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!.id;
  const foe = Object.values(gs.factions).find((f) => f.name.ja === '武田家')!.id;
  const c = newCampaign(gs, save.world, me);
  return { c, me, foe, prov: gs.factions[me].capital };
}
/** foe の将 ids が me に負けて倒された戦いの結果 */
const lost = (c: Campaign, me: number, foe: number, prov: number, ids: string[]): [PendingBattle, BattleSummary] => [
  { attacker: me, defender: foe, prov, from: prov, atk: [c.gs.factions[me].lordId], def: ids },
  { winner: 0, rounds: 5, levelUps: [], lost: [], beaten: ids.map((id) => c.gs.generals[id].name.ja), beatenSides: ids.map(() => 1), beatenIds: ids },
];
const foeGen = (c: Campaign, foe: number, lord = false) => Object.values(c.gs.generals).find((g) => g.faction === foe && g.isLord === lord)!;

describe('captives', () => {
  it('a beaten general on the losing side is captured and waits for the player', async () => {
    const { c, me, foe, prov } = await setup();
    S.captive.base = 1;
    const g = foeGen(c, foe), troops = g.troops.length;
    const [pb, sum] = lost(c, me, foe, prov, [g.id]);
    expect(takeCaptives(c, pb, sum)).toEqual([g.id]);
    expect(c.gs.generals[g.id]).toBeUndefined();
    expect(captiveOf(c, g.id)?.by).toBe(me);
    expect(c.captivePending).toContain(g.id);
    expect(g.troops).toHaveLength(0);
    if (troops) expect(Object.values(c.reserve).flat().length).toBeGreaterThan(0);
    expect(c.log.at(-1)?.key).toBe('captured');
  });

  it('recruit (sure) makes a low-loyalty vassal; a refusal keeps them captive with a lower chance', async () => {
    const { c, me, foe, prov } = await setup();
    S.captive.base = 1;
    const [a, b] = Object.values(c.gs.generals).filter((g) => g.faction === foe && !g.isLord);
    takeCaptives(c, ...lost(c, me, foe, prov, [a.id, b.id]));
    S.captive.recruit.min = 0; S.captive.recruit.max = 1;
    const before = recruitChance(c, captiveOf(c, b.id)!);
    S.captive.recruit.min = 0; S.captive.recruit.max = 0;
    expect(recruitCaptive(c, b.id)).toBe(false);
    expect(captiveOf(c, b.id)!.tries).toBe(1);
    S.captive.recruit.min = 0; S.captive.recruit.max = 1;
    expect(recruitChance(c, captiveOf(c, b.id)!)).toBeLessThan(before);
    S.captive.recruit.min = 1; S.captive.recruit.max = 1;
    expect(recruitCaptive(c, a.id)).toBe(true);
    expect(c.gs.generals[a.id].faction).toBe(me);
    expect(c.gs.generals[a.id].loyalty).toBeLessThanOrEqual(S.captive.recruitLoyalty);
  });

  it('release sends them home with a debt and better opinion; execute starts a war', async () => {
    const { c, me, foe, prov } = await setup();
    S.captive.base = 1;
    const [a, b] = Object.values(c.gs.generals).filter((g) => g.faction === foe && !g.isLord);
    takeCaptives(c, ...lost(c, me, foe, prov, [a.id, b.id]));
    const op = c.gs.factions[foe].opinions[me] ?? 0;
    expect(releaseCaptive(c, a.id)).toBe(true);
    expect(c.gs.generals[a.id].faction).toBe(foe);
    expect(c.gs.generals[a.id].debts).toContain(me);
    expect(c.gs.factions[foe].opinions[me]).toBeGreaterThan(op);
    expect(executeCaptive(c, b.id)).toBe(true);
    expect(c.gs.generals[b.id]).toBeUndefined();
    expect(captiveOf(c, b.id)).toBeUndefined();
    expect(relation(c, me, foe)).toBe('war');
  });

  it('a captured lord can only be released or executed; executing one makes the house succeed', async () => {
    const { c, me, foe, prov } = await setup();
    S.captive.lordBase = 1;
    const lord = foeGen(c, foe, true);
    takeCaptives(c, ...lost(c, me, foe, prov, [lord.id]));
    expect(recruitChance(c, captiveOf(c, lord.id)!)).toBe(0);
    expect(recruitCaptive(c, lord.id)).toBe(false);
    expect(executeCaptive(c, lord.id)).toBe(true);
    const f = c.gs.factions[foe];
    expect(f.lordId).not.toBe(lord.id);
    expect(c.gs.generals[f.lordId]?.isLord).toBe(true);
  });

  it('an undecided captured lord is released at the end of the month; held captives are freed when the province is lost', async () => {
    const { c, me, foe, prov } = await setup();
    S.captive.base = 1; S.captive.lordBase = 1; S.captive.escape = 0;
    const lord = foeGen(c, foe, true), g = foeGen(c, foe);
    takeCaptives(c, ...lost(c, me, foe, prov, [lord.id, g.id]));
    captivesMonth(c);
    expect(c.gs.generals[lord.id]?.faction).toBe(foe);
    expect(captiveOf(c, g.id)).toBeTruthy();
    expect(c.captivePending).toHaveLength(0);
    c.gs.provinces[prov].owner = foe;
    captivesMonth(c);
    expect(c.gs.generals[g.id]?.faction).toBe(foe);
  });

  it('the player pays a ransom; a rival lord decides at once; captives survive saving', async () => {
    const { c, me, foe, prov } = await setup();
    S.captive.base = 1; S.captive.lordBase = 1;
    const mine = Object.values(c.gs.generals).find((g) => g.faction === me && !g.isLord)!;
    const fprov = c.gs.factions[foe].capital;
    S.captive.recruit.min = 0; S.captive.recruit.max = 0; S.captive.ai.executeChance = 0;
    takeCaptives(c, { attacker: me, defender: foe, prov: fprov, from: prov, atk: [mine.id], def: [] }, { winner: 1, rounds: 3, levelUps: [], lost: [], beaten: [mine.name.ja], beatenSides: [0], beatenIds: [mine.id] });
    expect(captiveOf(c, mine.id)?.by).toBe(foe);
    const back = restore(snapshot(c));
    expect(back.captives?.some((x) => x.g.id === mine.id)).toBe(true);
    c.gs.factions[me].supply = 10_000;
    expect(ransomCaptive(c, mine.id)).toBe(true);
    expect(c.gs.generals[mine.id].faction).toBe(me);
    // 相手が自分の当主を捕らえたら、その場で決める（処断しない設定なので解き放つ）
    const myLord = c.gs.generals[c.gs.factions[me].lordId];
    takeCaptives(c, { attacker: me, defender: foe, prov: fprov, from: prov, atk: [myLord.id], def: [] }, { winner: 1, rounds: 3, levelUps: [], lost: [], beaten: [myLord.name.ja], beatenSides: [0], beatenIds: [myLord.id] });
    expect(captiveOf(c, myLord.id)).toBeUndefined();
    expect(c.gs.generals[myLord.id]?.faction).toBe(me);
  });
});
