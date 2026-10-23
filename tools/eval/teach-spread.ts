// 直伝の広がりを測る（P68 のバランス確認）：どの国もおまかせ（観戦）で年月を進め、教わった将・兵の数、身についた割合、よく教えられた技・軍略、1か月の重さを見る。
// 使い方：npx vite-node tools/eval/teach-spread.ts [月=120] [難しさ=normal]
import { readFileSync } from 'node:fs';
import { readSaveFile } from '../../src/bridge/histsim';
import { convert } from '../../src/convert/convert';
import { autoMonth, newCampaign, S } from '../../src/strategy/campaign';
import type { Difficulty } from '../../src/strategy/config';
import { artName, isMastered, slotsOf } from '../../src/strategy/teach';

const MONTHS = Number(process.argv[2] ?? 120), DIFF = (process.argv[3] ?? 'normal') as Difficulty;
const marks = [12, 24, 60, 120].filter((m) => m <= MONTHS);
for (const file of ['sengoku_fid5_1575', 'sangoku_fid5_212']) {
  const { save } = await readSaveFile(new Uint8Array(readFileSync(`tests/fixtures/${file}.histsim`)));
  // 観戦（player 0）では難しさは戦略の数に効かないが、相手の国の直伝の見込みは難しさで決まる
  const c = newCampaign(convert(save), save.world, 0, DIFF);
  console.log(`\n## ${file}（${MONTHS}か月・難しさ ${DIFF}・相手の国が教え始める見込み ${S.teach.aiChance[DIFF]}）`);
  console.log('月\t将\t教わった将\t1人あたり\t枠を使い切った将\t身についた割合\t教わった兵\t進行中\t1か月の平均ms');
  let ms = 0;
  for (let m = 1; m <= MONTHS; m++) {
    const t0 = performance.now(); autoMonth(c); ms += performance.now() - t0;
    if (!marks.includes(m)) continue;
    const gens = Object.values(c.gs.generals).filter((g) => g.faction);
    const taught = gens.filter((g) => g.taught?.length);
    const all = gens.flatMap((g) => g.taught ?? []);
    const troops = gens.flatMap((g) => g.troops).filter((t) => t.taught?.length);
    const full = gens.filter((g) => (g.taught?.length ?? 0) >= slotsOf(g)).length;
    console.log(`${m}\t${gens.length}\t${taught.length}\t${(all.length / Math.max(1, gens.length)).toFixed(2)}\t${full}\t${all.length ? Math.round((all.filter(isMastered).length / all.length) * 100) : 0}%\t${troops.length}\t${(c.lessons ?? []).length}\t${Math.round(ms / m)}`);
  }
  const count = new Map<string, number>();
  for (const g of Object.values(c.gs.generals)) for (const x of [...(g.taught ?? []), ...g.troops.flatMap((t) => t.taught ?? [])]) { const k = `${x.kind === 'skill' ? '技' : '軍略'}「${artName(x.id, x.kind)}」`; count.set(k, (count.get(k) ?? 0) + 1); }
  console.log('よく教えられた：' + [...count].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k}${n}`).join('・'));
}
