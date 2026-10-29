// 天佑（P102）：名将の、戦い全体に効く力。戦いの始め（戦場を作ったとき）に、持ち主の将が条件をみな満たすと発動する。
// 発動すると、始めの一手（全体攻撃など）を打ち、持ち主が戦場にいるあいだ、両軍の駒に掛け目（攻撃・防御・移動・命中・回避）が付く。
// 持ち主が倒れるか退くと、その天佑は消える。データは data/system/heroes.json、式は docs/COMBAT.md の 11。

import { BOONS, type BoonCond, type BoonDef, type BoonMods } from '../convert/heroes';
import type { TacticDef } from '../data/types';
import { tacticDamage } from '../rules/combat';
import { addStatus, logEntry } from './engine';
import type { BUnit, BattleState } from './types';

const TIE: Record<string, string> = {
  rival: '宿敵', avenge: '仇', betrayed_by: '裏切られた相手', betrayed: '裏切った相手', sworn: '義兄弟', friend: '友', lord: '家臣', servant: '主君', spouse: '伴侶', mentor: '弟子', pupil: '師', love: '想い人', companion: '生涯の友',
};

/** 条件を満たしていれば、その文（満たさなければ null） */
export function condMet(st: BattleState, u: BUnit, c: BoonCond): string | null {
  const foes = st.units.filter((x) => x.alive && x.side !== u.side);
  const foeGens = foes.filter((x) => x.kind === 'general');
  switch (c.type) {
    case 'defense': return u.home === 1 ? '守る側' : null;
    case 'attack': return u.home === 0 ? '攻める側' : null;
    case 'higherFoe': { const x = foeGens.filter((f) => f.level > u.level).sort((a, b) => b.level - a.level)[0]; return x ? `格上の敵：${x.name}（Lv${x.level}。自分はLv${u.level}）` : null; }
    case 'tieFoe': {
      for (const t of u.ties ?? []) {
        if (!c.kinds.includes(t.kind)) continue;
        const x = foeGens.find((f) => f.generalId === t.with);
        if (x) return `因縁の敵：${x.name}（${TIE[t.kind] ?? t.kind}）`;
      }
      return null;
    }
    case 'lordFoe': { const x = foeGens.find((f) => f.isLord); return x ? `敵の当主：${x.name}` : null; }
    case 'castle': return st.hold ? '城・砦・陣の戦い' : null;
    case 'field': return st.hold ? null : '野戦';
    case 'outnumbered': { const mine = st.units.filter((x) => x.alive && x.side === u.side).length; return mine < foes.length ? `寡兵（${mine}対${foes.length}）` : null; }
    case 'night': return st.night ? '夜' : null;
    case 'rain': return st.weather === 'rain' ? '雨' : null;
  }
}

/** 条件の文（満たしたかに関わらず。説明用） */
export function condText(c: BoonCond): string {
  switch (c.type) {
    case 'defense': return '守る側のとき';
    case 'attack': return '攻める側のとき';
    case 'higherFoe': return '自分よりレベルの高い将が敵にいる';
    case 'tieFoe': return `${c.kinds.map((k) => TIE[k] ?? k).join('・')}の縁のある将が敵にいる`;
    case 'lordFoe': return '敵に当主がいる';
    case 'castle': return '城・砦・陣の戦い';
    case 'field': return '野戦（天守の無い戦場）';
    case 'outnumbered': return '自軍の駒が敵より少ない';
    case 'night': return '夜の戦い';
    case 'rain': return '雨の戦い';
  }
}

const sgn = (v: number): string => (v > 0 ? `+${v}` : String(v));
function modsText(m: BoonMods | undefined, who: string): string[] {
  if (!m) return [];
  const out: string[] = [];
  if (m.atkPct) out.push(`攻撃${sgn(m.atkPct)}%`);
  if (m.defPct) out.push(`防御${sgn(m.defPct)}%`);
  if (m.move) out.push(`移動${sgn(m.move)}`);
  if (m.hit) out.push(`命中${sgn(m.hit)}`);
  if (m.evade) out.push(`回避${sgn(m.evade)}`);
  return out.length ? [`${who}：${out.join('・')}`] : [];
}
/** 効き目の文（説明用） */
export function boonEffects(b: BoonDef): string[] {
  const out = [...modsText(b.ally, '味方の駒みな'), ...modsText(b.enemy, '敵の駒みな')];
  const o = b.opening;
  if (o?.kind === 'damage') out.push(`始めの一手：敵の駒みなに威力${o.power}の必中の攻撃（知略で増減。体力は1残す）`);
  if (o?.kind === 'daze') out.push(`始めの一手：敵の駒みなを${o.chance}%で怯ませる`);
  if (o?.kind === 'heal') out.push(`始めの一手：味方の駒みなを${o.power}回復`);
  return out;
}

/** 始めの一手の全体攻撃を、軍略の式で計算するための形 */
const openingTactic = (power: number): TacticDef => ({ id: 'boon', name: { jp: '天佑', cn: '天佑' }, mp: 0, power, range: 0, area: 0, sure: true, kind: 'damage' } as TacticDef);

/**
 * 天佑を確かめて発動させる（戦場を作ったときに1回）。発動したら、記録に boon（持ち主・天佑・満たした条件）と、
 * 始めの一手の boonHit（相手・ダメージや怯み）を残し、掛け目を付ける
 */
export function activateBoons(st: BattleState): void {
  for (const u of st.units) {
    if (!u.alive || u.kind !== 'general' || !u.hero) continue;
    const b = BOONS[u.hero];
    if (!b || !b.cond.length) continue;
    const met = b.cond.map((c) => condMet(st, u, c));
    if (met.some((m) => m === null)) continue;
    (st.boons ??= []).push({ uid: u.id, id: u.hero, side: u.home, met: met as string[] });
    logEntry(st, 'boon', { uid: u.id, unit: u.name, boon: u.hero, name: b.name.jp });
    const o = b.opening;
    if (!o) continue;
    const foes = st.units.filter((x) => x.alive && x.side !== u.side), mine = st.units.filter((x) => x.alive && x.side === u.side);
    if (o.kind === 'damage') for (const t of foes) {
      const from = t.hp, dmg = Math.max(0, Math.min(tacticDamage(st, u, openingTactic(o.power), t), t.hp - 1));
      t.hp -= dmg;
      logEntry(st, 'boonHit', { uid: u.id, tid: t.id, unit: u.name, target: t.name, dmg, hp0: from, hp1: t.hp, fx: o.fx });
    }
    if (o.kind === 'daze') for (const t of foes) {
      const roll = st.rng.float() * 100, ok = roll < o.chance && addStatus(st, t, 'daze', undefined, u);
      logEntry(st, 'boonHit', { uid: u.id, tid: t.id, unit: u.name, target: t.name, status: 'daze', ok: ok ? 1 : 0, fx: o.fx });
    }
    if (o.kind === 'heal') for (const t of mine) {
      const from = t.hp; t.hp = Math.min(t.maxHp, t.hp + o.power);
      logEntry(st, 'boonHit', { uid: u.id, tid: t.id, unit: u.name, target: t.name, heal: t.hp - from, hp0: from, hp1: t.hp, fx: o.fx });
    }
  }
  refreshBoons(st);
}

/** 掛け目を付け直す（発動したとき、持ち主が倒れた・退いたとき） */
export function refreshBoons(st: BattleState): void {
  const live = (st.boons ?? []).filter((b) => st.units[b.uid]?.alive);
  for (const x of st.units) {
    const m = { atkPct: 0, defPct: 0, move: 0, hit: 0, evade: 0, from: [] as string[] };
    // 同じ天佑が同じ側に2つあっても重ねない
    const seen = new Set<string>();
    for (const b of live) {
      const key = `${b.side}:${b.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = BOONS[b.id], mods = x.side === b.side ? d.ally : d.enemy;
      if (!mods) continue;
      m.atkPct += mods.atkPct ?? 0; m.defPct += mods.defPct ?? 0; m.move += mods.move ?? 0; m.hit += mods.hit ?? 0; m.evade += mods.evade ?? 0;
      m.from.push(`${d.name.jp}（${st.units[b.uid].name}）`);
    }
    x.bmod = m.from.length ? m : undefined;
  }
}

/** 持ち主が倒れた・退いたとき：消えた天佑を記録し、掛け目を付け直す */
export function boonsLost(st: BattleState, ids: number[]): void {
  const lost = (st.boons ?? []).filter((b) => ids.includes(b.uid));
  if (!lost.length) return;
  for (const b of lost) logEntry(st, 'boonEnd', { uid: b.uid, unit: st.units[b.uid].name, name: BOONS[b.id].name.jp });
  refreshBoons(st);
}
