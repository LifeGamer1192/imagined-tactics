import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSaveFile, type HSave } from '../src/bridge/histsim';

export const FIXTURES = ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'rome_fid3_212bc', 'invented_archipelago_y30'] as const;
const cache = new Map<string, HSave>();

export async function loadFixture(name: string): Promise<HSave> {
  const hit = cache.get(name);
  if (hit) return hit;
  const path = fileURLToPath(new URL(`./fixtures/${name}.histsim`, import.meta.url));
  const { save } = await readSaveFile(new Uint8Array(readFileSync(path)));
  cache.set(name, save);
  return save;
}
