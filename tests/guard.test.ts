// 身代わり（馬廻衆の特技 guard。P107）を、いろいろな向きから確かめる（P111）。
// 決まり：隣にいる「自分の将」が「敵」から受けるダメージの30%を、代わりに受ける。将は少なくとも1は受ける。
// 兵は残りの体力より多くは受けない。毒など、だれからでもないダメージ・味方からのダメージには効かない。
import { describe, expect, it } from 'vitest';
import { addStatus, apply, startTurn } from '../src/battle/engine';
import { parseMap, type BattleMap } from '../src/battle/map';
import type { BUnit, BattleState, Side } from '../src/battle/types';
import { makeTroop } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D } from '../src/data/db';
import { forecastSkill, guardSplit, skillDamage, tacticDamage, takenDamage } from '../src/rules/combat';
import { basicSkill, skillOf } from '../src/rules/stats';
import { logText } from '../src/ui/text';
import { before, cues } from '../src/ui/battleFx';

function troop(st: BattleState, unitId: string, side: Side, pos: number, leader?: number): BUnit {
  const def = D.byUnit[unitId], t = makeTroop(def, 1);
  const u: BUnit = {
    id: st.units.length, side, home: side, kind: 'troop', generalId: `t${st.units.length}`, leader: leader ?? st.units.length, troopIndex: 0,
    defId: unitId, name: `${def.name.jp}${st.units.length}`, level: 1, pos, hp: t.stats.hp, maxHp: t.stats.hp, mp: 999, maxMp: 999,
    str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: def.def, move: def.move, affinity: def.affinity, commandRange: 9,
    passives: [...def.passives], skills: [...def.skills], tactics: [...def.tactics], critPct: 0, healPct: 0,
    statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0,
  };
  st.units.push(u);
  return u;
}
function general(st: BattleState, side: Side, pos: number): BUnit {
  const u = troop(st, 'u01a', side, pos);
  u.kind = 'general'; u.hp = u.maxHp = 5000;
  return u;
}
function field(text = Array.from({ length: 7 }, () => '. . . . . . . . .').join('\n'), seed = 7): BattleState {
  const map: BattleMap = parseMap(text);
  return { map, units: [], turn: 0, round: 1, maxRounds: 20, winner: null, rng: new RNG(seed), log: [], sideNames: ['攻', '守'] };
}
/** 守り手の将と、その隣の馬廻衆、攻め手の将（勝ち負けが決まらないよう）と攻め手の兵 */
function scene(seed = 7) {
  const st = field(undefined, seed), g = st.map.grid;
  const gen = general(st, 1, g.idx(4, 3));
  const guard = troop(st, 'u01f', 1, g.idx(5, 3), gen.id);
  const foeGen = general(st, 0, g.idx(0, 0));
  const foe = troop(st, 'u01a', 0, g.idx(3, 3), foeGen.id);
  return { st, g, gen, guard, foeGen, foe };
}
const hit = (st: BattleState, a: BUnit, t: BUnit, skill = a.skills[0]) => {
  a.acted = false; a.moved = false;
  addStatus(st, a, 'sureNext', -1);
  return apply(st, { type: 'skill', unit: a.id, skill, target: t.pos });
};

describe('身代わり（guard）', () => {
  it('式：30%を四捨五入、将は少なくとも1、兵は残りの体力まで', () => {
    const { st, gen, guard, foe } = scene();
    expect(guardSplit(st, gen, foe, 100)).toMatchObject({ self: 70, share: 30, guard });
    expect(guardSplit(st, gen, foe, 101)).toMatchObject({ self: 71, share: 30 });
    expect(guardSplit(st, gen, foe, 105)).toMatchObject({ self: 73, share: 32 }); // 31.5 → 32
    expect(guardSplit(st, gen, foe, 2)).toMatchObject({ self: 1, share: 1 });
    expect(guardSplit(st, gen, foe, 1)).toMatchObject({ self: 1, share: 0, guard: null });
    guard.hp = 10;
    expect(guardSplit(st, gen, foe, 100)).toMatchObject({ self: 90, share: 10 });
  });

  it('実際の攻撃で、将と身代わりの減りの合計が一撃のダメージで、身代わりがおよそ3割', () => {
    let shared = 0, total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { st, gen, guard, foe } = scene(seed);
      const g0 = gen.hp, k0 = guard.hp;
      expect(hit(st, foe, gen)).toBe(true);
      const e = st.log.find((x) => x.key === 'hit' || x.key === 'hit.crit')!;
      const gLost = g0 - gen.hp, kLost = k0 - guard.hp;
      // 反撃は将がするので、身代わりの兵は反撃では傷つかない
      expect(gLost + kLost).toBe(e.vars.dmg);
      expect(st.log.find((x) => x.key === 'guard')?.vars.dmg).toBe(kLost);
      expect(kLost).toBe(guardSplit({ ...st, units: st.units.map((u) => (u.id === guard.id ? { ...u, hp: k0 } : u)) }, gen, foe, Number(e.vars.dmg)).share);
      shared += kLost; total += gLost + kLost;
    }
    expect(shared / total).toBeGreaterThan(0.29);
    expect(shared / total).toBeLessThan(0.31);
  });

  it('隣でなければ・ほかの将の兵なら・寝返り中なら・倒れていれば、かばわない', () => {
    const cases: [string, (s: ReturnType<typeof scene>) => void][] = [
      ['2マス離れた', (s) => { s.guard.pos = s.g.idx(6, 3); }],
      ['ほかの将の兵', (s) => { const other = general(s.st, 1, s.g.idx(8, 6)); s.guard.leader = other.id; }],
      ['寝返って敵の側', (s) => { s.guard.side = 0; }],
      ['倒れている', (s) => { s.guard.alive = false; }],
    ];
    for (const [name, mod] of cases) {
      const s = scene();
      mod(s);
      expect(guardSplit(s.st, s.gen, s.foe, 100).share, name).toBe(0);
      expect(hit(s.st, s.foe, s.gen), name).toBe(true);
      expect(s.st.log.some((x) => x.key === 'guard'), name).toBe(false);
    }
  });

  it('兵や、身代わりの無い兵の隣の将はかばわない（将だけ・馬廻衆だけ）', () => {
    const s = scene();
    const mate = troop(s.st, 'u01a', 1, s.g.idx(4, 2), s.gen.id);
    expect(guardSplit(s.st, mate, s.foe, 100).share).toBe(0);           // 兵は守られない
    s.guard.pos = s.g.idx(8, 6);
    expect(guardSplit(s.st, s.gen, s.foe, 100).share).toBe(0);          // 隣にいるのは身代わりの無い兵だけ
  });

  it('毒（だれからでもない）・味方からのダメージには効かない', () => {
    const s = scene();
    addStatus(s.st, s.gen, 'poison', 3);
    s.st.turn = 0;
    startTurn(s.st, 1);
    expect(s.st.log.some((x) => x.key === 'poison')).toBe(true);
    expect(s.st.log.some((x) => x.key === 'guard')).toBe(false);
    const ally = troop(s.st, 'u01a', 1, s.g.idx(4, 4), s.gen.id);
    expect(guardSplit(s.st, s.gen, ally, 100).share).toBe(0);
  });

  it('軍略のダメージ・将が攻めたときの反撃にも効く', () => {
    // 軍略
    const s = scene();
    s.foe.tactics = ['x01'];
    expect(guardSplit(s.st, s.gen, s.foe, tacticDamage(s.st, s.foe, D.byTactic.x01, s.gen)).share).toBeGreaterThan(0);
    const k0 = s.guard.hp, g0 = s.gen.hp;
    s.foe.acted = false;
    expect(apply(s.st, { type: 'tactic', unit: s.foe.id, tactic: 'x01', target: s.gen.pos })).toBe(true);
    const full = Number(s.st.log.find((x) => x.key === 'tactic.hit')!.vars.dmg);   // 乱数の入った、実際の一撃
    expect(k0 - s.guard.hp).toBe(guardSplit(s.st, s.gen, s.foe, full).share);
    expect(g0 - s.gen.hp).toBe(full - (k0 - s.guard.hp));
    // 反撃：守り手の将が攻め手の兵を叩き、反撃を受ける（当たるまで種を変える）
    let seen = false;
    for (let seed = 1; seed <= 30 && !seen; seed++) {
      const r = scene(seed);
      r.st.turn = 1;
      r.foe.hp = r.foe.maxHp = 99999;
      const k1 = r.guard.hp;
      hit(r.st, r.gen, r.foe);
      const c = r.st.log.find((x) => x.key === 'guard');
      // 将が攻めた手番に「かばった」と出るのは、反撃を受けたときだけ
      if (c) {
        expect(c.vars.tid).toBe(r.gen.id);
        expect(k1 - r.guard.hp).toBe(c.vars.dmg);
        seen = true;
      }
    }
    expect(seen).toBe(true);
  });

  it('身代わりが倒れるほどの一撃：兵は体力のぶんだけ受けて倒れ、あふれは将が受ける', () => {
    const s = scene();
    s.guard.hp = 5;
    const g0 = s.gen.hp;
    expect(hit(s.st, s.foe, s.gen)).toBe(true);
    const dmg = Number(s.st.log.find((x) => x.key === 'hit' || x.key === 'hit.crit')!.vars.dmg);
    expect(s.guard.alive).toBe(false);
    expect(g0 - s.gen.hp).toBe(dmg - 5);
  });

  it('身代わりが2隊いても、重ならない（割合の高い1隊だけ）', () => {
    const s = scene();
    const second = troop(s.st, 'u01f', 1, s.g.idx(4, 2), s.gen.id);
    const k0 = s.guard.hp, k1 = second.hp;
    expect(hit(s.st, s.foe, s.gen)).toBe(true);
    expect(s.st.log.filter((x) => x.key === 'guard').length).toBe(1);
    expect((k0 - s.guard.hp) + (k1 - second.hp)).toBe(s.st.log.find((x) => x.key === 'guard')!.vars.dmg);
  });

  it('身代わりのおかげで将が倒れないとき、見込みも「倒せる」と言わない', () => {
    const s = scene();
    const full = skillDamage(s.st, s.foe, skillOf(s.foe.skills[0]), s.gen);
    s.gen.hp = full - 1;                     // 身代わりが無ければ倒れる
    const f = forecastSkill(s.st, s.foe, skillOf(s.foe.skills[0]), s.gen, basicSkill(s.gen));
    expect(f.damage + (f.guard?.damage ?? 0)).toBe(full);
    expect(f.guard?.who).toBe(s.guard);
    expect(f.damage).toBeLessThan(s.gen.hp);
    expect(takenDamage(s.st, s.gen, s.foe, full)).toBe(f.damage);
  });

  it('将が受けたダメージの記録（深手の相手）は、将が受けたぶんだけ', () => {
    const s = scene();
    const g0 = s.gen.hp;
    expect(hit(s.st, s.foe, s.gen)).toBe(true);
    expect(s.gen.hurtBy?.[s.foe.generalId]).toBe(g0 - s.gen.hp);
  });

  it('記録の文：「◯◯が◯◯をかばい、Nを代わりに受けた」', () => {
    const s = scene();
    expect(hit(s.st, s.foe, s.gen)).toBe(true);
    const e = s.st.log.find((x) => x.key === 'guard')!;
    expect(logText(e)).toMatch(new RegExp(`${s.guard.name}が${s.gen.name}をかばい、\\d+を代わりに受けた`));
  });

  it('演出：将のマスに「かばわれた」と将が受けたぶん、兵のマスに「身代わり」と受けたぶん、2つのマスが光る', () => {
    const s = scene();
    const b = before(s.st);
    const g0 = s.gen.hp, k0 = s.guard.hp;
    expect(hit(s.st, s.foe, s.gen)).toBe(true);
    const fx = cues(s.st, b, 1, 0).fx;
    type Text = { kind: 'text'; cell?: number; label?: string; text: string };
    const texts = fx.filter((f) => f.kind === 'text') as Text[];
    expect(texts.find((f) => f.cell === s.gen.pos && f.label === 'かばわれた')?.text).toBe(String(g0 - s.gen.hp));
    expect(texts.find((f) => f.cell === s.guard.pos && f.label === '身代わり')?.text).toBe(String(k0 - s.guard.hp));
    expect(fx.some((f) => f.kind === 'flash' && (f as { cells: number[] }).cells.includes(s.guard.pos) && (f as { cells: number[] }).cells.includes(s.gen.pos))).toBe(true);
    expect(fx.some((f) => f.kind === 'slide' && (f as { unit: number }).unit === s.guard.id)).toBe(true);
  });
});
