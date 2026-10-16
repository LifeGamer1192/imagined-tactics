// 画面なしの自動対戦。セーブから勢力を2つ選び、決着までを何回か回して結果をまとめる（バランス調整用）。
// 使い方：npx vite-node tools/sim.ts [セーブ名] [回数]
import { readFileSync } from 'node:fs';
import { autoBattle } from '../src/ai/ai';
import { mapFromProvince, mapToText } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import { readSaveFile } from '../src/bridge/histsim';
import { convert, generalsOf } from '../src/convert/convert';
import { D, L } from '../src/data/db';

const name = process.argv[2] ?? 'sengoku_fid5_1575';
const runs = Number(process.argv[3] ?? 20);
const { save } = await readSaveFile(new Uint8Array(readFileSync(`tests/fixtures/${name}.histsim`)));
const gs = convert(save);
const facs = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
console.log(`${gs.worldName.ja} ${gs.year}年${gs.month}月  勢力${facs.length}  武将${Object.keys(gs.generals).length}  変換ログ${gs.log.length}件`);
for (const f of facs.slice(0, 6)) {
  const gens = generalsOf(gs, f.id);
  console.log(`  ${f.name.ja}: 武将${gens.length} 兵糧${f.supply} 収入${f.income} 兵Lv${f.troopLevel} 徴兵=${Object.keys(f.recruit).map((u) => L(D.byUnit[u].name)).join('・')}`);
}
const pick = (id: number) => generalsOf(gs, id).sort((a, b) => b.level - a.level).slice(0, 3).map((g) => g.id);
const swap = process.argv[4] === 'swap';
const [fa, fb] = swap ? [facs[1], facs[0]] : facs;
for (const side of [fa, fb]) {
  console.log(`\n【${side.name.ja}】`);
  for (const id of pick(side.id)) {
    const g = gs.generals[id];
    console.log(`  ${g.name.ja} Lv${g.level} ${L(D.byClass[g.classId].name)} 武${g.stats.str} 知${g.stats.int} 敏${g.stats.agi} 体${g.stats.hp} 采配${g.command}/${g.commandRange}  兵: ${g.troops.map((t) => `${L(D.byUnit[t.unitId].name)}Lv${t.level}`).join('、') || 'なし'}`);
  }
}
const map = mapFromProvince(save.world, fb.capital, { capital: true });
console.log(`\n戦場：${map.name}\n${mapToText(map)}\n`);
const wins = [0, 0]; let rounds = 0, timeups = 0;
for (let i = 0; i < runs; i++) {
  const st = autoBattle(createBattle(gs, map, [pick(fa.id), pick(fb.id)], `sim${i}`, [fa.name.ja, fb.name.ja]));
  wins[st.winner!]++; rounds += st.round;
  if (st.log.some((l) => l.key === 'timeup')) timeups++;
  if (i === 0) {
    const cnt: Record<string, number> = {};
    for (const l of st.log) cnt[l.key] = (cnt[l.key] ?? 0) + 1;
    console.log('1戦目のログの内訳', cnt);
    console.log('1戦目の生き残り', st.units.filter((u) => u.alive).map((u) => `${u.side ? '守' : '攻'}:${u.name}(${u.hp}/${u.maxHp})`).join(' '));
  }
}
console.log(`\n${runs}戦：${fa.name.ja}（攻め）${wins[0]}勝 ／ ${fb.name.ja}（守り）${wins[1]}勝  平均${(rounds / runs).toFixed(1)}巡  時間切れ${timeups}`);
