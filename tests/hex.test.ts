import { describe, expect, it } from 'vitest';
import { HexGrid } from '../src/core/hex';
import { mapFromProvince, mapToText, parseMap } from '../src/battle/map';
import { loadFixture } from './helpers';

describe('hex grid', () => {
  const g = new HexGrid(7, 6);

  it('neighbors: 6 inside, fewer at the edge, and symmetric', () => {
    expect(g.neighbors(g.idx(3, 3)).length).toBe(6);
    expect(g.neighbors(g.idx(0, 0)).length).toBe(2);
    for (let i = 0; i < g.n; i++) for (const j of g.neighbors(i)) {
      expect(g.neighbors(j)).toContain(i);
      expect(g.distance(i, j)).toBe(1);
    }
  });

  it('odd columns sit half a hex lower', () => {
    // (1,0) は奇数列：左右の上側の隣は (0,0) と (2,0)、下側は (0,1) と (2,1)
    const nb = g.neighbors(g.idx(1, 0)).sort((a, b) => a - b);
    expect(nb).toEqual([g.idx(0, 0), g.idx(2, 0), g.idx(0, 1), g.idx(1, 1), g.idx(2, 1)].sort((a, b) => a - b));
  });

  it('distance', () => {
    expect(g.distance(g.idx(0, 0), g.idx(0, 0))).toBe(0);
    expect(g.distance(g.idx(0, 0), g.idx(0, 3))).toBe(3);
    expect(g.distance(g.idx(0, 0), g.idx(2, 0))).toBe(2);
    expect(g.distance(g.idx(0, 0), g.idx(2, 1))).toBe(2);
    expect(g.distance(g.idx(0, 0), g.idx(6, 5))).toBe(8);
  });

  it('range and line', () => {
    const c = g.idx(3, 3);
    expect(g.range(c, 1).length).toBe(7);
    expect(g.range(c, 2).length).toBe(19);
    expect(g.range(c, 2, 1).length).toBe(18);
    for (const i of g.range(c, 2)) expect(g.distance(c, i)).toBeLessThanOrEqual(2);
    for (let d = 0; d < 6; d++) {
      const line = g.line(c, d, 2);
      expect(line.length).toBe(2);
      expect(g.distance(c, line[0])).toBe(1);
      expect(g.distance(c, line[1])).toBe(2);
      expect(g.dirTo(c, line[1])).toBe(d);
    }
    // 盤の端で止まる
    expect(g.line(g.idx(0, 0), 3, 3).length).toBe(0);
  });

  it('pixel round trip', () => {
    for (let i = 0; i < g.n; i++) {
      const [x, y] = g.center(i, 20);
      expect(g.pick(x, y, 20)).toBe(i);
      expect(g.pick(x + 5, y - 5, 20)).toBe(i);
    }
    expect(g.pick(-100, -100, 20)).toBe(-1);
  });
});

describe('battle map', () => {
  it('parses text maps', () => {
    const m = parseMap(`
      . . T ~ . .
      . = = B = C
      . . ^ ~ , W
    `);
    expect(m.grid.w).toBe(6); expect(m.grid.h).toBe(3);
    expect(m.terrain[m.grid.idx(3, 1)]).toBe('bridge');
    expect(m.terrain[m.grid.idx(5, 1)]).toBe('castle');
    expect(mapToText(m).split('\n')[2]).toBe('..^~,W');
    expect(m.spawn[0].length).toBeGreaterThan(0);
  });

  it('generates a map from every province, deterministically', async () => {
    for (const f of ['sengoku_fid5_1575', 'invented_archipelago_y30']) {
      const w = (await loadFixture(f)).world;
      const kinds = new Set<string>();
      for (const p of w.provinces) {
        const m = mapFromProvince(w, p.id, { capital: p.id % 3 === 0 });
        expect(m.terrain.length).toBe(m.grid.n);
        expect(m.spawn[0].length, `${f} ${p.id}`).toBeGreaterThanOrEqual(15);
        expect(m.spawn[1].length, `${f} ${p.id}`).toBeGreaterThanOrEqual(15);
        m.terrain.forEach((k) => kinds.add(k));
        if (p.id < 5) expect(mapToText(mapFromProvince(w, p.id, { capital: p.id % 3 === 0 }))).toBe(mapToText(m));
      }
      // 地形に変化がある
      expect(kinds.size, f).toBeGreaterThanOrEqual(4);
    }
    // すべての領の地図を作るので、ほかの試験と同時に走ると5秒を超えることがある
  }, 30_000);
});
