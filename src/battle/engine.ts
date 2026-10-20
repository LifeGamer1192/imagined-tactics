// 戦闘の進行：行動の実行、ターンの切り替え、勝敗。乱数はすべて st.rng から取る。

import { D } from '../data/db';
import { seatName } from './map';
import type { SkillDef, StatusId, TacticDef } from '../data/types';
import {
  atkParts, canCounter, canUseSkill, canUseTactic, critChance, damageParts, defParts, healParts, hitParts, skillTargetCells,
  needsReload, skillVictims, successParts, tacticCost, tacticParts, tacticTargetCells, tacticVictims, breachTargets, breachParts,
} from '../rules/combat';
import { killExp } from '../rules/growth';
import { reach, unitAt } from '../rules/move';
import {
  basicSkill, disabled, has, immune, moveOf, passive, removeStatus, skillOf, statusOf, terrainAt,
} from '../rules/stats';
import type { Action, BUnit, BattleState, Side, StrikeDetail, TacticDetail } from './types';

const other = (s: Side): Side => (s === 0 ? 1 : 0);
function log(st: BattleState, key: string, vars: Record<string, string | number> = {}): void { st.log.push({ key, vars }); }



// ---------------------------------------------------------------- 行動できるか

export function canAct(st: BattleState, u: BUnit): boolean {
  return st.winner === null && u.alive && u.side === st.turn && !u.acted && !disabled(u);
}
export function hasRemove(u: BUnit): boolean { return passive(u, 'remove').length > 0; }
export function canMove(st: BattleState, u: BUnit): boolean {
  if (st.winner !== null || !u.alive || u.side !== st.turn || disabled(u)) return false;
  if (!u.acted) return !u.moved;
  return hasRemove(u) && !u.postMoved && moveOf(u) - u.moveSpent > 0;
}
/** いま移動できるマス */
export function moveCells(st: BattleState, u: BUnit): number[] {
  if (!canMove(st, u)) return [];
  return reach(st, u, moveOf(u) - u.moveSpent).cells.filter((i) => i !== u.pos);
}

// ---------------------------------------------------------------- 状態変化

/** 状態変化を付ける。無効のパッシブがあれば付かない。戻り値：付いたか */
export function addStatus(st: BattleState, t: BUnit, id: StatusId, turns?: number, from?: BUnit): boolean {
  if (immune(t, id)) return false;
  const S = D.status;
  let n = turns;
  if (n === undefined) {
    if (id === 'daze' || id === 'silence' || id === 'defect' || id === 'stun') n = st.rng.int(S[id].turns[0], S[id].turns[1]);
    else n = -1;
  }
  const cur = statusOf(t, id);
  if (cur) { cur.turns = Math.max(cur.turns, n); return true; }
  if (id === 'defect') {
    if (t.kind === 'general') return false;           // 武将は寝返らない（陣営の勝敗が崩れるため）
    t.statuses.push({ id, turns: n, origSide: t.side });
    t.side = other(t.side);
  } else if (id === 'routed') {
    t.statuses.push({ id, turns: -1, origSide: t.home });
    t.side = from ? from.side : t.side;
  } else t.statuses.push({ id, turns: n });
  // 騎乗と足止めは打ち消し合う
  if (id === 'mounted') removeStatus(t, 'grounded');
  if (id === 'grounded') removeStatus(t, 'mounted');
  log(st, 'status.add', { unit: t.name, status: id, sid: t.id, turns: n });
  return true;
}

function expire(st: BattleState, u: BUnit, id: StatusId): void {
  const s = statusOf(u, id);
  if (!s) return;
  if (id === 'defect' && s.origSide !== undefined) u.side = s.origSide;
  removeStatus(u, id);
  log(st, 'status.end', { unit: u.name, status: id, sid: u.id });
}

/** 立て直し（状態異常の回復）で消える状態 */
const AILMENTS: StatusId[] = ['poison', 'daze', 'silence', 'defect', 'stun', 'confuse'];
/** 看破で消える状態（軍略による補正） */
const DISPELLABLE: StatusId[] = ['weaken', 'atkNext', 'moveUp', 'resistUp', 'defUp', 'atkUp', 'agiUp', 'atkDown', 'intDown', 'grounded', 'mounted', 'regen', 'ward', 'sureNext', 'extraAct'];

// ---------------------------------------------------------------- 倒れる・撤退

function defeat(st: BattleState, victim: BUnit, killer: BUnit | null): void {
  victim.alive = false; victim.hp = 0;
  // by・exp は細かい記録用（だれが倒して、経験値をいくつ得たか）
  const exp = killer && killer.alive ? killExp(victim) : 0;
  log(st, 'defeat', killer && killer.alive ? { unit: victim.name, uid: victim.id, by: killer.id, exp } : { unit: victim.name, uid: victim.id });
  if (killer && killer.alive) killer.expGained += exp;
  if (victim.kind === 'general') {
    // 率いていた兵は戦場を離れる。寝返り中・収容された敗残兵は失われる
    for (const t of st.units) {
      if (!t.alive || t.leader !== victim.id || t.id === victim.id) continue;
      t.alive = false;
      t.retreated = !(has(t, 'defect') || has(t, 'routed'));
      log(st, t.retreated ? 'retreat' : 'lost', { unit: t.name, uid: t.id });
    }
  }
  checkWinner(st);
}

function damage(st: BattleState, t: BUnit, amount: number, by: BUnit | null): void {
  t.hp = Math.max(0, t.hp - amount);
  if (has(t, 'stun')) expire(st, t, 'stun');   // 気絶は攻撃を受けると解ける
  if (t.hp <= 0) defeat(st, t, by);
}

function heal(t: BUnit, amount: number): number {
  const v = Math.min(amount, t.maxHp - t.hp);
  t.hp += v;
  return v;
}

/**
 * 部隊ごとの退却：自分の陣営の初期配置のマスにいる武将は、配下の兵を連れて戦場から必ず退ける（兵は失わず、深手にもならない）。
 * 退いた駒は st.withdrawn に残る（戦略で、翌月の休養にする）。行動済みでも、自分の番なら退ける
 */
export function canWithdraw(st: BattleState, u: BUnit): boolean {
  return st.winner === null && u.alive && u.kind === 'general' && u.side === st.turn && u.side === u.home && !disabled(u) && st.map.spawn[u.home].includes(u.pos);
}

/** 武将と配下の兵（こちらの陣営にいるもの）を戦場から退かせる */
export function withdraw(st: BattleState, u: BUnit): void {
  const who = st.units.filter((x) => x.alive && (x.id === u.id || (x.leader === u.id && x.side === u.home && x.home === u.home)));
  for (const x of who) { x.alive = false; x.retreated = true; (st.withdrawn ??= []).push(x.id); }
  log(st, 'withdraw', { unit: u.name, uid: u.id, n: who.length - 1 });
}

export function checkWinner(st: BattleState): void {
  if (st.winner !== null) return;
  const alive = (s: Side) => st.units.some((u) => u.alive && u.kind === 'general' && u.home === s);
  if (!alive(0) && !alive(1)) st.winner = 1;
  else if (!alive(0)) st.winner = 1;
  else if (!alive(1)) st.winner = 0;
  if (st.winner !== null) log(st, 'win', { side: st.sideNames[st.winner] });
}

// ---------------------------------------------------------------- 技

function strike(st: BattleState, a: BUnit, skill: SkillDef, t: BUnit, single: boolean, isCounter: boolean): void {
  const rng = st.rng;
  const hp = hitParts(st, a, skill, t);
  const hit = hp.pct;
  const roll = rng.float() * 100;
  // 細かい記録用の内訳。計算で使った値を、そのまま入れていく（乱数を引く順番は変えない）
  const d: StrikeDetail = { type: 'strike', counter: isCounter, hit: hp, roll, landed: roll < hit, tries: [] };
  st.log.push({ key: 'strike', vars: { uid: a.id, tid: t.id, sk: skill.id }, d });
  // uid・tid は画面の演出用（だれがだれに。名前は重なることがある）
  if (roll >= hit) { log(st, 'miss', { unit: a.name, skill: skill.name.jp, target: t.name, uid: a.id, tid: t.id }); return; }
  const parts = damageParts(st, a, skill, t, isCounter);
  let dmg = parts.base;
  if (dmg > 0) {
    const atk = atkParts(st, a), def = defParts(st, t);
    const rnd = rng.range(D.combat.randomMin, D.combat.randomMax);
    dmg *= rnd;
    const critRoll = rng.float() * 100, critPct = critChance(a);
    const crit = critRoll < critPct;
    if (crit) dmg *= D.combat.critMult;
    const critBonus = crit && skill.effects.some((e) => e.type === 'critBonus') ? 1.25 : 1;
    if (critBonus !== 1) dmg *= critBonus;
    let shield: { chance: number; roll: number; ok: boolean } | undefined;
    if (single) for (const p of passive(t, 'shield')) {
      const r = rng.float() * 100;
      shield = { chance: p.chance, roll: r, ok: r < p.chance };
      if (shield.ok) { dmg /= 2; log(st, 'shield', { unit: t.name, sid: t.id }); break; }
    }
    const raw = dmg;
    dmg = Math.max(1, Math.round(dmg));
    d.dmg = { parts, atk, def, rnd, critPct, critRoll, crit, critMult: D.combat.critMult, critBonus, shield, raw, final: dmg };
    log(st, crit ? 'hit.crit' : 'hit', { unit: a.name, skill: skill.name.jp, target: t.name, dmg, uid: a.id, tid: t.id });
    const from = t.hp;
    damage(st, t, dmg, a);
    d.hp = [from, t.hp];
  }
  for (const e of skill.effects) {
    if (e.type === 'lifesteal' && dmg > 0 && a.alive) { const from = a.hp; heal(a, Math.round(dmg * e.rate)); d.steal = [from, a.hp]; }
    if (!t.alive) continue;
    if (e.type === 'status') {
      const r = rng.float() * 100, ok = r < e.chance;
      const applied = ok && addStatus(st, t, e.status, undefined, a);
      d.tries.push({ status: e.status, chance: e.chance, roll: r, ok, immune: ok && !applied });
    }
    if (e.type === 'weakenStun') {
      const r = rng.float() * 100, ok = r < e.chance;
      let applied = false;
      if (ok) { addStatus(st, t, 'weaken', D.status.weaken.turns); applied = addStatus(st, t, 'stun'); }
      d.tries.push({ status: 'stun', also: 'weaken', chance: e.chance, roll: r, ok, immune: ok && !applied });
    }
    if (e.type === 'mpHalf') { const from = t.mp; t.mp = Math.floor(t.mp / 2); d.mpHalf = [from, t.mp]; }
    if (e.type === 'heal') { const from = t.hp; heal(t, skill.power); d.heal = [from, t.hp]; }
    if (e.type === 'knockback') {
      const g = st.map.grid;
      const to = g.step(t.pos, g.dirTo(a.pos, t.pos));
      if (to >= 0 && !unitAt(st, to) && D.terrain.moveCost[st.map.terrain[to]][t.affinity] !== null) { d.knock = [t.pos, to]; t.pos = to; }
    }
  }
}

function doSkill(st: BattleState, u: BUnit, skill: SkillDef, target: number): void {
  u.mp -= skill.mp;
  // 装填の要る技は、撃つと装填が外れる
  if (skill.reload) removeStatus(u, 'loaded');
  u.expGained += D.combat.useExp;
  const single = skill.shape.type === 'single';
  const victims = skillVictims(st, u, skill, target);
  for (const t of victims) {
    if (!t.alive) continue;
    const basic = basicSkill(t);
    const counter = single && canCounter(st, u, skill, t, basic);
    strike(st, u, skill, t, single, false);
    if (counter && t.alive && u.alive && st.winner === null && canCounter(st, u, skill, t, basic)) strike(st, t, basic!, u, true, true);
  }
  removeStatus(u, 'atkNext');
  removeStatus(u, 'sureNext');
}

// ---------------------------------------------------------------- 軍略

function freeNear(st: BattleState, u: BUnit, center: number): number {
  for (const i of st.map.grid.neighbors(center)) {
    if (!unitAt(st, i) && D.terrain.moveCost[st.map.terrain[i]][u.affinity] !== null) return i;
  }
  return -1;
}

function doTactic(st: BattleState, u: BUnit, tac: TacticDef, target: number): void {
  const rng = st.rng;
  u.mp -= tacticCost(u, tac);
  u.expGained += tac.kind === 'heal' || tac.kind === 'cure' ? D.combat.healExp : D.combat.useExp;
  log(st, 'tactic', { unit: u.name, tactic: tac.name.jp, uid: u.id, cell: target, tac: tac.id });

  if (tac.kind === 'revive') {
    // 敗残兵収容：壊滅した兵のうち最も采配負担の大きいものを、隣のマスに戻す
    const dead = st.units.filter((x) => !x.alive && !x.retreated && x.kind === 'troop')
      .sort((a, b) => D.byUnit[b.defId].cost - D.byUnit[a.defId].cost || a.id - b.id)[0];
    if (!dead) return;
    const pos = freeNear(st, dead, u.pos);
    if (pos < 0) return;
    dead.alive = true; dead.hp = dead.maxHp; dead.pos = pos; dead.statuses = []; dead.leader = u.kind === 'general' ? u.id : u.leader;
    dead.acted = true; dead.moved = true;
    st.log.push({ key: 'tactic.on', vars: { uid: u.id, tid: dead.id, tac: tac.id }, d: { type: 'tactic', kind: tac.kind, tries: [], moved: [-1, pos] } });
    addStatus(st, dead, 'routed', -1, u);
    return;
  }
  if (tac.kind === 'pull') {
    const t = unitAt(st, target);
    if (!t) return;
    const pos = freeNear(st, t, u.pos);
    if (pos >= 0) {
      st.log.push({ key: 'tactic.on', vars: { uid: u.id, tid: t.id, tac: tac.id }, d: { type: 'tactic', kind: tac.kind, tries: [], moved: [t.pos, pos] } });
      t.pos = pos;
    }
    return;
  }

  for (const t of tacticVictims(st, u, tac, target)) {
    if (!t.alive) continue;
    const hostile = t.side !== u.side;
    // 細かい記録用の内訳（相手ひとりぶん）
    const d: TacticDetail = { type: 'tactic', kind: tac.kind, tries: [] };
    st.log.push({ key: 'tactic.on', vars: { uid: u.id, tid: t.id, tac: tac.id }, d });
    // 用心（軍略無効）：1度だけ軍略を無効にする。味方の回復なども対象
    if (has(t, 'ward') && tac.kind !== 'dispel') { d.ward = true; expire(st, t, 'ward'); log(st, 'ward', { unit: t.name, sid: t.id }); continue; }
    /** 解けた状態を覚えながら解く */
    const clear = (ids: StatusId[]) => { d.removed = ids.filter((id) => has(t, id)); for (const id of d.removed) expire(st, t, id); };
    switch (tac.kind) {
      case 'damage': {
        if (tac.purge && has(t, 'routed')) { d.purged = true; t.alive = false; log(st, 'lost', { unit: t.name, uid: t.id }); break; }
        const parts = tacticParts(st, u, tac, t);
        const rnd = rng.range(D.combat.randomMin, D.combat.randomMax);
        const raw = parts.base * rnd;
        const dmg = Math.max(1, Math.round(raw));
        d.dmg = { parts, rnd, raw, final: dmg };
        log(st, 'tactic.hit', { tactic: tac.name.jp, target: t.name, dmg, tid: t.id });
        const from = t.hp;
        damage(st, t, dmg, u);
        d.hp = [from, t.hp];
        if (t.alive && typeof tac.status === 'object') {
          const r = rng.float() * 100, ok = r < tac.status.chance;
          const applied = ok && addStatus(st, t, tac.status.status, undefined, u);
          d.tries.push({ status: tac.status.status, chance: tac.status.chance, roll: r, ok, immune: ok && !applied });
        }
        break;
      }
      case 'heal': {
        const parts = healParts(u, tac.power);
        const from = t.hp;
        const v = heal(t, parts.amount);
        d.heal = { parts, got: v }; d.hp = [from, t.hp];
        log(st, 'heal', { target: t.name, hp: v, tid: t.id });
        break;
      }
      case 'cure': clear(AILMENTS); break;
      case 'mpRestore': { const from = t.mp; t.mp = Math.min(t.maxMp, t.mp + (tac.amount ?? 0)); d.mp = [from, t.mp]; break; }
      case 'dispel': clear(DISPELLABLE); break;
      case 'buff': case 'debuff':
        if (typeof tac.status === 'string') d.status = { id: tac.status, applied: addStatus(st, t, tac.status, tac.turns ?? -1, u) };
        break;
      case 'status': {
        if (typeof tac.status !== 'string') break;
        if (!tac.sure && hostile) {
          const r = rng.float() * 100, parts = successParts(st, u, t);
          d.success = { parts, roll: r, ok: r < parts.pct };
          if (r >= parts.pct) { log(st, 'resist', { target: t.name, tid: t.id }); break; }
        }
        d.status = { id: tac.status, applied: addStatus(st, t, tac.status, undefined, u) };
        break;
      }
      case 'displace': {
        const r = rng.float() * 100, parts = successParts(st, u, t);
        d.success = { parts, roll: r, ok: r < parts.pct };
        if (r >= parts.pct) { log(st, 'resist', { target: t.name, tid: t.id }); break; }
        const cells = Array.from({ length: st.map.grid.n }, (_, i) => i)
          .filter((i) => !unitAt(st, i) && D.terrain.moveCost[st.map.terrain[i]][t.affinity] !== null && st.map.terrain[i] !== 'water');
        if (cells.length) { const from = t.pos; t.pos = rng.pick(cells); d.moved = [from, t.pos]; }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- ターン

function afterAction(st: BattleState, u: BUnit): void {
  u.acted = true;
  // 2回行動・号令：このターンにもう1度動ける
  const extra = passive(u, 'doubleAct').length > 0 || has(u, 'extraAct');
  if (u.alive && extra && !u.extraUsed) {
    u.extraUsed = true;
    removeStatus(u, 'extraAct');
    u.acted = false; u.moved = false; u.postMoved = false; u.moveSpent = 0;
  }
}

/** 装填の要る技を持つ駒が待機すると、矢・弾を込める（状態「装填済み」。強化と同じ演出が出る） */
export function reload(st: BattleState, u: BUnit): void {
  if (!needsReload(u) || has(u, 'loaded')) return;
  addStatus(st, u, 'loaded', -1, u);
}

/** 陣営の番の始まり：状態変化の残りを減らし、毒・回復を処理する */
export function startTurn(st: BattleState, side: Side): void {
  st.turn = side;
  for (const u of st.units) {
    if (!u.alive) continue;
    // 寝返り中の兵は、もとの陣営の番で残りターンを数える
    const counts = u.home === side;
    if (counts) {
      for (const s of [...u.statuses]) {
        if (s.turns > 0 && --s.turns === 0) expire(st, u, s.id);
      }
    }
    if (u.side !== side) continue;
    u.moved = false; u.postMoved = false; u.acted = false; u.extraUsed = false; u.moveSpent = 0;
    if (has(u, 'poison')) {
      const d = Math.round(u.maxHp * D.status.poison.pct / 100);
      log(st, 'poison', { unit: u.name, dmg: d, tid: u.id, hp: u.hp, pct: D.status.poison.pct, max: u.maxHp });
      damage(st, u, d, null);
      if (!u.alive) continue;
    }
    let regen = has(u, 'regen') ? D.status.regen.pct : 0;
    for (const p of passive(u, 'regen')) if (!p.on || terrainAt(st, u.pos) === p.on) regen += p.pct;
    // 陣などの、休める地形
    regen += D.terrain.regen[terrainAt(st, u.pos)] ?? 0;
    if (regen > 0) heal(u, Math.round(u.maxHp * regen / 100));
  }
  checkWinner(st);
  if (side === 0) checkHold(st);
}

/** 天守に今いる攻め手の駒（いなければ undefined） */
export function holder(st: BattleState): BUnit | undefined {
  const h = st.hold;
  return h ? st.units.find((u) => u.alive && u.side === 0 && u.pos === h.cell) : undefined;
}

/** 攻め手の番の始め：天守を押さえていれば数を進め、届けば攻め手の勝ち。いなければ数を戻す */
function checkHold(st: BattleState): void {
  const h = st.hold;
  if (!h || st.winner !== null) return;
  const u = holder(st);
  if (!u) {
    if (h.count > 0) log(st, 'holdLost', { side: st.sideNames[0], seat: seatName(st.map.terrain[h.cell]) });
    h.count = 0;
    return;
  }
  h.count++;
  if (h.count >= h.need) {
    st.winner = 0;
    log(st, 'castleTaken', { side: st.sideNames[0], unit: u.name, uid: u.id, seat: seatName(st.map.terrain[h.cell]) });
    return;
  }
  log(st, 'hold', { unit: u.name, uid: u.id, count: h.count, need: h.need, seat: seatName(st.map.terrain[h.cell]) });
}

export function endTurn(st: BattleState): void {
  if (st.winner !== null) return;
  // まだ動いていない駒は待機したのと同じ：装填の要る駒は込め直す
  for (const u of st.units) if (u.alive && u.side === st.turn && !u.acted && !disabled(u)) reload(st, u);
  if (st.turn === 1) {
    st.round++;
    if (st.round > st.maxRounds) {
      // 時間切れ：天守を攻め手が押さえていれば攻め手の勝ち、そうでなければ守り手の勝ち
      const u = holder(st);
      if (u) { st.winner = 0; log(st, 'timeupHeld', { side: st.sideNames[0], unit: u.name, seat: seatName(st.map.terrain[st.hold!.cell]) }); return; }
      st.winner = 1; log(st, 'timeup', { side: st.sideNames[1] }); return;
    }
  }
  startTurn(st, other(st.turn));
}

/** 行動を実行する。できない行動なら false を返し、何も変えない */
export function apply(st: BattleState, a: Action): boolean {
  if (st.winner !== null) return false;
  if (a.type === 'endTurn') { endTurn(st); return true; }
  const u = st.units[a.unit];
  if (!u || !u.alive || u.side !== st.turn) return false;
  switch (a.type) {
    case 'move': {
      if (!canMove(st, u)) return false;
      const r = reach(st, u, moveOf(u) - u.moveSpent);
      if (a.to === u.pos || !r.cells.includes(a.to)) return false;
      log(st, 'move', { uid: u.id, side: u.side, from: u.pos, to: a.to, cost: r.dist[a.to] });
      u.moveSpent += r.dist[a.to];
      u.pos = a.to;
      if (u.acted) u.postMoved = true; else u.moved = true;
      return true;
    }
    case 'skill': {
      const skill = u.skills.includes(a.skill) ? skillOf(a.skill) : undefined;
      if (!skill || !canAct(st, u) || !canUseSkill(st, u, skill)) return false;
      if (!skillTargetCells(st, u, skill).includes(a.target)) return false;
      const act = openAct(st, u, 'skill', skill.id, a.target, skill.mp);
      doSkill(st, u, skill, a.target);
      afterAction(st, u);
      closeAct(st, u, act);
      return true;
    }
    case 'tactic': {
      const tac = u.tactics.includes(a.tactic) ? D.byTactic[a.tactic] : undefined;
      if (!tac || !canAct(st, u) || !canUseTactic(u, tac)) return false;
      if (!tacticTargetCells(st, u, tac).includes(a.target)) return false;
      const act = openAct(st, u, 'tactic', tac.id, a.target, tacticCost(u, tac));
      doTactic(st, u, tac, a.target);
      afterAction(st, u);
      closeAct(st, u, act);
      return true;
    }
    case 'breach': {
      if (!canAct(st, u) || !breachTargets(st, u).includes(a.target)) return false;
      const act = openAct(st, u, 'breach', '', a.target, 0);
      doBreach(st, u, a.target);
      afterAction(st, u);
      closeAct(st, u, act);
      return true;
    }
    case 'wait': {
      if (!canAct(st, u)) return false;
      const act = openAct(st, u, 'wait', '', u.pos, 0);
      reload(st, u);
      afterAction(st, u);
      closeAct(st, u, act);
      return true;
    }
    case 'withdraw': {
      if (!canWithdraw(st, u)) return false;
      withdraw(st, u);
      checkWinner(st);
      return true;
    }
  }
}

/** 造りの名前（記録に出す） */
const STRUCT_NAME: Record<string, string> = { gate: '門', fortgate: '砦の門', palisade: '柵' };

/** 造りを壊す：乱数を掛けたダメージを耐久から引き、0になれば決まった地形（門は道、柵は平地）に変わる */
function doBreach(st: BattleState, u: BUnit, cell: number): void {
  const str = st.structures![cell];
  const p = breachParts(st, u, cell);
  const roll = st.rng.range(D.combat.randomMin, D.combat.randomMax);
  const dmg = Math.max(1, Math.round(p.base * roll));
  str.hp = Math.max(0, str.hp - dmg);
  const what = STRUCT_NAME[str.kind] ?? str.kind;
  log(st, 'breach', { uid: u.id, unit: u.name, what, dmg, hp: str.hp, max: str.max, cell, base: p.base, power: p.power, atk: Math.round(p.atk * 10) / 10, def: p.def, siege: p.siege, fire: p.fire, roll: Math.round(roll * 1000) / 1000 });
  if (str.hp > 0) return;
  st.map.terrain[cell] = str.rubble;
  delete st.structures![cell];
  st.mapVersion = (st.mapVersion ?? 0) + 1;
  log(st, 'broken', { unit: u.name, uid: u.id, what, cell });
}

// ---------------------------------------------------------------- 細かい記録の見出し

/**
 * 行動の見出し（'act'）を記録に足す。画面の「通常・詳細」の記録は、これを見出しにして、続く記録をひとまとめに出す。
 * side は、そのときの陣営（寝返り中は変わる）。mp は使った気力。
 */
function openAct(st: BattleState, u: BUnit, kind: 'skill' | 'tactic' | 'wait' | 'breach', id: string, cell: number, mp: number): { at: number; exp: number } {
  log(st, 'act', { uid: u.id, side: u.side, kind, id, cell, from: u.pos, mp, mpLeft: u.mp - mp, n: 0, exp: 0 });
  return { at: st.log.length - 1, exp: u.expGained };
}

/** 行動が終わったら、この行動で続いた記録の数と、行動した駒が得た経験値を書き込む */
function closeAct(st: BattleState, u: BUnit, act: { at: number; exp: number }): void {
  const e = st.log[act.at];
  e.vars.n = st.log.length - act.at - 1;
  e.vars.exp = u.expGained - act.exp;
}
