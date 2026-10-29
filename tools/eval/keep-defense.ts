// 天守の守り（P88）を測る：城の戦場（本拠）でおまかせどうしを戦わせ、攻め手が天守で勝った・攻め手が武将を倒して勝った・守り手が勝った、
// 天守を取り返した回数（押さえられた天守から攻め手を追い出した）、初めに天守に立つ駒の強さの順位を数える。
// 使い方：npx vite-node tools/eval/keep-defense.ts [戦いの数=24]
import { autoBattle } from '../../src/ai/ai';
import { mapFromProvince } from '../../src/battle/map';
import { createBattle } from '../../src/battle/setup';
import { convert, generalsOf } from '../../src/convert/convert';
import { attackPower, outOfCommand } from '../../src/rules/stats';
import { loadFixture } from '../../tests/helpers';

const N = Number(process.argv[2] ?? 24);
const out = { keep: 0, rout: 0, def: 0, retook: 0, seatRank: [] as number[], outOfCommand: 0 };
for (let i = 0; i < N; i++) {
  const name = ['sengoku_fid5_1575', 'shunju_fid5_259bc', 'rome_fid3_212bc'][i % 3];
  const save = await loadFixture(name), gs = convert(save);
  const facs = Object.values(gs.factions).filter((x) => generalsOf(gs, x.id).length >= 2).sort((a, b) => generalsOf(gs, b.id).length - generalsOf(gs, a.id).length).slice(0, 8);
  const a = facs[i % facs.length], d = facs[(i + 3) % facs.length], p = gs.provinces[d.capital];
  const pick = (id: number) => generalsOf(gs, id).sort((x, y) => y.level - x.level).slice(0, 3).map((g) => g.id);
  const map = mapFromProvince(save.world, d.capital, { capital: true, walls: i % 2 === 0, from: p.nb[i % Math.max(1, p.nb.length)] });
  const st0 = createBattle(gs, map, [pick(a.id), pick(d.id)], `keepdef${i}`, undefined, undefined, { weather: 'clear', night: false });
  // 初めに天守に立つ守り手の駒は、守り手の兵の中で何番めに強いか（1が一番）
  const def = st0.units.filter((u) => u.side === 1 && u.kind === 'troop').sort((x, y) => y.hp * attackPower(st0, y) - x.hp * attackPower(st0, x));
  const onSeat = st0.units.find((u) => u.side === 1 && u.pos === st0.hold?.cell);
  out.seatRank.push(onSeat ? def.indexOf(onSeat) + 1 : 0);
  out.outOfCommand += st0.units.filter((u) => u.side === 1 && u.kind === 'troop' && outOfCommand(st0, u)).length;
  const st = autoBattle(st0);
  const keys = st.log.map((l) => l.key);
  if (st.winner === 1) out.def++;
  else if (keys.includes('castleTaken') || keys.includes('timeupHeld')) out.keep++;
  else out.rout++;
  out.retook += keys.filter((k) => k === 'holdLost').length;
}
const ranks = out.seatRank;
console.log(`戦い${N}：守り手の勝ち ${out.def}、攻め手が天守で勝ち ${out.keep}、攻め手が武将を倒して勝ち ${out.rout}、天守を取り返した ${out.retook}回`);
console.log(`初めに采配範囲外の守り手の兵：${out.outOfCommand}隊`);
console.log(`初めに天守に立つ兵の強さの順位：1番め ${ranks.filter((r) => r === 1).length}／${N}（天守が空 ${ranks.filter((r) => r === 0).length}）`, ranks.join(','));
