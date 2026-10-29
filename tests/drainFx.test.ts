// 与えたダメージの一部を回復する技（P94）：ダメージの演出のあとに、攻めた側の回復の演出（光・緑の数字・体力の棒・音）が出る
import { describe, expect, it } from 'vitest';
import { apply } from '../src/battle/engine';
import { parseMap } from '../src/battle/map';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { before, cues } from '../src/ui/battleFx';
import { HEX } from '../src/render/battleView';

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

describe('drain effect', () => {
  it('shows the heal on the attacker after the damage', () => {
    for (let seed = 1; seed < 40; seed++) {
      const st: BattleState = { map: parseMap(Array.from({ length: 5 }, () => '. . . . .').join('\n')), units: [], turn: 0, round: 1, maxRounds: 20, winner: null, rng: new RNG(seed), log: [], sideNames: ['攻', '守'] };
      const g = st.map.grid;
      // 長柄足軽（長柄叩き：与えたダメージの21%を回復）が、傷ついた状態で雑兵を叩く
      const a = troop(st, 'u01c', 0, g.idx(1, 2)), t = troop(st, 'u01a', 1, g.idx(2, 2));
      a.hp = Math.round(a.maxHp / 2);
      const b = before(st);
      apply(st, { type: 'skill', unit: a.id, skill: 'k003', target: t.pos });
      const steal = st.log.map((e) => e.d).find((d) => d?.type === 'strike' && d.steal && !d.counter);
      if (!steal || steal.type !== 'strike' || !steal.steal) continue;
      const [s0, s1] = steal.steal;
      const c = cues(st, b, 1, 0);
      const texts = c.fx.filter((f) => f.kind === 'text') as Extract<(typeof c.fx)[number], { kind: 'text' }>[];
      const dmg = texts.find((f) => f.cell === t.pos && !f.chip)!, gain = texts.find((f) => f.cell === a.pos && f.text === `+${s1 - s0}`);
      expect(gain, '攻めた側に緑の数字').toBeTruthy();
      expect(gain!.t0).toBeGreaterThan(dmg.t0);
      const [ax, ay] = g.center(a.pos, HEX);
      expect(c.fx.some((f) => f.kind === 'puff' && f.style === 'heal' && Math.abs(f.x - ax) < 1 && Math.abs(f.y - ay) < 1 && f.t0 > dmg.t0 - 200), '攻めた側に回復の光').toBe(true);
      expect(c.sounds.some((s) => s.id === 'heal'), '回復の音').toBe(true);
      return;
    }
    throw new Error('当たる戦いが見つからない');
  });

  it('the spear wall (k002) no longer drains', () => {
    expect(D.skills.find((s) => s.id === 'k002')!.effects.some((e) => e.type === 'lifesteal')).toBe(false);
    expect(D.skills.find((s) => s.id === 'k003')!.effects.some((e) => e.type === 'lifesteal')).toBe(true);
  });
});
