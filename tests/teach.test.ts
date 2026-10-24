// 直伝（P68）：枠・教えられるもの・月と成否・取りやめとやり直し・兵・戦いでの借り物の気力と身につく回数
import { describe, expect, it } from 'vitest';
import { applyBattleResult } from '../src/battle/result';
import { createBattle } from '../src/battle/setup';
import { mapFromProvince } from '../src/battle/map';
import { convert } from '../src/convert/convert';
import type { GGeneral } from '../src/convert/model';
import { D } from '../src/data/db';
import { skillCost, tacticCost } from '../src/rules/combat';
import { newCampaign, S, type Campaign } from '../src/strategy/campaign';
import { aiTeach, artMp, artsOfGeneral, learnersOf, lessonLearner, lessonsBusy, lessonsMonth, maxMpOf, slotsOf, startLesson, teachableArts, teachProblem, teacherProblem } from '../src/strategy/teach';
import { loadFixture } from './helpers';

async function setup(): Promise<{ c: Campaign; teacher: GGeneral; pupil: GGeneral; art: { id: string; kind: 'skill' | 'tactic' } }> {
  const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
  const me = Object.values(gs.factions).find((f) => f.name.ja === '織田家')!;
  const c = newCampaign(gs, save.world, me.id);
  for (const t of Object.values(gs.generals).filter((g) => g.faction === me.id)) {
    const arts = teachableArts(t).filter((x) => !x.why).map((x) => x.art);
    for (const l of learnersOf(c, t)) if (!l.troop) for (const art of arts) if (!teachProblem(c, t, l, art)) return { c, teacher: t, pupil: l.g, art };
  }
  throw new Error('教えられる組が見つからない');
}
const month = (c: Campaign): void => { lessonsMonth(c); c.moved.clear(); lessonsBusy(c); };

describe('teach', () => {
  it('slots follow intellect', async () => {
    const { teacher } = await setup();
    const g = structuredClone(teacher);
    const set = (int: number) => { g.stats.int = int - (D.byClass[g.classId].mod.int ?? 0); return slotsOf(g); };
    expect(set(50)).toBe(1); expect(set(64)).toBe(1); expect(set(65)).toBe(2); expect(set(79)).toBe(2); expect(set(80)).toBe(3); expect(set(95)).toBe(4);
  });

  it('a general teaches another in 3 months; both are busy; one lesson per province', async () => {
    const { c, teacher, pupil, art } = await setup();
    const months = teacher.isLord ? S.teach.months.lord : S.teach.months.general;
    expect(startLesson(c, teacher, { g: pupil }, art)).toBe(true);
    expect(c.moved.has(teacher.id) && c.moved.has(pupil.id)).toBe(true);
    const other = Object.values(c.gs.generals).find((g) => g.faction === teacher.faction && g.prov === teacher.prov && g.id !== teacher.id && g.id !== pupil.id);
    if (other) expect(teacherProblem(c, other)).toMatch(/同時に1つ|行動済み/);
    for (let m = 1; m < months; m++) { month(c); expect(pupil.taught ?? []).toHaveLength(0); expect(c.moved.has(pupil.id)).toBe(true); }
    month(c);
    expect(pupil.taught).toEqual([{ id: art.id, kind: art.kind, from: teacher.name.ja, uses: 0 }]);
    expect(c.lessons).toHaveLength(0);
    // 借り物は教えられない
    expect(teachableArts(pupil).find((x) => x.art.id === art.id)?.why).toMatch(/借り物/);
  });

  it('a wound restarts the lesson; changing side cancels it', async () => {
    const { c, teacher, pupil, art } = await setup();
    startLesson(c, teacher, { g: pupil }, art);
    month(c);
    expect(c.lessons![0].progress).toBe(1);
    c.wounded[pupil.id] = c.gs.tick + 1;
    month(c);
    expect(c.lessons![0].progress).toBe(0);
    delete c.wounded[pupil.id];
    pupil.faction = 0;
    month(c);
    expect(c.lessons).toHaveLength(0);
    expect(c.log.at(-1)?.key).toBe('teachCancel');
  });

  it('rival countries only teach arts the learner has enough MP to use (borrowed cost)', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const c = newCampaign(gs, save.world, 0);
    const saved = { ...S.teach.aiChance };
    for (const k of Object.keys(S.teach.aiChance)) S.teach.aiChance[k] = 1;
    try {
      for (let m = 0; m < 6; m++) { for (const f of Object.values(gs.factions)) aiTeach(c, f.id); month(c); }
    } finally { Object.assign(S.teach.aiChance, saved); }
    const lessons = [...(c.lessons ?? [])];
    let learned = 0;
    for (const g of Object.values(gs.generals)) {
      for (const x of g.taught ?? []) { learned++; expect(artMp(x.id, x.kind, true)).toBeLessThanOrEqual(maxMpOf({ g })); }
      for (const t of g.troops) for (const x of t.taught ?? []) { learned++; expect(artMp(x.id, x.kind, true)).toBeLessThanOrEqual(maxMpOf({ g, troop: t })); }
    }
    for (const x of lessons) { const l = lessonLearner(c, x); if (l) expect(artMp(x.art, x.kind, true)).toBeLessThanOrEqual(maxMpOf(l)); }
    expect(learned + lessons.length).toBeGreaterThan(5);
  });

  it('troops learn one art that survives promotion; borrowed arts cost more and are mastered by use', async () => {
    const { c, teacher } = await setup();
    const troopL = learnersOf(c, teacher).find((l) => l.troop)!;
    const art = teachableArts(teacher).filter((x) => !x.why).map((x) => x.art).find((a) => !teachProblem(c, teacher, troopL, a))!;
    expect(startLesson(c, teacher, troopL, art)).toBe(true);
    for (let m = 0; m < S.teach.months.troop; m++) month(c);
    const t = troopL.troop!;
    expect(t.taught?.[0].id).toBe(art.id);
    expect(t.tid).toBeUndefined();
    // 枠は1つ
    const art2 = teachableArts(teacher).filter((x) => !x.why).map((x) => x.art).find((a) => a.id !== art.id);
    if (art2) expect(teachProblem(c, teacher, troopL, art2)).toMatch(/枠がいっぱい|もう持っている/);
    // 戦い：借り物の気力、使った回数が戻る
    const gs = c.gs, foe = Object.values(gs.factions).find((f) => f.id !== teacher.faction && Object.values(gs.generals).some((g) => g.faction === f.id))!;
    const map = mapFromProvince(c.world, foe.capital, { capital: true, from: gs.factions[teacher.faction].capital });
    const st = createBattle(gs, map, [[teacher.id], [Object.values(gs.generals).find((g) => g.faction === foe.id)!.id]], 'teach');
    const u = st.units.find((x) => x.generalId === teacher.id && x.kind === 'troop' && x.taught?.includes(art.id))!;
    expect(u.borrowed).toContain(art.id);
    if (art.kind === 'skill') { const s = D.skills.find((x) => x.id === art.id)!; expect(skillCost(u, s)).toBe(Math.round(s.mp * S.teach.borrowedMpMult)); }
    else { const tac = D.byTactic[art.id]; expect(tacticCost(u, tac)).toBeGreaterThanOrEqual(tac.mp); }
    u.artUses = { [art.id]: S.teach.masterUses };
    st.winner = 0;
    applyBattleResult(gs, st);
    expect(t.taught![0].uses).toBe(S.teach.masterUses);
    expect(artsOfGeneral(teacher).length).toBeGreaterThan(0);
  });
});
