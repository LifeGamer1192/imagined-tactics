// 兵種・役職を進める（クラスチェンジ。P52）の見せ方：前と後の比べ表、確かめる窓の中身、祝いの窓の中身。
// 進める処理そのものは rules/growth.ts（promoteTroop・promoteGeneral）。

import type { GGeneral, GTroop } from '../convert/model';
import { D, L } from '../data/db';
import { classMod } from '../rules/growth';
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
