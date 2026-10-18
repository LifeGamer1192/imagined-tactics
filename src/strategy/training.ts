// 訓練（P30）：自分の武将に「1か月訓練」「ずっと訓練」を命じる。月の終わりに、武将と配下の兵に経験値が入る。
//   1か月訓練：命じた時点でその武将は行動済みになり、その月の終わりに1度訓練する。
//   ずっと訓練：毎月の終わりに、その月ほかの命令（移動・攻める・諸国巡りなど）で動かなかったときだけ訓練する。
//   経験値：次のレベルまでに要る経験値の一定割合（武将 generalShare・兵 troopShare）。
//   倍率：特性（bonusTraits）か、もとの軍事（bonusMilitary 以上）か、規律の性格（bonusDiscipline 以上）なら、毎回 bonusMult 倍。
//         出来事で上がった倍率（c.trainBonus）も掛ける。
//   まれに出来事（eventChance）：昇進の品を見つける・兵が1隊増える・この武将の訓練の倍率がずっと上がる・この月の経験値が倍。
// 調整値は data/system/strategy.json の train。

import { personalityOf } from '../ai/personality';
import { makeTroop } from '../convert/convert';
import type { GGeneral } from '../convert/model';
import { D, L } from '../data/db';
import { gainGeneralExp, gainTroopExp, generalExpToNext, troopExpToNext } from '../rules/growth';
import { MAX_TROOPS, note, provinceRecruit, recruitLevel, toReserve, troopLoad, type Campaign } from './campaign';
import { S } from './config';

export type TrainMode = 'once' | 'always';

/** 訓練を命じられない理由（命じられるなら null） */
export function trainProblem(c: Campaign, g: GGeneral): string | null {
  if (!c.player || g.faction !== c.player) return '自分の武将ではありません';
  if (g.id in c.away) return '諸国巡り中です';
  if (g.id in c.wounded) return '深手を負っています';
  if (c.moved.has(g.id)) return '今月は行動済みです';
  return null;
}

/** 1か月訓練を命じる（行動済みになる） */
export function trainOnce(c: Campaign, gid: string): boolean {
  const g = c.gs.generals[gid];
  if (!g || trainProblem(c, g)) return false;
  (c.training ??= {})[gid] = c.training[gid] === 'always' ? 'always' : 'once';
  c.moved.add(gid);
  c.trainedThisMonth = [...new Set([...(c.trainedThisMonth ?? []), gid])];
  return true;
}

/** ずっと訓練を切り替える。戻り値：切り替えたあと、ずっと訓練か */
export function toggleTrainAlways(c: Campaign, gid: string): boolean {
  const g = c.gs.generals[gid];
  if (!g || g.faction !== c.player) return false;
  c.training ??= {};
  if (c.training[gid] === 'always') { delete c.training[gid]; return false; }
  c.training[gid] = 'always';
  return true;
}

/** 毎回の倍率と、その理由 */
export function trainMult(c: Campaign, g: GGeneral): { mult: number; why: string[] } {
  const T = S.train, why: string[] = [];
  let mult = 1;
  const trait = g.traits.find((t) => T.bonusTraits.includes(t));
  const disc = personalityOf(g.traits, g.ab).discipline;
  if (trait) why.push('特性');
  else if (g.ab[1] >= T.bonusMilitary) why.push(`軍事${g.ab[1]}`);
  else if (disc >= T.bonusDiscipline) why.push('規律を重んじる性格');
  if (why.length) mult *= T.bonusMult;
  const extra = c.trainBonus?.[g.id] ?? 0;
  if (extra) { mult *= 1 + extra; why.push(`鍛錬の成果+${Math.round(extra * 100)}%`); }
  return { mult, why };
}

/** 月の終わり：訓練する武将に経験値を与え、まれに出来事を起こす（finishMonth から、行動済みを消す前に呼ぶ） */
export function trainMonth(c: Campaign): void {
  const T = S.train, gs = c.gs, once = new Set(c.trainedThisMonth ?? []);
  for (const [gid, mode] of Object.entries(c.training ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const g = gs.generals[gid];
    if (!g || g.faction !== c.player) { delete c.training![gid]; continue; }
    // ずっと訓練でも、その月ほかの命令で動いたときは訓練しない（1か月訓練を命じた月は訓練する）
    const trains = once.has(gid) || (mode === 'always' && !c.moved.has(gid) && !(gid in c.away) && !(gid in c.wounded));
    if (mode === 'once') delete c.training![gid];
    if (!trains) continue;
    let { mult } = trainMult(c, g);
    // まれな出来事
    let event = '';
    if (c.rng.chance(T.eventChance)) {
      const kind = c.rng.int(0, 3);
      if (kind === 0) {
        const items = Object.keys(D.items).sort();
        const item = items[c.rng.int(0, items.length - 1)];
        c.items[item] = (c.items[item] ?? 0) + 1;
        event = `訓練の場で${D.items[item]?.[gs.variant] ?? item}を見つけた`;
      } else if (kind === 1) {
        const f = gs.factions[g.faction];
        const units = Object.keys(provinceRecruit(c, g.prov)).filter((u) => D.byUnit[u]).sort();
        if (units.length) {
          const u = units[c.rng.int(0, units.length - 1)], t = makeTroop(D.byUnit[u], recruitLevel(c, u, f));
          if (troopLoad(g) + D.byUnit[u].cost <= g.command && g.troops.length < MAX_TROOPS) { g.troops.push(t); event = `訓練を見た若者が加わり、${L(D.byUnit[u].name)}が1隊増えた`; }
          else { toReserve(c, g.prov, [t]); event = `訓練を見た若者が加わり、${L(D.byUnit[u].name)}が予備兵に1隊増えた`; }
        }
      } else if (kind === 2) {
        (c.trainBonus ??= {})[gid] = Math.min(T.bonusMax, (c.trainBonus[gid] ?? 0) + T.bonusStep);
        mult = trainMult(c, g).mult;
        event = `鍛錬のこつをつかみ、これからの訓練の経験値が${Math.round(T.bonusStep * 100)}%増える`;
      } else {
        mult *= 2;
        event = '気迫のこもった訓練で、この月の経験値が倍になった';
      }
    }
    const gExp = Math.round(generalExpToNext(g) * T.generalShare * mult);
    const fromLv = g.level;
    gainGeneralExp(g, gExp, c.rng);
    let troopUps = 0;
    for (const t of g.troops) troopUps += gainTroopExp(t, Math.round(troopExpToNext(t) * T.troopShare * mult), c.rng);
    note(c, 'train', { name: g.name.ja, exp: gExp, mult: Math.round(mult * 100) / 100, lv: g.level > fromLv ? `・レベル${fromLv}→${g.level}` : '', troops: troopUps ? `・兵のレベルが計${troopUps}上がった` : '' });
    if (event) note(c, 'trainEvent', { name: g.name.ja, text: event });
  }
  c.trainedThisMonth = [];
}
