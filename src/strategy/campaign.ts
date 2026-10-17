// 戦略パート（docs/13_実装計画 の P11）：領の取り合い。1ターン＝1か月。画面には依存しない。

import cfgJson from '../../data/system/convert.json';
import { autoBattle } from '../ai/ai';
import { BM, mapFromProvince, type BattleMap, type ProvinceLook } from '../battle/map';
import { applyBattleResult, type BattleSummary } from '../battle/result';
import { createBattle, MAX_GENERALS } from '../battle/setup';
import type { BattleState } from '../battle/types';
import type { HWorld } from '../bridge/histsim';
import { makeGarrison, makeTroop } from '../convert/convert';
import type { GFaction, GGeneral, GProvince, GTroop, GameStart } from '../convert/model';
import { RNG, codeToSeed } from '../core/rng';
import { D } from '../data/db';
import { NEUTRAL, personalityOf, type Personality } from '../ai/personality';
import { S, traitsOf, type Difficulty } from './config';
export { S, traitsOf, type Difficulty, type FactionTrait } from './config';
import { afterBattle, autoPromote, generalDies, monthlyEvents, onEliminated } from './events';
import { historyMonth } from './history';

const SUPPLY = (cfgJson as unknown as { supply: { recruitCostMult: number } }).supply;
const MAX_TROOPS = (cfgJson as unknown as { troops: { maxPerGeneral: number } }).troops.maxPerGeneral;

export interface CampaignLog { key: string; vars: Record<string, string | number> }

export interface PendingBattle {
  attacker: number;
  defender: number;
  /** 攻められる領 */
  prov: number;
  /** 攻め手が出陣した領 */
  from: number;
  atk: string[];
  def: string[];
}

export interface Campaign {
  gs: GameStart;
  /** hist-sim の世界（戦場マップを作るのに使う） */
  world: HWorld;
  /** プレイヤーの勢力（0 = 観戦） */
  player: number;
  rng: RNG;
  /** 今月すでに動いた武将 */
  moved: Set<string>;
  log: CampaignLog[];
  /** null = 続行中 */
  over: null | 'win' | 'lose';
  months: number;
  /** プレイヤーが持っている昇進の品（品の番号 → 個数） */
  items: Record<string, number>;
  /** 守る武将のいない領への攻め（包囲）の進み具合。領の番号 → 攻め手と進み */
  sieges: Record<number, { by: number; progress: number; tick: number }>;
  /** 諸国巡りに出ている武将 → 戻る月（tick） */
  away: Record<string, number>;
  /** 戦いで倒され、深手を負っている武将 → 戦えるようになる月（tick）。その間は攻めにも守りにも出られない */
  wounded: Record<string, number>;
  /** 難しさ（プレイヤーの収入・領の落ちにくさ、相手の攻めやすさが変わる） */
  difficulty: Difficulty;
  /** ほかの勢力からプレイヤーへの申し込み（同盟・停戦・従属）。until の月を過ぎると流れる */
  offers: Offer[];
  /** 予備兵：どの武将にも付いていない兵（領の番号 → 兵）。領に付いていて、戦いには出ない。領を奪った勢力のものになる（動かせるのはプレイヤーだけ） */
  reserve: Record<number, GTroop[]>;
  /** 普請をした月（領の番号 → tick）。1つの領で1か月に1回 */
  built: Record<number, number>;
  /** 本拠を移している最中の勢力（勢力 → 移す先・終わる月・払った兵糧） */
  relocations: Record<number, { to: number; until: number; cost: number }>;
  /** 史実の出来事：起きた（または、もう起きようがない）出来事の id */
  history: { done: string[]; from?: number };
}

export interface Offer { kind: 'alliance' | 'truce' | 'vassal'; from: number; until: number }

export function newCampaign(gs: GameStart, world: HWorld, player: number, difficulty: Difficulty = 'normal'): Campaign {
  const c: Campaign = { gs, world, player, rng: new RNG(codeToSeed(`${gs.seed}:${gs.tick}:campaign`)), moved: new Set(), log: [], over: null, months: 0, items: {}, sieges: {}, away: {}, wounded: {}, difficulty, offers: [], reserve: {}, built: {}, relocations: {}, history: { done: [], from: gs.year * 12 + gs.month } };
  // hist-sim では軍が他国の領にいることがある（遠征・包囲）。戦略パートでは、武将は必ず自分の勢力の領にいることにする
  for (const g of Object.values(gs.generals)) if (g.faction && gs.provinces[g.prov]?.owner !== g.faction) g.prov = homeFor(c, g.faction, g.prov);
  // 開始時の兵糧も、蔵に入るぶんまで（hist-sim の国庫が大きい勢力は、上限の何倍にもなるため）
  refreshIncome(c);
  for (const f of Object.values(gs.factions)) f.supply = Math.min(f.supply, supplyCap(f));
  return c;
}

/** from に一番近い、勢力 f の領（無ければ本拠） */
function homeFor(c: Campaign, f: number, from: number): number {
  const gs = c.gs;
  if (from >= 0 && gs.provinces[from]) {
    const seen = new Set<number>([from]);
    let frontier = [from];
    for (let depth = 0; depth < 6 && frontier.length; depth++) {
      const next: number[] = [];
      for (const p of frontier) for (const n of [...gs.provinces[p].nb, ...gs.provinces[p].sea]) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (gs.provinces[n].owner === f) return n;
        next.push(n);
      }
      frontier = next;
    }
  }
  return gs.factions[f].capital;
}

export const note = (c: Campaign, key: string, vars: Record<string, string | number> = {}): void => { c.log.push({ key, vars }); };

// ---------------------------------------------------------------- 調べる

export const provincesOf = (c: Campaign, f: number): GProvince[] => c.gs.provinces.filter((p) => p.owner === f);
export const generalsAt = (c: Campaign, prov: number, f: number): GGeneral[] =>
  Object.values(c.gs.generals).filter((g) => g.faction === f && g.prov === prov && !(g.id in c.away) && !(g.id in c.wounded))
    .sort((a, b) => b.level - a.level || a.id.localeCompare(b.id));

/** 隣の領（陸続き。海に面した領は海路の先も） */
export function neighborsOf(c: Campaign, prov: number): number[] {
  const p = c.gs.provinces[prov];
  return [...new Set([...p.nb, ...(p.coastal ? p.sea : [])])];
}

/**
 * 飛び地：本拠から、自分の領づたい（地図の線：陸の隣と海路）にたどり着けない領。
 * 収入が大きく減り、守備兵が弱く（落ちやすく）、徴兵が高くつく（strategy.json の exclave）。
 */
export function exclavesOf(c: Campaign, f: number): Set<number> {
  const fac = c.gs.factions[f], out = new Set<number>();
  if (!fac) return out;
  const seen = new Set<number>([fac.capital]);
  const queue = [fac.capital];
  while (queue.length) {
    const p = queue.pop()!;
    for (const n of neighborsOf(c, p)) if (!seen.has(n) && c.gs.provinces[n].owner === f) { seen.add(n); queue.push(n); }
  }
  for (const p of c.gs.provinces) if (p.owner === f && !seen.has(p.id)) out.add(p.id);
  return out;
}
export const isExclave = (c: Campaign, prov: number): boolean => { const o = c.gs.provinces[prov]?.owner; return !!o && exclavesOf(c, o).has(prov); };

/**
 * 飛び地を本拠とつなげるのに取る領：取る数がいちばん少ない道すじの、自分の領でない領（近い順）。
 * つなげようが無ければ空。自分の領は数えずに通れる（0-1 の幅優先）。
 */
export function exclaveLink(c: Campaign, prov: number): number[] {
  const f = c.gs.provinces[prov]?.owner;
  if (!f || !isExclave(c, prov)) return [];
  const ex = exclavesOf(c, f);
  const main = new Set(provincesOf(c, f).filter((p) => !ex.has(p.id)).map((p) => p.id));
  const cost = new Map<number, number>([[prov, 0]]), prev = new Map<number, number>();
  const dq: number[] = [prov];
  while (dq.length) {
    const p = dq.shift()!;
    if (main.has(p)) {
      const out: number[] = [];
      for (let q: number | undefined = prev.get(p); q !== undefined && q !== prov; q = prev.get(q)) if (c.gs.provinces[q].owner !== f) out.unshift(q);
      return out;
    }
    for (const n of neighborsOf(c, p)) {
      const np = c.gs.provinces[n];
      if (!np || np.out) continue;
      const w = np.owner === f ? 0 : 1, nc = cost.get(p)! + w;
      if (nc < (cost.get(n) ?? Infinity)) { cost.set(n, nc); prev.set(n, p); if (w) dq.push(n); else dq.unshift(n); }
    }
  }
  return [];
}

export type Relation ='self' | 'ally' | 'truce' | 'war' | 'neutral';

export function relation(c: Campaign, a: number, b: number): Relation {
  if (a === b) return 'self';
  const gs = c.gs, fa = gs.factions[a], fb = gs.factions[b];
  if (!fa || !fb) return 'neutral';
  const pair = (x: number, y: number) => (x === a && y === b) || (x === b && y === a);
  // 宗主と従属、同じ宗主を持つ勢力は味方
  if (fa.overlord === b || fb.overlord === a || (fa.overlord && fa.overlord === fb.overlord)) return 'ally';
  if (gs.alliances.some(([x, y]) => pair(x, y))) return 'ally';
  if (gs.wars.some((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)))) return 'war';
  if (gs.truces.some((t) => pair(t.a, t.b) && t.until > gs.tick)) return 'truce';
  return 'neutral';
}
export const canAttack = (c: Campaign, a: number, b: number): boolean => {
  if (b === 0) return true;   // 持ち主のいない領
  const r = relation(c, a, b);
  return r === 'war' || r === 'neutral';
};

/** 武将1人（と兵）の強さの目安 */
export function strengthOf(g: GGeneral): number {
  const cls = D.byClass[g.classId];
  let s = g.level * 8 + (g.stats.str + g.stats.int + cls.mod.str + cls.mod.int) / 4 + (g.stats.hp + cls.mod.hp) / 20;
  for (const t of g.troops) s += D.byUnit[t.unitId].cost * 0.6 + t.level * 3;
  return s;
}
const strengthSum = (gs: GGeneral[]): number => gs.slice(0, MAX_GENERALS).reduce((s, g) => s + strengthOf(g), 0);

/** 徴兵の費用。勢力を渡すと、勢力の特色による割引を入れる */
export function recruitCost(unitId: string, f?: GFaction, exclave = false): number {
  const u = D.byUnit[unitId];
  let mult = exclave ? S.exclave.recruitCostMult : 1;
  if (f) for (const t of traitsOf(f)) if (t.cost?.lines.includes(u.line)) mult *= t.cost.mult;
  return Math.round(u.cost * SUPPLY.recruitCostMult * mult);
}
/** 徴兵した兵の開始レベル（勢力の特色を含む） */
export function recruitLevel(unitId: string, f: GFaction): number {
  let lv = f.troopLevel - 2;
  for (const t of traitsOf(f)) { lv += t.troopLevel ?? 0; if (t.level?.lines.includes(D.byUnit[unitId].line)) lv += t.level.add; }
  return Math.max(1, lv);
}
/** 守る武将のいない領を落とすのに要る力（城が強いほど大きい） */
export function siegeResist(c: Campaign, prov: number): number {
  const p = c.gs.provinces[prov], f = c.gs.factions[p.owner];
  let r = S.siege.base + p.fort * S.siege.perFort;
  if (!f) return r * S.siege.unownedMult;
  for (const t of traitsOf(f)) r *= t.siegeMult ?? 1;
  if (f.id === c.player) r *= S.difficulty[c.difficulty].playerSiege;
  return r;
}
const isTactical = (unitId: string): boolean => S.tactical.lines.includes(D.byUnit[unitId].line);
export const troopLoad = (g: GGeneral): number => g.troops.reduce((s, t) => s + D.byUnit[t.unitId].cost, 0);

// ---------------------------------------------------------------- 行動

/** 兵を徴兵できるか。できないときは理由を返す */
export function recruitProblem(c: Campaign, g: GGeneral, unitId: string): string | null {
  const f = c.gs.factions[g.faction];
  if (!f) return '勢力に仕えていません';
  if (!(unitId in f.recruit)) return 'この兵種は徴兵できません';
  if (g.troops.length >= MAX_TROOPS) return `兵は${MAX_TROOPS}隊までです`;
  if (troopLoad(g) + D.byUnit[unitId].cost > g.command) return '采配力が足りません';
  // 軍略の兵（伝令・間者の系統）は本陣付きの少数の役なので、武将1人につき1隊まで
  if (isTactical(unitId) && g.troops.filter((t) => isTactical(t.unitId)).length >= S.tactical.capPerGeneral) return `軍略の兵は${S.tactical.capPerGeneral}隊までです`;
  if (g.id in c.away) return '諸国巡りに出ています';
  if (f.supply < recruitCost(unitId, f, isExclave(c, g.prov))) return '兵糧が足りません';
  return null;
}

export function recruit(c: Campaign, gid: string, unitId: string): boolean {
  const g = c.gs.generals[gid];
  if (!g || recruitProblem(c, g, unitId)) return false;
  const f = c.gs.factions[g.faction];
  f.supply -= recruitCost(unitId, f, isExclave(c, g.prov));
  g.troops.push(makeTroop(D.byUnit[unitId], recruitLevel(unitId, f) + (c.player && f.id !== c.player ? S.difficulty[c.difficulty].aiTroopLevel : 0)));
  return true;
}

/**
 * その領から、1か月で移れる自分の領。自分の領だけを通って、決まった数（3つ）先まで。
 * ほかの勢力の領は通り抜けられない。
 */
export function moveTargets(c: Campaign, from: number, f: number, range = S.move.range): Set<number> {
  const out = new Set<number>();
  if (from < 0 || !c.gs.provinces[from]) return out;
  const seen = new Set<number>([from]);
  let frontier = [from];
  for (let step = 0; step < range && frontier.length; step++) {
    const next: number[] = [];
    for (const p of frontier) for (const n of neighborsOf(c, p)) {
      if (seen.has(n) || c.gs.provinces[n].owner !== f) continue;
      seen.add(n); out.add(n); next.push(n);
    }
    frontier = next;
  }
  return out;
}

/** 自分の領から、自分の領へ武将を動かす（1か月に1回。自領づたいに3つ先まで） */
export function moveGeneral(c: Campaign, gid: string, to: number): boolean {
  const g = c.gs.generals[gid];
  if (!g || c.moved.has(gid) || g.prov < 0 || gid in c.away) return false;
  if (c.gs.provinces[to]?.owner !== g.faction || !moveTargets(c, g.prov, g.faction).has(to)) return false;
  g.prov = to;
  c.moved.add(gid);
  return true;
}

/** 攻め込む準備：出陣する武将と、迎え撃つ武将を決める */
export function planAttack(c: Campaign, faction: number, from: number, to: number, gids: string[]): PendingBattle | null {
  const target = c.gs.provinces[to];
  if (!target || target.owner === faction || !neighborsOf(c, from).includes(to)) return null;
  if (!canAttack(c, faction, target.owner)) return null;
  const atk = gids.filter((id) => { const g = c.gs.generals[id]; return g && g.faction === faction && g.prov === from && !c.moved.has(id) && !(id in c.away) && !(id in c.wounded); }).slice(0, MAX_GENERALS);
  if (!atk.length) return null;
  const def = target.owner ? generalsAt(c, to, target.owner).slice(0, MAX_GENERALS).map((g) => g.id) : [];
  return { attacker: faction, defender: target.owner, prov: to, from, atk, def };
}

/** 領の今のようす（戦場の形を決める）。持ち主の本拠なら城になる */
export function provinceLook(c: Campaign, prov: number): ProvinceLook {
  const p = c.gs.provinces[prov], f = c.gs.factions[p.owner];
  return { capital: !!f && f.capital === prov, fort: p.fort, buildings: p.buildings, pop: p.pop, income: p.income, unrest: p.unrest, coastal: p.coastal, river: p.river };
}

/** その領で今戦うときの戦場。領のようすが変われば（普請、本拠が移る、など）、戦場も変わる。from：攻めてくる領（戦場の向き） */
export const provinceMap = (c: Campaign, prov: number, from?: number): BattleMap => mapFromProvince(c.world, prov, { ...provinceLook(c, prov), from });

export function battleMapFor(c: Campaign, pb: PendingBattle): BattleMap {
  return provinceMap(c, pb.prov, pb.from);
}

// ---- 普請：領に建物を建てる、城を固める（1つの領で1か月に1回、兵糧を使う）。建てたものは、その領の戦場に現れる

export type BuildKind = string;
export const BUILD_KINDS: BuildKind[] = ['fort', ...Object.keys(BM.build.costs)];

export function buildCost(c: Campaign, prov: number, kind: BuildKind): number {
  const B = BM.build, p = c.gs.provinces[prov];
  return kind === 'fort' ? Math.round(B.fortCostBase + B.fortCostPerFort * (p?.fort ?? 0)) : B.costs[kind] ?? 0;
}

/** 普請できるか。できないときは理由を返す */
export function buildProblem(c: Campaign, faction: number, prov: number, kind: BuildKind): string | null {
  const p = c.gs.provinces[prov], f = c.gs.factions[faction];
  if (!p || !f || p.owner !== faction) return '自分の領ではありません';
  if (c.built[prov] === c.gs.tick) return 'この領の普請は今月もう済んでいます';
  if (c.sieges[prov]) return '包囲されていて普請できません';
  if (kind === 'fort') {
    if (p.fort >= BM.build.fortMax - 1e-6) return '城はもうこれ以上固くできません';
  } else {
    if (!(kind in BM.build.costs)) return 'その建物は建てられません';
    if (p.buildings.includes(kind)) return 'もう建っています';
    if (BM.buildings[kind]?.coastal && !p.coastal) return '海沿いの領にだけ建てられます';
  }
  const cost = buildCost(c, prov, kind);
  if (f.supply < cost) return `兵糧が足りません（${cost}要ります）`;
  return null;
}

export function build(c: Campaign, faction: number, prov: number, kind: BuildKind): boolean {
  if (buildProblem(c, faction, prov, kind)) return false;
  const p = c.gs.provinces[prov], f = c.gs.factions[faction];
  f.supply -= buildCost(c, prov, kind);
  if (kind === 'fort') p.fort = Math.min(BM.build.fortMax, Math.round((p.fort + BM.build.fortStep) * 100) / 100);
  else {
    p.buildings.push(kind);
    p.income *= BM.buildings[kind]?.income ?? 1;
  }
  c.built[prov] = c.gs.tick;
  refreshIncome(c);
  note(c, kind === 'fort' ? 'buildFort' : 'build', { faction: f.name.ja, prov: p.name.ja, what: BM.buildings[kind]?.name ?? '', fort: Math.round(p.fort * 100) });
  return true;
}

/** 勢力の普請：兵糧に余りがあれば、ときどき、敵と接した領の城を固めるか、本拠に建物を建てる */
function aiBuild(c: Campaign, f: GFaction): void {
  const B = BM.build;
  if (f.supply < S.ai.reserveSupply + f.income * B.aiSupplyMonths) return;
  const r = new RNG(codeToSeed(`${c.gs.seed}:build:${c.gs.tick}:${f.id}`));
  if (!r.chance(B.aiChance)) return;
  const front = provincesOf(c, f.id).filter((p) => threatened(c, f.id, p.id) && p.fort < B.fortMax).sort((a, b) => a.fort - b.fort || a.id - b.id)[0];
  if (front && build(c, f.id, front.id, 'fort')) return;
  const cap = f.capital;
  for (const k of ['walls', 'market', 'granary', 'mine', 'temple']) if (build(c, f.id, cap, k)) return;
}

// ---- 守備兵：守る武将のいない領を守る、弱い兵。強さは領の城と人口で決まる

const GARRISON = 'garrison:';
export const isGarrison = (id: string): boolean => id.startsWith(GARRISON);

/** その領の守備兵の強さ：頭と兵のレベル、兵の隊数 */
export function garrisonOf(c: Campaign, prov: number): { level: number; troops: number } {
  const G = S.garrison, p = c.gs.provinces[prov], f = c.gs.factions[p.owner];
  let level = G.levelBase + Math.round(p.fort * G.levelPerFort) + (p.pop >= G.cityPop ? G.levelCity : p.pop >= G.townPop ? G.levelTown : 0);
  if (f && f.capital === prov) level += G.levelCapital;
  const ex = !!f && isExclave(c, prov);
  if (ex) level += S.exclave.garrisonLevel;
  // 自分の領の守備兵は、難しさで少し強さが変わる
  if (f && f.id === c.player) level = Math.round(level * S.difficulty[c.difficulty].playerSiege);
  const troops = G.troopsBase + Math.round(p.fort * G.troopsPerFort) + (p.pop >= G.townPop ? G.troopsTown : 0) + (ex ? S.exclave.garrisonTroops : 0);
  return { level: Math.max(1, Math.min(G.levelMax, level)), troops: Math.max(1, Math.min(G.troopsMax, troops)) };
}

/** 守備兵の強さの目安（勢力が、攻めるかどうかを決めるのに使う） */
const garrisonStrength = (c: Campaign, prov: number): number => { const g = garrisonOf(c, prov); return 40 + g.level * 10 + g.troops * (28 + g.level * 3); };

/** 守備兵を立てる：その戦いのあいだだけ居る仮の武将を作り、守り手にする */
function raiseGarrison(c: Campaign, pb: PendingBattle): void {
  const gs = c.gs, G = S.garrison, f = gs.factions[pb.defender], g = garrisonOf(c, pb.prov);
  // 兵種は、その勢力が徴兵できる陸の兵から、選ばれやすい順に。持ち主のいない領は、ふつうの兵
  const own = f ? Object.keys(f.recruit).filter((u) => !G.skipLines.includes(D.byUnit[u].line)).sort((a, b) => f.recruit[b] - f.recruit[a] || a.localeCompare(b)) : [];
  const kinds = (own.length ? own.slice(0, 3) : G.units);
  const units = Array.from({ length: g.troops }, (_x, i) => kinds[i % kinds.length]);
  const id = `${GARRISON}${pb.prov}`;
  makeGarrison(gs, id, pb.defender, pb.prov, g.level + 1, units, g.level);
  pb.def = [id];
}

/** 戦いが済んだら、守備兵を消す */
function dropGarrison(c: Campaign, pb: PendingBattle): void {
  for (const id of pb.def) if (isGarrison(id)) delete c.gs.generals[id];
  pb.def = pb.def.filter((id) => !isGarrison(id));
}

export function battleFor(c: Campaign, pb: PendingBattle): BattleState {
  const gs = c.gs;
  if (!pb.def.length) raiseGarrison(c, pb);
  const names: [string, string] = [gs.factions[pb.attacker].name.ja, gs.factions[pb.defender]?.name.ja ?? '守備兵'];
  const st = createBattle(gs, battleMapFor(c, pb), [pb.atk, pb.def], `c:${gs.tick}:${pb.prov}:${pb.attacker}`, names);
  const cut = battleSupply(c, pb);
  if (cut[0] !== 1 || cut[1] !== 1) st.supplyMult = cut;
  // 戦闘の難しさ：自分の勢力と戦う相手の陣営だけ、思考の賢さが変わる（相手どうしの戦いは、ふつう）
  if (c.player && (pb.attacker === c.player || pb.defender === c.player)) st.aiLevel = { side: pb.attacker === c.player ? 1 : 0, level: c.difficulty };
  return st;
}

/**
 * 飛び地の戦いの罰：飛び地から攻めて出た攻め手、飛び地を守る守り手は、攻撃・防御が下がる（strategy.json の exclave.battleAtkDefPct）。
 * [攻め手, 守り手] の掛け目
 */
export function battleSupply(c: Campaign, pb: PendingBattle): [number, number] {
  const m = 1 + S.exclave.battleAtkDefPct / 100;
  const atkCut = exclavesOf(c, pb.attacker).has(pb.from), defCut = !!pb.defender && exclavesOf(c, pb.defender).has(pb.prov);
  return [atkCut ? m : 1, defCut ? m : 1];
}

function eliminate(c: Campaign, f: GFaction, by: number): void {
  const gs = c.gs;
  note(c, 'fall', { faction: f.name.ja, by: gs.factions[by]?.name.ja ?? '' });
  const freed = Object.values(gs.generals).filter((g) => g.faction === f.id);
  for (const g of freed) { g.faction = 0; g.prov = -1; g.isLord = false; delete c.away[g.id]; }
  for (const x of Object.values(gs.factions)) if (x.overlord === f.id) x.overlord = 0;
  gs.wars = gs.wars.map((w) => ({ ...w, attackers: w.attackers.filter((i) => i !== f.id), defenders: w.defenders.filter((i) => i !== f.id) }))
    .filter((w) => w.attackers.length && w.defenders.length);
  gs.alliances = gs.alliances.filter(([a, b]) => a !== f.id && b !== f.id);
  gs.truces = gs.truces.filter((t) => t.a !== f.id && t.b !== f.id);
  delete gs.factions[f.id];
  if (f.id === c.player) c.over = 'lose';
  onEliminated(c, freed, by);
}

function capture(c: Campaign, pb: PendingBattle): void {
  const gs = c.gs, p = gs.provinces[pb.prov];
  const loser = gs.factions[pb.defender];
  p.owner = pb.attacker; p.controller = pb.attacker;
  delete c.sieges[pb.prov];
  note(c, 'capture', { faction: gs.factions[pb.attacker].name.ja, prov: p.name.ja, from: loser?.name.ja ?? '' });
  // 領にいた予備兵は、奪った側のものになる
  if (reserveOf(c, pb.prov).length) note(c, 'reserveTaken', { faction: gs.factions[pb.attacker].name.ja, prov: p.name.ja, n: reserveOf(c, pb.prov).length });
  for (const id of pb.atk) { const g = gs.generals[id]; if (g && g.faction === pb.attacker) g.prov = pb.prov; }
  // 攻め手・守り手以外の勢力の武将がいたら、自分の領へ帰す
  for (const g of Object.values(gs.generals)) {
    if (g.prov === pb.prov && g.faction && g.faction !== pb.attacker && g.faction !== pb.defender) g.prov = homeFor(c, g.faction, pb.prov);
  }
  if (!loser) return;
  const left = provincesOf(c, loser.id);
  if (!left.length) { eliminate(c, loser, pb.attacker); return; }
  if (loser.capital === pb.prov) loser.capital = left.sort((a, b) => b.pop - a.pop || a.id - b.id)[0].id;
  // 残っていた武将は、隣の自領か本拠へ退く
  for (const g of Object.values(gs.generals)) {
    if (g.faction !== loser.id || g.prov !== pb.prov) continue;
    const near = neighborsOf(c, pb.prov).find((n) => gs.provinces[n].owner === loser.id);
    g.prov = near ?? loser.capital;
  }
}

function refreshIncome(c: Campaign): void {
  for (const f of Object.values(c.gs.factions)) {
    const mult = traitsOf(f).reduce((m, t) => m * (t.incomeMult ?? 1), 1) * (f.id === c.player ? S.difficulty[c.difficulty].playerIncome : 1);
    // 飛び地の収入は大きく減る
    const ex = exclavesOf(c, f.id);
    f.income = Math.round(provincesOf(c, f.id).reduce((s, p) => s + p.income * (ex.has(p.id) ? S.exclave.incomeMult : 1), 0) * mult);
  }
}

/** 宣戦する（中立の相手にだけ）。攻め込んだときにも自動で呼ばれる */
export function declareWar(c: Campaign, a: number, b: number): boolean {
  const gs = c.gs;
  if (!gs.factions[a] || !gs.factions[b] || relation(c, a, b) !== 'neutral') return false;
  gs.wars.push({ attackers: [a], defenders: [b], since: gs.tick });
  gs.factions[b].opinions[a] = Math.min(gs.factions[b].opinions[a] ?? 0, S.diplomacy.opinionOnWar);
  // 攻められた側の味方は、仕掛けた側をよく思わない
  for (const x of Object.values(gs.factions)) {
    if (x.id !== a && x.id !== b && relation(c, x.id, b) === 'ally') x.opinions[a] = Math.max(-100, (x.opinions[a] ?? 0) + S.diplomacy.opinionAllyOfVictim);
  }
  c.offers = c.offers.filter((o) => !((a === c.player && o.from === b) || (b === c.player && o.from === a)));
  note(c, 'war', { a: gs.factions[a].name.ja, b: gs.factions[b].name.ja });
  return true;
}

function checkOver(c: Campaign): void {
  if (c.over || !c.player) return;
  if (!c.gs.factions[c.player]) { c.over = 'lose'; return; }
  const rivals = Object.values(c.gs.factions).filter((f) => f.id !== c.player && relation(c, c.player, f.id) !== 'ally');
  if (!rivals.length) c.over = 'win';
}

/**
 * 戦いの結果を反映する。st を渡さなければ、その場で自動で戦わせる。
 * 守る武将がいない領は、戦わずに落ちる。
 */
export function resolveBattle(c: Campaign, pb: PendingBattle, st?: BattleState): BattleSummary | null {
  try { return settle(c, pb, st); } finally { dropGarrison(c, pb); }
}

function settle(c: Campaign, pb: PendingBattle, st?: BattleState): BattleSummary | null {
  for (const id of pb.atk) c.moved.add(id);
  // 準備してから決着までの間に、状況が変わっていたら取りやめる（攻め手が滅んだ、領の持ち主が変わった、など）
  if (!c.gs.factions[pb.attacker] || c.gs.provinces[pb.prov].owner !== pb.defender) return null;
  if (c.gs.factions[pb.defender] === undefined && pb.defender !== 0) return null;
  pb.atk = pb.atk.filter((id) => c.gs.generals[id]?.faction === pb.attacker);
  pb.def = pb.def.filter((id) => c.gs.generals[id]?.faction === pb.defender && c.gs.generals[id].prov === pb.prov);
  if (!pb.atk.length) return null;
  // 中立の相手に攻め込んだら、戦争になる
  if (pb.defender) declareWar(c, pb.attacker, pb.defender);
  // 守る武将がいない領は、守備兵が守る（弱いが、戦わずには落ちない）
  if (!pb.def.length) raiseGarrison(c, pb);
  const battle = st ?? autoBattle(battleFor(c, pb));
  if (battle.winner === null) throw new Error('戦闘がまだ終わっていません');
  const sum = applyBattleResult(c.gs, battle);
  note(c, 'battle', {
    attacker: c.gs.factions[pb.attacker].name.ja, defender: c.gs.factions[pb.defender]?.name.ja ?? '在地の兵',
    prov: c.gs.provinces[pb.prov].name.ja, winner: battle.sideNames[sum.winner],
  });
  // 倒された武将は深手を負い、しばらく戦えない（翌月すぐ元どおりに出てこないように）
  const hurt = sum.beatenIds.filter((id) => c.gs.generals[id] && !isGarrison(id));
  for (const id of hurt) {
    const months = woundMonths(c.gs.generals[id]);
    c.wounded[id] = c.gs.tick + months;
    note(c, 'wounded', { names: c.gs.generals[id].name.ja, months });
  }
  retreatPenalty(c, pb, battle, sum);
  afterBattle(c, pb, sum);
  dropGarrison(c, pb);
  if (sum.winner === 0 && c.gs.factions[pb.attacker]) capture(c, pb);
  refreshIncome(c);
  checkOver(c);
  return sum;
}

/**
 * 退いた陣営の罰（重い）：体力が半分を切った兵と、ほかの兵も一定の見込みで失う。兵糧を失う。武将は深手を負う。
 * 守り手が退いたときは、領も失う（勝敗で、ふつうに取られる）
 */
function retreatPenalty(c: Campaign, pb: PendingBattle, st: BattleState, sum: BattleSummary): void {
  const side = st.retreat;
  if (side === undefined) return;
  const R = S.retreat, gs = c.gs;
  const fid = side === 0 ? pb.attacker : pb.defender, f = gs.factions[fid];
  const rng = new RNG(codeToSeed(`${gs.seed}:${gs.tick}:retreat:${pb.prov}:${fid}`));
  const remove = new Map<string, Set<number>>();
  for (const u of st.units) {
    if (u.home !== side || u.kind !== 'troop' || !u.alive) continue;
    const g = gs.generals[u.generalId];
    if (!g || !g.troops[u.troopIndex]) continue;
    if (u.hp / u.maxHp < R.troopLossBelowHp || rng.chance(R.troopLossChance)) {
      if (!remove.has(g.id)) remove.set(g.id, new Set());
      remove.get(g.id)!.add(u.troopIndex);
      sum.lost.push({ general: g.name.ja, unit: `${u.name}（退くときに失った）`, side });
    }
  }
  for (const [gid, idxs] of remove) gs.generals[gid].troops = gs.generals[gid].troops.filter((_t, i) => !idxs.has(i));
  if (f) {
    const lose = Math.round(f.supply * R.supplyLossPct / 100);
    f.supply = Math.max(0, f.supply - lose);
    note(c, 'retreated', { faction: f.name.ja, prov: gs.provinces[pb.prov].name.ja, troops: [...remove.values()].reduce((s, x) => s + x.size, 0), supply: lose });
  }
  for (const u of st.units) {
    if (u.home !== side || u.kind !== 'general' || !u.alive) continue;
    const g = gs.generals[u.generalId];
    if (g && !(g.id in c.wounded)) c.wounded[g.id] = gs.tick + R.woundMonths;
  }
}

// ---- 本拠を移す：兵糧を多く使い、2〜3か月かかる。途中でその領を失うと取りやめ（兵糧は戻らない）

/** 本拠を移すのにかかる兵糧と月数（本拠とつながった領は短く、飛び地は長い） */
export function relocationPlan(c: Campaign, faction: number, to: number): { cost: number; months: number } {
  const f = c.gs.factions[faction], R = S.capital;
  const cost = Math.max(R.costMin, Math.round(f.income * R.costIncomeMonths));
  const months = exclavesOf(c, faction).has(to) ? R.monthsFar : R.monthsNear;
  return { cost, months };
}

/** 本拠を移せるか。移せないときは理由を返す */
export function relocationProblem(c: Campaign, faction: number, to: number): string | null {
  const f = c.gs.factions[faction], p = c.gs.provinces[to];
  if (!f || !p || p.owner !== faction) return '自分の領ではありません';
  if (f.capital === to) return 'もう本拠です';
  if (c.relocations[faction]) return 'いま本拠を移しているところです';
  if (c.sieges[to]) return '包囲されている領には移せません';
  const { cost } = relocationPlan(c, faction, to);
  if (f.supply < cost) return `兵糧が足りません（${cost}要ります）`;
  return null;
}

/** 本拠を移し始める（兵糧はすぐ払う） */
export function startRelocation(c: Campaign, faction: number, to: number): boolean {
  if (relocationProblem(c, faction, to)) return false;
  const f = c.gs.factions[faction], { cost, months } = relocationPlan(c, faction, to);
  f.supply -= cost;
  c.relocations[faction] = { to, until: c.gs.tick + months, cost };
  note(c, 'capitalMoveStart', { faction: f.name.ja, prov: c.gs.provinces[to].name.ja, months });
  return true;
}

/** 月の終わり：期日が来た本拠の移りを終える。途中で領を失っていれば取りやめ */
function finishRelocations(c: Campaign): void {
  for (const [k, r] of Object.entries(c.relocations)) {
    const fid = Number(k), f = c.gs.factions[fid];
    if (!f) { delete c.relocations[fid]; continue; }
    if (c.gs.provinces[r.to]?.owner !== fid) {
      note(c, 'capitalMoveFailed', { faction: f.name.ja, prov: c.gs.provinces[r.to].name.ja });
      delete c.relocations[fid];
      continue;
    }
    if (c.gs.tick < r.until) continue;
    f.capital = r.to;
    note(c, 'capitalMoved', { faction: f.name.ja, prov: c.gs.provinces[r.to].name.ja });
    delete c.relocations[fid];
  }
}

// ---------------------------------------------------------------- 勢力の思考

function aiRecruit(c: Campaign, f: GFaction): void {
  const ids = Object.keys(f.recruit);
  if (!ids.length) return;
  for (const g of Object.values(c.gs.generals)) {
    if (g.faction !== f.id) continue;
    for (let guard = 0; guard < MAX_TROOPS; guard++) {
      if (f.supply < S.ai.reserveSupply) return;        // 兵糧は少し残す
      const ok = ids.filter((u) => !recruitProblem(c, g, u));
      if (!ok.length) break;
      let r = c.rng.float() * ok.reduce((s, u) => s + f.recruit[u], 0);
      let pick = ok[ok.length - 1];
      for (const u of ok) { r -= f.recruit[u]; if (r < 0) { pick = u; break; } }
      recruit(c, g.id, pick);
    }
  }
}

/** 勢力の当主の性格（戦略の判断に使う）。当主がいなければ標準 */
export function lordPersonality(c: Campaign, f: GFaction): Personality {
  const lord = c.gs.generals[f.lordId];
  return lord ? personalityOf(lord.traits, lord.ab) : NEUTRAL;
}

/** その領が敵と接しているか、包囲されているか（守りを置くべき領） */
function threatened(c: Campaign, f: number, prov: number): boolean {
  if (c.sieges[prov]) return true;
  return neighborsOf(c, prov).some((n) => { const o = c.gs.provinces[n].owner; return o !== f && o !== 0 && canAttack(c, o, f); });
}

/**
 * 勢力の1か月ぶんの行動。プレイヤーの領への攻撃は、戦わずに返す（プレイヤーが戦う）。
 * 当主の性格で判断が変わる：猛攻なら少ない戦力差でも攻め、慎重なら十分に勝る相手だけを攻める。
 * 知略があれば守りのいない領を好み、武勇を重んじれば戦争中でない相手を攻めたがらない。
 */
function aiFaction(c: Campaign, f: GFaction): PendingBattle[] {
  const pending: PendingBattle[] = [];
  const A = S.ai, per = lordPersonality(c, f);
  const needRatio = Math.max(0.8, A.attackRatio - per.aggression * A.aggressionRatio + per.caution * A.cautionRatio);
  const chance = Math.max(0.2, Math.min(0.95, A.attackChance * (1 + per.aggression * A.aggressionChance)));
  aiRecruit(c, f);
  if (f.id !== c.player) aiBuild(c, f);
  for (const p of provincesOf(c, f.id)) {
    if (!c.gs.factions[f.id]) break;
    const here = generalsAt(c, p.id, f.id).filter((g) => !c.moved.has(g.id));
    if (!here.length) continue;
    const mine = strengthSum(here);
    let best: { to: number; score: number; empty: boolean } | null = null;
    for (const n of neighborsOf(c, p.id)) {
      const t = c.gs.provinces[n];
      if (t.owner === f.id || !canAttack(c, f.id, t.owner)) continue;
      const defenders = t.owner ? generalsAt(c, n, t.owner) : [];
      // 守りのいない領は、城が持ちこたえるぶんを相手の力として見る
      // 守りのいない領は、攻めればすぐ落ちる。見かけの守りを少しだけ置いて、空の領ばかりを追い回さないようにする
      const def = defenders.length ? strengthSum(defenders) * (1 + t.fort * 0.5) : garrisonStrength(c, n) * (1 + t.fort * 0.5);
      let score = mine / (def + 30);
      if (!defenders.length) score *= 1 + per.cunning * A.cunningEmptyBonus;
      if (c.sieges[n]?.by === f.id) score *= 1.5;       // 始めた包囲は続ける
      if (t.owner === c.player && c.player) score *= S.difficulty[c.difficulty].aiVsPlayer;
      if (t.owner && relation(c, f.id, t.owner) === 'war') score *= A.warBonus;
      else if (t.owner) score *= A.neutralMult * (1 - Math.max(0, per.honor) * A.honorNeutralPenalty);   // 戦争中でない相手には、仕掛けにくい
      if (!best || score > best.score) best = { to: n, score, empty: !defenders.length };
    }
    // 守りのいない領は取りやすいが、毎月のように取り合うと落ち着かないので、仕掛ける頻度は下げる
    if (best && best.score > needRatio && c.rng.chance(chance * (best.empty ? S.difficulty[c.difficulty].aiEmptyChance : 1))) {
      // 本拠を空にしない：本拠からは1人残す
      const send = (p.id === f.capital && here.length > 1 ? here.slice(0, Math.min(MAX_GENERALS, here.length - 1)) : here.slice(0, MAX_GENERALS)).map((g) => g.id);
      const pb = planAttack(c, f.id, p.id, best.to, send);
      if (!pb) continue;
      if (pb.defender === c.player && c.player) { for (const id of pb.atk) c.moved.add(id); pending.push(pb); }
      else resolveBattle(c, pb);
      continue;
    }
    // 攻めないとき：守りを整える。敵と接していない領の武将を、敵と接した（または包囲された）隣の自領へ送る
    const keep = p.id === f.capital ? 1 : threatened(c, f.id, p.id) ? Math.min(here.length, MAX_GENERALS) : 0;
    const spare = here.slice(keep);
    if (!spare.length) continue;
    const own = neighborsOf(c, p.id).filter((n) => c.gs.provinces[n].owner === f.id);
    const need = (n: number): number => (c.sieges[n] ? 100 : 0) + (threatened(c, f.id, n) ? 10 : own.length && neighborsOf(c, n).some((m) => c.gs.provinces[m].owner === f.id && threatened(c, f.id, m)) ? 3 : 0)
      - generalsAt(c, n, f.id).length * 4;
    for (const g of spare.reverse()) {
      const to = own.map((n) => ({ n, v: need(n) })).filter((x) => x.v > 0).sort((x, y) => y.v - x.v || x.n - y.n)[0];
      if (!to) break;
      moveGeneral(c, g.id, to.n);
    }
  }
  return pending;
}

/**
 * 月を進める：プレイヤー以外の勢力が動き、収入が入り、暦が1か月進む。
 * 戻り値：プレイヤーの領が攻められた戦い（プレイヤーが resolveBattle で決着をつける）
 */
export function endMonth(c: Campaign): PendingBattle[] {
  if (c.over) return [];
  const pending: PendingBattle[] = [];
  const order = Object.values(c.gs.factions).filter((f) => f.id !== c.player).sort((a, b) => a.id - b.id);
  for (const f of order) if (c.gs.factions[f.id]) pending.push(...aiFaction(c, f));
  return pending;
}

/** 深手の長さ（月）。病弱な武将は長く、勇敢・武人の武将は短い */
export function woundMonths(g: GGeneral): number {
  const W = S.people.wound;
  if (g.traits.some((t) => W.longTraits.includes(t))) return W.long;
  if (g.traits.some((t) => W.shortTraits.includes(t))) return W.short;
  return W.months;
}

// ---- 兵の入れ替え：同じ領にいる自分の武将どうしで兵を渡す、兵を手放す

/** 兵の持ち主：武将か、領の予備兵。key は武将の番号か、予備兵なら「@領の番号」 */
export interface Holder { key: string; troops: GTroop[]; prov: number; faction: number; general: GGeneral | null }
export const reserveKey = (prov: number): string => `@${prov}`;
export const isReserveKey = (key: string): boolean => key.startsWith('@');

/** 領の予備兵（領に付いている。持ち主が替われば、新しい持ち主のものになる） */
export function reserveOf(c: Campaign, prov: number): GTroop[] {
  return c.reserve[prov] ?? [];
}

export function holderOf(c: Campaign, key: string): Holder | null {
  if (isReserveKey(key)) {
    const prov = Number(key.slice(1));
    if (!c.player || c.gs.provinces[prov]?.owner !== c.player) return null;
    return { key, troops: (c.reserve[prov] ??= []), prov, faction: c.player, general: null };
  }
  const g = c.gs.generals[key];
  return g ? { key, troops: g.troops, prov: g.prov, faction: g.faction, general: g } : null;
}

/** 持ち主をなくした兵を、その領の予備兵に入れる（どの勢力の領でも。入りきらないぶんは失われる）。入った数を返す */
export function toReserve(c: Campaign, prov: number, troops: GTroop[]): number {
  if (!c.gs.provinces[prov]) return 0;
  const list = (c.reserve[prov] ??= []);
  const fit = troops.slice(0, Math.max(0, S.reserve.max - list.length));
  list.push(...fit);
  return fit.length;
}

/** 兵を移せるか（武将どうし、武将と予備兵のあいだ）。移せないときは理由を返す */
export function moveTroopProblem(c: Campaign, fromKey: string, index: number, toKey: string): string | null {
  const from = holderOf(c, fromKey), to = holderOf(c, toKey);
  const t = from?.troops[index];
  if (!from || !to || !t || fromKey === toKey) return '渡せません';
  if (from.faction !== to.faction || from.prov !== to.prov) return '同じ領にいる味方の武将にだけ渡せます';
  if ((from.general && from.general.id in c.away) || (to.general && to.general.id in c.away)) return '諸国巡りに出ています';
  if (!to.general) return to.troops.length >= S.reserve.max ? `予備兵は${S.reserve.max}隊までです` : null;
  if (to.troops.length >= MAX_TROOPS) return `兵は${MAX_TROOPS}隊までです`;
  if (troopLoad(to.general) + D.byUnit[t.unitId].cost > to.general.command) return '相手の采配力が足りません';
  if (isTactical(t.unitId) && to.troops.filter((x) => isTactical(x.unitId)).length >= S.tactical.capPerGeneral) return `軍略の兵は${S.tactical.capPerGeneral}隊までです`;
  return null;
}

/** 兵を渡せるか。渡せないときは理由を返す */
export function transferProblem(c: Campaign, from: GGeneral, index: number, to: GGeneral): string | null {
  return moveTroopProblem(c, from.id, index, to.id);
}

/** 兵を、同じ領にいる別の武将（か予備兵）へ渡す（レベルや経験はそのまま） */
export function transferTroop(c: Campaign, fromKey: string, index: number, toKey: string): boolean {
  if (moveTroopProblem(c, fromKey, index, toKey)) return false;
  const from = holderOf(c, fromKey)!, to = holderOf(c, toKey)!;
  to.troops.push(...from.troops.splice(index, 1));
  return true;
}

/** 兵を手放す（兵糧は戻らない） */
export function dismissTroop(c: Campaign, key: string, index: number): boolean {
  const h = holderOf(c, key);
  if (!h || !h.troops[index] || (h.general && h.general.id in c.away)) return false;
  h.troops.splice(index, 1);
  return true;
}

/** 兵糧をためておける上限 */
export const supplyCap = (f: GFaction): number => Math.max(S.supply.capMin, f.income * S.supply.capMonths);

/** 攻められた戦いがすべて決着したあとに呼ぶ：収入と暦 */
export function finishMonth(c: Campaign): void {
  const gs = c.gs;
  // 空になった予備兵の欄は片づける（予備兵は領に付いたまま。領を奪われても残り、奪った側のものになる）
  for (const k of Object.keys(c.reserve)) if (!c.reserve[Number(k)].length) delete c.reserve[Number(k)];
  refreshIncome(c);
  /* 兵糧は蔵に入るぶんまで（収入の何か月ぶんか）。あふれたぶんは失われる */
  for (const f of Object.values(gs.factions)) f.supply = Math.max(Math.min(f.supply, supplyCap(f)), Math.min(f.supply + f.income, supplyCap(f)));
  gs.tick++; c.months++;
  gs.month++;
  if (gs.month > 12) { gs.month = 1; gs.year++; }
  gs.truces = gs.truces.filter((t) => t.until > gs.tick);
  c.moved.clear();
  // 今月攻められなかった包囲は、守りが立て直されて進みが戻る
  for (const [k, sg] of Object.entries(c.sieges)) {
    if (sg.tick >= gs.tick - 1 && gs.factions[sg.by]) continue;
    sg.progress *= S.siege.idleDecay;
    if (sg.progress < 20 || !gs.factions[sg.by]) delete c.sieges[Number(k)];
  }
  for (const id of Object.keys(c.wounded)) if (c.wounded[id] <= gs.tick || !gs.generals[id]) delete c.wounded[id];
  finishRelocations(c);
  autoPromote(c);
  monthlyEvents(c);
  historyMonth(c, { dies: (g) => generalDies(c, g), note: (key, vars) => note(c, key, vars) });
  refreshIncome(c);
  checkOver(c);
}

/** プレイヤーの操作なしで1か月進める（観戦・テスト用。プレイヤーの領への攻撃も自動で戦う） */
export function autoMonth(c: Campaign): void {
  const player = c.player;
  if (player && c.gs.factions[player]) aiFaction(c, c.gs.factions[player]).forEach((pb) => resolveBattle(c, pb));
  for (const pb of endMonth(c)) resolveBattle(c, pb);
  finishMonth(c);
}
