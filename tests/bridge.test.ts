import { describe, expect, it } from 'vitest';
import { aliveNations, parseSave, SaveError, yearOf } from '../src/bridge/histsim';
import { FIXTURES, loadFixture } from './helpers';

describe('hist-sim save reader', () => {
  it('reads the sengoku save', async () => {
    const s = await loadFixture('sengoku_fid5_1575');
    const w = s.world;
    expect(s.format).toBe('hist-sim');
    expect(yearOf(w)).toBe(1575);
    expect(w.scenario?.id).toBe('sengoku');
    // 見本は公開版の hist-sim で作り直すことがあるので、数は幅で見る
    expect(aliveNations(w).length).toBeGreaterThan(20);
    expect(w.provinces.length).toBeGreaterThan(50);
    expect(w.armies.length).toBeGreaterThan(20);
    expect(Object.values(w.people).filter((p) => p.died === -1).length).toBeGreaterThan(50);
    // 型付き配列が復元されている
    expect(w.ps.owner).toBeInstanceOf(Uint16Array);
    expect(w.ps.owner.length).toBe(w.provinces.length);
    expect(w.map.biome.length).toBe(w.map.n);
  });

  it('reads every fixture', async () => {
    for (const f of FIXTURES) {
      const s = await loadFixture(f);
      expect(aliveNations(s.world).length, f).toBe(s.summary.nations);
      expect(s.world.provinceName.length, f).toBe(s.world.provinces.length);
    }
  });

  it('rejects other files', () => {
    expect(() => parseSave('not json')).toThrow(SaveError);
    expect(() => parseSave('{"format":"other","world":{}}')).toThrow(SaveError);
  });
});
