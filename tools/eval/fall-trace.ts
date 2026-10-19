// 家が滅ぶまでの記録をたどる（滅亡の窓の手がかり）。使い方：npx vite-node tools/eval/fall-trace.ts [家の名] [月数]
import { convert, generalsOf } from '../../src/convert/convert';
import { endMonth, finishMonth, newCampaign, resolveBattle } from '../../src/strategy/campaign';
import { loadFixture } from '../../tests/helpers';

const name = process.argv[2] ?? '三村家', months = Number(process.argv[3] ?? 12);
const save = await loadFixture('sengoku_fid5_1575'), gs = convert(save);
const me = Object.values(gs.factions).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length)[0];
const f = Object.values(gs.factions).find((x) => x.name.ja === name)!;
console.log(name, '領', gs.provinces.filter((p) => p.owner === f.id).map((p) => p.name.ja).join('・'), '武将', generalsOf(gs, f.id).map((g) => g.name.ja).join('・'));
const c = newCampaign(gs, save.world, me.id);
const short = name.replace(/家$/, '');
for (let m = 0; m < months; m++) {
  const mark = c.log.length;
  for (const pb of endMonth(c)) resolveBattle(c, pb);
  finishMonth(c);
  for (const e of c.log.slice(mark)) if (JSON.stringify(e.vars).includes(short)) console.log(gs.year, gs.month, e.key, JSON.stringify(e.vars).slice(0, 200));
  if (!gs.factions[f.id]) { console.log('滅亡', JSON.stringify(c.realms?.[f.id]?.events)); break; }
}
