// 捕虜と登用（P72）。戦いで倒された負けた側の将は、勝った側に捕まることがある。
//   捕まった将は gs.generals から外し、c.captives に置く（戦えず、動けず、数にも入らない）。置かれた領を取り返されると解き放たれ、毎月まれに逃げる。
//   捕らえた家は「登用する／解き放つ／処断する／保留」から選ぶ。当主だった将は「解き放つ／処断する」だけ（保留できない）。
//   相手の国が捕らえたときは、当主の性格で決める。自分の将が捕まったら、身代金（兵糧）で取り戻せる。
// 数は data/system/strategy.json の captive。

import type { GGeneral } from '../convert/model';
import { personalityOf } from '../ai/personality';
import type { BattleSummary } from '../battle/result';
import { declareWar, homeFor, isGarrison, neighborsOf, note, relation, toReserve, type Campaign, type Captive, type PendingBattle } from './campaign';
import { S } from './config';
import { effectiveLoyalty, generalDies } from './events';
import { officeFx } from './office';

const K = () => S.captive;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const captiveOf = (c: Campaign, gid: string): Captive | undefined => (c.captives ?? []).find((x) => x.g.id === gid);
/** 自分の家が捕らえている捕虜 */
export const myCaptives = (c: Campaign): Captive[] => (c.captives ?? []).filter((x) => x.by === c.player);
/** 自分の家の将で、よその家に捕まっている者 */
export const myCaptured = (c: Campaign): Captive[] => (c.captives ?? []).filter((x) => x.from === c.player && x.by !== c.player);

/** 捕まる見込み（倒された負けた側の将ごと） */
export function captureChance(c: Campaign, g: GGeneral, pb: PendingBattle, attackerWon: boolean): number {
  const lord = g.isLord;
  let p = lord ? K().lordBase : K().base;
  if (attackerWon) {
    p += K().provLost;
    // 退く先の自分の領が無い（囲まれた・最後の領）
    const loser = g.faction;
    if (!neighborsOf(c, pb.prov).some((n) => n !== pb.prov && c.gs.provinces[n].owner === loser)) p += K().noRetreat;
  }
  if (g.traits.includes('craven')) p -= K().cravenEscape;
  return clamp(p, 0, 0.95);
}

/**
 * 戦いのあと：倒された負けた側の将を、見込みで捕らえる。捕らえた将は gs.generals から外し、率いていた兵はもとの家の近くの領の予備兵になる。
 * 相手の国が捕らえたら、その場で決める（当主の性格）。自分の家が捕らえたら、決めるのを待つ（captivePending）。戻り値：捕らえた将の id
 */
export function takeCaptives(c: Campaign, pb: PendingBattle, sum: BattleSummary): string[] {
  const winner = sum.winner === 0 ? pb.attacker : pb.defender, loserSide = sum.winner === 0 ? 1 : 0;
  if (!winner || !c.gs.factions[winner]) return [];
  const out: string[] = [];
  sum.beatenIds.forEach((id, i) => {
    if (sum.beatenSides[i] !== loserSide || isGarrison(id)) return;
    const g = c.gs.generals[id];
    if (!g || !g.faction || g.faction === winner || !c.gs.factions[g.faction]) return;
    if (!c.rng.chance(captureChance(c, g, pb, sum.winner === 0))) return;
    // 率いていた兵は、もとの家の近くの領の予備兵になる（家が無ければ散る）
    const home = homeFor(c, g.faction, pb.prov);
    if (g.troops.length && c.gs.provinces[home]?.owner === g.faction) toReserve(c, home, g.troops);
    g.troops = [];
    const cap: Captive = { g, by: winner, prov: pb.prov, from: g.faction, since: c.gs.tick, tries: 0, lord: g.isLord };
    delete c.gs.generals[id];
    delete c.wounded[id]; delete c.away[id];
    (c.captives ??= []).push(cap);
    out.push(id);
    note(c, 'captured', { by: c.gs.factions[winner].name.ja, name: g.name.ja, from: c.gs.factions[cap.from].name.ja, prov: c.gs.provinces[pb.prov].name.ja, lord: cap.lord ? '（当主）' : '' });
    if (winner === c.player) (c.captivePending ??= []).push(id);
    else aiDecide(c, cap, true);
  });
  return out;
}

/** 登用の見込み（もとの家への忠誠・特性・縁・こちらの当主の魅力・もとの家が滅んだか・断られた回数・恩） */
export function recruitChance(c: Campaign, cap: Captive): number {
  if (cap.lord) return 0;
  const R = K().recruit, g = cap.g, by = c.gs.factions[cap.by], lord = by ? c.gs.generals[by.lordId] : undefined;
  let p = R.base;
  const home = c.gs.factions[cap.from];
  if (home) {
    // もとの家への忠誠（縁を入れる。捕まっている間は gs.generals に居ないので、もとの家として見る）
    const loyal = effectiveLoyalty(c, { ...g, faction: cap.from });
    p -= loyal * R.perLoyalty;
  } else p += R.fallen;
  if (g.traits.some((t) => R.honorTraits.includes(t))) p += R.honor;
  if (g.traits.some((t) => R.greedyTraits.includes(t))) p += R.greedy;
  if (g.ties.some((t) => R.tieKinds.includes(t.kind) && c.gs.generals[t.with]?.faction === cap.by)) p += R.tie;
  if (lord) p += (lord.ab[3] - 5) * R.perCha;
  if (g.debts?.includes(cap.by)) p += R.debt;
  p += cap.tries * R.retry;
  // 相国の家中：捕虜を登用しやすい（P77）
  if (cap.by === c.player) p += officeFx(c)?.recruit ?? 0;
  return clamp(p, R.min, R.max);
}

/** 捕虜を外へ戻す（解き放つ・登用・逃げる・取り返された） */
function putBack(c: Campaign, cap: Captive, faction: number, prov: number): GGeneral {
  c.captives = (c.captives ?? []).filter((x) => x !== cap);
  c.captivePending = (c.captivePending ?? []).filter((id) => id !== cap.g.id);
  const g = cap.g;
  g.faction = faction;
  g.prov = prov;
  c.gs.generals[g.id] = g;
  return g;
}

/** 登用する。断られたら捕虜のまま（次の見込みは下がる）。戻り値：仕えたか */
export function recruitCaptive(c: Campaign, gid: string): boolean {
  const cap = captiveOf(c, gid);
  if (!cap || cap.lord) return false;
  const by = c.gs.factions[cap.by];
  if (!by) return false;
  const ok = c.rng.chance(recruitChance(c, cap));
  if (!ok) {
    cap.tries++;
    c.captivePending = (c.captivePending ?? []).filter((id) => id !== gid);
    note(c, 'captiveRefuse', { by: by.name.ja, name: cap.g.name.ja });
    return false;
  }
  const g = putBack(c, cap, cap.by, c.gs.provinces[cap.prov]?.owner === cap.by ? cap.prov : by.capital);
  g.isLord = false; g.role = 'general';
  g.loyalty = Math.min(g.loyalty, K().recruitLoyalty);
  note(c, 'captiveRecruit', { by: by.name.ja, name: g.name.ja, from: c.gs.factions[cap.from]?.name.ja ?? '滅んだ家' });
  return true;
}

/** 解き放つ。もとの家へ帰る（家が無ければ浪人）。捕らえた家の名声ともとの家の心証が上がり、恩が残る */
export function releaseCaptive(c: Campaign, gid: string): boolean {
  const cap = captiveOf(c, gid);
  if (!cap) return false;
  const by = c.gs.factions[cap.by], home = c.gs.factions[cap.from];
  const g = putBack(c, cap, home ? cap.from : 0, home ? homeFor(c, cap.from, cap.prov) : cap.prov);
  if (!home) { g.isLord = false; g.role = 'general'; }
  if (by) {
    by.prestige = (by.prestige ?? 0) + K().releasePrestige;
    if (home) home.opinions[cap.by] = Math.min(100, (home.opinions[cap.by] ?? 0) + K().releaseOpinion);
    (g.debts ??= []).includes(cap.by) || g.debts.push(cap.by);
  }
  note(c, 'captiveRelease', { by: by?.name.ja ?? '', name: g.name.ja, to: home?.name.ja ?? '浪人' });
  return true;
}

/** 処断する。もとの家と戦になり、縁のある者はこちらの当主を仇とする。こちらの公正・優しい武将は忠誠が下がる（当主が残酷なら下がらない） */
export function executeCaptive(c: Campaign, gid: string): boolean {
  const cap = captiveOf(c, gid);
  if (!cap) return false;
  const gs = c.gs, by = gs.factions[cap.by], home = gs.factions[cap.from];
  const byLord = by ? gs.generals[by.lordId] : undefined;
  const name = cap.g.name.ja, lord = cap.lord;
  // 縁のある者は仇とする
  if (byLord) for (const x of Object.values(gs.generals)) {
    if (x.faction === cap.by) continue;
    if (x.ties.some((t) => t.with === gid && ['sworn', 'friend', 'spouse', 'lord', 'servant', 'mentor', 'pupil'].includes(t.kind)) && !x.ties.some((t) => t.kind === 'avenge' && t.with === byLord.id)) x.ties.push({ kind: 'avenge', with: byLord.id });
  }
  if (home && by) {
    home.opinions[cap.by] = Math.max(-100, (home.opinions[cap.by] ?? 0) + K().executeOpinion);
    if (relation(c, cap.from, cap.by) === 'neutral') declareWar(c, cap.from, cap.by);
  }
  if (by && !byLord?.traits.includes('cruel')) for (const x of Object.values(gs.generals)) if (x.faction === cap.by && (x.traits.includes('just') || x.traits.includes('kind'))) x.loyalty -= 1;
  // もとの家に戻してから世を去らせる（当主なら代替わり）
  const g = putBack(c, cap, home ? cap.from : 0, home ? home.capital : cap.prov);
  note(c, 'captiveExecute', { by: by?.name.ja ?? '', name, from: home?.name.ja ?? '', lord: lord ? '（当主）' : '' });
  generalDies(c, g);
  return true;
}

/** 身代金（自分の将を取り戻す兵糧） */
export const ransomCost = (cap: Captive): number => Math.round(K().ransomBase + K().ransomPerLevel * cap.g.level);
/** 身代金を払って、よその家に捕まっている自分の将を取り戻す */
export function ransomCaptive(c: Campaign, gid: string): boolean {
  const cap = captiveOf(c, gid), me = c.gs.factions[c.player];
  if (!cap || !me || cap.from !== c.player || cap.by === c.player) return false;
  const cost = ransomCost(cap);
  if (me.supply < cost) return false;
  me.supply -= cost;
  const by = c.gs.factions[cap.by];
  if (by) by.supply += cost;
  const g = putBack(c, cap, c.player, homeFor(c, c.player, cap.prov));
  note(c, 'captiveRansom', { name: g.name.ja, by: by?.name.ja ?? '', cost });
  return true;
}

/** 相手の国の判断（当主の性格）。first：捕らえたその場 */
function aiDecide(c: Campaign, cap: Captive, first: boolean): void {
  const by = c.gs.factions[cap.by], lord = by ? c.gs.generals[by.lordId] : undefined;
  const per = lord ? personalityOf(lord.traits, lord.ab) : null;
  const A = K().ai;
  const cruel = (per?.cruelty ?? 0) >= A.executeCruelty;
  if (cap.lord) {
    // 当主は、その場で解き放つか処断する
    if (cruel && c.rng.chance(A.executeChance)) executeCaptive(c, cap.g.id); else releaseCaptive(c, cap.g.id);
    return;
  }
  if (first || c.rng.chance(A.retry)) { if (recruitCaptive(c, cap.g.id)) return; }
  if (first && cruel && c.rng.chance(A.executeChance * 0.5)) { executeCaptive(c, cap.g.id); return; }
  if (!first && c.rng.chance(A.release + Math.max(0, per?.care ?? 0) * A.releaseCare)) releaseCaptive(c, cap.g.id);
}

/** 月の終わり：取り返された・捕らえた家が無い→解き放たれる。逃げる。相手の国の捕虜の判断。決めていない当主は解き放つ */
export function captivesMonth(c: Campaign): void {
  for (const cap of [...(c.captives ?? [])]) {
    if (!captiveOf(c, cap.g.id)) continue;
    const by = c.gs.factions[cap.by];
    const lost = !by || c.gs.provinces[cap.prov]?.owner !== cap.by;
    if (lost || (!cap.lord && c.rng.chance(K().escape))) {
      const home = c.gs.factions[cap.from];
      const g = putBack(c, cap, home ? cap.from : 0, home ? homeFor(c, cap.from, cap.prov) : cap.prov);
      if (!home) { g.isLord = false; g.role = 'general'; }
      note(c, lost ? 'captiveFreed' : 'captiveEscape', { name: g.name.ja, by: by?.name.ja ?? '', to: home?.name.ja ?? '浪人' });
      continue;
    }
    if (cap.by === c.player) {
      // 決めないまま月を越えた当主は、解き放つ（当主は保留できない）
      if (cap.lord) releaseCaptive(c, cap.g.id);
      continue;
    }
    aiDecide(c, cap, false);
  }
  // 決めないまま月を越えた捕虜は保留にする（捕虜の一覧から、あとで決められる）
  c.captivePending = [];
}
