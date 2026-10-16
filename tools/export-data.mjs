// 兄弟の作品（ima-rpg など）と共有する戦闘のデータを、公開物の data/ に写す（ビルドの前に実行）。
// 正本は data/system/*.json。ここでは中身を変えずに写し、写した日時と版を data/index.json に書く。
// 公開先では https://lifegamer1192.github.io/imagined-tactics/data/<名前>.json で読める。
// 使い方：node tools/export-data.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FILES = ['skills', 'tactics', 'units', 'classes', 'statuses', 'combat', 'terrain', 'exp', 'growth'];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
mkdirSync('public/data', { recursive: true });
const index = { version: pkg.version, schema: 'docs/SHARED_DATA.md', formulas: 'docs/COMBAT.md', files: {} };
for (const f of FILES) {
  const text = readFileSync(`data/system/${f}.json`, 'utf8');
  JSON.parse(text);
  writeFileSync(`public/data/${f}.json`, text);
  index.files[f] = `${f}.json`;
}
writeFileSync('public/data/index.json', JSON.stringify(index, null, 1) + '\n');
console.log(`data/ に ${FILES.length} 個を写した（版 ${pkg.version}）`);
