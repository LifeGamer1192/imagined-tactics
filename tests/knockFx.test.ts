// 押し出す技（0.10.0）の演出：押し付けたら数字に「押し付け×1.5」、後ろの駒にぶつけたらその駒に「ぶつかった」の数字
import { describe, expect, it } from 'vitest';
import { apply } from '../src/battle/engine';
import { parseMap } from '../src/battle/map';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { before, cues } from '../src/ui/battleFx';

function troop(st: BattleState, unitId: string, side: Side, pos: number): BUnit {
  const def = D.byUnit[unitId], t = makeTroop(def, 1);
  const u = {
    id: st.units.length, side, home: side, kind: 'general', generalId: `t${st.units.length}`, leader: st.units.length, troopIndex: -1,
    defId: unitId, name: def.name.jp, level: 1, pos, hp: t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp,
    str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: def.def, move: def.move, affinity: def.affinity, commandRange: 9,
    passives: [], skills: [...def.skills], tactics: [...def.tactics], critPct: 0, healPct: 0,
    statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0,
  } as BUnit;
  st.units.push(u);
  return u;
}
const field = (seed: number): BattleState => ({ map: parseMap(Array.from({ length: 7 }, () => '. . . . . . . . .').join('\n')), units: [], turn: 0, round: 1, maxRounds: 20, winner: null, rng: new RNG(seed), log: [], sideNames: ['攻', '守'] });
type Text = { kind: 'text'; cell?: number; label?: string; text: string };

describe('knockback effects', () => {
  it('pressing against the edge shows a bigger number labelled with the multiplier', () => {
    for (let seed = 1; seed < 40; seed++) {
      const st = field(seed), g = st.map.grid;
      const a = troop(st, 'u09c', 0, g.idx(7, 3)), t = troop(st, 'u01a', 1, g.idx(8, 3));
      const b = before(st);
      apply(st, { type: 'skill', unit: a.id, skill: 'k037', target: t.pos });
      if (!st.log.some((e) => e.key === 'hit' || e.key === 'hit.crit')) continue;
      const texts = cues(st, b, 1, 0).fx.filter((f) => f.kind === 'text') as Text[];
      expect(texts.some((f) => f.cell === t.pos && f.label === `押し付け×${D.combat.knock.wallMult}`)).toBe(true);
      return;
    }
    throw new Error('当たる戦いが見つからない');
  });

  it('bumping into a unit behind shows its damage', () => {
    for (let seed = 1; seed < 40; seed++) {
      const st = field(seed), g = st.map.grid;
      const a = troop(st, 'u09c', 0, g.idx(2, 3)), t = troop(st, 'u01a', 1, g.idx(3, 3));
      const o = troop(st, 'u01a', 1, g.step(t.pos, g.dirTo(a.pos, t.pos)));
      const b = before(st);
      apply(st, { type: 'skill', unit: a.id, skill: 'k037', target: t.pos });
      const c = st.log.find((e) => e.key === 'collide');
      if (!c) continue;
      const texts = cues(st, b, 1, 0).fx.filter((f) => f.kind === 'text') as Text[];
      expect(texts.some((f) => f.cell === o.pos && f.label === 'ぶつかった' && f.text === String(c.vars.dmg))).toBe(true);
      return;
    }
    throw new Error('ぶつかる戦いが見つからない');
  });
});
