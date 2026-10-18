// 偵察度（P33）：自分の勢力から見た、ほかの勢力の領の様子がどれだけ分かっているか（0〜100）。
//   自分の領と観戦は 100。味方（同盟・従属）の領は少なくとも allyFloor。
//   毎月：自分の領に隣り合う領は adjacentGain 上がる。そのほかは decay ずつ薄れる。
//   偵察させる：武将を1人その月使って、その領の偵察度を上げる（missionBase＋知略×missionPerInt）。月の終わりに上がる。
//   相国：任じた武将の外交の能力に応じて、自分の領から officeRange 歩までの他国の領が毎月 officeGain×外交 上がる。
//   見える量（画面だけ。コンピューターの国の考え方は変えない）：full 以上はすべて、names 以上は武将の名とレベル・兵の数、
//   rough 以上はおおまかな数、それ未満は持ち主だけ。
// 調整値は data/system/strategy.json の scout。

import type { GGeneral } from '../convert/model';
import { D } from '../data/db';
import { neighborsOf, note, relation, type Campaign } from './campaign';
import { S } from './config';

/** 武将の知略（役職の補正込み） */
const intellect = (g: GGeneral): number => g.stats.int + (D.byClass[g.classId]?.mod.int ?? 0);

export type ScoutTier = 'full' | 'names' | 'rough' | 'none';

/** 領の偵察度（0〜100） */
export function scoutOf(c: Campaign, prov: number): number {
  const p = c.gs.provinces[prov];
  if (!c.player || !p) return 100;
  if (p.owner === c.player) return 100;
  const v = c.scout?.[prov] ?? 0;
  if (p.owner && relation(c, c.player, p.owner) === 'ally') return Math.max(v, S.scout.allyFloor);
  return v;
}

export function scoutTier(c: Campaign, prov: number): ScoutTier {
  const v = scoutOf(c, prov), T = S.scout;
  return v >= T.full ? 'full' : v >= T.names ? 'names' : v >= T.rough ? 'rough' : 'none';
}

const bump = (c: Campaign, prov: number, d: number): void => {
  c.scout ??= {};
  c.scout[prov] = Math.max(0, Math.min(100, (c.scout[prov] ?? 0) + d));
};

/** 偵察させられない理由（させられるなら null） */
export function scoutProblem(c: Campaign, g: GGeneral, prov: number): string | null {
  const p = c.gs.provinces[prov];
  if (!c.player || g.faction !== c.player) return '自分の武将ではありません';
  if (!p || p.owner === c.player) return '自分の領です';
  if (g.id in c.away) return '諸国巡り中です';
  if (g.id in c.wounded) return '深手を負っています';
  if (c.moved.has(g.id)) return '今月は行動済みです';
  if ((c.scoutMissions ?? []).some((m) => m.prov === prov)) return 'この領には、もう偵察を出しています';
  return null;
}

/** 偵察で上がる量の見込み */
export function missionGain(g: GGeneral): number {
  return Math.round(S.scout.missionBase + intellect(g) * S.scout.missionPerInt);
}

/** 偵察させる（その武将は行動済みになる。月の終わりに上がる） */
export function sendScout(c: Campaign, gid: string, prov: number): boolean {
  const g = c.gs.generals[gid];
  if (!g || scoutProblem(c, g, prov)) return false;
  c.moved.add(gid);
  (c.scoutMissions ??= []).push({ gid, prov });
  return true;
}

/** 相国に任じる（1人だけ。同じ人をもう一度押すと解く）。戻り値：任じたあと相国か */
export function appointChancellor(c: Campaign, gid: string): boolean {
  const g = c.gs.generals[gid];
  if (!g || g.faction !== c.player) return false;
  c.offices ??= {};
  if (c.offices.chancellor === gid) { delete c.offices.chancellor; return false; }
  c.offices.chancellor = gid;
  return true;
}

/** 相国が毎月上げる量（外交の能力から） */
export function officeGain(g: GGeneral): number {
  return Math.round(S.scout.officeGain * g.ab[2]);
}

/** 月の終わり（finishMonth から）：隣は上がり、ほかは薄れる。偵察と相国のぶんを足す */
export function scoutMonth(c: Campaign): void {
  if (!c.player || !c.gs.factions[c.player]) { c.scoutMissions = []; return; }
  const gs = c.gs, T = S.scout, me = c.player;
  const mine = gs.provinces.filter((p) => p.owner === me);
  const near = new Set<number>();
  for (const p of mine) for (const n of neighborsOf(c, p.id)) if (gs.provinces[n].owner !== me) near.add(n);
  for (const p of gs.provinces) {
    if (p.owner === me || p.out) continue;
    bump(c, p.id, near.has(p.id) ? T.adjacentGain : -T.decay);
  }
  // 偵察
  for (const m of c.scoutMissions ?? []) {
    const g = gs.generals[m.gid];
    if (!g || gs.provinces[m.prov]?.owner === me) continue;
    const d = missionGain(g);
    bump(c, m.prov, d);
    note(c, 'scouted', { name: g.name.ja, prov: gs.provinces[m.prov].name.ja, v: Math.round(c.scout![m.prov]) });
  }
  c.scoutMissions = [];
  // 相国：自分の領から officeRange 歩までの他国の領
  const ch = c.offices?.chancellor ? gs.generals[c.offices.chancellor] : undefined;
  if (c.offices?.chancellor && (!ch || ch.faction !== me)) delete c.offices.chancellor;
  if (ch && ch.faction === me) {
    const gain = officeGain(ch);
    let frontier = mine.map((p) => p.id);
    const seen = new Set(frontier);
    for (let step = 0; step < T.officeRange; step++) {
      const next: number[] = [];
      for (const id of frontier) for (const n of neighborsOf(c, id)) if (!seen.has(n)) { seen.add(n); next.push(n); }
      for (const n of next) if (gs.provinces[n].owner !== me) bump(c, n, gain);
      frontier = next;
    }
  }
}

/** 始めたとき（と、偵察度の無い古いセーブを読んだとき）：自分の領に隣り合う領を start から始める */
export function initScout(c: Campaign): void {
  c.scout = {};
  if (!c.player) return;
  for (const p of c.gs.provinces) {
    if (p.owner !== c.player) continue;
    for (const n of neighborsOf(c, p.id)) if (c.gs.provinces[n].owner !== c.player) c.scout[n] = Math.max(c.scout[n] ?? 0, S.scout.start);
  }
}

/** 数をおおまかに言う（偵察度が低いとき） */
export function roughCount(n: number): string {
  return n === 0 ? 'いない' : n <= 2 ? '少し' : n <= 5 ? 'いくらか' : '多い';
}
/** 数をおおよそにする（2桁目まで） */
export function approx(n: number): string {
  if (n < 100) return `約${Math.round(n / 10) * 10}`;
  const d = 10 ** (Math.floor(Math.log10(n)) - 1);
  return `約${Math.round(n / d) * d}`;
}
