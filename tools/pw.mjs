// Playwright の読み込み。兄弟フォルダ ../hist-sim にあればそれを借り、無ければこのリポジトリ（と NODE_PATH・全体に入れたもの）から探す。
import { createRequire } from 'node:module';
import path from 'node:path';
const bases = [path.resolve('../hist-sim/package.json'), path.resolve('package.json')];
let found;
for (const base of bases) {
  try { found = createRequire(base)('playwright'); break; } catch { /* 次を探す */ }
}
if (!found) {
  console.error('Playwright が見つからない。`npm i -D playwright` と `npx playwright install chromium` で入れる（または ../hist-sim に置く）。');
  process.exit(1);
}
export default found;
