// 相国（P77）と本拠：5分野の効き目・膝元・できなくなること・本拠の収入と兵のレベル
import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import { newCampaign, finishMonth, neighborsOf, planAttack, provincesOf, recruit, S, type Campaign } from '../src/strategy/campaign';
import { recruitChance, takeCaptives } from '../src/strategy/captive';
import { nearChancellor, officeBlocks, officeFx, officeMonth } from '../src/strategy/office';
import { appointChancellor } from '../src/strategy/scouting';
import { teacherProblem } from '../src/strategy/teach';
import { trainMult, trainProblem } from '../src/strategy/training';
import { loadFixture } from './helpers';

async function setup(): Promise<{ c: Campaign; me: number }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(structuredClone(save));
  const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!.id;
  return { c: newCampaign(gs, save.world, me), me };
}
const officer = (c: Campaign, me: number) => Object.values(c.gs.generals).find((g) => g.faction === me && !g.isLord)!;

describe('chancellor and capital', () => {
  it('effects follow the abilities; the province of the chancellor and its neighbours get more income', async () => {
    const { c, me } = await setup();
    const g = officer(c, me);
    g.ab = [8, 6, 7, 6];
    const income0 = c.gs.factions[me].income;
    expect(appointChancellor(c, g.id)).toBe(true);
    const fx = officeFx(c)!;
    expect(fx.income).toBeCloseTo(0.08); expect(fx.envoy).toBe(4); expect(fx.defect).toBeCloseTo(0.3); expect(fx.train).toBeCloseTo(0.18); expect(fx.recruit).toBeCloseTo(0.07);
    finishMonth(c);
    expect(c.gs.factions[me].income).toBeGreaterThan(income0);
    const near = provincesOf(c, me).filter((p) => nearChancellor(c, p.id));
    expect(near.some((p) => p.id === c.gs.generals[g.id].prov)).toBe(true);
    // 膝元で訓練する将は、ほかの領より経験値が多い
    const here = Object.values(c.gs.generals).find((x) => x.faction === me && x.id !== g.id && nearChancellor(c, x.prov));
    const far = Object.values(c.gs.generals).find((x) => x.faction === me && x.id !== g.id && !nearChancellor(c, x.prov));
    if (here && far) expect(trainMult(c, here).mult / trainMult(c, far).mult).toBeGreaterThan(1);
  });

  it('the chancellor cannot attack, train or teach; appointing removes standing training', async () => {
    const { c, me } = await setup();
    const g = officer(c, me);
    (c.training ??= {})[g.id] = 'always';
    appointChancellor(c, g.id);
    expect(c.training[g.id]).toBeUndefined();
    expect(officeBlocks(c, g.id, 'attack')).toBeTruthy();
    expect(trainProblem(c, g)).toMatch(/相国/);
    expect(teacherProblem(c, g)).toMatch(/相国/);
    const to = neighborsOf(c, g.prov).find((n) => c.gs.provinces[n].owner && c.gs.provinces[n].owner !== me);
    if (to !== undefined) expect(planAttack(c, me, g.prov, to, [g.id])).toBeNull();
  });

  it('diplomacy warms neighbours who are not at war; household raises the recruit chance of captives', async () => {
    const { c, me } = await setup();
    const g = officer(c, me);
    g.ab = [5, 5, 9, 9];
    appointChancellor(c, g.id);
    const foe = Object.values(c.gs.factions).find((f) => f.id !== me && provincesOf(c, f.id).some((p) => neighborsOf(c, p.id).some((n) => c.gs.provinces[n].owner === me)) && !c.gs.wars.some((w) => [...w.attackers, ...w.defenders].includes(f.id) && [...w.attackers, ...w.defenders].includes(me)))!;
    const op0 = foe.opinions[me] ?? 0;
    officeMonth(c);
    if (op0 < S.office.driftCap) expect(foe.opinions[me]).toBeGreaterThan(op0);
    const tak = Object.values(c.gs.factions).find((f) => f.name.ja === '武田家')!.id;
    const t = Object.values(c.gs.generals).find((x) => x.faction === tak && !x.isLord)!;
    S.captive.base = 1;
    takeCaptives(c, { attacker: me, defender: tak, prov: c.gs.factions[me].capital, from: c.gs.factions[me].capital, atk: [], def: [t.id] }, { winner: 0, rounds: 1, levelUps: [], lost: [], beaten: [t.name.ja], beatenSides: [1], beatenIds: [t.id] });
    S.captive.base = 0.3;
    const cap = c.captives!.find((x) => x.g.id === t.id)!;
    const withCh = recruitChance(c, cap);
    delete c.offices!.chancellor;
    expect(withCh).toBeGreaterThan(recruitChance(c, cap));
  });

  it('the capital earns more and raises the level of troops recruited there', async () => {
    const { c, me } = await setup();
    const f = c.gs.factions[me];
    const g = Object.values(c.gs.generals).find((x) => x.faction === me && x.prov === f.capital)!;
    const other = Object.values(c.gs.generals).find((x) => x.faction === me && x.prov !== f.capital)!;
    g.troops = []; other.troops = []; f.supply = 99999; g.command = 9999; other.command = 9999;
    other.prov = g.prov === f.capital ? provincesOf(c, me).find((p) => p.id !== f.capital)!.id : other.prov;
    c.gs.provinces[other.prov].recruit = { ...c.gs.provinces[f.capital].recruit };
    expect(recruit(c, g.id, 'u01a')).toBe(true);
    expect(recruit(c, other.id, 'u01a')).toBe(true);
    expect(g.troops[0].level).toBe(other.troops[0].level + S.capitalBonus.recruitLevel);  });
});
