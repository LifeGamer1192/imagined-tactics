// 戦闘の難しさの効き目を測る：相手（守り手か攻め手）の考え方を変えて、自分の側（ふつうの思考で代わりに動かす）の勝ちを数える。
// 使い方：npx vite-node tools/eval/ai-level.ts [1組の回数=32] [比べるもの=all] [戦いの番号のずらし=0（別の戦いの組で確かめるとき）]
import { readFileSync } from 'node:fs';
import { autoBattle } from '../../src/ai/ai';
import { AI, type SmartConfig } from '../../src/ai/personality';
import { mapFromProvince } from '../../src/battle/map';
import { createBattle } from '../../src/battle/setup';
import { readSaveFile } from '../../src/bridge/histsim';
import { convert, generalsOf } from '../../src/convert/convert';

const per = Number(process.argv[2] ?? 32), only = process.argv[3] ?? 'all', offset = Number(process.argv[4] ?? 0);
const SAVES = ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'rome_fid3_212bc'];
const saves = await Promise.all(SAVES.map(async (n) => (await readSaveFile(new Uint8Array(readFileSync(`tests/fixtures/${n}.histsim`)))).save));
const full = { ...AI.levels.hard.smart } as SmartConfig;
const off: SmartConfig = { bestFirst: false, withdrawHp: 0, withdraw: 0, terrainAware: false, surround: 0, surrounded: 0, mpThrift: 0, attackerPush: 0, keepPush: 0 };
const variants: Record<string, { level: 'normal' | 'hard'; smart?: SmartConfig; lv?: Record<string, number> }> = {
  'sally1.1': { level: 'hard', smart: full, lv: { sallyStrengthRatio: 1.1 } },
  'sally2': { level: 'hard', smart: full, lv: { sallyStrengthRatio: 2 } },
  'retreat0.2': { level: 'hard', smart: full, lv: { retreatHp: 0.2 } },
  normal: { level: 'normal' },
  'hard-weights': { level: 'hard', smart: off },
  'hard-full': { level: 'hard', smart: full },
  'hard-full+decap': { level: 'hard', smart: { ...full, decapitate: 2 } },
  'hard-full+decap3': { level: 'hard', smart: { ...full, decapitate: 3 } },
  '+exact': { level: 'hard', smart: { ...full, exactReach: true } },
  '+focus0.3': { level: 'hard', smart: { ...full, focus: 0.3 } },
  '+focus0.6': { level: 'hard', smart: { ...full, focus: 0.6 } },
  '+safe0.5': { level: 'hard', smart: { ...full, leaderSafe: 0.5 } },
  '+safe1': { level: 'hard', smart: { ...full, leaderSafe: 1 } },
  '+safe2': { level: 'hard', smart: { ...full, leaderSafe: 2 } },
  '+first10': { level: 'hard', smart: { ...full, firstStrike: 10 } },
  '+first25': { level: 'hard', smart: { ...full, firstStrike: 25 } },
  '+buddy6': { level: 'hard', smart: { ...full, buddy: 6 } },
  '+buddy15': { level: 'hard', smart: { ...full, buddy: 15 } },
  'hard-full+leader0.3': { level: 'hard', smart: { ...full, leaderKill: 0.3 } },
  'hard-full+leader0.5': { level: 'hard', smart: { ...full, leaderKill: 0.5 } },
  'hard-full+leader1': { level: 'hard', smart: { ...full, leaderKill: 1 } },
  'hard-full+leader2': { level: 'hard', smart: { ...full, leaderKill: 2 } },
  '+leader1': { level: 'hard', smart: { ...off, leaderKill: 1 } },
  'hard-noPush': { level: 'hard', smart: { ...full, attackerPush: 0, keepPush: 0 } },
  '+push': { level: 'hard', smart: { ...off, attackerPush: full.attackerPush, keepPush: full.keepPush } },
  '+bestFirst': { level: 'hard', smart: { ...off, bestFirst: true } },
  '+withdraw': { level: 'hard', smart: { ...off, withdrawHp: full.withdrawHp, withdraw: full.withdraw } },
  '+terrain': { level: 'hard', smart: { ...off, terrainAware: true } },
  '+surround': { level: 'hard', smart: { ...off, surround: full.surround, surrounded: full.surrounded } },
  '+mpThrift': { level: 'hard', smart: { ...off, mpThrift: full.mpThrift } },
};
for (const [name, v] of Object.entries(variants)) {
  if (only !== 'all' && !only.split(',').includes(name)) continue;
  AI.levels.hard.smart = v.smart;
  const keepLv = { ...AI.levels.hard };
  Object.assign(AI.levels.hard, v.lv ?? {});
  const res: string[] = [];
  for (const side of [1, 0] as const) {
    let n = 0, playerWins = 0;
    const t0 = Date.now();
    for (const save of saves) for (let i = offset; i < offset + per; i++) {
      const gs = convert(save);
      const facs = Object.values(gs.factions).filter((x) => generalsOf(gs, x.id).length >= 2).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length).slice(0, 8);
      const a = facs[i % facs.length], d = facs[(i + 3) % facs.length], p = gs.provinces[d.capital];
      const pick = (id: number) => generalsOf(gs, id).sort((x, y) => y.level - x.level).slice(0, 3).map((g) => g.id);
      const map = mapFromProvince(save.world, d.capital, { capital: i % 3 !== 0, fort: i % 3 === 0 ? 0.2 : undefined, walls: i % 2 === 0, from: p.nb[i % Math.max(1, p.nb.length)] });
      const st = createBattle(gs, map, [pick(a.id), pick(d.id)], `ev${i}`, undefined, undefined, { weather: (['clear', 'rain', 'fog', 'clear'] as const)[i % 4], night: i % 5 === 0 });
      st.aiLevel = { side, level: v.level };
      autoBattle(st); n++; if (st.winner !== side) playerWins++;
    }
    res.push(`相手が${side === 1 ? '守り手' : '攻め手'}：自分の勝ち ${Math.round(100 * playerWins / n)}%（${n}戦、${((Date.now() - t0) / n).toFixed(0)}ms/戦）`);
  }
  console.log(`${name.padEnd(13)} ${res.join('　')}`);
  AI.levels.hard = keepLv;
}
AI.levels.hard.smart = full;
