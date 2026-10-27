// 自分の家のおまかせ（P81）：おまかせ登用（兵をつり合いよく雇う）と、1か月オートの自分の家の動き。
//   雇う：前衛・飛び道具・騎馬・支えの割合（strategy.json の auto.roles）に近づくように、足りない役の兵から雇う
//   1か月オート：「むずかしい」の相手くらいの考えで、雇う → 普請 → 弱い隣を攻める → 前線へ移る → 残りは訓練
// 画面には依存しない。

import { BM } from '../battle/map';
import { MAX_GENERALS } from '../battle/setup';
import type { GGeneral } from '../convert/model';
import { D } from '../data/db';
import {
  build, buildProblem, canAttack, garrisonStrength, generalsAt, moveGeneral, moveTargets, neighborsOf, planAttack, provinceRecruit,
  provincesOf, recruit, recruitCostFor, recruitProblem, relation, resolveBattle, strengthSum, threatened, type Campaign,
} from './campaign';
import { S } from './config';
import { officeBlocks } from './office';
import { trainOnce, trainProblem } from './training';

export type Role = 'front' | 'ranged' | 'cavalry' | 'support' | 'skip';
export const ROLE_NAME: Record<Role, string> = { front: '前衛', ranged: '飛び道具', cavalry: '騎馬・遊撃', support: '支え', skip: 'そのほか' };

const A = () => S.auto;

/** 兵種の役（系統で決める。strategy.json の auto.lines）。城攻め・水の上の兵は、おまかせでは雇わない（skip） */
export function unitRole(unitId: string): Role {
  const line = D.byUnit[unitId].line, L = A().lines;
  if (A().skipLines.includes(line)) return 'skip';
  return (['front', 'ranged', 'cavalry', 'support'] as const).find((r) => L[r].includes(line)) ?? 'front';
}

/**
 * おまかせ登用：采配の範囲で、その領で雇える兵種から、役の割合が目安に近づくように雇う。
 * reserve より兵糧を減らさない。雇った兵種の一覧を返す
 */
export function autoRecruit(c: Campaign, gid: string, reserve = 0): string[] {
  const g = c.gs.generals[gid], f = g ? c.gs.factions[g.faction] : undefined;
  if (!g || !f) return [];
  const ids = Object.keys(provinceRecruit(c, g.prov)).filter((u) => unitRole(u) !== 'skip');
  const target = A().roles as Record<Exclude<Role, 'skip'>, number>;
  const out: string[] = [];
  for (let guard = 0; guard < 12; guard++) {
    const ok = ids.filter((u) => !recruitProblem(c, g, u) && f.supply - recruitCostFor(c, g, u) >= reserve);
    if (!ok.length) break;
    const count: Record<Role, number> = { front: 0, ranged: 0, cavalry: 0, support: 0, skip: 0 };
    for (const t of g.troops) count[unitRole(t.unitId)]++;
    const n = g.troops.length + 1;
    // いちばん足りない役から。その役の中では、格が高い・その役の系統の並び（strategy.json の先のものほど、その役らしい）・初めから雇えた（安い）・兵糧が少ない順
    const roles = (Object.keys(target) as (keyof typeof target)[]).filter((r) => ok.some((u) => unitRole(u) === r))
      .sort((a, b) => (target[b] * n - count[b]) - (target[a] * n - count[a]) || a.localeCompare(b));
    const rank = (u: string): number => A().lines[roles[0]].indexOf(D.byUnit[u].line);
    const pick = ok.filter((u) => unitRole(u) === roles[0])
      .sort((a, b) => D.byUnit[b].tier - D.byUnit[a].tier || rank(a) - rank(b) || Number(b in f.recruit) - Number(a in f.recruit) || recruitCostFor(c, g, a) - recruitCostFor(c, g, b) || a.localeCompare(b))[0];
    if (!pick || !recruit(c, g.id, pick)) break;
    out.push(pick);
  }
  return out;
}

/** 動ける自分の将（今月まだ動いていない・深手でない・諸国巡りでない） */
const idle = (c: Campaign, g: GGeneral): boolean => !c.moved.has(g.id) && !(g.id in c.wounded) && !(g.id in c.away);

/** 自分の領ごとの、前線（敵と接した領）までの距離（自分の領だけを通る） */
function frontDistance(c: Campaign, me: number): Map<number, number> {
  const dist = new Map<number, number>(), queue: number[] = [];
  for (const p of provincesOf(c, me)) if (threatened(c, me, p.id)) { dist.set(p.id, 0); queue.push(p.id); }
  while (queue.length) {
    const p = queue.shift()!;
    for (const n of neighborsOf(c, p)) {
      if (c.gs.provinces[n].owner !== me || dist.has(n)) continue;
      dist.set(n, dist.get(p)! + 1);
      queue.push(n);
    }
  }
  return dist;
}

/** 1か月オートの自分の家の動き（攻めた戦いはここで決着させる） */
export function autoPlayerMonth(c: Campaign): void {
  const me = c.player, f = c.gs.factions[me];
  if (!me || !f) return;
  const reserve = S.ai.reserveSupply;
  const dist = frontDistance(c, me);
  const order = (gs: GGeneral[]): GGeneral[] => gs.sort((a, b) => (dist.get(a.prov) ?? 99) - (dist.get(b.prov) ?? 99) || a.id.localeCompare(b.id));
  // 1. 雇う：前線に近い将から
  for (const g of order(Object.values(c.gs.generals).filter((x) => x.faction === me && !(x.id in c.away)))) autoRecruit(c, g.id, reserve);
  // 2. 普請：兵糧に余りがあれば、前線の城を固め、なければ本拠に建物
  if (A().build && f.supply >= reserve + f.income * BM.build.aiSupplyMonths) {
    const front = provincesOf(c, me).filter((p) => dist.get(p.id) === 0).sort((a, b) => a.fort - b.fort || a.id - b.id);
    const done = front.some((p) => !buildProblem(c, me, p.id, 'fort') && build(c, me, p.id, 'fort'));
    if (!done) for (const k of ['walls', 'market', 'granary', 'mine', 'temple']) if (!buildProblem(c, me, f.capital, k) && build(c, me, f.capital, k)) break;
  }
  // 3. 攻める：勝てる見込みが十分な隣だけ。戦争中の相手・主のいない領は低めの見込みで、戦争していない国は高めの見込みで
  for (const p of provincesOf(c, me)) {
    if (!c.gs.factions[me]) return;
    if (c.gs.provinces[p.id].owner !== me) continue;
    const here = generalsAt(c, p.id, me).filter((g) => idle(c, g) && !officeBlocks(c, g.id, 'attack')).sort((a, b) => b.level - a.level);
    if (!here.length) continue;
    const mine = strengthSum(here);
    let best: { to: number; score: number } | null = null;
    for (const n of neighborsOf(c, p.id)) {
      const t = c.gs.provinces[n];
      if (t.owner === me || !canAttack(c, me, t.owner)) continue;
      const defenders = t.owner ? generalsAt(c, n, t.owner) : [];
      const def = (defenders.length ? strengthSum(defenders) : garrisonStrength(c, n)) * (1 + t.fort * 0.5);
      const need = !t.owner || relation(c, me, t.owner) === 'war' ? A().attackRatio : A().attackRatioPeace;
      const score = mine / (def + 30) / need;
      if (score >= 1 && (!best || score > best.score)) best = { to: n, score };
    }
    if (!best) continue;
    // 攻め先のほかにも敵と接していれば、1人は残して守る
    const others = neighborsOf(c, p.id).some((n) => n !== best!.to && c.gs.provinces[n].owner !== me && c.gs.provinces[n].owner && canAttack(c, c.gs.provinces[n].owner, me));
    const send = (others && here.length > 1 ? here.slice(0, here.length - 1) : here).slice(0, MAX_GENERALS).map((g) => g.id);
    const pb = planAttack(c, me, p.id, best.to, send);
    if (pb) resolveBattle(c, pb);
  }
  // 4. 前線へ移る：前線でない領の将は、前線に近い領へ（前線の領は将の少ない所から）
  const now = frontDistance(c, me);
  for (const g of order(Object.values(c.gs.generals).filter((x) => x.faction === me && idle(c, x)))) {
    const d0 = now.get(g.prov);
    if (!A().move || d0 === undefined || d0 === 0) continue;
    const to = [...moveTargets(c, g.prov, me)].filter((n) => (now.get(n) ?? 99) < d0)
      .sort((a, b) => (now.get(a) ?? 99) - (now.get(b) ?? 99) || generalsAt(c, a, me).length - generalsAt(c, b, me).length || a - b)[0];
    if (to !== undefined) moveGeneral(c, g.id, to);
  }
  // 5. 残りは訓練（行動済みになるが、守りには出られる）
  if (A().train) for (const g of Object.values(c.gs.generals)) if (g.faction === me && !trainProblem(c, g)) trainOnce(c, g.id);
}
