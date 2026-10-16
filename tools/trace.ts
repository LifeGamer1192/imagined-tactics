// 1戦の経過を追う：各巡の構え、両軍の最短距離、ログの件数、武将の体力。思考の調整用。
// 使い方：npx vite-node tools/trace.ts [セーブ名] [swap]
import { readFileSync } from 'node:fs';
import { planUnitDetailed, runAiTurn, stanceOf } from '../src/ai/ai';
import { personalityLabel } from '../src/ai/personality';
import { mapFromProvince } from '../src/battle/map';
import { createBattle } from '../src/battle/setup';
import { readSaveFile } from '../src/bridge/histsim';
import { convert, generalsOf } from '../src/convert/convert';

const name = process.argv[2] ?? 'sengoku_fid5_1575';
const { save } = await readSaveFile(new Uint8Array(readFileSync(`tests/fixtures/${name}.histsim`)));
const gs = convert(save);
const facs = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length);
const [fa, fb] = process.argv[3] === 'swap' ? [facs[1], facs[0]] : facs;
const pick = (id: number) => generalsOf(gs, id).sort((a, b) => b.level - a.level).slice(0, 3).map((g) => g.id);
const st = createBattle(gs, mapFromProvince(save.world, fb.capital, { capital: true }), [pick(fa.id), pick(fb.id)], 'trace', [fa.name.ja, fb.name.ja]);
const g = st.map.grid;
for (const u of st.units.filter((x) => x.kind === 'general')) console.log(`${u.side ? '守' : '攻'} ${u.name} 性格=${personalityLabel(u.persona!)} ${JSON.stringify(u.persona)}`);
let logAt = 0;
while (st.winner === null && st.round <= st.maxRounds) {
  const side = st.turn;
  const gens = st.units.filter((u) => u.alive && u.kind === 'general' && u.side === side);
  const foes = st.units.filter((u) => u.alive && u.side !== side);
  const mine = st.units.filter((u) => u.alive && u.side === side);
  let minD = Infinity;
  for (const a of mine) for (const b of foes) minD = Math.min(minD, g.distance(a.pos, b.pos));
  const sample = mine.find((u) => u.kind === 'troop');
  const p = sample ? planUnitDetailed(st, sample) : null;
  const parts = p ? Object.entries(p.parts).map(([k, v]) => `${k}=${Math.round(v)}`).join(' ') : '';
  runAiTurn(st);
  const cnt: Record<string, number> = {};
  for (const l of st.log.slice(logAt)) cnt[l.key] = (cnt[l.key] ?? 0) + 1;
  logAt = st.log.length;
  console.log(`巡${st.turn === 0 && side === 1 ? st.round - 1 : st.round} ${side ? '守' : '攻'} 構え=[${gens.map((u) => `${u.name}:${stanceOf(st, u)}(${u.hp}/${u.maxHp})`).join(' ')}] 最短距離=${minD} 兵の例{${p?.role} ${p?.actions.map((a) => a.type).join('+')} ${parts}} ログ=${JSON.stringify(cnt)}`);
}
console.log('勝ち', st.winner === null ? 'なし' : st.sideNames[st.winner], '巡', st.round);
