// 軍略・技が勝ち負けにどれだけ効くかを測る：両陣営とも同じ思考（ふつう）で、片側だけ軍略と気力を使う技を取り上げて、攻め手の勝ちを比べる。
// 能力値は変えないので、勝ちの差が、そのまま軍略・技の重み。
// 使い方：npx vite-node tools/eval/tactic-impact.ts [1組の回数=64] [育てるレベル=0]
import { readFileSync } from 'node:fs';
import { autoBattle } from '../../src/ai/ai';
import { mapFromProvince } from '../../src/battle/map';
import { createBattle } from '../../src/battle/setup';
import type { BattleState } from '../../src/battle/types';
import { readSaveFile } from '../../src/bridge/histsim';
import { convert, generalsOf } from '../../src/convert/convert';
import { RNG, codeToSeed } from '../../src/core/rng';
import { D } from '../../src/data/db';
import { gainGeneralExp, gainTroopExp, generalExpToNext, generalPromotions, promoteGeneral, promoteTroop, troopExpToNext, troopPromotions } from '../../src/rules/growth';
import { skillOf } from '../../src/rules/stats';

const per = Number(process.argv[2] ?? 64), high = Number(process.argv[3] ?? 0);
const SAVES = ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'rome_fid3_212bc'];
const saves = await Promise.all(SAVES.map(async (n) => (await readSaveFile(new Uint8Array(readFileSync(`tests/fixtures/${n}.histsim`)))).save));

function boost(gs: ReturnType<typeof convert>, ids: string[], seed: string): void {
  const rng = new RNG(codeToSeed(seed));
  for (const id of ids) {
    const g = gs.generals[id];
    while (g.level < high) {
      gainGeneralExp(g, generalExpToNext(g) - g.exp, rng);
      for (let k = 0; k < 3; k++) { const up = generalPromotions(g).filter((p) => p.ok); if (!up.length) break; promoteGeneral(g, up[rng.int(0, up.length - 1)].to.id); }
    }
    for (const t of g.troops) {
      while (t.level < high) {
        gainTroopExp(t, troopExpToNext(t) - t.exp, rng);
        const up = troopPromotions(t).filter((p) => p.ok);
        if (up.length) promoteTroop(t, up[rng.int(0, up.length - 1)].to.id);
      }
    }
  }
}

/** 片側の軍略と、気力を使う技を取り上げる（能力値はそのまま） */
function strip(st: BattleState, side: 0 | 1): void {
  for (const u of st.units) {
    if (u.side !== side) continue;
    u.tactics = [];
    u.skills = u.skills.filter((id) => skillOf(id).mp === 0);
  }
}

let abilities = [0, 0];
for (const mode of ['both', 'noAtk', 'noDef'] as const) {
  let n = 0, atkWins = 0, casts = 0;
  const t0 = Date.now();
  for (const save of saves) for (let i = 0; i < per; i++) {
    const gs = convert(save);
    const facs = Object.values(gs.factions).filter((x) => generalsOf(gs, x.id).length >= 2).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length).slice(0, 8);
    const a = facs[i % facs.length], d = facs[(i + 3) % facs.length], p = gs.provinces[d.capital];
    const pick = (id: number) => generalsOf(gs, id).sort((x, y) => y.level - x.level).slice(0, 3).map((g) => g.id);
    const map = mapFromProvince(save.world, d.capital, { capital: i % 3 !== 0, fort: i % 3 === 0 ? 0.2 : undefined, walls: i % 2 === 0, from: p.nb[i % Math.max(1, p.nb.length)] });
    const sides = [pick(a.id), pick(d.id)];
    if (high) boost(gs, [...sides[0], ...sides[1]], `hi${i}`);
    const st = createBattle(gs, map, sides, `ev${i}`, undefined, undefined, { weather: (['clear', 'rain', 'fog', 'clear'] as const)[i % 4], night: i % 5 === 0 });
    if (mode === 'both') for (const u of st.units) abilities[u.side] += u.tactics.length + u.skills.filter((id) => skillOf(id).mp > 0).length;
    if (mode === 'noAtk') strip(st, 0);
    if (mode === 'noDef') strip(st, 1);
    autoBattle(st); n++;
    if (st.winner === 0) atkWins++;
    casts += st.log.filter((e) => e.key === 'act' && Number(e.vars.mp) > 0).length;
  }
  const label = { both: '両方とも軍略・技あり', noAtk: '攻め手だけ軍略・技なし', noDef: '守り手だけ軍略・技なし' }[mode];
  console.log(`Lv${high || '元のまま'} ${label}：攻め手の勝ち ${Math.round(100 * atkWins / n)}%（${n}戦、1戦に軍略・技 ${(casts / n).toFixed(1)}回、${((Date.now() - t0) / n).toFixed(0)}ms/戦）`);
  if (mode === 'both') console.log(`  軍略・気力を使う技の数（1戦あたり）：攻め手 ${(abilities[0] / n).toFixed(1)}、守り手 ${(abilities[1] / n).toFixed(1)}`);
  void D;
}
