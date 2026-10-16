// バランスを数字で見る道具（docs/13_実装計画 の P12）。
// 複数のセーブから勢力の組を選び、攻守を入れ替えながら自動対戦して、勝率・長さ・経験値・兵種ごとの損耗をまとめる。
// 使い方：npx vite-node tools/balance.ts [1組あたりの回数=6] [勢力の組の数=6]
import { readFileSync } from 'node:fs';
import { autoBattle } from '../src/ai/ai';
import { mapFromProvince } from '../src/battle/map';
import { applyBattleResult } from '../src/battle/result';
import { createBattle } from '../src/battle/setup';
import { readSaveFile } from '../src/bridge/histsim';
import { convert, generalsOf } from '../src/convert/convert';
import { RNG } from '../src/core/rng';
import { D, L } from '../src/data/db';

//        3つ目は戦場：walls＝城壁のある城攻め、nowalls＝城だけ、field＝城の無い野戦、省くと本拠（城の強さしだいで城壁が付く）。
//        4つ目に clear を付けると天気を晴れに固定する
const runs = Number(process.argv[2] ?? 6), pairs = Number(process.argv[3] ?? 6);
const field = process.argv[4] ?? 'castle', fixedSky = process.argv[5] === 'clear' ? { weather: 'clear' as const, night: false } : undefined;
const skyCount: Record<string, number> = {};
const skyStat: Record<string, { battles: number; atkWins: number; timeups: number }> = {};
const SAVES = ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'rome_fid3_212bc', 'invented_archipelago_y30'];
const tot = { battles: 0, atkWins: 0, strongWins: 0, rounds: 0, timeups: 0, genLevels: 0, gens: 0, troopLevels: 0, troops: 0, ms: 0, maxGenLv: 0 };
const unitStat: Record<string, { used: number; lost: number; kills: number }> = {};

for (const name of SAVES) {
  const { save } = await readSaveFile(new Uint8Array(readFileSync(`tests/fixtures/${name}.histsim`)));
  const base = convert(save);
  const facs = Object.values(base.factions).filter((f) => generalsOf(base, f.id).length >= 2);
  const rng = new RNG(20260101);
  const loc = { battles: 0, atkWins: 0, rounds: 0, timeups: 0 };
  for (let p = 0; p < pairs; p++) {
    const fa = rng.pick(facs);
    let fb = rng.pick(facs);
    for (let k = 0; k < 10 && fb.id === fa.id; k++) fb = rng.pick(facs);
    if (fa.id === fb.id) continue;
    for (let i = 0; i < runs; i++) {
      // 経験値や兵の損失が次の戦いに残らないよう、毎回変換し直す
      const gs = convert(save);
      const [atk, def] = i % 2 ? [fb, fa] : [fa, fb];
      const pick = (id: number) => generalsOf(gs, id).sort((a, b) => b.level - a.level).slice(0, 3).map((g) => g.id);
      const A = pick(atk.id), B = pick(def.id);
      const str = (ids: string[]) => ids.reduce((s, id) => s + gs.generals[id].level * 10 + gs.generals[id].troops.length * 30, 0);
      const before = new Map([...A, ...B].map((id) => [id, gs.generals[id].level]));
      const mapOpts = field === 'walls' ? { capital: true, walls: true } : field === 'field' ? { capital: false, fort: 0 } : field === 'nowalls' ? { capital: true, fort: 0.6 } : { capital: true };
      const st = createBattle(gs, mapFromProvince(save.world, gs.factions[def.id].capital, mapOpts), [A, B], `bal${p}:${i}`, [atk.name.ja, def.name.ja], undefined, fixedSky);
      const sky = `${st.weather}${st.night ? '・夜' : ''}`;
      skyCount[sky] = (skyCount[sky] ?? 0) + 1;
      const bySky = (skyStat[st.weather ?? 'clear'] ??= { battles: 0, atkWins: 0, timeups: 0 });
      const t0 = performance.now();
      autoBattle(st);
      tot.ms += performance.now() - t0;
      for (const u of st.units) if (u.kind === 'troop') {
        const s = (unitStat[u.defId] ??= { used: 0, lost: 0, kills: 0 });
        s.used++; if (!u.alive && !u.retreated) s.lost++;
      }
      const timeup = st.log.some((l) => l.key === 'timeup');
      const sum = applyBattleResult(gs, st);
      loc.battles++; tot.battles++;
      if (sum.winner === 0) { loc.atkWins++; tot.atkWins++; }
      if ((str(A) >= str(B)) === (sum.winner === 0)) tot.strongWins++;
      loc.rounds += Math.min(st.round, st.maxRounds); tot.rounds += Math.min(st.round, st.maxRounds);
      if (timeup) { loc.timeups++; tot.timeups++; }
      bySky.battles++; if (sum.winner === 0) bySky.atkWins++; if (timeup) bySky.timeups++;
      for (const [id, lv] of before) { const d = gs.generals[id].level - lv; tot.genLevels += d; tot.gens++; tot.maxGenLv = Math.max(tot.maxGenLv, d); }
      for (const l of sum.levelUps) if (l.name.includes('の')) tot.troopLevels += l.to - l.from;
      tot.troops += st.units.filter((u) => u.kind === 'troop').length;
    }
  }
  console.log(`${name}: ${loc.battles}戦  攻め手の勝ち${Math.round(100 * loc.atkWins / loc.battles)}%  平均${(loc.rounds / loc.battles).toFixed(1)}巡  時間切れ${Math.round(100 * loc.timeups / loc.battles)}%`);
}
console.log(`\n合計 ${tot.battles}戦（戦場：${field}、天気：${Object.entries(skyCount).map(([k, v]) => `${k} ${v}`).join('、')}）`);
console.log(`  攻め手の勝ち ${Math.round(100 * tot.atkWins / tot.battles)}%（守り手 ${100 - Math.round(100 * tot.atkWins / tot.battles)}%）`);
console.log(`  戦力が上の側の勝ち ${Math.round(100 * tot.strongWins / tot.battles)}%`);
console.log(`  平均 ${(tot.rounds / tot.battles).toFixed(1)}巡  時間切れ ${Math.round(100 * tot.timeups / tot.battles)}%`);
console.log(`  1戦あたりのレベル上昇：武将 平均${(tot.genLevels / tot.gens).toFixed(2)}（最大${tot.maxGenLv}）  兵 平均${(tot.troopLevels / tot.troops).toFixed(2)}`);
console.log(`  思考の速さ：1戦 平均${Math.round(tot.ms / tot.battles)}ミリ秒`);
console.log(`  天気ごと：${Object.entries(skyStat).map(([k, s]) => `${k} ${s.battles}戦 攻め手${Math.round(100 * s.atkWins / s.battles)}% 時間切れ${Math.round(100 * s.timeups / s.battles)}%`).join('  ')}`);
console.log('\n兵種ごとの損耗（出陣した隊のうち、壊滅した割合）');
for (const [id, s] of Object.entries(unitStat).sort((a, b) => b[1].used - a[1].used)) {
  console.log(`  ${L(D.byUnit[id].name).padEnd(6, '　')} 出陣${String(s.used).padStart(4)}  壊滅${String(Math.round(100 * s.lost / s.used)).padStart(3)}%`);
}
