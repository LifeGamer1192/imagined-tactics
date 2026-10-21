// 史実の人物の顔絵（hist-sim・ima-rpg・hex-sim で共有）を、hist-sim から写す。写すだけで、手では直さない。
// 写すもの：public/art/faces/（台帳 faces.json と、時代ごとの絵 <時代>/<id>.webp）、src/art/faces.ts（引く関数）
// 使い方：node tools/sync-faces.mjs [hist-sim の場所 = ../hist-sim]
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const hist = path.resolve(process.argv[2] ?? '../hist-sim');
const from = path.join(hist, 'public/art/faces'), code = path.join(hist, 'src/art/faces.ts');
if (!existsSync(path.join(from, 'faces.json')) || !existsSync(code)) {
  console.error(`hist-sim の顔絵が見つからない：${from}`);
  process.exit(1);
}
// 消えた絵が残らないように、前の写しを消してから写す
rmSync('public/art/faces', { recursive: true, force: true });
cpSync(from, 'public/art/faces', { recursive: true });
cpSync(code, 'src/art/faces.ts');
let n = 0;
const walk = (d) => { for (const x of readdirSync(d)) { const p = path.join(d, x); if (statSync(p).isDirectory()) walk(p); else if (x.endsWith('.webp')) n++; } };
walk('public/art/faces');
console.log(`顔絵 ${n}枚と台帳・src/art/faces.ts を写した（${hist}）`);
