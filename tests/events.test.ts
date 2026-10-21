import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert/convert';
import {
  autoMonth, declareWar, dismissTroop, garrisonOf, generalsAt, isGarrison, moveGeneral, moveTargets, moveTroopProblem, reserveKey, reserveOf, neighborsOf, newCampaign, planAttack, transferProblem, transferTroop, woundMonths, recruitCost, relation, resolveBattle, siegeResist,
  strengthOf, traitsOf, troopLoad,
} from '../src/strategy/campaign';
import {
  acceptOffer, afterBattle, allianceProblem, lowerProblem, lowerRefund, lowerToTroop, raiseCost, raiseProblem, raiseToGeneral, renameGeneral, renameTroop, breakAlliance, callProblem, callToArms, effectiveLoyalty, makeTruce, monthlyEvents, proposeAlliance, questProblem, startQuest, troopUpgrades, upgradeTroop,
} from '../src/strategy/events';
import { D } from '../src/data/db';
import { S } from '../src/strategy/config';
import { loadFixture } from './helpers';

async function campaign(name = 'sengoku_fid5_1575') {
  const save = await loadFixture(name);
  const c = newCampaign(convert(save), save.world, 0);
  const oda = Object.values(c.gs.factions).find((f) => f.name.ja === '織田家')!;
  c.player = oda.id;
  return { c, oda };
}

describe('undefended provinces, movement, wounds', () => {
  it('a province with no general is held by a weak garrison, whose strength follows the province', async () => {
    const { c, oda } = await campaign();
    const gs = c.gs;
    const fits = (n: number): boolean => { const o = gs.provinces[n].owner; return o > 0 && o !== oda.id && gs.factions[o].capital !== n && relation(c, oda.id, o) !== 'ally' && relation(c, oda.id, o) !== 'truce'; };
    const from = gs.provinces.find((p) => p.owner === oda.id && neighborsOf(c, p.id).some(fits))!.id;
    const to = neighborsOf(c, from).find(fits)!;
    for (const g of generalsAt(c, oda.capital, oda.id)) g.prov = from;
    for (const g of generalsAt(c, to, gs.provinces[to].owner)) g.prov = gs.factions[g.faction].capital;
    // 守備兵は、城が強いほど強い
    gs.provinces[to].fort = 0;
    const weak = garrisonOf(c, to);
    gs.provinces[to].fort = 1;
    const strong = garrisonOf(c, to);
    expect(strong.level).toBeGreaterThan(weak.level);
    expect(strong.troops).toBeGreaterThanOrEqual(weak.troops);
    // 攻め込むと守備兵との戦いになる。強い武将3人なら勝って、領が手に入る。攻め込んだので戦争になる
    const owner = gs.provinces[to].owner, before = Object.keys(gs.generals).length;
    const top = generalsAt(c, from, oda.id).slice(0, 3).map((g) => g.id);
    const pb = planAttack(c, oda.id, from, to, top)!;
    expect(pb.def.length).toBe(0);
    const sum = resolveBattle(c, pb);
    expect(sum, 'a battle was fought').not.toBeNull();
    expect(sum!.winner).toBe(0);
    expect(gs.provinces[to].owner).toBe(oda.id);
    expect(relation(c, oda.id, owner)).toBe('war');
    // 守備兵の頭は、戦いが済んだら残らない。深手の一覧にも入らない
    expect(Object.keys(gs.generals).length).toBe(before);
    expect(Object.keys(gs.generals).some(isGarrison)).toBe(false);
    expect(Object.keys(c.wounded).some(isGarrison)).toBe(false);
  });

  it('wounds last two or three months by trait; troops can be handed over or let go', async () => {
    const { c, oda } = await campaign();
    const [a, b] = generalsAt(c, oda.capital, oda.id).filter((g) => !g.isLord);
    a.traits = ['brave']; expect(woundMonths(a)).toBe(2);
    a.traits = ['sickly', 'brave']; expect(woundMonths(a)).toBe(3);
    a.traits = ['wise']; expect(woundMonths(a)).toBe(3);
    // 兵を渡す：相手の采配力と隊数の空きが要る
    const unit = Object.keys(oda.recruit)[0];
    a.troops = [{ unitId: unit, level: 5, exp: 10, stats: { hp: 100, mp: 10, str: 10, int: 10, agi: 10 } }];
    b.troops = []; b.command = D.byUnit[unit].cost - 1;
    expect(transferProblem(c, a, 0, b)).toMatch(/采配/);
    b.command = D.byUnit[unit].cost;
    expect(transferTroop(c, a.id, 0, b.id)).toBe(true);
    expect(a.troops.length).toBe(0);
    expect(b.troops[0]).toMatchObject({ unitId: unit, level: 5, exp: 10 });
    // 別の領の武将には渡せない。手放すと消える
    a.prov = [...moveTargets(c, oda.capital, oda.id)][0];
    expect(transferTroop(c, b.id, 0, a.id)).toBe(false);
    expect(dismissTroop(c, b.id, 0)).toBe(true);
    expect(b.troops.length).toBe(0);
  });

  it('generals move up to three provinces away through their own land, not through others', async () => {
    const { c, oda } = await campaign();
    const gs = c.gs;
    const near = moveTargets(c, oda.capital, oda.id, 1), far = moveTargets(c, oda.capital, oda.id);
    expect(far.size).toBeGreaterThan(near.size);
    for (const p of far) expect(gs.provinces[p].owner).toBe(oda.id);
    for (const p of near) expect(far.has(p)).toBe(true);
    const only = [...far].find((p) => !near.has(p))!;
    const g = generalsAt(c, oda.capital, oda.id).find((x) => !x.isLord)!;
    expect(moveGeneral(c, g.id, only)).toBe(true);
    expect(g.prov).toBe(only);
    // 1か月に1回。ほかの勢力の領へは移れない
    expect(moveGeneral(c, g.id, oda.capital)).toBe(false);
    const g2 = generalsAt(c, oda.capital, oda.id).find((x) => !x.isLord)!;
    const foreign = gs.provinces.find((p) => p.owner && p.owner !== oda.id)!.id;
    expect(moveGeneral(c, g2.id, foreign)).toBe(false);
  });

  it('a general beaten in battle is wounded for some months and cannot fight', async () => {
    const { c, oda } = await campaign();
    const gs = c.gs;
    c.player = 0;
    // 戦いが起きて、倒された武将が出るまで進める
    for (let m = 0; m < 36 && !Object.keys(c.wounded).length; m++) autoMonth(c);
    const id = Object.keys(c.wounded)[0];
    expect(id, 'someone was beaten').toBeDefined();
    const g = gs.generals[id];
    expect(c.wounded[id]).toBeGreaterThan(gs.tick);
    expect(c.wounded[id]).toBeLessThanOrEqual(gs.tick + 3);
    // 深手の間は、守りにも攻めにも数えない
    expect(generalsAt(c, g.prov, g.faction).some((x) => x.id === id)).toBe(false);
    expect(planAttack(c, g.faction, g.prov, neighborsOf(c, g.prov)[0], [id])).toBeNull();
    expect(c.log.some((e) => e.key === 'wounded')).toBe(true);
    // 時が経てば戦えるようになる
    const until = c.wounded[id];
    while (c.gs.tick < until && !c.over) autoMonth(c);
    if (gs.generals[id] && !(id in c.wounded)) expect(c.wounded[id]).toBeUndefined();
    void oda;
  }, 120000);
});

describe('diplomacy', () => {
  it('war, truce, alliance and breaking an alliance change the relation', async () => {
    const { c, oda } = await campaign();
    const other = Object.values(c.gs.factions).find((f) => f.id !== oda.id && relation(c, oda.id, f.id) === 'neutral')!;
    expect(declareWar(c, oda.id, other.id)).toBe(true);
    expect(relation(c, oda.id, other.id)).toBe('war');
    expect(declareWar(c, oda.id, other.id)).toBe(false);
    expect(makeTruce(c, oda.id, other.id)).toBe(true);
    expect(relation(c, oda.id, other.id)).toBe('truce');
    // 停戦が明けて、心証が良ければ同盟できる
    c.gs.truces = [];
    other.opinions[oda.id] = -50;
    expect(allianceProblem(c, oda.id, other.id)).toMatch(/心証/);
    other.opinions[oda.id] = 60;
    expect(proposeAlliance(c, oda.id, other.id)).toBe(true);
    expect(relation(c, oda.id, other.id)).toBe('ally');
    expect(breakAlliance(c, oda.id, other.id)).toBe(true);
    expect(relation(c, oda.id, other.id)).toBe('neutral');
  });
});

describe('quest, promotion, traits', () => {
  it('a general on a journey is away for a while and comes back with a result', async () => {
    const { c, oda } = await campaign();
    const g = generalsAt(c, oda.capital, oda.id).find((x) => !x.isLord)!;
    expect(questProblem(c, c.gs.generals[oda.lordId])).toMatch(/当主/);
    expect(startQuest(c, g.id)).toBe(true);
    expect(generalsAt(c, oda.capital, oda.id).some((x) => x.id === g.id)).toBe(false);
    const before = c.log.length;
    for (let i = 0; i < 3; i++) { c.gs.tick++; c.gs.month = (c.gs.month % 12) + 1; monthlyEvents(c); }
    expect(g.id in c.away).toBe(false);
    expect(c.log.slice(before).some((e) => e.key.startsWith('quest'))).toBe(true);
  });

  it('troops are promoted only within the general\'s command', async () => {
    const { c, oda } = await campaign();
    const lord = c.gs.generals[oda.lordId];
    const base = D.units.find((u) => u.promote.length && u.promote[0].lv && !u.promote[0].item)!;
    lord.troops = [{ unitId: base.id, level: 30, exp: 0, stats: { hp: base.hp, mp: base.mp, str: base.str, int: base.int, agi: base.agi } }];
    const to = base.promote[0].to;
    lord.command = D.byUnit[to].cost - 1;
    expect(troopUpgrades(lord, 0)[0].missing).toContain('采配力');
    expect(upgradeTroop(c, lord.id, 0, to)).toBe(false);
    lord.command = D.byUnit[to].cost;
    expect(upgradeTroop(c, lord.id, 0, to)).toBe(true);
    expect(lord.troops[0].unitId).toBe(to);
    expect(troopLoad(lord)).toBeLessThanOrEqual(lord.command);
  });

  it('faction traits change the price of troops', async () => {
    const { c } = await campaign();
    for (const f of Object.values(c.gs.factions)) {
      expect(traitsOf(f).length, f.name.ja).toBeGreaterThan(0);
      for (const t of traitsOf(f)) {
        if (!t.cost) continue;
        const u = D.units.find((x) => t.cost!.lines.includes(x.line))!;
        expect(recruitCost(u.id, f)).toBeLessThan(recruitCost(u.id));
      }
    }
  });
});

describe('people', () => {
  it('over thirty years generals die, lords are succeeded, and every faction keeps a lord', async () => {
    const { c } = await campaign();
    c.player = 0;
    const start = Object.keys(c.gs.generals).length;
    for (let m = 0; m < 360 && !c.over; m++) autoMonth(c);
    const keys = new Set(c.log.map((e) => e.key));
    expect(Object.keys(c.gs.generals).length).toBeLessThan(start + 10);
    expect(keys.has('death')).toBe(true);
    for (const f of Object.values(c.gs.factions)) {
      const lord = c.gs.generals[f.lordId];
      if (Object.values(c.gs.generals).some((g) => g.faction === f.id)) expect(lord?.faction, f.name.ja).toBe(f.id);
    }
    for (const g of Object.values(c.gs.generals)) for (const t of g.ties) expect(c.gs.generals[t.with], `${g.name.ja} tie`).toBeTruthy();
  }, 240000);
});

describe('ties', () => {
  it('rivals sharpen each other, and a foe may be slain, which starts a new feud', async () => {
    const { c, oda } = await campaign();
    const gs = c.gs;
    const other = Object.values(gs.factions).find((f) => f.id !== oda.id && Object.values(gs.generals).filter((g) => g.faction === f.id && !g.isLord).length >= 2)!;
    const [w] = generalsAt(c, oda.capital, oda.id).filter((g) => !g.isLord);
    const [l, kin] = Object.values(gs.generals).filter((g) => g.faction === other.id && !g.isLord);
    const pb = { attacker: oda.id, defender: other.id, prov: other.capital, from: oda.capital, atk: [w.id], def: [l.id] };
    const sum = { winner: 0 as const, rounds: 5, levelUps: [], lost: [], beaten: [l.name.ja], beatenSides: [1 as const], beatenIds: [l.id] };
    // 好敵手：双方が経験を得る
    w.ties = [{ kind: 'rival', with: l.id }]; l.ties = [];
    const e0 = w.exp + w.level * 100000, e1 = l.exp + l.level * 100000;
    afterBattle(c, pb, sum);
    expect(w.exp + w.level * 100000).toBeGreaterThan(e0);
    expect(l.exp + l.level * 100000).toBeGreaterThan(e1);
    expect(c.log.some((e) => e.key === 'rivalWin')).toBe(true);
    // 仇：何度か戦えば討ち取り、討たれた者の義兄弟が新たな仇を持つ
    w.ties = [{ kind: 'avenge', with: l.id }];
    kin.ties = [{ kind: 'sworn', with: l.id }];
    for (let i = 0; i < 40 && gs.generals[l.id]; i++) afterBattle(c, pb, sum);
    expect(gs.generals[l.id]).toBeUndefined();
    expect(w.ties.some((t) => t.kind === 'avenge')).toBe(false);
    expect(kin.ties).toContainEqual({ kind: 'avenge', with: w.id });
    // 同じ勢力に仇がいると、忠誠が下がる
    const base = effectiveLoyalty(c, kin);
    w.faction = kin.faction;
    expect(effectiveLoyalty(c, kin)).toBe(base - 1);
  });
});

describe('offers, call to arms, difficulty', () => {
  it('an offered truce can be accepted, and an ally can be called into a war', async () => {
    const { c, oda } = await campaign();
    const gs = c.gs;
    const [a, b] = Object.values(gs.factions).filter((f) => f.id !== oda.id && relation(c, oda.id, f.id) === 'neutral' && relation(c, f.id, Object.values(gs.factions).find((x) => x.id !== oda.id && x.id !== f.id)!.id) !== undefined);
    expect(declareWar(c, oda.id, a.id)).toBe(true);
    c.offers.push({ kind: 'truce', from: a.id, until: gs.tick + 3 });
    expect(acceptOffer(c, a.id)).toBe(true);
    expect(relation(c, oda.id, a.id)).toBe('truce');
    expect(c.offers.length).toBe(0);
    // 同盟の申し込みを受け、別の相手との戦争に加勢を頼む
    const enemy = Object.values(gs.factions).find((f) => f.id !== oda.id && f.id !== a.id && f.id !== b.id && relation(c, oda.id, f.id) === 'neutral' && relation(c, b.id, f.id) === 'neutral')!;
    c.offers.push({ kind: 'alliance', from: b.id, until: gs.tick + 3 });
    expect(acceptOffer(c, b.id)).toBe(true);
    expect(relation(c, oda.id, b.id)).toBe('ally');
    declareWar(c, oda.id, enemy.id);
    b.opinions[oda.id] = 0;
    expect(callProblem(c, b.id, enemy.id)).toMatch(/心証/);
    b.opinions[oda.id] = 80;
    expect(callToArms(c, b.id, enemy.id)).toBe(true);
    expect(relation(c, b.id, enemy.id)).toBe('war');
  });

  it('difficulty changes the player\'s income', async () => {
    const save = await loadFixture('sengoku_fid5_1575');
    const income = (d: 'easy' | 'normal' | 'hard'): number => {
      const c = newCampaign(convert(save), save.world, 0, d);
      const oda = Object.values(c.gs.factions).find((f) => f.name.ja === '織田家')!;
      c.player = oda.id;
      autoMonth(c);
      return c.gs.factions[oda.id]?.income ?? 0;
    };
    expect(income('easy')).toBeGreaterThan(income('normal'));
    expect(income('normal')).toBeGreaterThan(income('hard'));
  });
});
describe('names, raising and lowering', () => {
  it('generals and troops can be renamed; an empty troop name falls back to the unit name', async () => {
    const { c, oda } = await campaign();
    const g = generalsAt(c, oda.capital, oda.id).find((x) => x.troops.length > 0)!;
    expect(renameGeneral(c, g.id, '  あたらしい名  ')).toBe(true);
    expect(g.name.ja).toBe('あたらしい名');
    expect(renameGeneral(c, g.id, '   ')).toBe(false);
    expect(g.name.ja).toBe('あたらしい名');
    renameGeneral(c, g.id, 'あ'.repeat(S.officer.nameMax + 40));
    expect([...g.name.ja].length).toBe(S.officer.nameMax);
    expect(renameTroop(c, g.id, 0, '親衛隊')).toBe(true);
    expect(g.troops[0].name).toBe('親衛隊');
    renameTroop(c, g.id, 0, '');
    expect(g.troops[0].name).toBeUndefined();
  });

  it('raising a troop costs supply and gives a leader with the troop\'s skills; lowering refunds two thirds and fills the reserve', async () => {
    const { c, oda } = await campaign();
    const [a, b] = generalsAt(c, oda.capital, oda.id).filter((x) => !x.isLord && x.troops.length > 0);
    const lv = S.officer.minTroopLevel + 2;
    a.troops[0].level = S.officer.minTroopLevel - 1;
    expect(raiseProblem(c, a.id, 0)).not.toBeNull();
    expect(raiseToGeneral(c, a.id, 0, '新参')).toBeNull();
    // 兵糧が足りないと取り立てられない
    a.troops[0].level = lv;
    oda.supply = raiseCost(lv) - 1;
    expect(raiseProblem(c, a.id, 0)).toContain('兵糧');
    oda.supply = 1000;
    // 特技と軍略を持つ兵種にして、引き継がれることを見る
    const skilled = Object.values(D.byUnit).find((u) => u.passives.length > 0 && u.tactics.length > 0)!;
    a.troops[0].unitId = skilled.id;
    const n = a.troops.length, count = Object.keys(c.gs.generals).length;
    const made = raiseToGeneral(c, a.id, 0, '新参')!;
    expect(oda.supply).toBe(1000 - raiseCost(lv));
    expect(made.name.ja).toBe('新参');
    expect(made.level).toBe(lv);
    expect(made.faction).toBe(oda.id);
    expect(made.prov).toBe(a.prov);
    expect(made.troops.length).toBe(0);
    expect(made.traits.length).toBe(1);
    expect(S.officer.leaderTraits).toContain(made.traits[0]);
    for (const p of skilled.passives) expect(made.passives.some((x) => x.type === p.type)).toBe(true);
    for (const t of skilled.tactics) expect(made.learned).toContain(t);
    expect(a.troops.length).toBe(n - 1);
    expect(Object.keys(c.gs.generals).length).toBe(count + 1);
    expect(generalsAt(c, a.prov, oda.id).some((x) => x.id === made.id)).toBe(true);
    // 当主は下げられない
    const lord = Object.values(c.gs.generals).find((x) => x.isLord && x.faction === oda.id)!;
    expect(lowerProblem(c, lord)).not.toBeNull();
    // 下げると、3分の2の兵糧が戻り、名前とレベルを持つ兵が予備兵に加わる
    const before = oda.supply;
    expect(lowerToTroop(c, made.id)).toBe(true);
    expect(oda.supply).toBe(before + lowerRefund(lv));
    expect(lowerRefund(lv)).toBe(Math.round(raiseCost(lv) * 2 / 3));
    expect(c.gs.generals[made.id]).toBeUndefined();
    const res = reserveOf(c, a.prov);
    expect(res.length).toBe(1);
    expect(res[0].name).toBe('新参');
    expect(res[0].level).toBe(lv);
    // 兵を率いている武将を下げると、その兵も予備兵になる
    const m = b.troops.length;
    expect(lowerToTroop(c, b.id)).toBe(true);
    expect(reserveOf(c, a.prov).length).toBe(1 + 1 + m);
    // 予備兵は武将へ付けられ、武将の兵は予備兵へ戻せる。予備兵からも取り立てられる
    const key = reserveKey(a.prov);
    a.command = 999;
    while (a.troops.length > 2) a.troops.pop();
    const r0 = reserveOf(c, a.prov).length, a0 = a.troops.length;
    expect(moveTroopProblem(c, key, 0, a.id)).toBeNull();
    expect(transferTroop(c, key, 0, a.id)).toBe(true);
    expect(a.troops.length).toBe(a0 + 1);
    expect(a.troops[a0].name).toBe('新参');
    expect(transferTroop(c, a.id, a0, key)).toBe(true);
    expect(reserveOf(c, a.prov).length).toBe(r0);
    oda.supply = 1000;
    const i = reserveOf(c, a.prov).findIndex((t) => t.level >= S.officer.minTroopLevel);
    expect(raiseToGeneral(c, key, i, '予備上がり')!.prov).toBe(a.prov);
    expect(reserveOf(c, a.prov).length).toBe(r0 - 1);
    // 予備兵には上限がある
    while (reserveOf(c, a.prov).length < S.reserve.max) reserveOf(c, a.prov).push({ ...a.troops[0] });
    expect(moveTroopProblem(c, a.id, 0, key)).toContain('予備兵');
    // 予備兵は領に付いている：領を失っても残る（動かせなくなるだけ）。取り返せば、また使える
    const n1 = reserveOf(c, a.prov).length;
    c.gs.provinces[a.prov].owner = Object.values(c.gs.factions).find((f) => f.id !== oda.id)!.id;
    expect(reserveOf(c, a.prov).length).toBe(n1);
    expect(moveTroopProblem(c, key, 0, a.id)).not.toBeNull();
    c.gs.provinces[a.prov].owner = oda.id;
    while (a.troops.length > 1) a.troops.pop();
    expect(moveTroopProblem(c, key, 0, a.id)).toBeNull();
  });
});

describe('off-stage land', () => {
  it('land with no owned province is out of play and cut off from the rest', async () => {
    const { c } = await campaign();
    const out = c.gs.provinces.filter((p) => p.out);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) { expect(p.owner).toBe(0); expect(neighborsOf(c, p.id).length).toBe(0); }
    for (const p of c.gs.provinces.filter((x) => !x.out)) for (const n of neighborsOf(c, p.id)) expect(c.gs.provinces[n].out).toBeFalsy();
  });
});

describe('ages', () => {
  it('nobody starts centuries old: long-dead army leaders are left out, stale birth months are reset', async () => {
    for (const name of ['shunju_fid5_259bc', 'sengoku_fid5_1575', 'sangoku_fid5_212', 'rome_fid3_212bc', 'invented_archipelago_y30']) {
      const save = await loadFixture(name);
      const gs = convert(save);
      for (const g of Object.values(gs.generals)) {
        expect(g.age, `${name} ${g.name.ja}`).toBeLessThanOrEqual(100);
        const rec = g.pid !== undefined ? save.world.people[g.pid] : undefined;
        if (rec) expect(rec.died, `${name} ${g.name.ja}`).toBe(-1);
      }
      for (const f of Object.values(gs.factions)) expect(gs.generals[f.lordId], `${name} ${f.name.ja}`).toBeTruthy();
    }
  });
});

describe('no level cap', () => {
  it('experience to the next level follows K x (1 + (LV-1)^2 / 36), and levels go past 30', async () => {
    const { generalExpToNext, troopExpToNext, gainTroopExp, expCurve } = await import('../src/rules/growth');
    const { RNG } = await import('../src/core/rng');
    expect(expCurve(1)).toBe(1);
    expect(expCurve(7)).toBe(2);
    expect(expCurve(13)).toBe(5);
    expect(expCurve(31)).toBe(26);
    // 足軽は K≒146（LV30 までの合計は、もとの表と同じ 35,474 前後）
    const ash = { classId: 'ashigaru', level: 1 };
    expect(generalExpToNext(ash)).toBe(146);
    let sum = 0;
    for (let L = 1; L < 30; L++) sum += generalExpToNext({ classId: 'ashigaru', level: L });
    expect(Math.abs(sum - 35474)).toBeLessThan(30);
    expect(generalExpToNext({ classId: 'ashigaru', level: 100 })).toBeGreaterThan(39000);
    // 兵も 30 を超えて上がる
    const t = { unitId: 'u01a', level: 30, exp: 0, stats: { hp: 500, mp: 50, str: 50, int: 20, agi: 50 } };
    expect(Number.isFinite(troopExpToNext(t))).toBe(true);
    const ups = gainTroopExp(t as never, 1_000_000, new RNG(1));
    expect(t.level).toBeGreaterThan(60);
    expect(ups).toBe(t.level - 30);
  });
});