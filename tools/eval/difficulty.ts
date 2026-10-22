// 難しさの段を測る（P67）：自分の国をおまかせにして年月を進め、難しさごとに、自分の国が残るか・領の数の移り変わりを比べる。
// 使い方：npx vite-node tools/eval/difficulty.ts [月=120] [回=2]
import { readFileSync } from 'node:fs';
import { readSaveFile } from '../../src/bridge/histsim';
import { convert } from '../../src/convert/convert';
import { RNG, codeToSeed } from '../../src/core/rng';
import { autoMonth, newCampaign, provincesOf } from '../../src/strategy/campaign';
import { DIFFICULTIES } from '../../src/strategy/config';

const MONTHS = Number(process.argv[2] ?? 120), RUNS = Number(process.argv[3] ?? 2);
const CASES: [string, string][] = [['sengoku_fid5_1575', '織田家'], ['sangoku_fid5_212', '劉備軍']];
const marks = [12, 24, 60, 120].filter((m) => m <= MONTHS);

for (const [file, who] of CASES) {
  const { save } = await readSaveFile(new Uint8Array(readFileSync(`tests/fixtures/${file}.histsim`)));
  console.log(`\n## ${file}：${who}（${MONTHS}か月・${RUNS}回）`);
  console.log(`難しさ\t残った\t滅んだ月\t領（始め→${marks.join('→')}か月）`);
  for (const d of DIFFICULTIES) {
    const rows: string[] = [];
    let alive = 0;
    const fell: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const gs = convert(save), me = Object.values(gs.factions).find((f) => f.name.ja === who)!;
      const c = newCampaign(gs, save.world, me.id, d);
      c.rng = new RNG(codeToSeed(`diff:${file}:${r}`));
      const seq = [provincesOf(c, me.id).length];
      let end = 0;
      for (let m = 1; m <= MONTHS; m++) {
        autoMonth(c);
        if (marks.includes(m)) seq.push(c.gs.factions[me.id] ? provincesOf(c, me.id).length : 0);
        if (!c.gs.factions[me.id] || c.over === 'lose') { end = m; break; }
        if (c.over) break;
      }
      while (seq.length < marks.length + 1) seq.push(end ? 0 : provincesOf(c, me.id).length);
      if (end) fell.push(end); else alive++;
      rows.push(seq.join('→'));
    }
    console.log(`${d}\t${alive}/${RUNS}\t${fell.join(',') || '-'}\t${rows.join('　')}`);
  }
}
