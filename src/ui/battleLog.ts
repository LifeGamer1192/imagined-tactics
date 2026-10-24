// 戦闘の記録の表示。記録の元データ（st.log）は1つで、細かさ（簡易・通常・詳細）は表示だけを変える。
//   簡易：これまでどおり、1件を1行で出す。
//   通常：1つの行動を、見出し（だれが何を）＋字下げした行（だれに・当たったか・ダメージ・体力・反撃・状態・経験値）で出す。
//   詳細：通常に加えて、計算式と途中の値を出す。値は、計算で実際に使ったもの（記録の d に入っている内訳）をそのまま出す。

import type { BattleLogEntry, BattleState, StatusTry, StrikeDetail, TacticDetail } from '../battle/types';
import { D, L, term } from '../data/db';
import type { StatusId } from '../data/types';
import { TERRAIN_NAME } from '../render/battleView';
import type { HitParts, StatParts } from '../rules/combat';
import { FIELD, skillOf } from '../rules/stats';
import { logText, STATUS_NAME } from './text';

/** 記録の細かさ：0 簡易、1 通常、2 詳細 */
export const LOG_LEVEL_NAME = ['簡易', '通常', '詳細'];
const KEY = 'hexsim.logLevel';
export function loadLogLevel(): number {
  try {
    const raw = localStorage.getItem(KEY), v = Number(raw);
    return raw !== null && Number.isInteger(v) && v >= 0 && v < LOG_LEVEL_NAME.length ? v : 1;
  } catch { return 1; }
}
export function saveLogLevel(v: number): void { try { localStorage.setItem(KEY, String(v)); } catch { /* 保存できなくても動く */ } }

/** 細かい記録用に足したキー。簡易の記録には出さない */
const EXTRA = new Set(['act', 'move', 'strike', 'tactic.on']);
/** 行動のまとまりの中では、strike・tactic.on の行が代わりに伝えるので出さないキー */
const COVERED = new Set(['hit', 'hit.crit', 'miss', 'shield', 'tactic', 'tactic.hit', 'heal', 'resist', 'ward']);
/** 残す件数：簡易は記録の件数、通常・詳細は行動のまとまりの数 */
const KEEP = [60, 40, 24];
const SIDE_MARK = ['攻', '守'];

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** 式に出す数：整数はそのまま、小数は2けたまで */
const num = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const signed = (v: number): string => (v >= 0 ? `+${num(v)}` : num(v));
/** 出目：切り捨てて2けた（「出目 ＜ 確率」の見え方が、実際の判定と食い違わないように） */
const roll = (v: number): string => (Math.floor(v * 100) / 100).toFixed(2);
const n = (v: string | number | undefined): number => (typeof v === 'number' ? v : -1);
const ln = (html: string): string => `<div class="ln">${html}</div>`;
const fm = (html: string): string => `<div class="fm">${html}</div>`;

/** だれか：陣営の印と色、武将の名前、兵なら「○○隊の△△」。side を省くと、もとの陣営 */
function who(st: BattleState, id: number, side?: number): string {
  const u = st.units[id];
  if (!u) return '';
  const s = side === 0 || side === 1 ? side : u.home;
  const leader = st.units[u.leader];
  const name = u.kind === 'general' || !leader ? u.name : `${leader.name}隊の${u.name}`;
  return `<span class="s${s}">${SIDE_MARK[s]} ${esc(name)}</span>`;
}

/** マス：地形の名前と、列・行（左上が 1,1） */
function cellName(st: BattleState, cell: number): string {
  const g = st.map.grid;
  if (cell < 0 || cell >= g.n) return '';
  return `${TERRAIN_NAME[st.map.terrain[cell]]}(${g.col(cell) + 1},${g.row(cell) + 1})`;
}

const statusName = (id: string | number | undefined): string => STATUS_NAME[id as StatusId] ?? String(id ?? '');

// ---------------------------------------------------------------- 式（詳細）

function hitFormula(h: HitParts, r: number, landed: boolean): string {
  const C = D.combat;
  const verdict = `出目 ${roll(r)} ${landed ? '＜' : '≧'} ${h.pct} → ${landed ? '命中' : '外れ'}`;
  if (h.fixed) {
    const why = { x: 'この相手には当てられない', mark: '必ず当たる技', disabled: '相手が動けないので必ず当たる', sureNext: '「次の攻撃が必中」の効果' }[h.fixed];
    return `命中率 ${h.pct}%（${why}）／${verdict}`;
  }
  const terms = [
    `基本${h.base}`, `${term('agi')}の差${signed(h.agiA - h.agiT)}（${num(h.agiA)}−${num(h.agiT)}）`, `技の補正${signed(h.skill)}`,
    `自分の地形${signed(h.terA)}`, `相手の地形${signed(-h.terT)}`,
  ];
  if (h.tri) terms.push(`騎の相手${signed(-h.tri)}`);
  if (h.passHit) terms.push(`命中の特性${signed(h.passHit)}`);
  if (h.passEvade) terms.push(`相手の回避の特性${signed(-h.passEvade)}`);
  if (h.perch) terms.push(`櫓の上${signed(h.perch)}`);
  if (h.rain) terms.push(`雨${signed(h.rain)}`);
  if (h.fog) terms.push(`霧${signed(h.fog)}`);
  if (h.night) terms.push(`夜${signed(h.night)}`);
  const clamped = Math.round(h.raw) !== h.pct ? ` ＝ ${num(h.raw)} → ${h.pct}（${C.hitMin}〜${C.hitMax}%に収める）` : '';
  return `命中率 ${h.pct}% ＝ ${terms.join(' ')}${clamped}／${verdict}`;
}

/** 地形と天気の倍率（効いたものを並べる）。無ければ '' */
function fieldText(p: { field?: number; fieldNotes?: [string, string, number][] }): string {
  if (!p.field || p.field === 1 || !p.fieldNotes?.length) return '';
  return ` × 地形・天気${num(p.field)}（${p.fieldNotes.map(([w, k, v]) => `${w}で${L(FIELD.kinds[k])}×${v}`).join('・')}）`;
}

/** 攻撃・防御の値の成り立ち。補正が何も無いときは '' */
function statFormula(label: string, baseLabel: string, p: StatParts, always: boolean): string {
  if (p.fixed) return `${label}${num(p.value)}（混乱中は決まった値）`;
  const supply = p.supply ?? 1;
  if (!always && !p.adds.length && p.out === 1 && supply === 1) return '';
  let s = `${label}${num(p.value)} ＝ `;
  const inner = `${baseLabel}${num(p.base)}${p.mult !== 1 ? ` × ${num(p.mult)}` : ''}${p.adds.map(([id, v]) => ` ${signed(v)}（${STATUS_NAME[id]}）`).join('')}`;
  const lone = p.mult === 1 && !p.adds.length;
  const muls = `${p.out !== 1 ? ` × 采配範囲外${num(p.out)}` : ''}${supply !== 1 ? ` × 飛び地${num(supply)}` : ''}`;
  s += muls ? `${lone ? inner : `（${inner}）`}${muls}` : inner;
  return s;
}

function tryLine(t: StatusTry): string {
  const name = t.also ? `${STATUS_NAME[t.also]}と${STATUS_NAME[t.status]}` : STATUS_NAME[t.status];
  return `${name} ${num(t.chance)}%：出目 ${roll(t.roll)} → ${!t.ok ? '付かない' : t.immune ? '効かない（無効）' : '付いた'}`;
}

// ---------------------------------------------------------------- 1撃・軍略の1人ぶん

function strikeLines(st: BattleState, e: BattleLogEntry, detail: boolean): string {
  const d = e.d as StrikeDetail;
  const uid = n(e.vars.uid), tid = n(e.vars.tid);
  const T = who(st, tid);
  const head = d.counter ? `反撃：${who(st, uid)}の${esc(L(skillOf(String(e.vars.sk)).name))} → ` : '→ ';
  const out: string[] = [];
  if (!d.landed) out.push(ln(`${head}${T}：<span class="miss">外れ</span>`));
  else if (d.dmg && d.hp) {
    out.push(ln(`${head}${T}に${d.dmg.crit ? '<b class="crit">会心！</b> ' : '命中 '}<b class="dmg">${d.dmg.final}</b>（${term('hp')} ${d.hp[0]}→${d.hp[1]}）${d.dmg.shield?.ok ? '　盾で受けて半分' : ''}`));
  } else out.push(ln(`${head}${T}に命中（ダメージなし）`));
  if (detail) {
    out.push(fm(hitFormula(d.hit, d.roll, d.landed)));
    const g = d.dmg;
    if (g) {
      const p = g.parts;
      out.push(fm(`基準 ${p.base} ＝ 威力${num(p.power)} × 攻撃${num(p.atk)} ÷ 防御${num(p.def)}${p.bane !== 1 ? ` × 特効${num(p.bane)}` : ''}${p.counter !== 1 ? ` × 反撃${num(p.counter)}` : ''}${p.fire !== 1 ? ` × 雨の日の火${num(p.fire)}` : ''}${fieldText(p)}（切り捨て）`));
      out.push(fm(statFormula('攻撃', term('str'), g.atk, true)));
      const def = statFormula('防御', '防御', g.def, false);
      if (def) out.push(fm(def));
      out.push(fm(`会心率 ${num(g.critPct)}%：出目 ${roll(g.critRoll)} → ${g.crit ? '会心' : '会心せず'}`));
      if (g.shield) out.push(fm(`盾 ${num(g.shield.chance)}%：出目 ${roll(g.shield.roll)} → ${g.shield.ok ? '受けた' : '受けられず'}`));
      out.push(fm(`ダメージ ${g.final} ＝ 基準${p.base} × 乱数${g.rnd.toFixed(3)}${g.crit ? ` × 会心${num(g.critMult)}` : ''}${g.critBonus !== 1 ? ` × 会心に強い技${num(g.critBonus)}` : ''}${g.shield?.ok ? ' × 盾0.5' : ''} ＝ ${g.raw.toFixed(2)} → ${g.final}`));
    }
    for (const t of d.tries) out.push(fm(tryLine(t)));
  } else for (const t of d.tries) if (t.ok && t.immune) out.push(ln(`${T}に${STATUS_NAME[t.status]}は効かなかった`));
  if (d.steal) out.push(ln(`${who(st, uid)}が${term('hp')}を吸い取った（${d.steal[0]}→${d.steal[1]}）`));
  if (d.mpHalf) out.push(ln(`${T}の${term('mp')}を半分にした（${d.mpHalf[0]}→${d.mpHalf[1]}）`));
  if (d.heal) out.push(ln(`${T}の${term('hp')}が回復（${d.heal[0]}→${d.heal[1]}）`));
  if (d.knock) out.push(ln(`${T}を押し出した（${cellName(st, d.knock[0])} → ${cellName(st, d.knock[1])}）`));
  return out.join('');
}

function tacticLines(st: BattleState, e: BattleLogEntry, detail: boolean): string {
  const d = e.d as TacticDetail;
  const T = who(st, n(e.vars.tid));
  const out: string[] = [];
  if (d.ward) return ln(`→ ${T}は用心していた（無効）`);
  if (d.dmg && d.hp) {
    out.push(ln(`→ ${T}に <b class="dmg">${d.dmg.final}</b>（${term('hp')} ${d.hp[0]}→${d.hp[1]}）`));
    if (detail) {
      const p = d.dmg.parts;
      out.push(fm(`基準 ${p.base} ＝ 威力${num(p.power)} ×（${term('int')}${num(p.intA)} × ${num(p.mult)}）÷（相手の${term('int')}${num(p.intT)} ＋ ${p.defIsDefense ? '防御' : ''}${num(p.def)}）×（1 − 耐性${num(p.resist)}）${p.fire !== 1 ? ` × 雨の日の火${num(p.fire)}` : ''}${fieldText(p)}（切り捨て）`));
      out.push(fm(`ダメージ ${d.dmg.final} ＝ 基準${p.base} × 乱数${d.dmg.rnd.toFixed(3)} ＝ ${d.dmg.raw.toFixed(2)} → ${d.dmg.final}`));
    }
  }
  if (d.heal && d.hp) {
    out.push(ln(`→ ${T}が <b class="heal">+${d.heal.got}</b> 回復（${term('hp')} ${d.hp[0]}→${d.hp[1]}）`));
    if (detail) {
      const p = d.heal.parts;
      out.push(fm(`回復量 ${p.amount} ＝ 威力${num(p.power)} ×（${p.c0} ＋ ${term('int')}${num(p.int)} ÷ ${p.per}）${p.healPct ? ` ×（1 ＋ 回復の特性${num(p.healPct)}%）` : ''}${d.heal.got < p.amount ? `／${term('hp')}の上限までなので ${d.heal.got}` : ''}`));
    }
  }
  if (d.success) {
    const p = d.success.parts, C = D.combat;
    if (!d.success.ok) out.push(ln(`→ ${T}には効かなかった`));
    if (detail) {
      const clamped = Math.round(p.raw) !== p.pct ? ` → ${p.pct}（${C.statusMin}〜${C.statusMax}%に収める）` : '';
      out.push(fm(`成功率 ${p.pct}% ＝（基本${p.base} ＋ ${term('int')}${num(p.intA)} − 相手の${term('int')}${num(p.intT)}）×（1 − 耐性${num(p.resist)}）＝ ${num(p.raw)}${clamped}／出目 ${roll(d.success.roll)} ${d.success.ok ? '＜' : '≧'} ${p.pct} → ${d.success.ok ? '成功' : '失敗'}`));
    }
  }
  if (d.status && !d.status.applied) out.push(ln(`→ ${T}に${STATUS_NAME[d.status.id]}は付かなかった`));
  if (d.removed && !d.removed.length) out.push(ln(`→ ${T}：解ける状態は無かった`));
  if (d.mp) out.push(ln(`→ ${T}の${term('mp')}が回復（${d.mp[0]}→${d.mp[1]}）`));
  if (d.moved) {
    const [from, to] = d.moved;
    if (d.kind === 'revive') out.push(ln(`→ ${T}を収容した（${cellName(st, to)}）`));
    else out.push(ln(`→ ${T}を${d.kind === 'pull' ? '呼び戻した' : '別の場所へ動かした'}（${cellName(st, from)} → ${cellName(st, to)}）`));
  }
  if (detail) for (const t of d.tries) out.push(fm(tryLine(t)));
  else for (const t of d.tries) if (t.ok && t.immune) out.push(ln(`${T}に${STATUS_NAME[t.status]}は効かなかった`));
  return out.join('');
}

// ---------------------------------------------------------------- 1件ずつ

/** 行動のまとまりの外にも中にも出る記録（状態が付いた・解けた、倒れた、毒など）。出さないものは '' */
function plain(st: BattleState, e: BattleLogEntry, detail: boolean): string {
  const v = e.vars;
  switch (e.key) {
    case 'status.add': {
      const turns = n(v.turns);
      return `${who(st, n(v.sid)) || esc(String(v.unit))}：${statusName(v.status)}が付いた${turns > 0 ? `（${turns}巡）` : ''}`;
    }
    case 'status.end': return `${who(st, n(v.sid)) || esc(String(v.unit))}：${statusName(v.status)}が解けた`;
    case 'defeat': {
      const by = n(v.by), exp = n(v.exp) * D.combat.expGain;
      return `${who(st, n(v.uid))}が<b class="down">倒れた</b>${by >= 0 && exp > 0 ? `（${who(st, by)}に経験 +${num(exp)}）` : ''}`;
    }
    case 'retreat': return `${who(st, n(v.uid))}は戦場を離れた`;
    case 'lost': return `${who(st, n(v.uid))}は失われた`;
    case 'poison': {
      const hp = n(v.hp);
      const tail = hp >= 0 ? `（${term('hp')} ${hp}→${Math.max(0, hp - n(v.dmg))}）` : '';
      const line = `${who(st, n(v.tid))}は毒で <b class="dmg">${v.dmg}</b>${tail}`;
      return detail && hp >= 0 ? `${line}${fm(`毒 ${v.dmg} ＝ ${term('hp')}の上限${v.max} × ${v.pct}%`)}` : line;
    }
    default: return esc(logText(e));
  }
}

/** 行動の見出しと、続く記録をひとまとめにして出す */
function actBlock(st: BattleState, at: number, detail: boolean): string {
  const e = st.log[at], v = e.vars;
  const uid = n(v.uid), side = n(v.side);
  const actor = who(st, uid, side);
  if (v.kind === 'wait') return detail ? `<div class="blk b${side}"><div class="hd dim">${actor}：待機</div></div>` : '';
  let what: string;
  if (v.kind === 'breach') {
    what = '<b>造りを壊す</b>';
  } else if (v.kind === 'skill') {
    const s = skillOf(String(v.id));
    const shape = s.shape.type === 'around' ? `（周囲${s.shape.n}）` : s.shape.type === 'line' ? `（直線${s.shape.n}）` : '';
    what = `<b>${esc(L(s.name))}</b>${shape}`;
  } else {
    const t = D.byTactic[String(v.id)];
    what = `${term('tactic')} <b>${esc(L(t.name))}</b>${t.area > 0 ? `（範囲${t.area}）` : ''}`;
  }
  const lines: string[] = [];
  const count = n(v.n);
  for (let i = at + 1; i <= at + count && i < st.log.length; i++) {
    const c = st.log[i];
    if (c.key === 'strike') lines.push(strikeLines(st, c, detail));
    else if (c.key === 'tactic.on') lines.push(tacticLines(st, c, detail));
    else if (!COVERED.has(c.key) && !EXTRA.has(c.key)) lines.push(ln(plain(st, c, detail)));
  }
  if (!lines.join('')) lines.push(ln('<span class="dim">相手がいなかった</span>'));
  // 使った気力と、得た経験値（戦いのあとに入るぶん）
  const mp = n(v.mp), exp = n(v.exp);
  const foot: string[] = [];
  if (mp > 0) foot.push(`${term('mp')} −${mp}（残り${n(v.mpLeft)}）`);
  if (exp > 0) foot.push(`経験 +${num(exp * D.combat.expGain)}${detail && D.combat.expGain !== 1 ? `（${exp} × 戦いのあとの係数${D.combat.expGain}）` : ''}`);
  return `<div class="blk b${side}"><div class="hd">${actor} の ${what}${detail ? ` <span class="dim">${cellName(st, n(v.from))}から</span>` : ''}</div>${lines.join('')}${foot.length ? `<div class="ln dim">${foot.join('・')}</div>` : ''}</div>`;
}

function moveBlock(st: BattleState, e: BattleLogEntry, detail: boolean): string {
  const v = e.vars, side = n(v.side);
  return `<div class="blk b${side} mv"><div class="hd">${who(st, n(v.uid), side)}：移動 ${cellName(st, n(v.from))} → ${cellName(st, n(v.to))}${detail ? ` <span class="dim">移動力${num(n(v.cost))}を使う</span>` : ''}</div></div>`;
}

// ---------------------------------------------------------------- 欄ぜんたい

/**
 * 記録の欄の中身（HTML）を作る。
 * 速いときは1秒に何十回も呼ばれるので、通常・詳細では、行動のまとまりごとに作った文字列を覚えておく。
 */
export class BattleLogView {
  private st: BattleState | null = null;
  private level = -1;
  /** まとまりの始まりの位置（記録の番号）。parsed は、どこまで区切ったか */
  private starts: number[] = [];
  private parsed = 0;
  private cache = new Map<number, string>();

  html(st: BattleState, level: number): string {
    if (level <= 0) return this.simple(st);
    // 別の戦い・細かさの切り替え・記録が減った（移動の取り消し）ときは、作り直す
    if (st !== this.st || st.log.length < this.parsed) { this.st = st; this.starts = []; this.parsed = 0; this.cache.clear(); }
    if (level !== this.level) { this.level = level; this.cache.clear(); }
    while (this.parsed < st.log.length) {
      const e = st.log[this.parsed];
      this.starts.push(this.parsed);
      this.parsed += e.key === 'act' ? 1 + Math.max(0, n(e.vars.n)) : 1;
    }
    this.parsed = Math.min(this.parsed, st.log.length);
    const detail = level >= 2;
    const out: string[] = [];
    for (const at of this.starts.slice(-KEEP[level])) {
      let h = this.cache.get(at);
      if (h === undefined) { h = this.block(st, at, detail); this.cache.set(at, h); }
      out.push(h);
    }
    // 覚えた文字列が増えすぎないよう、古いものは捨てる
    if (this.cache.size > KEEP[level] * 4) {
      const keep = new Set(this.starts.slice(-KEEP[level]));
      for (const k of this.cache.keys()) if (!keep.has(k)) this.cache.delete(k);
    }
    return out.join('');
  }

  /** 最後の記録を取り消したとき（移動の取り消し）に呼ぶ */
  reset(): void { this.st = null; }

  private block(st: BattleState, at: number, detail: boolean): string {
    const e = st.log[at];
    if (e.key === 'act') return actBlock(st, at, detail);
    if (e.key === 'move') return moveBlock(st, e, detail);
    if (e.key === 'turn') return `<div class="sep">${esc(logText(e))}</div>`;
    if (EXTRA.has(e.key)) return '';
    return `<div>${plain(st, e, detail)}</div>`;
  }

  /** 簡易：これまでどおり。細かい記録用のキーを除いた、直近の60件 */
  private simple(st: BattleState): string {
    const list: BattleLogEntry[] = [];
    for (let i = st.log.length - 1; i >= 0 && list.length < KEEP[0]; i--) if (!EXTRA.has(st.log[i].key)) list.push(st.log[i]);
    return list.reverse().map((e) => `<div class="${e.key === 'turn' ? 'sep' : ''}">${esc(logText(e))}</div>`).join('');
  }
}
