// public/art にある絵の一覧を src/art/manifest.json に書き出す。絵を足したり消したりしたら実行する。
// ゲームは、この一覧にある絵だけを読み込む（無い絵はコードで描いた形のままになる）。
// 使い方：node tools/art-manifest.mjs
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = 'public/art';
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(webp|png)$/.test(name)) files.push(path.relative(root, p).replaceAll('\\', '/'));
  }
}
walk(root);
files.sort();
/** 「map/ink_mountain_0.webp」→ 組「map/ink_mountain」の0番。番号の無い絵は、その絵だけの組になる */
const groups = {};
for (const f of files) {
  const m = f.match(/^(.*?)(?:_(\d+))?\.(webp|png)$/);
  const key = m[1];
  (groups[key] ??= []).push(f);
}
writeFileSync('src/art/manifest.json', JSON.stringify(groups, null, 1) + '\n');
console.log(`${files.length}枚、${Object.keys(groups).length}組 → src/art/manifest.json`);
