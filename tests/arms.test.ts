import { describe, expect, it } from 'vitest';
import { armShares } from '../src/bridge/arms';
import { aliveNations, yearOf } from '../src/bridge/histsim';
import { convert } from '../src/convert/convert';
import { D } from '../src/data/db';
import { loadFixture } from './helpers';

describe('recorded arms from the save', () => {
  it('shares add up to one, and a save without arms gives null', async () => {
    const save = await loadFixture('shunju_fid5_259bc');
    const w = save.world, year = yearOf(w);
    for (const n of aliveNations(w)) {
      const s = armShares(w, n, year);
      expect(s, n.root.ja).not.toBeNull();
      expect(Object.values(s!).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    }
    const plain = await loadFixture('invented_archipelago_y30');
    expect(armShares(plain.world, aliveNations(plain.world)[0], yearOf(plain.world))).toBeNull();
  });

  it('the troops a faction can raise follow its recorded arms', async () => {
    const gs = convert(await loadFixture('shunju_fid5_259bc'));
    const share = (name: string, line: number): number => {
      const f = Object.values(gs.factions).find((x) => x.name.ja === name)!;
      const sum = Object.values(f.recruit).reduce((a, b) => a + b, 0);
      return Object.entries(f.recruit).filter(([id]) => D.byUnit[id].line === line).reduce((a, [, v]) => a + v, 0) / sum;
    };
    // 趙は胡服騎射で騎兵が多い。秦は鋭士（盾の系統）と弩。楚は舟師
    expect(share('趙', 7)).toBeGreaterThan(share('秦', 7) * 2);
    expect(share('秦', 9)).toBeGreaterThan(0.1);
    expect(share('秦', 4)).toBeGreaterThan(0.1);
    expect(share('楚', 3)).toBeGreaterThan(0.05);
    expect(share('秦', 3)).toBe(0);
    // 戦国の日本：どの家も鉄砲と騎馬を持つ
    const jp = convert(await loadFixture('sengoku_fid5_1575'));
    for (const f of Object.values(jp.factions)) {
      const lines = new Set(Object.keys(f.recruit).map((id) => D.byUnit[id].line));
      expect(lines.has(1) && lines.has(4) && lines.has(7), f.name.ja).toBe(true);
    }
  });
});
