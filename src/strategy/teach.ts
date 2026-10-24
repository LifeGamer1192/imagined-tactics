// 直伝（P68）：当主や将が、ほかの将や配下の兵に技・軍略を教える。
//   枠：将は知略で1〜4（strategy.json の teach.slotsByInt）、兵は1。教わったものは「借り物」（気力が2割多い）で、戦いで5回使うと「直伝済」。
//   教えられるもの：教える側がもとから持つもの（役職・持ち越し・兵の技）と、直伝済のもの。借り物・通常攻撃は教えられない。
//     上級の役職の軍略は、教える側がその役職の熟練度を上限まで上げているときだけ。
//   月：当主→将2か月・将→将3か月・将→兵4か月。そのあいだ教える側も教わる側も行動済み（守りには出られる）。必ず成功する。
//   1つの領で同時に1つまで（当主の直伝も同じ枠）。療養（深手・休養）に入るとやり直し。討たれた・寝返った・捕まった・領を失ったら取りやめ。

import type { GGeneral, GTroop, Taught } from '../convert/model';
import { D, L } from '../data/db';
import { classMod, MAX_MASTERY } from '../rules/growth';
import { skillOf } from '../rules/stats';
import { note, type Campaign, type Lesson } from './campaign';
import { S } from './config';

const T = () => S.teach;

/** 技・軍略の名前 */
export const artName = (id: string, kind: 'skill' | 'tactic'): string => (kind === 'skill' ? L(skillOf(id).name) : D.byTactic[id] ? L(D.byTactic[id].name) : id);
/** 技・軍略の気力（借り物なら上乗せのぶんも） */
export const artMp = (id: string, kind: 'skill' | 'tactic', borrowed = false): number => {
  const mp = kind === 'skill' ? skillOf(id).mp : D.byTactic[id]?.mp ?? 0;
  return borrowed ? Math.round(mp * T().borrowedMpMult) : mp;
};
export const isMastered = (t: Taught): boolean => t.uses >= T().masterUses;

/** 将の知略（役職の加減を入れる） */
export const intOf = (g: GGeneral): number => g.stats.int + classMod(D.byClass[g.classId]).int;
/** 将の直伝の枠（知略で決まる） */
export function slotsOf(g: GGeneral): number {
  const v = intOf(g);
  for (const [max, n] of T().slotsByInt) if (v <= max) return n;
  return T().maxSlots;
}

type Art = { id: string; kind: 'skill' | 'tactic' };
const isBasic = (id: string): boolean => id.startsWith('atk:') || !!D.skills.find((s) => s.id === id)?.basic;

/** その将が持っているすべての技・軍略（教わったものも） */
export function artsOfGeneral(g: GGeneral): Art[] {
  const c = D.byClass[g.classId];
  return dedupe([
    ...(g.skills ?? []).filter((id) => !id.startsWith('atk:')).map((id) => ({ id, kind: 'skill' as const })),
    ...[...c.tactics, ...g.learned].map((id) => ({ id, kind: 'tactic' as const })),
    ...(g.taught ?? []).map((t) => ({ id: t.id, kind: t.kind })),
  ]);
}
/** その兵が持っているすべての技・軍略 */
export function artsOfTroop(t: GTroop): Art[] {
  const u = D.byUnit[t.unitId];
  return dedupe([
    ...[...u.skills, ...(t.extraSkills ?? [])].map((id) => ({ id, kind: 'skill' as const })),
    ...[...u.tactics, ...(t.extraTactics ?? [])].map((id) => ({ id, kind: 'tactic' as const })),
    ...(t.taught ?? []).map((x) => ({ id: x.id, kind: x.kind })),
  ]);
}
const dedupe = (xs: Art[]): Art[] => xs.filter((a, i) => xs.findIndex((b) => b.id === a.id && b.kind === a.kind) === i);

/**
 * 教える側が教えられる技・軍略と、教えられないものの理由。
 * 教えられるのは、もとから持つもの（役職・持ち越し・兵の技）と直伝済のもの
 */
export function teachableArts(g: GGeneral): { art: Art; why: string | null }[] {
  const c = D.byClass[g.classId], full = (g.mastery[c.id] ?? 0) >= MAX_MASTERY;
  return artsOfGeneral(g).map((art) => {
    const taught = (g.taught ?? []).find((t) => t.id === art.id && t.kind === art.kind);
    let why: string | null = null;
    if (art.kind === 'skill' && isBasic(art.id)) why = '通常攻撃は教えられない';
    else if (taught && !isMastered(taught)) why = `借り物（あと${T().masterUses - taught.uses}回使うと教えられる）`;
    else if (!taught && art.kind === 'tactic' && c.tier >= 3 && !full && c.tactics.includes(art.id) && !g.learned.includes(art.id)) why = `上級の役職の軍略は、${L(c.name)}の熟練度を${MAX_MASTERY}にすると教えられる（いま${g.mastery[c.id] ?? 0}）`;
    return { art, why };
  });
}

/** 教われる相手：同じ領にいる自分の将（教える側以外）と、教える側の配下の兵 */
export interface Learner { g: GGeneral; troop?: GTroop; troopIndex?: number }
export function learnersOf(c: Campaign, teacher: GGeneral): Learner[] {
  const gens = Object.values(c.gs.generals).filter((x) => x.faction === teacher.faction && x.prov === teacher.prov && x.id !== teacher.id);
  return [...gens.map((g) => ({ g })), ...teacher.troops.map((t, i) => ({ g: teacher, troop: t, troopIndex: i }))];
}
export const learnerName = (l: Learner): string => (l.troop ? `${l.g.name.ja}の${l.troop.name ?? L(D.byUnit[l.troop.unitId].name)}` : l.g.name.ja);
const taughtOf = (l: Learner): Taught[] => (l.troop ? l.troop.taught ?? [] : l.g.taught ?? []);
export const slotsOfLearner = (l: Learner): number => (l.troop ? T().troopSlots : slotsOf(l.g));
export const slotsLeft = (l: Learner): number => slotsOfLearner(l) - taughtOf(l).length;
/** 教える月：将→兵4、当主→将2、将→将3 */
export const lessonMonths = (teacher: GGeneral, l: Learner): number => (l.troop ? T().months.troop : teacher.isLord ? T().months.lord : T().months.general);

/** 療養（深手・退却の休養）中か */
const resting = (c: Campaign, gid: string): boolean => gid in c.wounded || c.resting?.[gid] !== undefined;
/** 直伝の最中か（教える側・教わる側の将） */
export const inLesson = (c: Campaign, gid: string): Lesson | undefined => (c.lessons ?? []).find((x) => x.teacher === gid || (x.learner === gid && !x.tid));

/** 教える側として、いま教え始められない理由 */
export function teacherProblem(c: Campaign, g: GGeneral): string | null {
  if (!g.faction || !c.gs.factions[g.faction]) return '勢力に仕えていません';
  if (g.id in c.away) return '諸国巡りに出ています';
  if (resting(c, g.id)) return '療養中です';
  if (inLesson(c, g.id)) return '直伝の最中です';
  if (c.moved.has(g.id)) return '今月は行動済みです';
  if ((c.lessons ?? []).some((x) => x.prov === g.prov)) return 'この領では、いま直伝が進んでいます（1つの領で同時に1つまで）';
  return null;
}

/** その組み合わせで教えられない理由（教えられるなら null） */
export function teachProblem(c: Campaign, teacher: GGeneral, l: Learner, art: Art): string | null {
  const tp = teacherProblem(c, teacher);
  if (tp) return tp;
  const how = teachableArts(teacher).find((x) => x.art.id === art.id && x.art.kind === art.kind);
  if (!how) return '教える側が持っていない';
  if (how.why) return how.why;
  if (!l.troop) {
    if (l.g.faction !== teacher.faction || l.g.prov !== teacher.prov) return '同じ領にいない';
    if (l.g.id in c.away) return '諸国巡りに出ている';
    if (resting(c, l.g.id)) return '療養中';
    if (inLesson(c, l.g.id)) return '直伝の最中';
    if (c.moved.has(l.g.id)) return '今月は行動済み';
  } else if (l.g.id !== teacher.id) return '自分の配下の兵だけ';
  const has = l.troop ? artsOfTroop(l.troop) : artsOfGeneral(l.g);
  if (has.some((x) => x.id === art.id && x.kind === art.kind)) return 'もう持っている';
  if (slotsLeft(l) <= 0) return `枠がいっぱい（${slotsOfLearner(l)}）`;
  return null;
}

/** 教わる側の最大の気力（借り物の気力が1回ぶんに足りるか見る） */
export function maxMpOf(l: Learner): number {
  return l.troop ? l.troop.stats.mp : l.g.stats.mp + classMod(D.byClass[l.g.classId]).mp;
}

/** 直伝を始める。教える側（と教わる将）はその月から行動済み */
export function startLesson(c: Campaign, teacher: GGeneral, l: Learner, art: Art): boolean {
  if (teachProblem(c, teacher, l, art)) return false;
  let tid: string | undefined;
  if (l.troop) { tid = l.troop.tid ??= `t${c.gs.tick}_${teacher.id}_${l.troopIndex ?? 0}`; }
  (c.lessons ??= []).push({ teacher: teacher.id, learner: l.g.id, tid, art: art.id, kind: art.kind, months: lessonMonths(teacher, l), progress: 0, prov: teacher.prov });
  c.moved.add(teacher.id);
  if (!l.troop) c.moved.add(l.g.id);
  if (teacher.faction === c.player) note(c, 'teachStart', { teacher: teacher.name.ja, learner: learnerName(l), art: artName(art.id, art.kind), months: lessonMonths(teacher, l) });
  return true;
}

/** 教わったものを忘れる（枠を空ける） */
export function forgetArt(holder: { taught?: Taught[] }, id: string, kind: 'skill' | 'tactic'): boolean {
  const i = (holder.taught ?? []).findIndex((t) => t.id === id && t.kind === kind);
  if (i < 0) return false;
  holder.taught!.splice(i, 1);
  return true;
}

/** 進んでいる直伝の、教わる側（兵なら兵も） */
export function lessonLearner(c: Campaign, x: Lesson): Learner | null {
  const g = c.gs.generals[x.learner];
  if (!g) return null;
  if (!x.tid) return { g };
  const i = g.troops.findIndex((t) => t.tid === x.tid);
  return i < 0 ? null : { g, troop: g.troops[i], troopIndex: i };
}

/** 月の終わり：直伝を進める（取りやめ・やり直し・覚える） */
export function lessonsMonth(c: Campaign): void {
  const keep: Lesson[] = [];
  for (const x of c.lessons ?? []) {
    const t = c.gs.generals[x.teacher], l = lessonLearner(c, x);
    const fid = t?.faction;
    const mine = fid === c.player;
    const art = artName(x.art, x.kind);
    // 取りやめ：討たれた・寝返った・捕まった（勢力が変わった）、領を失った、領を離れた
    const lost = !t || !l || !fid || l.g.faction !== fid || c.gs.provinces[x.prov]?.owner !== fid || t.prov !== x.prov || l.g.prov !== x.prov;
    if (lost) {
      if (mine || l?.g.faction === c.player) note(c, 'teachCancel', { teacher: t?.name.ja ?? '教える将', learner: l ? learnerName(l) : '教わる側', art });
      if (l?.troop && l.troop.tid === x.tid) delete l.troop.tid;
      continue;
    }
    // 療養に入ったら、やり直し（療養のあいだは進まない）
    if (resting(c, t.id) || (!x.tid && resting(c, l.g.id))) {
      if (x.progress > 0 && mine) note(c, 'teachReset', { teacher: t.name.ja, learner: learnerName(l), art });
      x.progress = 0;
      keep.push(x);
      continue;
    }
    x.progress++;
    if (x.progress < x.months) { keep.push(x); continue; }
    const holder = l.troop ?? l.g;
    if (slotsLeft(l) > 0 && !(l.troop ? artsOfTroop(l.troop) : artsOfGeneral(l.g)).some((a) => a.id === x.art && a.kind === x.kind)) {
      (holder.taught ??= []).push({ id: x.art, kind: x.kind, from: t.name.ja, uses: 0 });
      if (mine) note(c, 'teachDone', { teacher: t.name.ja, learner: learnerName(l), art });
    }
    if (l.troop) delete l.troop.tid;
  }
  c.lessons = keep;
}

/** 月の初め：直伝の最中の将は行動済み（守りには出られる） */
export function lessonsBusy(c: Campaign): void {
  for (const x of c.lessons ?? []) { c.moved.add(x.teacher); if (!x.tid) c.moved.add(x.learner); }
}

/** 相手の国の直伝：ときどき（難しさが上がるほど多く）、どこかの領で教え始める。教わる側の気力の最大が、借り物の気力1回ぶんに足りるものだけ */
export function aiTeach(c: Campaign, fid: number): void {
  const chance = T().aiChance[c.difficulty] ?? 0.08;
  if (!c.rng.chance(chance)) return;
  const gens = Object.values(c.gs.generals).filter((g) => g.faction === fid && !teacherProblem(c, g));
  for (const teacher of gens.sort((a, b) => Number(b.isLord) - Number(a.isLord) || b.level - a.level)) {
    const arts = teachableArts(teacher).filter((x) => !x.why).map((x) => x.art);
    for (const l of learnersOf(c, teacher)) for (const art of arts) {
      if (artMp(art.id, art.kind, true) > maxMpOf(l)) continue;
      if (!teachProblem(c, teacher, l, art)) { startLesson(c, teacher, l, art); return; }
    }
  }
}
