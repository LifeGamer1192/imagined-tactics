// 兵種・役職を進める（クラスチェンジ。P52）の見せ方：前と後の比べ表、確かめる窓の中身、祝いの窓の中身。
// 進める処理そのものは rules/growth.ts（promoteTroop・promoteGeneral）。

import type { GGeneral, GTroop, Taught } from '../convert/model';
import { D, L } from '../data/db';
import type { SkillDef, TacticDef } from '../data/types';
import { classMod } from '../rules/growth';
import { artMp, artName, artsOfGeneral, artsOfTroop, isMastered } from '../strategy/teach';
import { skillTip, tacticTip } from './describe';
import { AFFINITY_NAME, T } from './text';

/** invert：下がる方がよいもの（采配の重さ） */
export interface ChangeRow { label: string; from: string; to: string; delta?: number; invert?: boolean }

const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const names = (ids: string[], kind: 'skill' | 'tactic'): string[] => ids.map((id) => (kind === 'skill' ? D.skills.find((s) => s.id === id)?.name : D.byTactic[id]?.name)).filter(Boolean).map((n) => L(n!));
const listDiff = (a: string[], b: string[]): string => {
  const add = b.filter((x) => !a.includes(x)), gone = a.filter((x) => !b.includes(x));
  return [add.length ? `＋${add.join('・')}` : '', gone.length ? `－${gone.join('・')}` : ''].filter(Boolean).join(' ') || '変わらない';
};

/** 兵が進んだら、何がどう変わるか（能力は今の兵の値に、兵種の基礎値の差を足す。promoteTroop と同じ） */
export function troopChange(t: GTroop, to: string): ChangeRow[] {
  const a = D.byUnit[t.unitId], b = D.byUnit[to];
  if (!a || !b) return [];
  const rows: ChangeRow[] = [];
  for (const k of ['hp', 'mp', 'str', 'int', 'agi'] as const) {
    const d = b[k] - a[k];
    // 気力の無い兵種どうし（0 → 0）は出さない
    if (!t.stats[k] && !d) continue;
    rows.push({ label: T[k](), from: String(t.stats[k]), to: String(t.stats[k] + d), delta: d });
  }
  rows.push({ label: '防御', from: String(a.def), to: String(b.def), delta: b.def - a.def });
  rows.push({ label: '移動', from: String(a.move), to: String(b.move), delta: b.move - a.move });
  rows.push({ label: '采配の重さ', from: String(a.cost), to: String(b.cost), delta: b.cost - a.cost, invert: true });
  if (a.affinity !== b.affinity) rows.push({ label: '得意な地形', from: AFFINITY_NAME[a.affinity] ?? a.affinity, to: AFFINITY_NAME[b.affinity] ?? b.affinity });
  const sa = names(a.skills, 'skill'), sb = names(b.skills, 'skill');
  if (sa.join() !== sb.join()) rows.push({ label: '技', from: sa.join('・') || 'なし', to: listDiff(sa, sb) });
  const ta = names(a.tactics, 'tactic'), tb = names(b.tactics, 'tactic');
  if (ta.join() !== tb.join()) rows.push({ label: '軍略', from: ta.join('・') || 'なし', to: listDiff(ta, tb) });
  if (a.passives.length !== b.passives.length || JSON.stringify(a.passives) !== JSON.stringify(b.passives)) rows.push({ label: '特技', from: `${a.passives.length}つ`, to: `${b.passives.length}つ` });
  return rows;
}

/** 武将が役職を進めたら、何がどう変わるか（役職の加減と、通常攻撃・防御・移動・軍略） */
export function generalChange(g: GGeneral, to: string): ChangeRow[] {
  const a = D.byClass[g.classId], b = D.byClass[to];
  if (!a || !b) return [];
  const rows: ChangeRow[] = [];
  for (const k of ['hp', 'mp', 'str', 'int', 'agi'] as const) {
    const base = g.stats[k];
    const ma = classMod(a)[k], mb = classMod(b)[k];
    rows.push({ label: T[k](), from: String(base + ma), to: String(base + mb), delta: mb - ma });
  }
  rows.push({ label: '防御', from: String(a.def), to: String(b.def), delta: b.def - a.def });
  rows.push({ label: '移動', from: String(a.move), to: String(b.move), delta: b.move - a.move });
  rows.push({ label: '通常攻撃の威力', from: String(a.attack.power), to: String(b.attack.power), delta: b.attack.power - a.attack.power });
  if (a.attack.range.join() !== b.attack.range.join()) rows.push({ label: '射程', from: a.attack.range.join('〜'), to: b.attack.range.join('〜') });
  if (a.affinity !== b.affinity) rows.push({ label: '得意な地形', from: AFFINITY_NAME[a.affinity] ?? a.affinity, to: AFFINITY_NAME[b.affinity] ?? b.affinity });
  const ta = names(a.tactics, 'tactic'), tb = names(b.tactics, 'tactic');
  if (ta.join() !== tb.join()) rows.push({ label: '軍略', from: ta.join('・') || 'なし', to: listDiff(ta, tb) });
  return rows;
}

/** 比べ表（HTML）。上がるものは緑、下がるものは朱 */
export function changeTable(rows: ChangeRow[]): string {
  const cell = (r: ChangeRow): string => r.delta === undefined ? '' : (r.delta > 0) !== !!r.invert && r.delta !== 0 ? `<span class="up">${r.delta > 0 ? '+' : ''}${r.delta}</span>` : r.delta !== 0 ? `<span class="down">${r.delta > 0 ? '+' : ''}${r.delta}</span>` : '<span class="dim">±0</span>';
  return `<table class="cc-table"><tr><th></th><th>今</th><th></th><th>進めたあと</th><th></th></tr>${rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.from)}</td><td>→</td><td><b>${esc(r.to)}</b></td><td>${cell(r)}</td></tr>`).join('')}</table>`;
}

/** 小窓用の短い文（ボタンに乗せたとき） */
export function changeText(rows: ChangeRow[]): string {
  return rows.map((r) => `${r.label}：${r.from} → ${r.to}${r.delta ? `（${r.delta > 0 ? '+' : ''}${r.delta}）` : ''}`).join('\n');
}

// ---------------------------------------------------------------- 新しく使えるようになる技・軍略（P85）
// 昇進の確かめる窓と祝いの窓に、新しく覚える技・軍略の細かな説明と、最大の気力に対して1回でどれだけ使うかのバーを出す。
// 気力は戦いのあいだ自然には戻らない（気力を戻す軍略だけ）ので、「1戦で何回使えるか」も添える。

type Art = { id: string; kind: 'skill' | 'tactic' };
const sameArt = (a: Art, b: Art): boolean => a.id === b.id && a.kind === b.kind;

/** 気力のバー：全体が最大の気力、明るい1区切りが1回ぶん、薄い区切りがそのあと使える回数ぶん */
export function mpBarHtml(cost: number, max: number, before?: number): string {
  if (cost <= 0) return '<div class="mpcap dim">気力を使わない（何度でも使える）</div>';
  if (max <= 0 || cost > max) {
    return `<div class="mpbar short" role="img" aria-label="気力が足りない"><span class="mp-seg over" style="width:100%"></span></div>
      <div class="mpcap"><span class="down">気力 <b>${cost}</b>／最大 ${max}：気力が足りず、このままでは使えない（あと${cost - max}要る）</span></div>`;
  }
  const uses = Math.floor(max / cost), seg = (cost / max) * 100;
  // 区切りが細かすぎると見分けられないので、多いときは1回ぶんと残りの帯だけにする
  const segs = uses <= 24
    ? Array.from({ length: uses }, (_v, i) => `<span class="mp-seg${i ? ' more' : ''}" style="width:${seg.toFixed(2)}%"></span>`).join('')
    : `<span class="mp-seg" style="width:${seg.toFixed(2)}%"></span><span class="mp-seg more" style="width:${(seg * (uses - 1)).toFixed(2)}%"></span>`;
  const was = before === undefined || before === max ? '' : before > 0 ? `（今 ${before}）` : '（今は気力なし）';
  return `<div class="mpbar" role="img" aria-label="気力 ${cost}／最大 ${max}">${segs}</div>
    <div class="mpcap">1回に気力 <b>${cost}</b>／最大 ${max}${was}・最大の${Math.round(seg)}%　→ 1戦で<b>${uses}回</b>使える</div>`;
}

/** 技・軍略1つの札：名前・種類・気力のバー・細かな説明（小窓と同じ中身。気力の行はバーに出すので省く） */
function artCard(a: Art, max: number, before: number | undefined, isNew: boolean, taught: Taught[]): string {
  const def = a.kind === 'skill' ? D.skills.find((s) => s.id === a.id) : D.byTactic[a.id];
  if (!def) return '';
  // 教わったばかりの借り物は、気力が多くかかる
  const t = taught.find((x) => x.id === a.id && x.kind === a.kind), borrowed = !!t && !isMastered(t);
  const cost = artMp(a.id, a.kind, borrowed);
  const lines = (a.kind === 'skill' ? skillTip(def as SkillDef) : tacticTip(def as TacticDef)).split('\n').slice(1).filter((l) => !/^気力を\d+使う$/.test(l));
  return `<div class="art-card${isNew ? ' new' : ''}">
    <div class="art-head">${isNew ? '<span class="art-new">新</span>' : ''}<b>${esc(L(def.name))}</b><span class="art-kind ${a.kind}">${a.kind === 'skill' ? '技' : '軍略'}</span>${borrowed ? '<span class="dim small">借り物（気力が多くかかる）</span>' : ''}</div>
    ${mpBarHtml(cost, max, before)}
    <ul class="art-lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

/** 前と後の技・軍略から、新しく使えるもの（細かく）・使えなくなるもの・そのまま使えるもの（畳む）を並べる */
function artsChangeHtml(before: Art[], after: Art[], maxBefore: number, maxAfter: number, title: string, taught: Taught[] = []): string {
  const visible = (a: Art): boolean => !(a.kind === 'skill' && (a.id.startsWith('atk:') || D.skills.find((s) => s.id === a.id)?.basic));
  const add = after.filter((a) => visible(a) && !before.some((b) => sameArt(a, b)));
  const gone = before.filter((a) => visible(a) && !after.some((b) => sameArt(a, b)));
  const keep = after.filter((a) => visible(a) && before.some((b) => sameArt(a, b)));
  const nm = (a: Art): string => esc(artName(a.id, a.kind));
  return `<div class="cc-arts">
    ${add.length ? `<h3>${esc(title)}</h3>${add.map((a) => artCard(a, maxAfter, maxBefore, true, taught)).join('')}` : '<p class="dim small">新しく覚える技・軍略はありません。</p>'}
    ${gone.length ? `<p class="warn small">使えなくなる：${gone.map(nm).join('・')}</p>` : ''}
    ${keep.length ? `<details class="art-keep"><summary>今までの技・軍略（${keep.length}つ）の気力</summary>${keep.map((a) => artCard(a, maxAfter, maxBefore, false, taught)).join('')}</details>` : ''}
  </div>`;
}

/** 武将が役職を進めたときの技・軍略（役職の軍略・持ち越し・教わったもの） */
export function generalArtsHtml(g: GGeneral, to: string, title = '新しく使えるようになる技・軍略'): string {
  const a = D.byClass[g.classId], b = D.byClass[to];
  if (!a || !b) return '';
  return artsChangeHtml(artsOfGeneral(g), artsOfGeneral({ ...g, classId: to }), g.stats.mp + classMod(a).mp, g.stats.mp + classMod(b).mp, title, g.taught);
}

/** 兵が兵種を進めたときの技・軍略 */
export function troopArtsHtml(t: GTroop, to: string, title = '新しく使えるようになる技・軍略'): string {
  const a = D.byUnit[t.unitId], b = D.byUnit[to];
  if (!a || !b) return '';
  return artsChangeHtml(artsOfTroop(t), artsOfTroop({ ...t, unitId: to }), t.stats.mp, t.stats.mp + b.mp - a.mp, title, t.taught);
}
