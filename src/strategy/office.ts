// 相国（P77）：自分の家の政を預かる将（1人。当主はなれない。毎月替えてよい）。武将のもとの能力（1〜10、5が並）で効き目が決まる。
//   偵察（外交）：自分の領から2つ先までの他国の領の偵察度が毎月 外交×1.2（scouting.ts）
//   内政（政治）：家の収入 +政治×1%
//   外交（外交）：使者の心証の上乗せ +（外交−5）×2、戦をしていない隣の国の心証が毎月 +（外交−4）÷2（+20まで）
//   家中（魅力）：自分の家の寝返りの見込み −魅力×5%、捕虜を登用する見込み +外交×1%
//   訓練（軍事）：家じゅうの訓練の経験値 +軍事×3%
//   膝元：相国のいる領とその隣の領は、収入がさらに +政治×2%、訓練の経験値がさらに +軍事×3%
//   引き換え：相国は攻めに出られず、訓練も直伝（教える）もできない（守り・移動はできる）。
// 数は data/system/strategy.json の office。

import type { GGeneral } from '../convert/model';
import { neighborsOf, relation, type Campaign } from './campaign';
import { S } from './config';

const O = () => S.office;

/** 自分の家の相国（いなければ undefined） */
export function chancellorOf(c: Campaign): GGeneral | undefined {
  const id = c.offices?.chancellor, g = id ? c.gs.generals[id] : undefined;
  return g && c.player && g.faction === c.player && !g.isLord ? g : undefined;
}
export const isChancellor = (c: Campaign, gid: string): boolean => chancellorOf(c)?.id === gid;

/** その領が相国の膝元（相国のいる領か、その隣）か */
export function nearChancellor(c: Campaign, prov: number): boolean {
  const ch = chancellorOf(c);
  return !!ch && (ch.prov === prov || neighborsOf(c, ch.prov).includes(prov));
}

/** 相国の効き目（g を渡すと、その将を相国にしたときの見込み）。割合は 0.08 = 8% */
export function officeFx(c: Campaign, g?: GGeneral): { income: number; envoy: number; drift: number; defect: number; recruit: number; train: number; localIncome: number; localTrain: number } | null {
  const ch = g ?? chancellorOf(c);
  if (!ch) return null;
  const [admin, mil, dip, cha] = ch.ab;
  return {
    income: admin * O().incomePerAdmin,
    envoy: Math.round((dip - 5) * O().envoyPerDip),
    drift: Math.max(0, (dip - O().driftFrom) / O().driftDiv),
    defect: Math.min(1, cha * O().defectPerCha),
    recruit: dip * O().recruitPerDip,
    train: mil * O().trainPerMil,
    localIncome: admin * O().localIncomePerAdmin,
    localTrain: mil * O().localTrainPerMil,
  };
}

/** 相国ができないこと（action のとき、理由を返す。できるなら null） */
export function officeBlocks(c: Campaign, gid: string, action: 'attack' | 'train' | 'teach'): string | null {
  if (!isChancellor(c, gid)) return null;
  return { attack: '相国は政務で城を離れられず、攻めに出られません', train: '相国は政務のため訓練できません', teach: '相国は政務のため直伝で教えられません' }[action];
}

/** 月の終わり：外交の相国は、戦をしていない隣の国の心証を少しずつ上げる（driftCap まで） */
export function officeMonth(c: Campaign): void {
  const fx = officeFx(c);
  if (!fx || fx.drift <= 0) return;
  const gs = c.gs, me = c.player, near = new Set<number>();
  for (const p of gs.provinces) if (p.owner === me) for (const n of neighborsOf(c, p.id)) { const o = gs.provinces[n].owner; if (o && o !== me) near.add(o); }
  for (const id of near) {
    const f = gs.factions[id];
    if (!f || relation(c, me, id) === 'war') continue;
    const now = f.opinions[me] ?? 0;
    if (now < O().driftCap) f.opinions[me] = Math.min(O().driftCap, now + fx.drift);
  }
}

/** 相国の効き目の一覧（画面の説明用） */
export function officeLines(c: Campaign, g: GGeneral): string[] {
  const fx = officeFx(c, g)!, pc = (v: number) => `${Math.round(v * 100)}%`;
  const [admin, mil, dip, cha] = g.ab;
  return [
    `内政（政治${admin}）：家の収入 +${pc(fx.income)}`,
    `外交（外交${dip}）：使者の心証の上乗せ ${fx.envoy >= 0 ? '+' : ''}${fx.envoy}、戦をしていない隣の国の心証が毎月 +${fx.drift.toFixed(1)}（${O().driftCap}まで）`,
    `家中（魅力${cha}・外交${dip}）：自分の家の寝返り −${pc(fx.defect)}、捕虜を登用する見込み +${pc(fx.recruit)}`,
    `訓練（軍事${mil}）：家じゅうの訓練の経験値 +${pc(fx.train)}`,
    `偵察（外交${dip}）：自分の領から${S.scout.officeRange}つ先までの他国の領の偵察度が毎月 +${Math.round(S.scout.officeGain * dip)}`,
    `膝元（相国のいる領とその隣）：収入がさらに +${pc(fx.localIncome)}、訓練の経験値がさらに +${pc(fx.localTrain)}`,
  ];
}
