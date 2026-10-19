// 兵⇔武将（P59）：取り立てても技と兵種の性格が大きく変わらない（弓の兵は弓で戦う将に）。下げるときも近い兵種で、技・軍略を引き継ぐ
import { describe, expect, it } from 'vitest';
import { generalUnit, troopUnits } from '../src/battle/setup';
import { convert, generalsOf, makeTroop } from '../src/convert/convert';
import { D } from '../src/data/db';
import { basicSkill } from '../src/rules/stats';
import { newCampaign, reserveOf } from '../src/strategy/campaign';
import { lowerToTroop, lowerUnit, raiseToGeneral } from '../src/strategy/events';
import { loadFixture } from './helpers';

async function setup() {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
  const c = newCampaign(gs, save.world, f.id);
  f.supply = 99999;
  const holder = generalsOf(gs, f.id).find((g) => !g.isLord && gs.provinces[g.prov]?.owner === f.id)!;
  return { c, gs, f, holder };
}

describe('raising a troop keeps its skills and kind (P59)', () => {
  it('an archer becomes a general who still shoots, keeps every skill and its terrain', async () => {
    const { c, holder } = await setup();
    const bow = D.units.find((u) => u.line === 6 && u.tier === 1)!;
    holder.troops.push(makeTroop(bow, 12));
    const made = raiseToGeneral(c, holder.id, holder.troops.length - 1, '弓取り')!;
    expect(made.unit).toBe(bow.id);
    for (const s of bow.skills) expect(made.skills).toContain(s);
    const bu = generalUnit(made, 0, 0);
    expect(basicSkill(bu)!.range[1]).toBeGreaterThanOrEqual(2);
    expect(bu.affinity).toBe(bow.affinity);
    // 下げると、もとの弓の兵に戻る
    expect(lowerUnit(c, made)).toBe(bow.id);
  });

  it('a gunner becomes a gun-captain line general', async () => {
    const { c, holder } = await setup();
    const gun = D.units.find((u) => u.line === 4 && u.tier === 1)!;
    holder.troops.push(makeTroop(gun, 11));
    const made = raiseToGeneral(c, holder.id, holder.troops.length - 1, '鉄砲頭')!;
    let root = D.byClass[made.classId];
    while (root.from) root = D.byClass[root.from];
    expect(root.id).toBe('teppo_gashira1');
  });

  it('lowering a strategist gives a near unit kind and keeps the tactics', async () => {
    const { c, gs, holder } = await setup();
    holder.classId = 'gunshi'; holder.unit = undefined; holder.skills = undefined;
    const tacs = [...new Set([...D.byClass.gunshi.tactics, ...holder.learned])];
    const prov = holder.prov;
    reserveOf(c, prov).splice(0);
    holder.troops = [];
    const unitId = lowerUnit(c, holder);
    expect(D.byUnit[unitId].line).toBe(17);
    expect(lowerToTroop(c, holder.id)).toBe(true);
    const t = reserveOf(c, prov).find((x) => x.name === holder.name.ja)!;
    expect(t.unitId).toBe(unitId);
    const bu = troopUnits({ ...holder, troops: [t] } as never, 1, 0, 0)[0];
    for (const id of tacs) if (D.byTactic[id]) expect(bu.tactics).toContain(id);
    expect(gs.generals[holder.id]).toBeUndefined();
  });
});
