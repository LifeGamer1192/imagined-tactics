// 熟練度（下の役職を揃える・兵の熟練度）と、当主を譲る（P71）
import { describe, expect, it } from 'vitest';
import { convert, makeTroop } from '../src/convert/convert';
import { D } from '../src/data/db';
import { RNG } from '../src/core/rng';
import { gainTroopExp, lowerClasses, MAX_MASTERY, troopExpToNext } from '../src/rules/growth';
import { newCampaign } from '../src/strategy/campaign';
import { abdicate, abdicateProblem } from '../src/strategy/events';
import { loadFixture } from './helpers';

describe('mastery', () => {
  it('generals who start in an upper class hold every lower class: mastery at the cap and its tactics', async () => {
    const gs = convert(await loadFixture('sengoku_fid5_1575'));
    const upper = Object.values(gs.generals).filter((g) => lowerClasses(g.classId).length);
    expect(upper.length).toBeGreaterThan(5);
    for (const g of upper) for (const c of lowerClasses(g.classId)) {
      expect(g.mastery[c.id]).toBe(MAX_MASTERY);
      for (const t of c.tactics) expect(g.learned).toContain(t);
    }
  });

  it('troops gain mastery in their unit type as they level up, up to the cap', () => {
    const t = makeTroop(D.byUnit.u01a, 1), rng = new RNG(1);
    for (let i = 0; i < 8; i++) gainTroopExp(t, troopExpToNext(t), rng);
    expect(t.level).toBe(9);
    expect(t.mastery?.u01a).toBe(MAX_MASTERY);
  });
});

describe('abdicate', () => {
  it('hands the lordship over: classes, command bonus, whole realm acts, loyalty, cooldown', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!;
    const c = newCampaign(gs, save.world, me.id);
    const oldLord = gs.generals[me.lordId];
    const heir = Object.values(gs.generals).filter((g) => g.faction === me.id && !g.isLord && !abdicateProblem(c, g)).sort((a, b) => a.fame - b.fame)[0];
    const cmdOld = oldLord.command, cmdNew = heir.command;
    const loyalBefore = Object.fromEntries(Object.values(gs.generals).filter((g) => g.faction === me.id).map((g) => [g.id, g.loyalty]));
    expect(abdicate(c, heir.id)).toBe(true);
    expect(me.lordId).toBe(heir.id);
    expect(heir.isLord).toBe(true);
    expect(D.byClass[heir.classId].unique).toBe('lord');
    expect(oldLord.isLord).toBe(false);
    expect(D.byClass[oldLord.classId].unique).not.toBe('lord');
    expect(heir.command).toBeGreaterThan(cmdNew);
    expect(oldLord.command).toBeLessThan(cmdOld);
    for (const g of Object.values(gs.generals)) if (g.faction === me.id) expect(c.moved.has(g.id)).toBe(true);
    // 名声の高い武将は忠誠が下がる（新しい当主は名声のいちばん低い人）
    const higher = Object.values(gs.generals).filter((g) => g.faction === me.id && g.fame - heir.fame >= 2 && g.id !== oldLord.id);
    if (higher.length) expect(higher.some((g) => g.loyalty < loyalBefore[g.id])).toBe(true);
    expect(c.log.at(-1)?.key).toBe('abdicate');
    // 続けては譲れない
    const back = gs.generals[oldLord.id];
    expect(abdicateProblem(c, back)).toMatch(/か月は譲れません/);
    c.months += 24;
    expect(abdicateProblem(c, back)).toBeNull();
  });
});
