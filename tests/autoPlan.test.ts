// 味方のおまかせの方針（P50）：性格の代わりに方針で動く。狙う相手が方針で変わる。セーブに残る
import { describe, expect, it } from 'vitest';
import { personaOf, planUnitDetailed } from '../src/ai/ai';
import { NEUTRAL, planPersona, type AutoPlan, type Personality } from '../src/ai/personality';
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
    const { st, u, near } = scene({ push: 'wait', aim: 'general', mind: 'cunning' });
    expect(personaOf(st, u)).toEqual(planPersona({ push: 'wait', aim: 'general', mind: 'cunning' }));
    expect(personaOf(st, near)).toEqual(st.units[near.leader].persona);
  });

  it('aims at the nearest, the general, or the weakened enemy as chosen', () => {
    const pick = (aim: AutoPlan['aim']) => { const s = scene({ push: 'push', aim, mind: 'direct' }); return [targetOf(s.st, s.u), s] as const; };
    const [n, sn] = pick('near'), [g, sg] = pick('general'), [w, sw] = pick('weak');
    expect(n).toBe(sn.near.id);
    expect(g).toBe(sg.gen.id);
    expect(w).toBe(sw.weak.id);
  });

  it('is kept in the save', async () => {
    const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
    const f = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
    const c = newCampaign(gs, save.world, f.id);
    c.autoPlan = { push: 'wait', aim: 'weak', mind: 'cunning' };
    const back = restore(JSON.parse(JSON.stringify(snapshot(c))));
    expect(back.autoPlan).toEqual(c.autoPlan);
  });
});
