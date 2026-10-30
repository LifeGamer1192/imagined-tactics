// 味方のおまかせの方針（P50。P104 で5段階と、密集・統制・包囲を足した）：性格の代わりに方針で動く。狙う相手が方針で変わる。セーブに残る
import { describe, expect, it } from 'vitest';
import { personaOf, planUnitDetailed } from '../src/ai/ai';
import { DEFAULT_PLAN, NEUTRAL, planPersona, validPlan, type AutoPlan, type Personality } from '../src/ai/personality';
import { parseMap } from '../src/battle/map';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { convert, generalsOf, makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { restore, snapshot } from '../src/persist/save';
import { newCampaign } from '../src/strategy/campaign';
import { loadFixture } from './helpers';

const OPEN = Array.from({ length: 9 }, () => '. . . . . . . . . . . . .').join('\n');
function field(): BattleState {
  return { map: parseMap(OPEN), units: [], turn: 0, round: 1, maxRounds: 20, winner: null, rng: new RNG(11), log: [], sideNames: ['攻', '守'] };
}
function put(st: BattleState, unitId: string, side: Side, c: number, r: number, opts: { leader?: BUnit; persona?: Partial<Personality>; hp?: number } = {}): BUnit {
  const def = D.byUnit[unitId], t = makeTroop(def, 5), id = st.units.length;
  const u: BUnit = {
    id, side, home: side, kind: opts.leader ? 'troop' : 'general', generalId: `g${id}`, leader: opts.leader?.id ?? id, troopIndex: -1,
    defId: unitId, name: `${def.name.jp}${id}`, level: 5, pos: st.map.grid.idx(c, r),
    hp: opts.hp ?? t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp,
    str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: def.def, move: def.move, affinity: def.affinity,
    commandRange: opts.leader ? 0 : 6, passives: [...def.passives], skills: [...def.skills], tactics: [],
    critPct: 0, healPct: 0, persona: opts.leader ? undefined : { ...NEUTRAL, ...opts.persona },
    statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0,
  };
  st.units.push(u);
  return u;
}

/** 自分の兵1隊と、近い元気な敵の兵・遠い弱った敵の兵・遠い敵の将 */
function scene(plan: AutoPlan | null): { st: BattleState; u: BUnit; near: BUnit; weak: BUnit; gen: BUnit } {
  const st = field();
  const lead = put(st, 'u01a', 0, 0, 0, { persona: { cruelty: -1 } });
  const gen = put(st, 'u01a', 1, 9, 4);
  const u = put(st, 'u01a', 0, 6, 4, { leader: lead });
  const near = put(st, 'u01a', 1, 5, 4, { leader: gen });
  const weak = put(st, 'u01a', 1, 6, 7, { leader: gen, hp: 20 });
  // 敵の将の兵を増やして、将を倒す値打ちを上げる
  if (plan) st.autoPlan = [plan, null];
  return { st, u, near, weak, gen };
}
function targetOf(st: BattleState, u: BUnit): number | undefined {
  const a = planUnitDetailed(st, u).actions.find((x) => x.type === 'skill');
  return a && a.type === 'skill' ? st.units.find((x) => x.pos === a.target)?.id : undefined;
}

describe('auto plan for the player side', () => {
  it('replaces personality with the plan for that side only', () => {
    const plan: AutoPlan = { ...DEFAULT_PLAN, push: 1, aim: 'general', mind: 5 };
    const { st, u, near } = scene(plan);
    expect(personaOf(st, u)).toEqual(planPersona(plan));
    expect(personaOf(st, near)).toEqual(st.units[near.leader].persona);
  });

  it('aims at the nearest, the general, or the weakened enemy as chosen', () => {
    const pick = (aim: AutoPlan['aim']) => { const s = scene({ ...DEFAULT_PLAN, push: 5, aim, mind: 1 }); return [targetOf(s.st, s.u), s] as const; };
    const [n, sn] = pick('near'), [g, sg] = pick('general'), [w, sw] = pick('weak');
    expect(n).toBe(sn.near.id);
    expect(g).toBe(sg.gen.id);
    expect(w).toBe(sw.weak.id);
  });

  it('is kept in the save', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
    const c = newCampaign(gs, save.world, f.id);
    c.autoPlan = { push: 2, aim: 'weak', mind: 4, tight: 5, command: 1, envelop: 3 };
    const back = restore(JSON.parse(JSON.stringify(snapshot(c))));
    expect(back.autoPlan).toEqual(c.autoPlan);
  });

  it('reads the old two-step plans as the ends of the five steps (P104)', () => {
    expect(validPlan({ push: 'wait', aim: 'general', mind: 'cunning' })).toEqual({ push: 1, aim: 'general', mind: 5, tight: 3, command: 3, envelop: 3 });
    expect(validPlan({ push: 'push', aim: 'near', mind: 'direct' })).toEqual({ ...DEFAULT_PLAN, push: 5, mind: 1 });
    expect(validPlan({ push: 9, tight: 0 })).toEqual(DEFAULT_PLAN);
    // 1と5は、前の2段階と同じ動き方
    expect(planPersona({ ...DEFAULT_PLAN, push: 1 }).aggression).toBeCloseTo(-0.7, 6);
    expect(planPersona({ ...DEFAULT_PLAN, push: 5 }).aggression).toBeCloseTo(0.8, 6);
    expect(planPersona({ ...DEFAULT_PLAN, push: 3 }).aggression).toBeCloseTo(0.05, 6);
  });
});

/** 動いた先（動かなければ今の場所） */
function moveTo(st: BattleState, u: BUnit): number {
  const a = planUnitDetailed(st, u).actions.find((x) => x.type === 'move');
  return a && a.type === 'move' ? a.to : u.pos;
}

describe('formation, command and envelopment (P104)', () => {
  it('tight 5 moves next to friends, tight 1 does not care', () => {
    const run = (tight: AutoPlan['tight']) => {
      const st = field();
      const lead = put(st, 'u01a', 0, 1, 1, { persona: {} });
      lead.commandRange = 12;
      put(st, 'u01a', 0, 2, 4, { leader: lead }); put(st, 'u01a', 0, 2, 5, { leader: lead });
      const u = put(st, 'u07a', 0, 7, 4, { leader: lead });
      put(st, 'u01a', 1, 12, 8);
      st.autoPlan = [{ ...DEFAULT_PLAN, push: 3, tight, envelop: 1 }, null];
      const to = moveTo(st, u);
      return Math.min(...st.units.filter((x) => x.side === 0 && x.id !== u.id).map((x) => st.map.grid.distance(x.pos, to)));
    };
    expect(run(5)).toBe(1);
    expect(run(1)).toBeGreaterThan(1);
  });

  it('command 5 keeps a troop inside its general\'s range; command 1 lets it wander toward the enemy', () => {
    const run = (command: AutoPlan['command']) => {
      const st = field();
      const lead = put(st, 'u01a', 0, 1, 4, { persona: {} });
      lead.commandRange = 2;
      const u = put(st, 'u07a', 0, 3, 4, { leader: lead });
      put(st, 'u01a', 1, 12, 4);
      st.autoPlan = [{ ...DEFAULT_PLAN, push: 5, command, tight: 1, envelop: 1 }, null];
      return st.map.grid.distance(moveTo(st, u), lead.pos);
    };
    expect(run(5)).toBeLessThanOrEqual(2);
    expect(run(1)).toBeGreaterThan(2);
  });

  it('envelop 5 goes round to the back of an enemy that a friend is facing, and only then scores the envelopment', () => {
    const plan = (envelop: AutoPlan['envelop'], c: number, r: number) => {
      const st = field();
      const lead = put(st, 'u01a', 0, 1, 4, { persona: {} });
      lead.commandRange = 12;
      put(st, 'u01a', 0, 5, 4, { leader: lead });
      const foe = put(st, 'u01a', 1, 6, 4);
      const u = put(st, 'u07a', 0, c, r, { leader: lead });
      st.autoPlan = [{ ...DEFAULT_PLAN, push: 3, envelop, tight: 1 }, null];
      const p = planUnitDetailed(st, u), g = st.map.grid;
      const m = p.actions.find((x) => x.type === 'move'), to = m && m.type === 'move' ? m.to : u.pos;
      return { behind: g.distance(to, foe.pos) === 1 && g.center(to, 1)[0] > g.center(foe.pos, 1)[0], spacing: p.parts.spacing };
    };
    const starts: [number, number][] = [[3, 2], [4, 2], [3, 6], [4, 6], [4, 3], [4, 5], [2, 3], [2, 5]];
    for (const [c, r] of starts) {
      const hi = plan(5, c, r), lo = plan(1, c, r);
      expect(hi.behind, `${c},${r}`).toBe(true);
      expect(hi.spacing).toBeGreaterThan(0);
      expect(lo.spacing).toBe(0);
    }
  });

  it('even at tight 5 and command 5, a unit leaves to finish off a weakened enemy', () => {
    const st = field();
    const lead = put(st, 'u01a', 0, 1, 4, { persona: {} });
    lead.commandRange = 1;
    put(st, 'u01a', 0, 1, 5, { leader: lead });
    const u = put(st, 'u07a', 0, 2, 4, { leader: lead });
    const foe = put(st, 'u01a', 1, 6, 4, { hp: 5 });
    put(st, 'u01a', 1, 12, 8);
    st.autoPlan = [{ ...DEFAULT_PLAN, push: 3, tight: 5, command: 5, envelop: 1 }, null];
    expect(targetOf(st, u)).toBe(foe.id);
  });
});
