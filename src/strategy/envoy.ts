// 使者と土産（P34）：同盟・停戦の申し込み、加勢の依頼、親善には、使者の武将と土産（兵糧）を出す。
//   使者：その月は行動済みになる。外交の能力が高いほど、相手の心証に上乗せ（(外交−5)×perDiplomacy）。
//   土産：兵糧を贈る。supplyPerOpinion ごとに心証+1。停戦では「相手が優勢なので受けない」の基準もゆるむ（上乗せ÷truceRelaxPer ぶん）。
//   受けてもらえるかは、上乗せしたあとの心証で決まる。申し込むと、使者と土産は受けてもらえたかに関わらず使い、心証は上がったまま残る。
//   親善：申し込みはせず、心証を上げるだけ。
// 調整値は data/system/strategy.json の envoy。

import type { GGeneral } from '../convert/model';
import { note, relation, type Campaign } from './campaign';
import { S } from './config';
import { officeFx } from './office';
import { allianceProblem, callProblem, callToArms, factionStrength, makeTruce, proposeAlliance, truceProblem } from './events';

export type DipKind = 'ally' | 'truce' | 'call' | 'goodwill';

export interface EnvoyPlan {
  /** 申し込めるか（使者・土産の条件）。だめなら理由 */
  blocked: string | null;
  /** 受けてもらえる見込みか。だめなら理由 */
  refused: string | null;
  opinionNow: number; opinionAfter: number; bonus: number;
}

const E = () => S.envoy;
const opinionOf = (c: Campaign, of: number, about: number): number => c.gs.factions[of]?.opinions[about] ?? 0;

/** 使者の外交による上乗せ */
export const envoyBonus = (g: GGeneral | undefined): number => (g ? Math.round((g.ab[2] - 5) * E().perDiplomacy) : 0);
/** 土産の兵糧による上乗せ */
export const giftBonus = (gift: number): number => Math.floor(gift / E().supplyPerOpinion);

/** 使者に出せない理由 */
export function envoyProblem(c: Campaign, g: GGeneral | undefined): string | null {
  if (!g) return '使者を選んでください';
  if (g.faction !== c.player) return '自分の武将ではありません';
  if (g.id in c.away) return '諸国巡り中です';
  if (g.id in c.wounded) return '深手を負っています';
  if (c.moved.has(g.id)) return '今月は行動済みです';
  return null;
}

/** 見込み：申し込めるか・受けてもらえるか・心証がいくつになるか */
export function envoyPlan(c: Campaign, kind: DipKind, other: number, envoyId: string, gift: number, enemy?: number): EnvoyPlan {
  const me = c.player, g = c.gs.generals[envoyId], f = c.gs.factions[me];
  // 相国の外交の上乗せ（P77）
  const bonus = envoyBonus(g) + giftBonus(gift) + (officeFx(c)?.envoy ?? 0);
  const now = opinionOf(c, other, me), after = Math.max(-100, Math.min(100, now + bonus));
  let blocked = envoyProblem(c, g);
  if (!blocked && (!f || f.supply < gift)) blocked = '兵糧が足りません';
  // 受けてもらえるかは、心証を上乗せしたとして調べる
  const was = c.gs.factions[other]?.opinions[me];
  if (c.gs.factions[other]) c.gs.factions[other].opinions[me] = after;
  let refused: string | null = null;
  try {
    if (kind === 'ally') refused = allianceProblem(c, me, other);
    else if (kind === 'call') refused = enemy === undefined ? '相手を選んでください' : callProblem(c, other, enemy);
    else if (kind === 'truce') {
      refused = truceProblem(c, me, other);
      // 相手が優勢でも、使者と土産の上乗せで基準がゆるむ
      if (refused && relation(c, me, other) === 'war' && factionStrength(c, other) <= factionStrength(c, me) * (S.diplomacy.truceStrengthRatio + bonus / E().truceRelaxPer)) refused = null;
    }
  } finally {
    if (c.gs.factions[other]) { if (was === undefined) delete c.gs.factions[other].opinions[me]; else c.gs.factions[other].opinions[me] = was; }
  }
  return { blocked, refused, opinionNow: Math.round(now), opinionAfter: Math.round(after), bonus };
}

/** 使者を出す。申し込めなければ false（受けてもらえなくても、使者と土産は使い、心証は上がる） */
export function sendEnvoy(c: Campaign, kind: DipKind, other: number, envoyId: string, gift: number, enemy?: number): { sent: boolean; accepted: boolean } {
  const plan = envoyPlan(c, kind, other, envoyId, gift, enemy);
  if (plan.blocked) return { sent: false, accepted: false };
  const me = c.player, gs = c.gs, g = gs.generals[envoyId];
  gs.factions[me].supply -= gift;
  c.moved.add(envoyId);
  gs.factions[other].opinions[me] = plan.opinionAfter;
  note(c, 'envoy', { name: g.name.ja, faction: gs.factions[other].name.ja, gift, from: plan.opinionNow, to: plan.opinionAfter });
  if (kind === 'goodwill') return { sent: true, accepted: true };
  if (plan.refused) { note(c, 'envoyRefused', { faction: gs.factions[other].name.ja, why: plan.refused }); return { sent: true, accepted: false }; }
  const ok = kind === 'ally' ? proposeAlliance(c, me, other) : kind === 'truce' ? makeTruce(c, me, other) : callToArms(c, other, enemy!);
  return { sent: true, accepted: ok };
}
