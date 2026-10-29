// 仕組みのデータの検査（rts-mons/tools/validate_data.py の役割）：id の相互参照、昇進ツリー、数値の範囲、名前の有無。
import { describe, expect, it } from 'vitest';
import { D } from '../src/data/db';
import { RNG } from '../src/core/rng';

describe('system data', () => {
  it('counts', () => {
    expect(D.classes.length).toBe(63);
    expect(D.units.length).toBe(59);
    expect(D.skills.length).toBe(105);
    expect(D.tactics.length).toBe(39);
  });

  it('ids are unique and names exist in both variants', () => {
    for (const list of [D.classes, D.units, D.skills, D.tactics] as { id: string; name: { jp: string; cn: string } }[][]) {
      const ids = new Set(list.map((x) => x.id));
      expect(ids.size).toBe(list.length);
      for (const x of list) { expect(x.name.jp, x.id).toBeTruthy(); expect(x.name.cn, x.id).toBeTruthy(); }
    }
  });

  it('cross references resolve', () => {
    for (const c of D.classes) {
      if (c.from) expect(D.byClass[c.from], c.id).toBeDefined();
      expect(D.byClass[c.line], c.id).toBeDefined();
      for (const t of c.tactics) expect(D.byTactic[t], `${c.id}:${t}`).toBeDefined();
    }
    for (const u of D.units) {
      expect(u.skills.length, u.id).toBeGreaterThan(0);
      for (const s of u.skills) expect(D.bySkill[s], `${u.id}:${s}`).toBeDefined();
      for (const t of u.tactics) expect(D.byTactic[t], `${u.id}:${t}`).toBeDefined();
      for (const p of u.promote) expect(D.byUnit[p.to], `${u.id}->${p.to}`).toBeDefined();
      expect(D.exp.k.units[u.id], u.id).toBeGreaterThan(0);
      expect(D.exp.kill.units[u.id], u.id).toBeDefined();
      // 通常攻撃（反撃に使う）を1つ持つ
      expect(u.skills.some((s) => D.bySkill[s].basic), u.id).toBe(true);
    }
  });

  it('promotion trees have no cycles and tiers rise', () => {
    for (const c of D.classes) {
      let x = c, steps = 0;
      while (x.from) { const p = D.byClass[x.from]; expect(p.tier, c.id).toBeLessThan(x.tier); x = p; expect(++steps).toBeLessThan(5); }
    }
    for (const u of D.units) for (const p of u.promote) expect(D.byUnit[p.to].tier, u.id).toBe(u.tier + 1);
  });

  it('numbers are in range', () => {
    for (const u of D.units) {
      expect(u.hp).toBeGreaterThan(100); expect(u.def).toBeGreaterThan(50); expect(u.move).toBeGreaterThanOrEqual(3);
      for (const k of ['hp', 'mp', 'str', 'int', 'agi'] as const) expect(u.growth[k][0], u.id).toBeLessThanOrEqual(u.growth[k][1]);
    }
    for (const s of D.skills) { expect(s.range[0]).toBeLessThanOrEqual(s.range[1]); expect(s.range[0]).toBeGreaterThanOrEqual(1); }
    for (const k of D.terrain.kinds) for (const a of D.terrain.affinities) {
      const c = D.terrain.moveCost[k][a];
      if (c !== null) expect(c).toBeGreaterThan(0);
    }
    expect(D.exp.k.unique).toBeGreaterThan(0);
  });

  it('every generic class has an exp table', () => {
    for (const c of D.classes) if (!c.unique) expect(D.exp.k.classes[c.id], c.id).toBeGreaterThan(0);
  });
});

describe('rng', () => {
  it('is deterministic', () => {
    const a = new RNG(42), b = new RNG(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    expect(new RNG(42).fork('x').next()).toBe(new RNG(42).fork('x').next());
    expect(new RNG(42).fork('x').next()).not.toBe(new RNG(42).fork('y').next());
  });
});

describe('shared IDs (ima-rpg uses the same IDs; never renumber)', () => {
  it('skills k001-k092, tactics x01-x39, units u01a-u18c stay as they are', () => {
    const pad = (n: number, w: number) => String(n).padStart(w, '0');
    // 0.11.0：技 k093〜k105 と、兵種 u01d・u01e・u19a・u19c・u20a・u20b・u21a・u21b・u21c を足した（前の ID はそのまま）
    expect(D.skills.map((s) => s.id)).toEqual(Array.from({ length: 105 }, (_, i) => `k${pad(i + 1, 3)}`));
    expect(D.tactics.map((t) => t.id)).toEqual(Array.from({ length: 39 }, (_, i) => `x${pad(i + 1, 2)}`));
    expect(D.units.map((u) => u.id).sort()).toEqual([
      'u01a', 'u01b', 'u01c', 'u02a', 'u02b', 'u03a', 'u03b', 'u04a', 'u04b', 'u05a', 'u05b', 'u05c', 'u06a', 'u06b',
      'u07a', 'u07b', 'u07c', 'u08a', 'u08b', 'u08b2', 'u09a', 'u09b', 'u09c', 'u10a', 'u10b', 'u10c', 'u11a', 'u11b', 'u11c',
      'u12a', 'u12b', 'u12b2', 'u13a', 'u13b', 'u13c', 'u14a', 'u14b', 'u14c', 'u15a', 'u15b', 'u15c', 'u16a', 'u16b', 'u16c',
      'u17a', 'u17b', 'u17c', 'u18a', 'u18b', 'u18c',
      'u01d', 'u01e', 'u19a', 'u19c', 'u20a', 'u20b', 'u21a', 'u21b', 'u21c',
    ].sort());
    for (const x of [...D.skills, ...D.tactics, ...D.units]) { expect(x.name.jp, x.id).toBeTruthy(); expect(x.name.cn, x.id).toBeTruthy(); }
  });
});