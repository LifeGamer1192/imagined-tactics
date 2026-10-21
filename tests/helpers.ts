import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BattleMap } from '../src/battle/map';
import { readSaveFile, type HSave } from '../src/bridge/histsim';

export const FIXTURES = ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'sangoku_fid5_212', 'rome_fid3_212bc', 'invented_archipelago_y30'] as const;
const cache = new Map<string, HSave>();

export async function loadFixture(name: string): Promise<HSave> {
  const hit = cache.get(name);
  if (hit) return hit;
  const path = fileURLToPath(new URL(`./fixtures/${name}.histsim`, import.meta.url));
  const { save } = await readSaveFile(new Uint8Array(readFileSync(path)));
  cache.set(name, save);
  return save;
}

/** 領から作った戦場の、攻め手の辺のまん中（街道の始まり） */
export function attackStart(m: BattleMap): number {
  const dmin = Math.min(...m.spawn[0].map((i) => m.depth![i]));
  return m.spawn[0].filter((i) => m.depth![i] === dmin).sort((a, b) => Math.abs(m.lateral![a]) - Math.abs(m.lateral![b]) || m.lateral![a] - m.lateral![b])[0];
}