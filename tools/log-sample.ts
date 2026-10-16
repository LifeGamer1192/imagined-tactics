// 記録の3段階（簡易・通常・詳細）の出方を、文字で見る。画面は使わない。
// 使い方：npx vite-node tools/log-sample.ts [セーブの名前] [出す件数]
import { readFileSync } from 'node:fs';
import { autoBattle } from '../src/ai/ai';
import { mapFromProvince } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import { readSaveFile } from '../src/bridge/histsim';
import { convert, generalsOf } from '../src/convert/convert';
import { BattleLogView } from '../src/ui/battleLog';

const name = process.argv[2] ?? 'sengoku_fid5_1575', count = Number(process.argv[3] ?? 6);
const { save } = await readSaveFile(new Uint8Array(readFileSync(`tests/fixtures/${name}.histsim`)));
const gs = convert(save, { variant: 'jp' });
const facs = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
const pick = (id: number) => generalsOf(gs, id).sort((x, y) => y.level - x.level).slice(0, 3).map((g) => g.id);
const st = createBattle(gs, mapFromProvince(save.world, facs[1].capital, { capital: true, walls: true }), [pick(facs[0].id), pick(facs[1].id)], 'sample', [facs[0].name.ja, facs[1].name.ja], undefined, { weather: 'rain', night: true });
autoBattle(st);
// 攻撃・軍略のある所までで切って、そこを3通りに出す
const acts = st.log.map((e, i) => (e.key === 'act' && e.vars.kind !== 'wait' ? i : -1)).filter((i) => i >= 0);
const cut = acts[Math.min(acts.length - 1, Math.floor(acts.length / 2))];
st.log.length = cut + 1 + (st.log[cut].vars.n as number);
/** HTML を、行ごとの文字にする */
const text = (html: string) => html.replace(/<div class="(ln|fm)">/g, (_m, c) => `\n${c === 'fm' ? '      ' : '   '}`).replace(/<div[^>]*>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').split('\n').filter((l) => l.trim());
const view = new BattleLogView();
for (const [lv, label] of [[0, '簡易'], [1, '通常'], [2, '詳細']] as const) {
  console.log(`\n===== ${label} =====`);
  console.log(text(view.html(st, lv)).slice(-count * (lv + 1) * 2).join('\n'));
}
