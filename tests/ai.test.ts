import { describe, expect, it } from 'vitest';
import { autoBattle, planUnitDetailed, roleOf, stanceOf } from '../src/ai/ai';
import { NEUTRAL, personalityLabel, personalityOf, weightsFor, type Personality } from '../src/ai/personality';
import { apply } from '../src/battle/engine';
import { parseMap } from '../src/battle/map';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { skillVictims } from '../src/rules/combat';
import { skillOf } from '../src/rules/stats';

const OPEN = Array.from({ length: 9 }, () => '. . . . . . . . . . . . .').join('\n');
function field(text = OPEN, maxRounds = 20): BattleState {
  return { map: parseMap(text), units: [], turn: 0, round: 1, maxRounds, winner: null, rng: new RNG(11), log: [], sideNames: ['攻', '守'] };
}
/** 兵種の能力を持つユニットを置く。leader を渡さなければ武将として置く */
function put(st: BattleState, unitId: string, side: Side, c: number, r: number, opts: { leader?: BUnit; persona?: Partial<Personality>; hp?: number } = {}): BUnit {
  const def = D.byUnit[unitId];
  const t = makeTroop(def, 5);
  const id = st.units.length;
  const u: BUnit = {
    id, side, home: side, kind: opts.leader ? 'troop' : 'general', generalId: `g${id}`, leader: opts.leader?.id ?? id, troopIndex: -1,
    defId: unitId, name: `${def.name.jp}${id}`, level: 5, pos: st.map.grid.idx(c, r),
    hp: opts.hp ?? t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp,
    str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: def.def, move: def.move, affinity: def.affinity,
    commandRange: opts.leader ? 0 : 3, passives: [...def.passives], skills: [...def.skills], tactics: [...def.tactics],
    critPct: 0, healPct: 0, persona: opts.leader ? undefined : { ...NEUTRAL, ...opts.persona },
    statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0,
  };
  st.units.push(u);
  return u;
}
const dist = (st: BattleState, a: BUnit, b: BUnit) => st.map.grid.distance(a.pos, b.pos);
/** 計画どおりに動かしたあとの位置 */
function after(st: BattleState, u: BUnit): number {
  const p = planUnitDetailed(st, u);
  const mv = p.actions.find((a) => a.type === 'move');
  return mv && mv.type === 'move' ? mv.to : u.pos;
}

describe('personality', () => {
  it('traits and abilities shape the axes', () => {
    expect(personalityOf(['brave']).aggression).toBeGreaterThan(0.3);
    expect(personalityOf(['brave']).caution).toBeLessThan(0);
    expect(personalityOf(['craven']).caution).toBeGreaterThan(0.3);
    expect(personalityOf(['genius', 'wise']).cunning).toBeGreaterThan(0.8);
    expect(personalityOf([], [5, 10, 5, 5]).aggression).toBeGreaterThan(personalityOf([], [5, 1, 5, 5]).aggression);
    for (const v of Object.values(personalityOf(['brave', 'warrior', 'ambitious', 'unifier'], [10, 10, 10, 10]))) { expect(v).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(-1); }
  });

  it('labels', () => {
    expect(personalityLabel(NEUTRAL)).toBe('中庸');
    expect(personalityLabel(personalityOf(['brave']))).toContain('猛攻');
    expect(personalityLabel(personalityOf(['craven']))).toContain('慎重');
  });

  it('personality changes the weights', () => {
    const brave = weightsFor(personalityOf(['brave'])), craven = weightsFor(personalityOf(['craven']));
    expect(craven.threat).toBeGreaterThan(brave.threat);
    expect(brave.approach).toBeGreaterThan(craven.approach);
    expect(weightsFor(personalityOf(['cruel'])).weakTarget).toBeGreaterThan(weightsFor(personalityOf(['kind'])).weakTarget);
    expect(weightsFor(personalityOf(['kind'])).heal).toBeGreaterThan(weightsFor(personalityOf(['cruel'])).heal);
    expect(weightsFor(personalityOf(['genius'])).status).toBeGreaterThan(weightsFor(personalityOf(['foolish'])).status);
    for (const v of Object.values(weightsFor(personalityOf(['craven', 'foolish', 'drunkard', 'cruel'])))) expect(v).toBeGreaterThan(0);
  });
});

describe('roles and stance', () => {
  it('roles', () => {
    const st = field();
    expect(roleOf(put(st, 'u01a', 0, 0, 0))).toBe('front');
    expect(roleOf(put(st, 'u06a', 0, 1, 0))).toBe('ranged');
    expect(roleOf(put(st, 'u08a', 0, 2, 0))).toBe('support');
    expect(roleOf(put(st, 'u18a', 0, 3, 0))).toBe('caster');
  });

  it('attackers advance, then engage when close', () => {
    const st = field();
    const a = put(st, 'u01a', 0, 0, 4), d = put(st, 'u01a', 1, 12, 4);
    expect(stanceOf(st, a)).toBe('advance');
    d.pos = st.map.grid.idx(4, 4);
    expect(stanceOf(st, a)).toBe('engage');
  });

  it('a defender holds, unless aggressive or much stronger', () => {
    const st = field();
    put(st, 'u01a', 0, 0, 4);
    const calm = put(st, 'u01a', 1, 12, 4);
    expect(stanceOf(st, calm)).toBe('hold');
    calm.persona = { ...NEUTRAL, aggression: 0.6 };
    expect(stanceOf(st, calm)).toBe('advance');
    calm.persona = { ...NEUTRAL };
    put(st, 'u15c', 1, 12, 5, { leader: calm }); put(st, 'u15c', 1, 12, 3, { leader: calm });
    expect(stanceOf(st, calm)).toBe('advance');   // 戦力が大きく上回る
  });

  it('a hurt general retreats sooner when cautious, later when brave', () => {
    const mk = (persona: Partial<Personality>, hpRatio: number) => {
      const st = field();
      const g = put(st, 'u01a', 0, 4, 4, { persona });
      g.hp = Math.round(g.maxHp * hpRatio);
      put(st, 'u01a', 1, 6, 4);
      return stanceOf(st, g);
    };
    expect(mk({ caution: 0.8 }, 0.45)).toBe('retreat');
    expect(mk({}, 0.45)).toBe('engage');
    expect(mk({}, 0.2)).toBe('retreat');
    expect(mk({ aggression: 0.9, caution: -0.4 }, 0.2)).toBe('engage');
  });
});

describe('behaviour', () => {
  it('finishes off a target it can kill', () => {
    const st = field();
    const a = put(st, 'u01a', 0, 5, 4);
    // 元気な相手は硬くて倒しきれない。弱った相手は一撃で倒せる
    const healthy = put(st, 'u10c', 1, 6, 4), weak = put(st, 'u01a', 1, 5, 5, { hp: 40 });
    // 移動してから撃つこともある（直線の技で両方を巻き込める位置など）。弱った相手が必ず狙いに入っていること
    let hitsWeak = false;
    for (const act of planUnitDetailed(st, a).actions) {
      if (act.type === 'move') expect(apply(st, act)).toBe(true);
      if (act.type === 'skill') hitsWeak = skillVictims(st, a, skillOf(act.skill), act.target).some((v) => v.id === weak.id);
    }
    expect(hitsWeak).toBe(true);
    expect(healthy.alive).toBe(true);
  });

  it('prefers the enemy general', () => {
    const st = field();
    const a = put(st, 'u01a', 0, 5, 4, { persona: { honor: 0.8 } });
    const gen = put(st, 'u01a', 1, 6, 4);
    put(st, 'u01a', 1, 5, 5, { leader: gen });
    const act = planUnitDetailed(st, a).actions.find((x) => x.type === 'skill');
    expect(act && act.type === 'skill' ? act.target : -1).toBe(gen.pos);
  });

  it('a healer heals a badly wounded ally', () => {
    const st = field();
    const lead = put(st, 'u01a', 0, 3, 4, { persona: { care: 0.5 } });
    lead.hp = Math.round(lead.maxHp * 0.3);
    const medic = put(st, 'u08a', 0, 2, 4, { leader: lead });
    put(st, 'u01a', 1, 10, 4);
    const act = planUnitDetailed(st, medic).actions.find((x) => x.type === 'tactic');
    expect(act).toBeDefined();
    expect(act && act.type === 'tactic' ? D.byTactic[act.tactic].kind : '').toBe('heal');
    expect(act && act.type === 'tactic' ? act.target : -1).toBe(lead.pos);
  });

  it('troops stay within command range of their leader', () => {
    const st = field();
    const lead = put(st, 'u01a', 0, 1, 4);
    lead.commandRange = 2;
    lead.acted = true; lead.moved = true;      // 武将は動かない
    const t = put(st, 'u07a', 0, 2, 4, { leader: lead });   // 足の速い兵
    put(st, 'u01a', 1, 12, 4);
    expect(st.map.grid.distance(after(st, t), lead.pos)).toBeLessThanOrEqual(2);
  });

  it('a holding defender stays put while the enemy is far; an aggressive one comes out', () => {
    const st = field();
    put(st, 'u01a', 0, 0, 4);
    st.turn = 1;
    const calm = put(st, 'u01a', 1, 12, 4);
    expect(after(st, calm)).toBe(calm.pos);
    calm.persona = { ...NEUTRAL, aggression: 0.8 };
    const to = after(st, calm);
    expect(st.map.grid.distance(to, st.units[0].pos)).toBeLessThan(dist(st, calm, st.units[0]));
  });

  it('a retreating general moves away; a brave one closes in', () => {
    const run = (persona: Partial<Personality>) => {
      const st = field();
      const g = put(st, 'u01a', 0, 6, 4, { persona });
      g.hp = Math.round(g.maxHp * 0.25);
      const foe = put(st, 'u15c', 1, 8, 4);
      return st.map.grid.distance(after(st, g), foe.pos) - dist(st, g, foe);
    };
    expect(run({ caution: 0.8 })).toBeGreaterThan(0);                       // 離れる
    expect(run({ aggression: 0.9, caution: -0.4, honor: 0.5 })).toBeLessThan(0);   // 詰める
  });

  it('archers do not end next to an enemy when they can shoot from range', () => {
    const st = field();
    const lead = put(st, 'u01a', 0, 2, 4);
    lead.acted = true; lead.moved = true;
    const archer = put(st, 'u06a', 0, 3, 4, { leader: lead });
    const foe = put(st, 'u01a', 1, 6, 4);
    const p = planUnitDetailed(st, archer);
    expect(p.actions.some((a) => a.type === 'skill')).toBe(true);
    expect(st.map.grid.distance(after(st, archer), foe.pos)).toBeGreaterThanOrEqual(2);
  });

  it('avoids hitting its own side with area attacks when cautious about it', () => {
    const st = field();
    const lead = put(st, 'u01a', 0, 3, 4, { persona: { care: 0.8 } });
    lead.acted = true; lead.moved = true;
    const gun = put(st, 'u04a', 0, 4, 4, { leader: lead });      // 直線の貫通射撃を持つ
    put(st, 'u01a', 0, 5, 4, { leader: lead }).acted = true;      // 射線上の味方
    const foe = put(st, 'u01a', 1, 6, 4);
    const ally = st.units[2];
    const plan = planUnitDetailed(st, gun).actions;
    // 移動してから、撃つ技が味方を巻き込まないことを確かめる
    for (const a of plan) {
      if (a.type === 'move') { expect(apply(st, a)).toBe(true); continue; }
      if (a.type === 'skill') expect(skillVictims(st, gun, skillOf(a.skill), a.target).map((v) => v.id)).not.toContain(ally.id);
    }
    expect(foe.alive).toBe(true);
  });

  it('plans never break the rules, and battles between AIs always end', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const st = field(OPEN, 20);
      st.rng = new RNG(seed);
      const a = put(st, 'u01a', 0, 1, 4, { persona: personalityOf(['brave']) });
      put(st, 'u06a', 0, 0, 3, { leader: a }); put(st, 'u08a', 0, 0, 5, { leader: a }); put(st, 'u07a', 0, 1, 3, { leader: a });
      const d = put(st, 'u01a', 1, 11, 4, { persona: personalityOf(['craven', 'wise']) });
      put(st, 'u09a', 1, 10, 4, { leader: d }); put(st, 'u04a', 1, 12, 3, { leader: d }); put(st, 'u18a', 1, 12, 5, { leader: d });
      // 1ユニットずつ、計画した行動がすべて受け付けられることを確かめながら進める
      for (let i = 0; i < 40 && st.winner === null; i++) {
        const u = st.units.find((x) => x.alive && x.side === st.turn && !x.acted);
        if (!u) { apply(st, { type: 'endTurn' }); continue; }
        for (const act of planUnitDetailed(st, u).actions) expect(apply(st, act), JSON.stringify(act)).toBe(true);
      }
      autoBattle(st);
      expect(st.winner, `seed ${seed}`).not.toBeNull();
    }
  });
});
