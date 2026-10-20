// 兵種の実際の強さを、戦闘の計算式（命中・ダメージ・反撃・会心）で測る。使い方：npx vite-node tools/eval/unit-power.ts [格=3] [レベル=20]
// 攻め：その兵種が、同じ格のほかの兵種それぞれに、いちばん期待値の高い技（気力が要る技は、気力が足りる最初の1回）を撃ったときの期待ダメージの平均。
// 守り：同じ格のほかの兵種それぞれから受ける期待ダメージの平均。強さ＝攻め ÷ 守り × 体力（倒すまでに与える量の目安）。
// 当たりやすさ：攻めの平均の命中率。
import { parseMap } from '../../src/battle/map';
import type { BUnit, BattleState } from '../../src/battle/types';
import { makeTroop } from '../../src/convert/convert';
import { RNG } from '../../src/core/rng';
import { D, L } from '../../src/data/db';
import { critChance, hitChance, skillDamage } from '../../src/rules/combat';
import { skillOf } from '../../src/rules/stats';

const tier = Number(process.argv[2] ?? 3), level = Number(process.argv[3] ?? 20);
const st: BattleState = { map: parseMap('. . .\n. . .\n. . .'), units: [], turn: 0, round: 1, maxRounds: 20, winner: null, rng: new RNG(1), log: [], sideNames: ['a', 'b'] };
const mk = (id: string, side: 0 | 1, pos: number): BUnit => {
  const def = D.byUnit[id], t = makeTroop(def, level);
  return {
    id: side, side, home: side, kind: 'troop', generalId: 'g', leader: side, troopIndex: 0, defId: id, name: L(def.name), level, pos,
    hp: t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp, str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: def.def,
    move: def.move, affinity: def.affinity, commandRange: 0, passives: [...def.passives], skills: [...def.skills], tactics: [...def.tactics],
    critPct: 0, healPct: 0, statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0,
  };
};
const units = D.units.filter((u) => u.tier === tier);
/** a が t に、技ごとの期待ダメージ（距離は技の射程に合わせる）のうち最大と、そのときの命中率 */
function best(aId: string, tId: string): { ev: number; hit: number; skill: string } {
  let out = { ev: 0, hit: 0, skill: '' };
  for (const sid of D.byUnit[aId].skills) {
    const s = skillOf(sid);
    if (s.noDamage || s.needsWater) continue;
    const a = mk(aId, 0, 0), t = mk(tId, 1, st.map.grid.idx(Math.min(2, s.range[1]), 0));
    if (a.mp < s.mp) continue;
    st.units = [a, t];
    const hit = hitChance(st, a, s, t) / 100, crit = critChance(a) / 100;
    const ev = skillDamage(st, a, s, t) * hit * (1 + crit * (D.combat.critMult - 1));
    if (ev > out.ev) out = { ev, hit, skill: L(s.name) };
  }
  return out;
}
const rows = units.map((u) => {
  const atk = units.map((t) => best(u.id, t.id)), dfn = units.map((t) => best(t.id, u.id));
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const off = avg(atk.map((x) => x.ev)), taken = avg(dfn.map((x) => x.ev)), hp = makeTroop(u, level).stats.hp;
  return { name: L(u.name), cost: u.cost, agi: makeTroop(u, level).stats.agi, hit: Math.round(avg(atk.map((x) => x.hit)) * 100), off: Math.round(off), taken: Math.round(taken), hp, power: Math.round((off / Math.max(1, taken)) * hp), skill: atk.sort((a, b) => b.ev - a.ev)[0].skill, dmg: units.find((x) => x === u) };
}).sort((a, b) => b.power - a.power);
console.log(`格${tier}・Lv${level}（同じ格の${units.length}種どうし）`);
rows.forEach((r, i) => console.log(`${i + 1}. ${r.name}　強さ${r.power}　攻め${r.off}（命中${r.hit}%・主に${r.skill}）　受ける${r.taken}　体力${r.hp}　機敏${r.agi}　采配${r.cost}`));
