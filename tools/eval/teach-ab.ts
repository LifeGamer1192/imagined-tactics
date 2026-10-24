// 直伝あり・なしで、コンピュータの国の強さを比べる（P68 のバランス確認）。
//  1) 戦略：ある国だけが直伝を使う（見込み 0.25＝鬼と同じ）場合と、どの国も使わない場合で、10年後の領・武将の数を比べる（種を変えて数回）。
//  2) 戦闘：直伝が広がった5年後の軍で、教わった技・軍略を持ったまま戦う場合と、取り除いて戦う場合の勝率を比べる。
// 使い方：npx vite-node tools/eval/teach-ab.ts [月=120] [種の数=3]
import { readFileSync } from 'node:fs';
import { autoBattle } from '../../src/ai/ai';
import { mapFromProvince } from '../../src/battle/map';
import { createBattle } from '../../src/battle/setup';
import { readSaveFile } from '../../src/bridge/histsim';
import { convert } from '../../src/convert/convert';
import type { GameStart } from '../../src/convert/model';
import { RNG, codeToSeed } from '../../src/core/rng';
import { autoMonth, newCampaign, provincesOf, S } from '../../src/strategy/campaign';
import { aiTeach } from '../../src/strategy/teach';

const MONTHS = Number(process.argv[2] ?? 120), SEEDS = Number(process.argv[3] ?? 3);
const { save } = await readSaveFile(new Uint8Array(readFileSync('tests/fixtures/sengoku_fid5_1575.histsim')));
const RATE = 0.25;
const setAll = (v: number) => { for (const k of Object.keys(S.teach.aiChance)) S.teach.aiChance[k] = v; };

// ---- 1) 戦略
console.log(`## 1) 戦略：その国だけ直伝を使う（毎月 ${RATE} の見込みで教え始める）／どの国も使わない。${MONTHS}か月・種${SEEDS}つ`);
console.log('国\t種\t直伝なし：領・武将\t直伝あり：領・武将\t教わった将・兵');
const sum = new Map<string, { off: number; on: number }>();
for (const who of ['織田家', '武田家', '毛利家']) {
  for (let s = 0; s < SEEDS; s++) {
    const res: string[] = [];
    let taughtNote = '';
    for (const teach of [false, true]) {
      setAll(0);
      const c = newCampaign(convert(save), save.world, 0, 'normal');
      c.rng = new RNG(codeToSeed(`ab:${who}:${s}`));
      const f = Object.values(c.gs.factions).find((x) => x.name.ja === who)!;
      for (let m = 0; m < MONTHS; m++) {
        if (teach && c.gs.factions[f.id]) { setAll(RATE); aiTeach(c, f.id); setAll(0); }
        autoMonth(c);
      }
      const alive = !!c.gs.factions[f.id];
      const provs = alive ? provincesOf(c, f.id).length : 0, gens = Object.values(c.gs.generals).filter((g) => g.faction === f.id);
      res.push(`${provs}・${gens.length}`);
      const k = sum.get(who) ?? { off: 0, on: 0 };
      if (teach) k.on += provs; else k.off += provs;
      sum.set(who, k);
      if (teach) taughtNote = `${gens.filter((g) => g.taught?.length).length}人・${gens.flatMap((g) => g.troops).filter((t) => t.taught?.length).length}隊`;
    }
    console.log(`${who}\t${s}\t${res[0]}\t${res[1]}\t${taughtNote}`);
  }
}
for (const [who, k] of sum) console.log(`${who}：平均の領 直伝なし ${(k.off / SEEDS).toFixed(1)} → 直伝あり ${(k.on / SEEDS).toFixed(1)}`);

// ---- 2) 戦闘
console.log(`\n## 2) 戦闘：直伝が広がった軍（観戦で${Math.min(60, MONTHS)}か月、見込み ${RATE}）で、教わったものを持ったまま／取り除いて戦う`);
setAll(RATE);
const c = newCampaign(convert(save), save.world, 0, 'normal');
for (let m = 0; m < Math.min(60, MONTHS); m++) autoMonth(c);
setAll(0.08);
const gs = c.gs;
const hasTaught = (id: string) => !!(gs.generals[id].taught?.length || gs.generals[id].troops.some((t) => t.taught?.length));
const factions = Object.values(gs.factions).filter((f) => Object.values(gs.generals).some((g) => g.faction === f.id && hasTaught(g.id)));
const strip = (g0: GameStart): GameStart => { const g = structuredClone(g0); for (const x of Object.values(g.generals)) { delete x.taught; for (const t of x.troops) delete t.taught; } return g; };
let n = 0, winOn = 0, winOff = 0, cases = 0;
const rows: string[] = [];
for (const f of factions) {
  const atk = Object.values(gs.generals).filter((g) => g.faction === f.id && hasTaught(g.id)).slice(0, 3).map((g) => g.id);
  // 相手：隣の国（なければ別の国）の武将3人
  const foe = Object.values(gs.factions).find((x) => x.id !== f.id && Object.values(gs.generals).filter((g) => g.faction === x.id).length >= 2);
  if (!foe || !atk.length) continue;
  const def = Object.values(gs.generals).filter((g) => g.faction === foe.id).slice(0, 3).map((g) => g.id);
  const map = mapFromProvince(c.world, foe.capital, { capital: true, from: f.capital });
  let on = 0, off = 0;
  const R = 10;
  for (let r = 0; r < R; r++) {
    const a = createBattle(gs, map, [atk, def], `ab:${f.id}:${r}`); autoBattle(a); if (a.winner === 0) on++;
    const g2 = strip(gs);
    const b = createBattle(g2, map, [atk, def], `ab:${f.id}:${r}`); autoBattle(b); if (b.winner === 0) off++;
  }
  const arts = atk.reduce((s, id) => s + (gs.generals[id].taught?.length ?? 0) + gs.generals[id].troops.filter((t) => t.taught?.length).length, 0);
  rows.push(`${f.name.ja}→${foe.name.ja}\t教わったもの${arts}\t勝ち 直伝あり${on}/${R}・取り除く${off}/${R}`);
  winOn += on; winOff += off; n += R; cases++;
  if (cases >= 12) break;
}
for (const r of rows) console.log(r);
console.log(`合わせて（${cases}組・${n}戦）：勝率 直伝あり ${Math.round((winOn / n) * 100)}% ／ 取り除く ${Math.round((winOff / n) * 100)}%`);
