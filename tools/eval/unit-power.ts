// 兵種の実際の強さを、戦闘の計算式で測る（1対1の決闘を、期待値で5巡まで進める）。
// 使い方：npx vite-node tools/eval/unit-power.ts [レベル=20] [巡=5] [格=すべて]
//
// ・相手は同じ格の全種（自分を含む）。相手ごとに、先に動く・後に動くの両方を進めて平均する。
// ・毎回の行動は、そのとき使える技・軍略（気力が足りるもの）から、いちばん効くものを選ぶ（気力切れも出る）。
//   技：期待ダメージ（命中・会心）。反撃が届けば、反撃の期待ダメージを受ける。技の状態（気絶・眩暈・混乱・毒・寝返りなど）も見込む。
//   軍略：ダメージ（外れない）、状態（成功率）、弱化・強化（そのあとのダメージの増減で）、回復、気力を減らすもの。範囲の軍略も1体ぶんだけ数える。
// ・2回行動（特技）は、1巡に2回動く（そのたびに反撃も受ける）。号令は、自分がもう1回動けるとして数える。
// ・盾で受ける（特技）は、単体の技と反撃を、その見込みで半分にする。毎ターンの回復（特技）も入れる（森・水の上だけのものは入れない）。
// ・強さ＝相手ごとの交換比（相手を削った割合 ÷ 自分が削られた割合）の幾何平均 ×100。100 が同じ格の並。
// ・コスパ＝強さ ÷ 采配の重さ ×100（同じ格の中で比べる）。
import { parseMap } from '../../src/battle/map';
import type { BUnit, BattleState } from '../../src/battle/types';
import { makeTroop } from '../../src/convert/convert';
import { RNG } from '../../src/core/rng';
import { D, L } from '../../src/data/db';
import type { SkillDef, StatusId, TacticDef } from '../../src/data/types';
import { canCounter, critChance, healAmount, hitChance, skillDamage, tacticCost, tacticDamage, tacticSide, tacticSuccess } from '../../src/rules/combat';
import { attackPower, basicSkill, passive, skillOf } from '../../src/rules/stats';
import { classMod } from '../../src/rules/growth';

const LV = Number(process.argv[2] ?? 20), ROUNDS = Number(process.argv[3] ?? 5), ONLY = process.argv[4] ? Number(process.argv[4]) : null;
const SD = D.status as unknown as Record<string, { turns?: number | [number, number]; pct?: number }>;
const turnsOf = (id: string, given?: number): number => {
  if (given && given > 0) return given;
  const t = SD[id]?.turns;
  return Array.isArray(t) ? (t[0] + t[1]) / 2 : typeof t === 'number' ? t : 99;
};
const DISABLE = new Set<StatusId>(['daze', 'stun', 'confuse', 'defect']);
const STAT_FX = new Set<StatusId>(['weaken', 'atkDown', 'intDown', 'grounded', 'atkUp', 'defUp', 'agiUp', 'resistUp', 'atkNext', 'sureNext', 'mounted', 'moveUp', 'regen', 'ward']);

function mk(id: string, side: 0 | 1, pos: number): BUnit {
  // 将の役職のとき（HEX_CLASSES）は、標準の将を作る
  const hook = (globalThis as unknown as { __mk?: (i: string, s: 0 | 1, p: number) => BUnit }).__mk;
  if (hook && D.byClass[id]) return hook(id, side, pos);
  const def = D.byUnit[id], t = makeTroop(def, LV);
  return {
    id: side, side, home: side, kind: 'troop', generalId: `g${side}`, leader: side, troopIndex: 0, defId: id, name: L(def.name), level: LV, pos,
    hp: t.stats.hp, maxHp: t.stats.hp, mp: t.stats.mp, maxMp: t.stats.mp, str: t.stats.str, int: t.stats.int, agi: t.stats.agi, def: def.def,
    move: def.move, affinity: def.affinity, commandRange: 9, passives: [...def.passives], skills: [...def.skills], tactics: [...def.tactics],
    critPct: 0, healPct: 0, statuses: [], moveSpent: 0, moved: false, postMoved: false, acted: false, extraUsed: false, alive: true, retreated: false, expGained: 0,
  };
}

/** 決闘の片方：期待値の体力、動けない見込み（これから先の巡ごと）、毒の見込み */
interface Side { u: BUnit; hp: number; dis: number[]; poison: number }
const st: BattleState = { map: parseMap(Array.from({ length: 3 }, () => '. . . . . . .').join('\n')), units: [], turn: 0, round: 1, maxRounds: 99, winner: null, rng: new RNG(1), log: [], sideNames: ['a', 'b'] };
const at = (a: Side, t: Side, dist: number): void => { a.u.pos = st.map.grid.idx(0, 1); t.u.pos = st.map.grid.idx(Math.max(1, dist), 1); st.units = [a.u, t.u]; };
const crit = (u: BUnit) => 1 + (critChance(u) / 100) * (D.combat.critMult - 1);
/** 盾で受ける（特技 shield）：単体の技は、その見込みで半分になる */
const shieldOf = (t: BUnit, s: SkillDef): number => (s.shape.type === 'single' ? passive(t, 'shield').reduce((m, p) => m * (1 - Math.min(100, p.chance) / 200), 1) : 1);

/** いちばん良い「気力の要らない」技の期待ダメージ（相手の脅威の目安） */
function threat(a: Side, t: Side): number {
  let best = 0;
  for (const id of a.u.skills) {
    const s = skillOf(id);
    if (s.noDamage || s.needsWater || s.mp > a.u.mp) continue;
    at(a, t, s.range[1]);
    best = Math.max(best, skillDamage(st, a.u, s, t.u) * (hitChance(st, a.u, s, t.u) / 100) * crit(a.u) * shieldOf(t.u, s));
  }
  return best;
}

type Option = { label: string; value: number; cost: number; apply: () => void };

/** 行動の候補（そのとき使えるもの）と、その値打ち（相手の体力の割合で数える）。left：この行動のあとに残る自分の行動の数 */
function options(a: Side, t: Side, left: number, actsT: number): Option[] {
  const out: Option[] = [];
  const myRest = Math.max(1, left), theirRest = Math.max(1, actsT);
  const disAt = (k: number) => t.dis[k] ?? 0;
  for (const id of a.u.skills) {
    const s = skillOf(id);
    if (s.mp > a.u.mp || s.needsWater) continue;
    const dist = s.shape.type === 'single' ? s.range[1] : 1;
    at(a, t, dist);
    const hit = hitChance(st, a.u, s, t.u) / 100;
    const dmg = s.noDamage ? 0 : skillDamage(st, a.u, s, t.u) * hit * crit(a.u) * shieldOf(t.u, s);
    // 反撃：届けば、動けない見込みのぶんだけ減らして受ける
    const basic = basicSkill(t.u);
    let counter = 0;
    if (canCounter(st, a.u, s, t.u, basic)) counter = skillDamage(st, t.u, basic!, a.u, true) * (hitChance(st, t.u, basic!, a.u) / 100) * shieldOf(a.u, basic!) * (1 - disAt(0));
    let extra = 0;
    const fx: (() => void)[] = [];
    for (const e of s.effects) {
      const p = ('chance' in e ? e.chance / 100 : 1) * hit;
      if (e.type === 'status' && DISABLE.has(e.status)) {
        const n = Math.min(e.status === 'stun' ? 1 : turnsOf(e.status), theirRest);
        extra += (p * n * threat(t, a)) / a.u.maxHp;
        fx.push(() => { for (let k = 0; k < n; k++) t.dis[k] = 1 - (1 - (t.dis[k] ?? 0)) * (1 - p); });
      } else if (e.type === 'status' && e.status === 'poison') {
        extra += (p * (SD.poison.pct ?? 10) / 100 * theirRest);
        fx.push(() => { t.poison = Math.min(1, t.poison + p); });
      } else if (e.type === 'weakenStun') {
        extra += (p * threat(t, a)) / a.u.maxHp;
        fx.push(() => { t.dis[0] = 1 - (1 - (t.dis[0] ?? 0)) * (1 - p); });
      } else if (e.type === 'lifesteal') extra += (dmg * e.rate) / a.u.maxHp;
      else if (e.type === 'mpHalf') fx.push(() => { t.u.mp = Math.floor(t.u.mp / 2); });
    }
    const value = dmg / t.u.maxHp + extra - counter / a.u.maxHp;
    out.push({ label: L(s.name), value, cost: s.mp, apply: () => { t.hp -= dmg; a.hp -= counter; a.u.mp -= s.mp; for (const f of fx) f(); if (s.effects.some((e) => e.type === 'lifesteal')) a.hp = Math.min(a.u.maxHp, a.hp + dmg * ((s.effects.find((e) => e.type === 'lifesteal') as { rate: number }).rate)); } });
  }
  for (const id of a.u.tactics) {
    const tac = D.byTactic[id];
    if (!tac) continue;
    const cost = tacticCost(a.u, tac);
    if (cost > a.u.mp) continue;
    at(a, t, Math.max(1, tac.range ?? 1));
    const side = tacticSide(tac);
    if (tac.kind === 'damage') {
      const dmg = tacticDamage(st, a.u, tac, t.u);
      let extra = 0;
      if (typeof tac.status === 'object' && DISABLE.has(tac.status.status)) extra = ((tac.status.chance / 100) * threat(t, a)) / a.u.maxHp;
      out.push({ label: L(tac.name), value: dmg / t.u.maxHp + extra, cost, apply: () => { t.hp -= dmg; a.u.mp -= cost; } });
    } else if (tac.kind === 'heal' && side === 'ally') {
      const h = Math.min(healAmount(a.u, tac.power), a.u.maxHp - a.hp);
      out.push({ label: L(tac.name), value: h / a.u.maxHp, cost, apply: () => { a.hp += h; a.u.mp -= cost; } });
    } else if (typeof tac.status === 'string' && (tac.kind === 'status' || tac.kind === 'debuff' || tac.kind === 'buff')) {
      const sid = tac.status as StatusId, p = tac.kind === 'status' && !tac.sure ? tacticSuccess(st, a.u, t.u) / 100 : 1;
      const onSelf = side === 'ally';
      if (sid === 'extraAct') {
        // 号令：自分がもう1回動けるとして、気力の要らない技1回ぶん
        const v = threat(a, t) / t.u.maxHp;
        out.push({ label: L(tac.name), value: v * 0.9, cost, apply: () => { a.u.mp -= cost; extraActs++; } });
      } else if (DISABLE.has(sid) || sid === 'silence') {
        const n = Math.min(turnsOf(sid, tac.turns), theirRest);
        const v = sid === 'silence' ? 0.3 * p : (p * n * threat(t, a)) / a.u.maxHp;
        out.push({ label: L(tac.name), value: v, cost, apply: () => { a.u.mp -= cost; for (let k = 0; k < n; k++) t.dis[k] = 1 - (1 - (t.dis[k] ?? 0)) * (1 - (sid === 'silence' ? 0 : p)); } });
      } else if (sid === 'poison') {
        out.push({ label: L(tac.name), value: (p * (SD.poison.pct ?? 10) / 100) * theirRest, cost, apply: () => { a.u.mp -= cost; t.poison = Math.min(1, t.poison + p); } });
      } else if (STAT_FX.has(sid)) {
        // 強化・弱化：付けたときの、そのあとの自分の与えるダメージの増え方と、受けるダメージの減り方
        const who = onSelf ? a : t, n = Math.min(turnsOf(sid, tac.turns), onSelf ? myRest : theirRest);
        const before = [threat(a, t), threat(t, a)];
        who.u.statuses.push({ id: sid, turns: n });
        const after = [threat(a, t), threat(t, a)];
        who.u.statuses.pop();
        const v = p * (((after[0] - before[0]) * Math.min(n, myRest)) / t.u.maxHp + ((before[1] - after[1]) * Math.min(n, theirRest)) / a.u.maxHp);
        out.push({ label: L(tac.name), value: v, cost, apply: () => { a.u.mp -= cost; if (p >= 0.5) who.u.statuses.push({ id: sid, turns: n }); } });
      }
    }
  }
  // 何もできないときの待機
  if (!out.length) out.push({ label: '待機', value: 0, cost: 0, apply: () => {} });
  return out;
}

let extraActs = 0;
interface Log { used: Map<string, number>; mpOut: number | null }

/** a の1回の行動 */
function act(a: Side, t: Side, left: number, actsT: number, log: Log, round: number): void {
  if (a.hp <= 0 || t.hp <= 0) return;
  // 動けない見込み：その割合だけ、行動の効き目が減る（期待値）
  const can = 1 - (a.dis[0] ?? 0);
  const opts = options(a, t, left, actsT).sort((x, y) => y.value - x.value);
  const pick = opts[0];
  const hp0 = t.hp, my0 = a.hp, mp0 = a.u.mp;
  pick.apply();
  // 動けない見込みのぶんを戻す
  t.hp = hp0 - (hp0 - t.hp) * can; a.hp = my0 - (my0 - a.hp) * can;
  log.used.set(pick.label, (log.used.get(pick.label) ?? 0) + 1);
  if (log.mpOut === null && mp0 > 0 && a.u.maxMp > 0 && !opts.some((o) => o.cost > 0 && o.cost <= a.u.mp)) {
    const anyCost = [...a.u.skills.map((id) => skillOf(id).mp), ...a.u.tactics.map((id) => tacticCost(a.u, D.byTactic[id]))].filter((c) => c > 0);
    if (anyCost.length && Math.min(...anyCost) > a.u.mp) log.mpOut = round;
  }
}

/** 決闘を1回（a が先か後か）。戻り値：a が削った割合、a が削られた割合 */
function duel(aId: string, tId: string, aFirst: boolean, log: Log): [number, number] {
  const A: Side = { u: mk(aId, 0, 0), hp: 0, dis: [], poison: 0 }, T: Side = { u: mk(tId, 1, 0), hp: 0, dis: [], poison: 0 };
  A.hp = A.u.maxHp; T.hp = T.u.maxHp;
  // 2回行動を外して比べるとき：HEX_NO_DOUBLE=1
  const dbl = (u: BUnit) => (passive(u, 'doubleAct').length && !process.env.HEX_NO_DOUBLE ? 2 : 1);
  const nA = dbl(A.u), nT = dbl(T.u);
  const tick = (s: Side): void => {
    if (s.poison > 0) s.hp -= s.u.maxHp * ((SD.poison.pct ?? 10) / 100) * s.poison;
    const regen = passive(s.u, 'regen').filter((p) => !p.on).reduce((x, p) => x + p.pct, 0);
    if (regen) s.hp = Math.min(s.u.maxHp, s.hp + s.u.maxHp * regen / 100);
    s.dis.shift();
    s.u.statuses = s.u.statuses.map((x) => ({ ...x, turns: x.turns - 1 })).filter((x) => x.turns > 0);
  };
  const turn = (me: Side, foe: Side, n: number, nFoe: number, r: number, lg: Log | null): void => {
    extraActs = 0;
    for (let i = 0; i < n + extraActs && i < 4; i++) act(me, foe, (ROUNDS - r) * n + (n - i - 1), (ROUNDS - r + 1) * nFoe, lg ?? { used: new Map(), mpOut: null }, r);
    tick(me);
  };
  for (let r = 1; r <= ROUNDS && A.hp > 0 && T.hp > 0; r++) {
    if (aFirst) { turn(A, T, nA, nT, r, log); turn(T, A, nT, nA, r, null); } else { turn(T, A, nT, nA, r, null); turn(A, T, nA, nT, r, log); }
  }
  const dealt = Math.min(1, Math.max(0, (T.u.maxHp - T.hp) / T.u.maxHp)), taken = Math.min(1, Math.max(0, (A.u.maxHp - A.hp) / A.u.maxHp));
  return [dealt, taken];
}

// ---------------------------------------------------------------- 将の役職も比べる（HEX_CLASSES=1）
// 標準の将：見本の戦国1575年の、Lv18〜22の武将の能力の真ん中。役職の加減・防御・移動・得意地形・通常攻撃・軍略を当てはめる。
// 相手は上級の兵種12種（上級の表と同じ物差し。100 が上級の並）
if (process.env.HEX_CLASSES) {
  const { convert } = await import('../../src/convert/convert');
  const { FIXTURES, loadFixture } = await import('../../tests/helpers');
  const pool = [];
  for (const f of FIXTURES) pool.push(...Object.values(convert(await loadFixture(f)).generals).filter((g) => g.faction && Math.abs(g.level - LV) <= 5));
  const med = (k: 'hp' | 'mp' | 'str' | 'int' | 'agi') => { const v = pool.map((g) => g.stats[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const base = { hp: med('hp'), mp: med('mp'), str: med('str'), int: med('int'), agi: med('agi') };
  console.log(`標準の将（見本4つの Lv${LV - 5}〜${LV + 5} の${pool.length}人の真ん中）：体力${base.hp} 気力${base.mp} 武力${base.str} 知略${base.int} 機敏${base.agi}`);
  const troops3 = D.units.filter((u) => u.tier === (ONLY ?? 3));
  const mkGen = (cid: string): BUnit => {
    const c = D.byClass[cid], u = mk(troops3[0].id, 0, 0), cm = classMod(c);
    Object.assign(u, {
      kind: 'general', defId: cid, name: L(c.name), hp: base.hp + cm.hp, maxHp: base.hp + cm.hp, mp: base.mp + cm.mp, maxMp: base.mp + cm.mp,
      str: base.str + cm.str, int: base.int + cm.int, agi: base.agi + cm.agi, def: c.def, move: c.move, affinity: c.affinity,
      passives: [], skills: [`atk:${cid}`], tactics: [...c.tactics],
    });
    return u;
  };
  // 相手の作り方を、役職なら標準の将、兵種なら兵に切り替える
  const realMk = mk;
  (globalThis as unknown as { __mk: typeof mk }).__mk = (id, side, pos) => (D.byClass[id] ? Object.assign(mkGen(id), { id: side, side, home: side, pos }) : realMk(id, side, pos));
  const rows = D.classes.map((c) => {
    let lnSum = 0, wins = 0;
    const log: Log = { used: new Map(), mpOut: null };
    for (const t of troops3) {
      let dealt = 0, taken = 0;
      for (const first of [true, false]) { const [d, k] = duel(c.id, t.id, first, log); dealt += d / 2; taken += k / 2; }
      const ratio = Math.min(20, Math.max(0.05, (dealt + 0.01) / (taken + 0.01)));
      lnSum += Math.log(ratio); if (ratio > 1) wins++;
    }
    const tot = [...log.used.values()].reduce((s, x) => s + x, 0);
    const used = [...log.used].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}${Math.round((n / tot) * 100)}%`).join('・');
    return { c, power: Math.round(Math.exp(lnSum / troops3.length) * 100), wins, used, mpOut: log.mpOut };
  }).sort((a, b) => b.power - a.power);
  console.log(`\n=== 将の役職（${rows.length}）：標準の将に当てはめ、格${ONLY ?? 3}の兵種${troops3.length}種（Lv${LV}）と1対1・${ROUNDS}巡。100＝その格の兵種の並 ===`);
  console.log('順\t役職\t格\t当主\t強さ\t勝ち越し\t攻撃\t防御\t移動\t得意\t気力切れ\t主な行動');
  rows.forEach((r, i) => console.log(`${i + 1}\t${L(r.c.name)}\t${r.c.tier}\t${r.c.unique === 'lord' ? '当主' : r.c.unique === 'feature' ? '特別' : ''}\t${r.power}\t${r.wins}/${troops3.length}\t${r.c.attack.kind === 'bow' ? '弓' : '近'}${r.c.attack.power}\t${r.c.def}\t${r.c.move}\t${r.c.affinity}\t${r.mpOut ? `${r.mpOut}巡目` : '-'}\t${r.used}`));
  process.exit(0);
}

const tiers = ONLY ? [ONLY] : [1, 2, 3];
for (const tier of tiers) {
  const units = D.units.filter((u) => u.tier === tier);
  const rows = units.map((u) => {
    const log: Log = { used: new Map(), mpOut: null };
    let lnSum = 0, wins = 0, dealtSum = 0, takenSum = 0;
    for (const t of units) {
      let dealt = 0, taken = 0;
      for (const first of [true, false]) { const [d, k] = duel(u.id, t.id, first, log); dealt += d / 2; taken += k / 2; }
      const ratio = Math.min(20, Math.max(0.05, (dealt + 0.01) / (taken + 0.01)));
      lnSum += Math.log(ratio); if (ratio > 1) wins++;
      dealtSum += dealt; takenSum += taken;
    }
    const power = Math.round(Math.exp(lnSum / units.length) * 100);
    const used = [...log.used].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}${Math.round((n / (units.length * ROUNDS)) * 100) / 100 > 0 ? '' : ''}${Math.round((n / [...log.used.values()].reduce((s, x) => s + x, 0)) * 100)}%`).join('・');
    return { name: L(u.name), id: u.id, cost: u.cost, power, wins, dealt: Math.round((dealtSum / units.length) * 100), taken: Math.round((takenSum / units.length) * 100), mpOut: log.mpOut, used, dbl: passive(mk(u.id, 0, 0), 'doubleAct').length > 0 };
  });
  const avgEff = rows.reduce((s, r) => s + r.power / r.cost, 0) / rows.length;
  rows.sort((a, b) => b.power - a.power);
  console.log(`\n=== 格${tier}（${units.length}種・Lv${LV}・${ROUNDS}巡・同じ格どうしの1対1） ===`);
  console.log('順\t兵種\t強さ\tコスパ\t采配\t勝ち越し\t削る%\t削られる%\t気力切れ\t主な行動');
  rows.forEach((r, i) => console.log(`${i + 1}\t${r.name}${r.dbl ? '（2回行動）' : ''}\t${r.power}\t${Math.round((r.power / r.cost / avgEff) * 100)}\t${r.cost}\t${r.wins}/${units.length}\t${r.dealt}\t${r.taken}\t${r.mpOut ? `${r.mpOut}巡目` : '-'}\t${r.used}`));
}
