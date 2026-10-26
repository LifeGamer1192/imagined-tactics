// 戦略パートの出来事：人物の出入り（元服・死去・代替わり・寝返り・仕官）、人物どうしの関係の効果、
// 諸国巡り、外交の操作、昇進。調整値は data/system/strategy.json。画面には依存しない。

import type { BattleSummary } from '../battle/result';
import { advanceClass, crown, makeOfficer, makeTroop, newcomer } from '../convert/convert';
import type { GGeneral } from '../convert/model';
import { D } from '../data/db';
import { fillLowerClasses, gainGeneralExp, generalPromotions, promoteGeneral, promoteTroop, troopPromotions } from '../rules/growth';
import {
  extinguish, holderOf, neighborsOf, note, relation, reserveOf, strengthOf, toReserve,
  type Campaign, type Offer, type PendingBattle,
} from './campaign';
import { S, traitsOf } from './config';

const P = S.people, DIP = S.diplomacy;

// ---------------------------------------------------------------- 人物どうしの関係

/** 2人の間に、仕官につながる関係（友・義兄弟・師弟など）があるか */
function bond(c: Campaign, a: GGeneral, b: GGeneral): boolean {
  return a.ties.some((t) => t.with === b.id && P.joinTies.includes(t.kind)) || b.ties.some((t) => t.with === a.id && P.joinTies.includes(t.kind));
}

/** 武将を別の勢力へ移す（兵はそのまま連れていく） */
function join(c: Campaign, g: GGeneral, faction: number, prov: number): void {
  g.faction = faction; g.prov = prov; g.isLord = false;
  delete c.away[g.id];
  c.moved.add(g.id);
}

const hasTie = (a: GGeneral, b: GGeneral, kinds: string[]): boolean => a.ties.some((t) => t.with === b.id && kinds.includes(t.kind));

/**
 * 戦いのあと、戦場で出会った人物どうしの関係が働く。
 * - 友・義兄弟・師弟・伴侶など：負けた側の武将が、勝った側に仕えることがある（当主は移らない）
 * - 好敵手：勝った側も負けた側も、腕を磨いて経験を得る（勝った側が多い）
 * - 仇：勝った側の武将が、負けた側にいる仇を討ち取ることがある（当主は討たれない）。
 *   討たれた武将の義兄弟・伴侶は、討った武将を新たな仇とする
 */
export function afterBattle(c: Campaign, pb: PendingBattle, sum: BattleSummary): void {
  const gs = c.gs;
  const [winF, loseF] = sum.winner === 0 ? [pb.attacker, pb.defender] : [pb.defender, pb.attacker];
  if (!gs.factions[winF]) return;
  const winners = (sum.winner === 0 ? pb.atk : pb.def).map((id) => gs.generals[id]).filter((g) => g && g.faction === winF);
  const losers = (sum.winner === 0 ? pb.def : pb.atk).map((id) => gs.generals[id]).filter((g) => g && g.faction === loseF);
  for (const w of winners) {
    for (const l of losers) {
      if (!gs.generals[l.id]) continue;
      if (hasTie(w, l, ['rival']) || hasTie(l, w, ['rival'])) {
        gainGeneralExp(w, P.rivalExp, c.rng); gainGeneralExp(l, P.rivalLoserExp, c.rng);
        note(c, 'rivalWin', { name: w.name.ja, rival: l.name.ja });
      }
      if (hasTie(w, l, ['avenge', 'betrayed_by'])) {
        gainGeneralExp(w, P.avengeExp, c.rng);
        if (l.isLord || !c.rng.chance(P.avengeKillChance)) { note(c, 'avengeFight', { name: w.name.ja, foe: l.name.ja }); continue; }
        note(c, 'avenged', { name: w.name.ja, foe: l.name.ja });
        w.ties = w.ties.filter((t) => !(t.with === l.id && (t.kind === 'avenge' || t.kind === 'betrayed_by')));
        for (const o of Object.values(gs.generals)) {
          if (o.id === w.id || !hasTie(o, l, P.strongTies) || hasTie(o, w, ['avenge'])) continue;
          o.ties.push({ kind: 'avenge', with: w.id });
          note(c, 'vendetta', { name: o.name.ja, foe: w.name.ja, late: l.name.ja });
        }
        removeGeneral(c, l);
      }
    }
  }
  for (const l of losers) {
    if (!gs.generals[l.id] || l.isLord) continue;
    const friend = winners.find((w) => bond(c, l, w));
    if (!friend || !c.rng.chance(P.tieJoinChance)) continue;
    note(c, 'tieJoin', { name: l.name.ja, friend: friend.name.ja, faction: gs.factions[winF].name.ja });
    join(c, l, winF, friend.prov);
  }
}

/**
 * 関係を入れた忠誠。同じ勢力に義兄弟・伴侶がいれば上がり、好敵手・仇・自分を裏切った相手がいれば下がる。
 */
export function effectiveLoyalty(c: Campaign, g: GGeneral): number {
  const same = (id: string): boolean => { const o = c.gs.generals[id]; return !!o && o.faction === g.faction; };
  let v = g.loyalty;
  if (g.ties.some((t) => P.strongTies.includes(t.kind) && same(t.with))) v += P.bondLoyalty;
  if (g.ties.some((t) => ['rival', 'avenge', 'betrayed_by'].includes(t.kind) && same(t.with))) v -= P.grudgeLoyalty;
  return v;
}

/** その勢力に、g が引かれる相手（縁のある武将、昔の主従）がいるか／憎む相手がいるか */
function pullOf(c: Campaign, g: GGeneral, faction: number): number {
  let v = 0;
  for (const t of g.ties) {
    if (c.gs.generals[t.with]?.faction !== faction) continue;
    if (P.joinTies.includes(t.kind) || P.oldLordTies.includes(t.kind)) v += 1;
    if (t.kind === 'avenge' || t.kind === 'betrayed_by') v -= 5;
  }
  return v;
}

/** 勢力が滅んだあと：浪人になった武将の一部は、滅ぼした勢力に降る。仇を持つ者は降らない */
export function onEliminated(c: Campaign, freed: GGeneral[], by: number): void {
  const f = c.gs.factions[by];
  if (!f) return;
  for (const g of freed) {
    // 憎む相手のいる勢力には降らない。縁のある相手がいれば降りやすい
    const pull = pullOf(c, g, by);
    if (pull < 0 || !c.rng.chance(Math.min(0.9, P.surrenderChance * (1 + pull)))) continue;
    note(c, 'surrender', { name: g.name.ja, faction: f.name.ja });
    join(c, g, by, f.capital);
  }
}

// ---------------------------------------------------------------- 昇進

/**
 * 兵の昇進先。上の兵種は采配の負担が重いので、武将の采配力に収まる昇進先だけが「できる」になる。
 * items はプレイヤーの持つ昇進の品（ほかの勢力は品なし）。
 */
export function troopUpgrades(g: GGeneral, index: number, items: Record<string, number> = {}): { to: string; ok: boolean; missing: string[] }[] {
  const t = g.troops[index];
  if (!t) return [];
  const load = g.troops.reduce((s, x) => s + D.byUnit[x.unitId].cost, 0) - D.byUnit[t.unitId].cost;
  return troopPromotions(t, items).map((p) => {
    const missing = [...p.missing];
    if (load + p.to.cost > g.command) missing.push('采配力');
    return { to: p.to.id, ok: missing.length === 0, missing };
  });
}

/** 兵を昇進させる（プレイヤーは持っている品を使う） */
export function upgradeTroop(c: Campaign, gid: string, index: number, to: string): boolean {
  const g = c.gs.generals[gid];
  if (!g) return false;
  const items = g.faction === c.player ? c.items : {};
  if (!troopUpgrades(g, index, items).find((p) => p.to === to)?.ok) return false;
  return promoteTroop(g.troops[index], to, items);
}

/** プレイヤー以外の勢力の武将と兵を、条件を満たしていれば昇進させる（プレイヤーは画面から自分で行う） */
export function autoPromote(c: Campaign): void {
  for (const g of Object.values(c.gs.generals)) {
    if (!g.faction || g.faction === c.player) continue;
    const up = generalPromotions(g).filter((p) => p.ok);
    if (up.length) promoteGeneral(g, up[c.rng.int(0, up.length - 1)].to.id);
    for (let i = 0; i < g.troops.length; i++) {
      const ok = troopUpgrades(g, i).filter((p) => p.ok);
      if (ok.length) upgradeTroop(c, g.id, i, ok[c.rng.int(0, ok.length - 1)].to);
    }
  }
}

// ---------------------------------------------------------------- 諸国巡り

/** 諸国巡りに出せるか。出せないときは理由を返す */
export function questProblem(c: Campaign, g: GGeneral): string | null {
  if (g.faction !== c.player || !c.player) return '自分の武将ではありません';
  if (g.id in c.away) return 'すでに出ています';
  if (g.id in c.wounded) return '深手を負っています';
  if (c.moved.has(g.id)) return '今月は行動済みです';
  if (g.isLord) return '当主は国を空けられません';
  return null;
}

/** 武将を諸国巡りに出す。数か月のあいだ戦えないが、浪人を連れ帰ったり、昇進の品を得たりする */
export function startQuest(c: Campaign, gid: string): boolean {
  const g = c.gs.generals[gid];
  if (!g || questProblem(c, g)) return false;
  c.away[gid] = c.gs.tick + S.quest.months;
  c.moved.add(gid);
  note(c, 'questStart', { name: g.name.ja });
  return true;
}

function finishQuest(c: Campaign, g: GGeneral): void {
  const gs = c.gs, Q = S.quest;
  const r = c.rng.float();
  if (r < Q.item) {
    const ids = Object.keys(D.items).sort();
    const id = ids[c.rng.int(0, ids.length - 1)];
    c.items[id] = (c.items[id] ?? 0) + 1;
    note(c, 'questItem', { name: g.name.ja, item: D.items[id][gs.variant] });
    return;
  }
  if (r < Q.item + Q.ronin) {
    // 縁のある浪人を先に、次に名のある浪人を
    const ronin = Object.values(gs.generals).filter((x) => !x.faction)
      .sort((a, b) => Number(bond(c, b, g)) - Number(bond(c, a, g)) || b.fame - a.fame || a.id.localeCompare(b.id));
    const pick = ronin[0] && bond(c, ronin[0], g) ? ronin[0] : ronin[c.rng.int(0, Math.min(4, ronin.length) - 1)];
    if (pick) {
      note(c, 'questRonin', { name: g.name.ja, ronin: pick.name.ja });
      join(c, pick, g.faction, g.prov);
      c.moved.delete(pick.id);
      return;
    }
  }
  if (r < Q.item + Q.ronin + Q.exp) {
    const from = g.level;
    gainGeneralExp(g, Q.expAmount, c.rng);
    note(c, 'questExp', { name: g.name.ja, from, to: g.level });
    return;
  }
  note(c, 'questNothing', { name: g.name.ja });
}

// ---------------------------------------------------------------- 外交

const opinion = (c: Campaign, of: number, about: number): number => c.gs.factions[of]?.opinions[about] ?? 0;
const bump = (c: Campaign, of: number, about: number, d: number): void => {
  const f = c.gs.factions[of];
  if (f) f.opinions[about] = Math.max(-100, Math.min(100, (f.opinions[about] ?? 0) + d));
};
export function factionStrength(c: Campaign, f: number): number {
  return Object.values(c.gs.generals).filter((g) => g.faction === f).reduce((s, g) => s + strengthOf(g), 0);
}
function warBetween(c: Campaign, a: number, b: number): number {
  return c.gs.wars.findIndex((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)));
}

/** 同盟を申し込めるか。断られるときは理由を返す */
export function allianceProblem(c: Campaign, a: number, b: number): string | null {
  if (relation(c, a, b) !== 'neutral') return '中立の相手にだけ申し込めます';
  if (opinion(c, b, a) < DIP.allianceOpinion) return `相手の心証が足りません（${Math.round(opinion(c, b, a))}／${DIP.allianceOpinion}）`;
  return null;
}
export function proposeAlliance(c: Campaign, a: number, b: number): boolean {
  if (allianceProblem(c, a, b)) return false;
  c.gs.alliances.push([a, b]);
  bump(c, b, a, DIP.opinionOnAlliance); bump(c, a, b, DIP.opinionOnAlliance);
  note(c, 'alliance', { a: c.gs.factions[a].name.ja, b: c.gs.factions[b].name.ja });
  return true;
}

/** 同盟を破る。中立に戻り、相手の心証が大きく下がる */
export function breakAlliance(c: Campaign, a: number, b: number): boolean {
  const gs = c.gs, n = gs.alliances.length;
  gs.alliances = gs.alliances.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));
  if (gs.alliances.length === n) return false;
  bump(c, b, a, DIP.opinionOnBreak);
  note(c, 'breakAlliance', { a: gs.factions[a].name.ja, b: gs.factions[b].name.ja });
  return true;
}

/** 停戦を申し込めるか。相手が大きく優勢なうちは受けない（長く続いた戦争なら受ける） */
export function truceProblem(c: Campaign, a: number, b: number): string | null {
  const i = warBetween(c, a, b);
  if (i < 0) return '交戦中の相手にだけ申し込めます';
  const age = c.gs.tick - (c.gs.wars[i].since ?? c.gs.tick - DIP.aiTruceAfter);
  if (age >= DIP.aiTruceAfter) return null;
  if (factionStrength(c, b) > factionStrength(c, a) * DIP.truceStrengthRatio) return '相手が優勢なので、受けてもらえません';
  return null;
}
export function makeTruce(c: Campaign, a: number, b: number, months: number = DIP.truceMonths): boolean {
  const gs = c.gs;
  if (!leaveWar(c, a, b)) return false;
  gs.truces.push({ a, b, until: gs.tick + months });
  note(c, 'truce', { a: gs.factions[a].name.ja, b: gs.factions[b].name.ja, months });
  return true;
}

/** 2勢力の戦をやめる（停戦は結ばない）。包囲も解く。戦っていなければ false */
export function leaveWar(c: Campaign, a: number, b: number): boolean {
  const gs = c.gs, i = warBetween(c, a, b);
  if (i < 0) return false;
  const w = gs.wars[i];
  // 2勢力の戦争なら終わらせる。ほかの勢力も加わっている戦争なら、片方だけが抜ける
  const sideOf = (x: number): number[] => (w.attackers.includes(x) ? w.attackers : w.defenders);
  const sb = sideOf(b), sa = sideOf(a);
  if (sb.length > 1) sb.splice(sb.indexOf(b), 1);
  else if (sa.length > 1) sa.splice(sa.indexOf(a), 1);
  else gs.wars.splice(i, 1);
  for (const k of Object.keys(c.sieges)) {
    const sg = c.sieges[Number(k)], owner = gs.provinces[Number(k)].owner;
    if ((sg.by === a && owner === b) || (sg.by === b && owner === a)) delete c.sieges[Number(k)];
  }
  return true;
}
export function proposeTruce(c: Campaign, a: number, b: number): boolean {
  return !truceProblem(c, a, b) && makeTruce(c, a, b);
}

// ---------------------------------------------------------------- 月ごとの出来事

/** 当主が欠けた勢力に、次の当主を立てる：跡継ぎがいれば跡継ぎ、いなければ最も名のある武将 */
function succeed(c: Campaign, fid: number, late: string): void {
  const gs = c.gs, f = gs.factions[fid];
  if (!f) return;
  const heirs = Object.values(gs.generals).filter((g) => g.faction === fid)
    .sort((a, b) => Number(b.role === 'heir') - Number(a.role === 'heir') || b.fame - a.fame || b.level - a.level || a.id.localeCompare(b.id));
  const next = heirs[0];
  // 跡を継ぐ武将が一人もいなければ、家が絶える（領は在地に戻る。自分の家なら負け）
  if (!next) { f.lordId = ''; extinguish(c, fid, late); return; }
  // 当主の役職・采配の上乗せも付け替える（譲るのと共通。P70）
  crown(gs, fid, next);
  delete c.away[next.id];
  if (c.offices?.chancellor === next.id) delete c.offices.chancellor;
  note(c, late ? 'succeed' : 'newLord', { faction: f.name.ja, late, name: next.name.ja });
}

/** 武将が世を去る：兵は領の予備兵に、当主なら代替わり（史実の出来事から使う） */
export function generalDies(c: Campaign, g: GGeneral): void {
  const fid = g.faction, lord = g.isLord;
  removeGeneral(c, g);
  if (lord) succeed(c, fid, g.name.ja);
}

function removeGeneral(c: Campaign, g: GGeneral): void {
  const gs = c.gs;
  // 率いる者のいなくなった兵は、その領の予備兵になる（どの勢力でも。その領を奪えば手に入る）
  if (g.faction && g.troops.length && c.gs.provinces[g.prov]?.owner === g.faction) toReserve(c, g.prov, g.troops.splice(0));
  delete gs.generals[g.id];
  delete c.away[g.id];
  delete c.wounded[g.id];
  c.moved.delete(g.id);
  for (const o of Object.values(gs.generals)) if (o.ties.some((t) => t.with === g.id)) o.ties = o.ties.filter((t) => t.with !== g.id);
}

/** 年の初め：歳を取る。老いた武将は世を去ることがあり、当主が欠ければ代替わりする */
function newYear(c: Campaign): void {
  const gs = c.gs;
  for (const g of Object.values(gs.generals).sort((a, b) => a.id.localeCompare(b.id))) {
    g.age++;
    const over = g.age - P.oldAge;
    if (over <= 0 || !c.rng.chance(Math.min(0.6, over * P.deathPerYearOver))) continue;
    const fid = g.faction, lord = g.isLord;
    if (fid) note(c, 'death', { name: g.name.ja, age: g.age, faction: gs.factions[fid]?.name.ja ?? '' });
    removeGeneral(c, g);
    if (lord) succeed(c, fid, g.name.ja);
  }
  // 師弟：同じ勢力の同じ領にいれば、若い方（レベルの低い方）が教えを受けて経験を得る
  for (const g of Object.values(gs.generals).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const t of g.ties) {
      const o = gs.generals[t.with];
      if (!o || (t.kind !== 'mentor' && t.kind !== 'pupil') || !g.faction || o.faction !== g.faction || o.prov !== g.prov) continue;
      if (g.level > o.level || (g.level === o.level && g.id > o.id)) continue;
      const from = g.level;
      gainGeneralExp(g, P.mentorExp, c.rng);
      note(c, 'mentor', { name: g.name.ja, mentor: o.name.ja, from, to: g.level });
      break;
    }
  }
  // 元服：hist-sim の記録にある、まだ幼かった一族が15歳になったら、仕えていた勢力（または親の勢力）の武将になる
  for (const rec of Object.values(c.world.people ?? {}).sort((a, b) => a.id - b.id)) {
    if (rec.died !== -1 || gs.generals[`p${rec.id}`]) continue;
    const age = Math.floor((gs.tick - rec.p.born) / 12);
    if (age !== P.comingOfAge) continue;
    const parent = rec.parents.map((pid) => gs.generals[`p${pid}`]).find((g) => g && g.faction);
    const fid = gs.factions[rec.court] ? rec.court : parent?.faction ?? 0;
    const f = gs.factions[fid];
    const g = newcomer(gs, rec, fid, f ? f.capital : -1);
    if (g && f) note(c, 'comeOfAge', { name: g.name.ja, faction: f.name.ja });
  }
}

/** 忠誠が負の武将は、隣の敵の勢力へ寝返ることがある。勢力が押されているほど起きやすい */
function defections(c: Campaign): void {
  const gs = c.gs;
  for (const g of Object.values(gs.generals).sort((a, b) => a.id.localeCompare(b.id))) {
    const f = gs.factions[g.faction];
    // 忠誠は特性から決まる小さな値（強欲・野心で −1 ずつ、公正・温厚などで ＋1 ずつ）。負の武将だけが寝返りうる
    const loyalty = effectiveLoyalty(c, g);
    if (!f || g.isLord || g.prov < 0 || loyalty >= P.defectLoyalty || g.id in c.away) continue;
    // 憎む相手のいる勢力へは行かない。縁のある相手（友・義兄弟・昔の主従）のいる勢力を先に選ぶ
    const rivals = [...new Set(neighborsOf(c, g.prov).map((n) => gs.provinces[n].owner))]
      .filter((o) => o && o !== f.id && gs.factions[o] && relation(c, f.id, o) !== 'ally' && pullOf(c, g, o) >= 0);
    if (!rivals.length) continue;
    const to = rivals.sort((a, b) => pullOf(c, g, b) - pullOf(c, g, a) || factionStrength(c, b) - factionStrength(c, a) || a - b)[0];
    const pressure = factionStrength(c, to) > factionStrength(c, f.id) ? 2 : 1;
    const mult = traitsOf(f).reduce((m, t) => m * (t.defectMult ?? 1), 1);
    if (!c.rng.chance(P.defectChance * pressure * mult * (P.defectLoyalty - loyalty) * (1 + Math.max(0, pullOf(c, g, to))))) continue;
    // 本拠にいる当主以外の最後の1人は残る（勢力が武将なしにならないように）
    if (Object.values(gs.generals).filter((x) => x.faction === f.id).length <= 1) continue;
    const dest = neighborsOf(c, g.prov).find((n) => gs.provinces[n].owner === to) ?? gs.factions[to].capital;
    note(c, 'defect', { name: g.name.ja, from: f.name.ja, to: gs.factions[to].name.ja });
    join(c, g, to, dest);
  }
}

/** 浪人は、縁のある武将のいる勢力や、名のある勢力に仕えることがある（プレイヤーの勢力へは諸国巡りで） */
function roninJoin(c: Campaign): void {
  const gs = c.gs;
  const fs = Object.values(gs.factions).filter((f) => f.id !== c.player).sort((a, b) => a.id - b.id);
  if (!fs.length) return;
  for (const g of Object.values(gs.generals).sort((a, b) => a.id.localeCompare(b.id))) {
    if (g.faction || !c.rng.chance(P.roninJoinChance)) continue;
    const kinds = [...P.joinTies, ...P.oldLordTies];
    const tied = g.ties.map((t) => gs.generals[t.with]).find((o) => o && o.faction && o.faction !== c.player && kinds.includes(g.ties.find((t) => t.with === o.id)!.kind) && pullOf(c, g, o.faction) > 0);
    const f = tied ? gs.factions[tied.faction] : fs[c.rng.int(0, fs.length - 1)];
    if (!f) continue;
    note(c, 'roninJoin', { name: g.name.ja, faction: f.name.ja });
    join(c, g, f.id, f.capital);
  }
}

/** プレイヤー以外どうしの長い戦争は、停戦で終わることがある */
function aiTruces(c: Campaign): void {
  const gs = c.gs;
  for (const w of [...gs.wars]) {
    const age = gs.tick - (w.since ?? gs.tick);
    const a = w.attackers[0], b = w.defenders[0];
    if (age < DIP.aiTruceAfter || a === c.player || b === c.player || w.attackers.includes(c.player) || w.defenders.includes(c.player)) continue;
    if (c.rng.chance(DIP.aiTruceChance)) makeTruce(c, a, b);
  }
}

/** 月の変わり目に起きること（暦が進んだあとに呼ぶ） */
export function monthlyEvents(c: Campaign): void {
  const gs = c.gs;
  for (const gid of Object.keys(c.away).sort()) {
    if (c.away[gid] > gs.tick) continue;
    delete c.away[gid];
    const g = gs.generals[gid];
    if (g && g.faction) finishQuest(c, g);
  }
  if (gs.month === 1) newYear(c);
  defections(c);
  roninJoin(c);
  diplomacyTick(c);
  aiTruces(c);
  // 当主のいない勢力（当主が寝返り・降伏でいなくなることは無いが、念のため）
  for (const f of Object.values(gs.factions)) if (!gs.generals[f.lordId] || gs.generals[f.lordId].faction !== f.id) succeed(c, f.id, '');
}

/** 画面用：その領で、まだ動かせる武将と、出かけている武将 */
export function woundedAt(c: Campaign, prov: number, f: number): GGeneral[] {
  return Object.values(c.gs.generals).filter((g) => g.faction === f && g.prov === prov && g.id in c.wounded);
}
export function awayAt(c: Campaign, prov: number, f: number): GGeneral[] {
  return Object.values(c.gs.generals).filter((g) => g.faction === f && g.prov === prov && g.id in c.away);
}

// ---------------------------------------------------------------- 相手からの外交

const atWar = (c: Campaign, a: number, b: number): boolean => warBetween(c, a, b) >= 0;
const enemiesOf = (c: Campaign, a: number): number[] => Object.values(c.gs.factions).filter((f) => f.id !== a && atWar(c, a, f.id)).map((f) => f.id);

/**
 * 月ごとの外交：心証はゆっくり 0 に近づき、同じ敵と戦っている相手には好意が積もる。
 * ほかの勢力からプレイヤーへ、停戦・同盟・従属の申し込みが来ることがある。ほかの勢力どうしも、同じ敵がいれば同盟を結ぶ。
 */
function diplomacyTick(c: Campaign): void {
  const gs = c.gs, fs = Object.values(gs.factions).sort((a, b) => a.id - b.id);
  const foes = new Map<number, Set<number>>(fs.map((f) => [f.id, new Set(enemiesOf(c, f.id))]));
  for (const f of fs) {
    for (const x of fs) {
      if (x.id === f.id) continue;
      let v = f.opinions[x.id] ?? 0;
      if (v > 0) v = Math.max(0, v - DIP.opinionDrift); else if (v < 0) v = Math.min(0, v + DIP.opinionDrift);
      const shared = [...foes.get(f.id)!].some((e) => foes.get(x.id)!.has(e));
      if (shared && !atWar(c, f.id, x.id)) v = Math.min(100, v + DIP.opinionSharedEnemy + DIP.opinionDrift);
      if (v !== 0 || f.opinions[x.id] !== undefined) f.opinions[x.id] = v;
    }
  }
  // ほかの勢力どうし：同じ敵がいて、互いに好意があれば同盟
  for (const a of fs) for (const b of fs) {
    if (a.id >= b.id || a.id === c.player || b.id === c.player) continue;
    if (![...foes.get(a.id)!].some((e) => foes.get(b.id)!.has(e))) continue;
    if (!allianceProblem(c, a.id, b.id) && !allianceProblem(c, b.id, a.id) && c.rng.chance(DIP.offerChance)) proposeAlliance(c, a.id, b.id);
  }
  c.offers = c.offers.filter((o) => o.until > gs.tick && gs.factions[o.from]);
  const me = gs.factions[c.player];
  if (!me) { c.offers = []; return; }
  const mine = factionStrength(c, me.id);
  const border = new Set(gs.provinces.filter((p) => p.owner === me.id).flatMap((p) => neighborsOf(c, p.id).map((n) => gs.provinces[n].owner)));
  for (const f of fs) {
    if (f.id === me.id || c.offers.some((o) => o.from === f.id) || !c.rng.chance(DIP.offerChance)) continue;
    const rel = relation(c, me.id, f.id), theirs = factionStrength(c, f.id);
    let kind: Offer['kind'] | null = null;
    if (rel === 'war') {
      const i = warBetween(c, me.id, f.id);
      const age = gs.tick - (gs.wars[i].since ?? gs.tick - DIP.aiTruceAfter);
      if (theirs < mine || age >= DIP.aiTruceAfter) kind = 'truce';
    } else if (rel === 'neutral') {
      const op = f.opinions[me.id] ?? 0;
      if (border.has(f.id) && !f.overlord && mine >= theirs * DIP.vassalStrengthRatio && op >= DIP.vassalOpinion) kind = 'vassal';
      else if (op >= DIP.allianceOpinion && [...foes.get(f.id)!].some((e) => foes.get(me.id)!.has(e))) kind = 'alliance';
    }
    if (!kind) continue;
    c.offers.push({ kind, from: f.id, until: gs.tick + DIP.offerMonths });
    note(c, `offer_${kind}`, { faction: f.name.ja });
  }
}

/** 申し込みを受ける */
export function acceptOffer(c: Campaign, from: number): boolean {
  const gs = c.gs, o = c.offers.find((x) => x.from === from), f = gs.factions[from], me = gs.factions[c.player];
  if (!o || !f || !me) return false;
  c.offers = c.offers.filter((x) => x !== o);
  if (o.kind === 'truce') { bump(c, from, me.id, DIP.opinionOnTruce); return makeTruce(c, from, me.id, o.months); }
  // 史実の従属は、戦のあとに来ることがある（降って従う）。戦と停戦をやめてから従える
  if (o.kind === 'vassal' && o.hist) { leaveWar(c, me.id, from); gs.truces = gs.truces.filter((t) => !((t.a === me.id && t.b === from) || (t.a === from && t.b === me.id))); }
  if (relation(c, me.id, from) !== 'neutral') return false;
  if (o.kind === 'alliance') {
    gs.alliances.push([me.id, from]);
    bump(c, from, me.id, DIP.opinionOnAlliance);
    note(c, 'alliance', { a: f.name.ja, b: me.name.ja });
    return true;
  }
  f.overlord = me.id;
  bump(c, from, me.id, DIP.opinionOnAlliance);
  note(c, 'vassal', { faction: f.name.ja, lord: me.name.ja });
  return true;
}

/** 申し込みを断る（相手の心証が少し下がる） */
export function declineOffer(c: Campaign, from: number): void {
  if (!c.offers.some((x) => x.from === from)) return;
  c.offers = c.offers.filter((x) => x.from !== from);
  bump(c, from, c.player, DIP.opinionOnRefuse);
}

/** 味方（同盟・従属）に、戦争への加勢を頼めるか。頼めないときは理由を返す */
export function callProblem(c: Campaign, ally: number, enemy: number): string | null {
  const me = c.player;
  if (relation(c, me, ally) !== 'ally') return '味方にだけ頼めます';
  if (!atWar(c, me, enemy)) return '交戦中の相手がいません';
  const r = relation(c, ally, enemy);
  if (r === 'war') return 'すでに戦っています';
  if (r !== 'neutral') return '相手と味方どうし、または停戦中です';
  const op = opinion(c, ally, me);
  if (op < DIP.callToArmsOpinion) return `心証が足りません（${Math.round(op)}／${DIP.callToArmsOpinion}）`;
  return null;
}

/** 味方を、自分の戦争に引き入れる（共同で攻める） */
export function callToArms(c: Campaign, ally: number, enemy: number): boolean {
  if (callProblem(c, ally, enemy)) return false;
  const gs = c.gs, w = gs.wars[warBetween(c, c.player, enemy)];
  (w.attackers.includes(c.player) ? w.attackers : w.defenders).push(ally);
  bump(c, enemy, ally, DIP.opinionOnWar);
  note(c, 'joinWar', { ally: gs.factions[ally].name.ja, a: gs.factions[c.player].name.ja, b: gs.factions[enemy].name.ja });
  return true;
}

/** プレイヤーが今戦っている相手（加勢を頼む相手の候補） */
export function playerEnemies(c: Campaign): number[] { return c.player ? enemiesOf(c, c.player) : []; }

// ---------------------------------------------------------------- 名前の変更、兵と武将の入れ替わり

const cleanName = (name: string): string => name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, S.officer.nameMax);

/** 武将の名前を変える */
export function renameGeneral(c: Campaign, gid: string, name: string): boolean {
  const g = c.gs.generals[gid], n = cleanName(name);
  if (!g || !n) return false;
  g.recordName ??= g.name.ja;
  g.name = { ja: n, en: n };
  return true;
}

/** 兵に名前を付ける（空にすると、兵種の名前に戻る）。key は武将の番号か、予備兵の「@領の番号」 */
export function renameTroop(c: Campaign, key: string, index: number, name: string): boolean {
  const t = holderOf(c, key)?.troops[index];
  if (!t) return false;
  const n = cleanName(name);
  if (n) t.name = n; else delete t.name;
  return true;
}

/** 兵を武将に取り立てるのに要る兵糧（レベルが高いほど多い） */
export const raiseCost = (level: number): number => S.officer.raiseCostBase + S.officer.raiseCostPerLevel * level;
/** 武将を兵に下げたときに戻る兵糧（取り立ての費用の3分の2） */
export const lowerRefund = (level: number): number => Math.round(raiseCost(level) * S.officer.lowerRefund);

/** 兵を武将に取り立てられるか。できないときは理由を返す */
export function raiseProblem(c: Campaign, key: string, index: number): string | null {
  const h = holderOf(c, key), t = h?.troops[index];
  if (!h || !t) return '兵がいません';
  if (h.general && h.general.id in c.away) return '諸国巡りに出ています';
  if (t.level < S.officer.minTroopLevel) return `レベル${S.officer.minTroopLevel}以上の兵だけ取り立てられます`;
  const f = c.gs.factions[h.faction];
  if (!f || f.supply < raiseCost(t.level)) return `兵糧が足りません（${raiseCost(t.level)}要ります）`;
  return null;
}

/**
 * 兵を武将に取り立てる：兵糧を払い、その隊は無くなり、同じ領に新しい武将が加わる（兵は連れていない）。
 * レベルは兵のレベルを引き継ぐ。兵のときの特技と軍略はそのまま使え、将としての特性を1つ得る。
 */
export function raiseToGeneral(c: Campaign, key: string, index: number, name: string): GGeneral | null {
  const h = holderOf(c, key), n = cleanName(name);
  if (!h || !n || raiseProblem(c, key, index)) return null;
  const [t] = h.troops.splice(index, 1);
  const unit = D.byUnit[t.unitId], f = c.gs.factions[h.faction];
  f.supply -= raiseCost(t.level);
  let k = Object.keys(c.gs.generals).length, id = `o${c.gs.tick}_${k}`;
  while (c.gs.generals[id]) id = `o${c.gs.tick}_${++k}`;
  // 将としての特性は、名前と兵種と月から決まる（戦略の乱数は使わない：先の展開を変えないため）
  const trait = S.officer.leaderTraits[[...`${n}${t.unitId}${c.gs.tick}`].reduce((a, ch) => (a * 31 + ch.codePointAt(0)!) >>> 0, 7) % S.officer.leaderTraits.length];
  const made = makeOfficer(c.gs, id, n, h.faction, h.prov, t.level, [trait]);
  // 役職は、兵種に近い系統にする（P59。鉄砲・弩は鉄砲足軽頭、素破・間者は乱波、医は僧、など）。レベルで上の役職へ
  const base = D.byClass[S.officerMap.raiseClass[String(unit.line)] ?? ''];
  if (base) { const cls = advanceClass(base, t.level, made.stats, []); made.classId = cls.id; made.mastery = { [cls.id]: 0 }; made.learned = []; fillLowerClasses(made); }
  // 兵のときの技をすべて引き継ぎ（通常攻撃の前に使う。弓の兵は弓のまま）、得意地形も兵種のまま。特技（同じ種類は重ねない）と軍略も引き継ぐ
  made.unit = t.unitId;
  made.skills = [...new Set([...unit.skills, ...(t.extraSkills ?? [])])];
  for (const p of unit.passives) if (!made.passives.some((x) => x.type === p.type)) made.passives.push({ ...p });
  made.learned = [...new Set([...made.learned, ...unit.tactics, ...(t.extraTactics ?? [])])];
  c.moved.add(id);
  note(c, 'raised', { name: n, by: h.general?.name.ja ?? '予備兵', unit: unit.name[c.gs.variant], faction: f.name.ja, trait });
  return made;
}

/** 武将を兵に下げられるか。できないときは理由を返す */
export function lowerProblem(c: Campaign, g: GGeneral): string | null {
  if (g.isLord) return '当主は下げられません';
  if (g.faction !== c.player || c.gs.provinces[g.prov]?.owner !== c.player) return '自分の領にいる自分の武将だけ下げられます';
  if (g.id in c.away) return '諸国巡りに出ています';
  if (reserveOf(c, g.prov).length + 1 + g.troops.length > S.reserve.max) return `予備兵は${S.reserve.max}隊までです（空きが足りません）`;
  return null;
}

/**
 * 下げたときの兵種（P59）：兵から取り立てた武将は、もとの兵種。ほかは、役職の系統に近い兵種の系統から、レベルに合った格の兵種
 * （Lv10未満は下級、Lv20未満は中級まで、それ以上は上級まで。その家が雇える兵種を先に選ぶ）
 */
export function lowerUnit(c: Campaign, g: GGeneral): string {
  if (g.unit && D.byUnit[g.unit]) return g.unit;
  let root = D.byClass[g.classId];
  while (root?.from && D.byClass[root.from]) root = D.byClass[root.from];
  const line = S.officerMap.lowerLine[root?.id ?? ''] ?? 1;
  const tier = g.level >= 20 ? 3 : g.level >= 10 ? 2 : 1;
  const f = c.gs.factions[g.faction];
  const cands = D.units.filter((u) => u.line === line && u.tier <= tier)
    .sort((a, b) => Number(!!f?.recruit?.[b.id]) - Number(!!f?.recruit?.[a.id]) || b.tier - a.tier || a.id.localeCompare(b.id));
  return cands[0]?.id ?? S.officer.unit;
}

/**
 * 武将を兵に下げる：武将はいなくなり、その名前とレベルを持つ兵1隊が、その領の予備兵に加わる。
 * 率いていた兵も予備兵になる。取り立ての費用の3分の2の兵糧が戻る。能力や特性、縁は引き継がれない。
 */
export function lowerToTroop(c: Campaign, gid: string): boolean {
  const g = c.gs.generals[gid];
  if (!g || lowerProblem(c, g)) return false;
  const unit = D.byUnit[lowerUnit(c, g)];
  const troop = makeTroop(unit, Math.max(1, g.level));
  troop.name = g.name.ja;
  // 武将のときの技・軍略を引き継ぐ（P59。兵種に無いものだけ。役職の通常攻撃は兵種の通常攻撃に替わる）
  const cls = D.byClass[g.classId];
  const skills = (g.skills ?? []).filter((s) => !unit.skills.includes(s) && !s.startsWith('atk:'));
  const tactics = [...new Set([...(cls?.tactics ?? []), ...g.learned])].filter((x) => !unit.tactics.includes(x) && D.byTactic[x]);
  if (skills.length) troop.extraSkills = skills;
  if (tactics.length) troop.extraTactics = tactics;
  const refund = lowerRefund(g.level);
  toReserve(c, g.prov, [troop, ...g.troops.splice(0)]);
  c.gs.factions[g.faction].supply += refund;
  note(c, 'lowered', { name: g.name.ja, unit: unit.name[c.gs.variant], refund });
  removeGeneral(c, g);
  return true;
}

// ---------------------------------------------------------------- 当主を譲る（P71）

const AB = () => S.abdicate;

/** g に当主を譲れない理由（譲れるなら null） */
export function abdicateProblem(c: Campaign, g: GGeneral): string | null {
  const f = c.gs.factions[c.player];
  if (!c.player || !f || g.faction !== c.player) return '自分の武将ではありません';
  if (g.isLord) return 'すでに当主です';
  if (g.age < AB().minAge) return `${AB().minAge}歳にならないと継げません`;
  if (g.id in c.wounded) return '深手を負っています';
  if (g.id in c.away) return '諸国巡りに出ています';
  if (c.resting?.[g.id] !== undefined) return '退却して休養中です';
  if (c.abdicatedAt !== undefined && c.months - c.abdicatedAt < AB().cooldown) return `前に譲ってから${AB().cooldown}か月は譲れません（あと${AB().cooldown - (c.months - c.abdicatedAt)}か月）`;
  return null;
}

/** 譲ると忠誠が下がる武将（新しい当主より名声の高い人。跡継ぎに譲るなら下がり方は半分） */
export function abdicateLoyaltyLoss(c: Campaign, g: GGeneral): { g: GGeneral; drop: number }[] {
  const heir = g.role === 'heir';
  return Object.values(c.gs.generals).filter((x) => x.faction === g.faction && x.id !== g.id && !x.isLord).map((x) => {
    const gap = x.fame - g.fame;
    let drop = gap >= AB().fameGapBig ? AB().dropBig : gap >= AB().fameGap ? AB().drop : 0;
    if (heir) drop = Math.floor(drop / 2);
    return { g: x, drop };
  }).filter((x) => x.drop > 0);
}

/** 当主を g に譲る。前の当主は隠居して武将に残る。その月は国じゅうの武将が行動済みになる */
export function abdicate(c: Campaign, gid: string): boolean {
  const g = c.gs.generals[gid];
  if (!g || abdicateProblem(c, g)) return false;
  const f = c.gs.factions[g.faction];
  const loss = abdicateLoyaltyLoss(c, g);
  const old = crown(c.gs, f.id, g) ?? '';
  // 相国だった将が当主になったら、相国の任を解く
  if (c.offices?.chancellor === g.id) delete c.offices.chancellor;
  for (const x of loss) x.g.loyalty -= x.drop;
  for (const x of Object.values(c.gs.generals)) if (x.faction === f.id) c.moved.add(x.id);
  c.abdicatedAt = c.months;
  note(c, 'abdicate', { faction: f.name.ja, late: old, name: g.name.ja });
  return true;
}