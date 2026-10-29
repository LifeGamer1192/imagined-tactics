// 図鑑（P90・P91）：兵種の対応表・役職・昇格の系図・技・軍略・地形と天気・特性・レベル。タイトル画面の「図鑑」から開く（遊び方の案内と同じ重ね表示）。
// 数はすべて data/system の正本から作る（データを変えれば図鑑も変わる。手で直す所は無い）。名前に乗せると、遊び方と同じ説明の小窓が出る。

import { artUrl } from '../art/art';
import { busy } from './busy';
import { D, westName } from '../data/db';
import type { ClassDef, Loc, SkillDef, TacticDef, UnitDef } from '../data/types';
import { classMod, generalExpToNext, troopExpToNext } from '../rules/growth';
import { MARK, statusEffect, skillTip, TACTIC_KIND, tacticTip, traitTip, unitTip, classTip } from './describe';
import { fieldTable, terrainTable } from './help';
import { AFFINITY_NAME, STATUS_NAME, T, TRAIT_NAME } from './text';

type Tab = 'units' | 'classes' | 'tree' | 'skills' | 'tactics' | 'terrain' | 'traits' | 'levels';
const TABS: [Tab, string][] = [['units', '兵種の対応表'], ['classes', '役職'], ['tree', '昇格の系図'], ['skills', '技'], ['tactics', '軍略'], ['terrain', '地形・天気'], ['traits', '特性'], ['levels', 'レベル']];
type Ver = 'jp' | 'cn';

const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
/** 系統の呼び名（docs/20 と同じ） */
const LINE: Record<number, string> = {
  1: '槍の歩兵', 2: '鼓舞（楽隊）', 3: '小舟', 4: '鉄砲・弩・投石', 5: '忍び・刺客', 6: '弓', 7: '軽騎兵', 8: '回復',
  9: '盾', 10: '城攻め', 11: '大刀・斧', 12: '山岳', 13: '騎馬武者・戦車・重騎兵', 14: '伏兵', 15: '火攻め', 16: '大船', 17: '指揮', 18: '調略',
};
const TIER = ['', '下級', '中級', '上級'];
/** 軍略の種類の短い呼び名（表の欄が細いので） */
const KIND_SHORT: Record<string, string> = { damage: '攻撃', heal: '回復', cure: '治療', mpRestore: '気力回復', buff: '強化', debuff: '弱化', status: '状態', dispel: '打ち消し', pull: '引き寄せ', revive: '立て直し', displace: '飛ばす' };

let back: HTMLElement | null = null;
let tab: Tab = 'units';
let ver: Ver = 'jp';
let query = '';
let pickClass = 'ashigaru', pickUnit = 'u01a';

const nm = (n: Loc): string => n[ver];
const hit = (...names: string[]): boolean => !query || names.some((x) => x.includes(query));
const pic = (set: string, id: string): string => { const u = artUrl(`unit/${set}/${id}`); return u ? `<img src="${u}" alt="" loading="lazy">` : '<span class="dim small">絵なし</span>'; };

// ------------------------------------------------------------ 兵種の対応表

function unitsPage(): string {
  const out = ['<p class="small">同じ番号の兵種は、名前と絵が違うだけで、能力・技・軍略・昇格はすべて同じ。どの名前で出るかは世界で決まる（日本の戦国は日本版、中国の世界は中国版、ローマは西洋版）。名前に乗せる（指なら押す）と説明が出る。</p>'];
  const lines = [...new Set(D.units.map((u) => u.line))].sort((a, b) => a - b);
  for (const line of lines) {
    const us = D.units.filter((u) => u.line === line && hit(u.name.jp, u.name.cn, westName(u.id) ?? '', u.id));
    if (!us.length) continue;
    out.push(`<h3>系統${line}：${esc(LINE[line] ?? '')}</h3><div class="scroll"><table class="zk-units">
      <tr><th>番号</th><th>格</th><th>日本版</th><th>中国版</th><th>西洋版</th><th>体力</th><th>武力</th><th>知略</th><th>機敏</th><th>防御</th><th>移動</th><th>得意</th><th>采配</th><th>昇格先</th></tr>
      ${us.map((u) => `<tr>
        <td>${u.id}</td><td>${TIER[u.tier] ?? u.tier}</td>
        ${(['jp', 'cn', 'west'] as const).map((s) => `<td class="zk-pic" data-tip="${esc(unitTip(u.id))}">${pic(s, u.id)}<br>${esc(s === 'west' ? westName(u.id) ?? '' : u.name[s])}</td>`).join('')}
        <td>${u.hp}</td><td>${u.str}</td><td>${u.int}</td><td>${u.agi}</td><td>${u.def}</td><td>${u.move}</td><td>${AFFINITY_NAME[u.affinity] ?? u.affinity}</td><td>${u.cost}</td>
        <td class="zk-left">${(u.promote ?? []).filter((p) => D.byUnit[p.to]).map((p) => `${esc(nm(D.byUnit[p.to].name))}${p.lv ? ` Lv${p.lv}` : ''}${p.item ? `・品「${esc(D.items[p.item]?.jp ?? p.item)}」` : ''}`).join('<br>') || '—'}</td>
      </tr>`).join('')}</table></div>`);
  }
  return out.length > 1 ? out.join('') : `${out[0]}<p>当てはまる兵種がありません。</p>`;
}

// ------------------------------------------------------------ 技表

/** 技・軍略を持つもの（兵種と役職） */
function holders(id: string, kind: 'skill' | 'tactic'): string {
  const us = D.units.filter((u) => (kind === 'skill' ? u.skills : u.tactics).includes(id)).map((u) => nm(u.name));
  const cs = kind === 'tactic' ? D.classes.filter((c) => c.tactics.includes(id)).map((c) => nm(c.name)) : [];
  const all = [...cs.map((x) => `将：${x}`), ...us];
  return all.length ? esc(all.join('・')) : '<span class="dim">—</span>';
}

function skillsPage(): string {
  const shape = (s: SkillDef): string => s.shape.type === 'around' ? `周り${s.shape.n}` : s.shape.type === 'line' ? `直線${s.shape.n}` : '1体';
  const rng = (s: SkillDef): string => s.range[0] === s.range[1] ? `${s.range[1]}` : `${s.range[0]}〜${s.range[1]}`;
  // 効果の行：説明の小窓から、表の欄に無いもの（状態・回復・押し出しなど）だけ
  const extra = (s: SkillDef): string => skillTip(s).split('\n').filter((l) => /当たると|回復|押し出|会心|気力を半分|装填|水の上|巻き込む/.test(l)).join('、');
  const list = D.skills.filter((s) => hit(s.name.jp, s.name.cn, s.id)).sort((a, b) => Number(b.basic) - Number(a.basic) || a.id.localeCompare(b.id));
  if (!list.length) return '<p>当てはまる技がありません。</p>';
  const row = (s: SkillDef): string => `<tr>
    <td class="zk-left" data-tip="${esc(skillTip(s))}">${esc(nm(s.name))}</td><td>${s.basic ? '通常攻撃' : '技'}</td>
    <td>${s.noDamage ? '—' : s.power}</td><td>${s.hit ? (s.hit > 0 ? '+' : '') + s.hit : '±0'}</td><td>${s.mp || '—'}</td><td>${rng(s)}</td><td>${shape(s)}</td>
    <td>${MARK[s.vsGround] ?? s.vsGround}</td><td>${MARK[s.vsRider] ?? s.vsRider}</td><td>${s.afterMove ? '○' : '×'}</td><td>${s.counter ? '○' : '—'}</td>
    <td class="zk-left zk-fx">${esc(extra(s)) || '—'}</td><td class="zk-left zk-who">${holders(s.id, 'skill')}</td></tr>`;
  return `<p class="small">威力は技の強さ、命中は命中率への上乗せ、射程はマスの数。地上・騎馬は、地上の相手・騎馬の相手への効き方。「移動後」は動いたあとに使えるか、「反撃」は反撃に使うか。名前に乗せると説明が出る。武将の通常攻撃は役職ごとに決まり、ここには無い（役職の説明を参照）。</p>
    <div class="scroll"><table><tr><th>名前</th><th>種類</th><th>威力</th><th>命中</th><th>気力</th><th>射程</th><th>範囲</th><th>地上</th><th>騎馬</th><th>移動後</th><th>反撃</th><th>効果</th><th>持つ兵種</th></tr>${list.map(row).join('')}</table></div>`;
}

// ------------------------------------------------------------ 軍略表

function tacticsPage(): string {
  const where = (t: TacticDef): string => t.range === null ? (t.area ? `周り${t.area}` : '全体・自分') : t.area ? `射程${t.range}・半径${t.area}` : `射程${t.range}・1体`;
  const effect = (t: TacticDef): string => {
    const xs: string[] = [];
    const st = t.status && typeof t.status === 'object' ? t.status : null;
    if (st) xs.push(`${st.chance}%で${STATUS_NAME[st.status] ?? st.status}（${statusEffect(st.status).replace(/。$/, '')}）`);
    else if (typeof t.status === 'string') xs.push(`${STATUS_NAME[t.status] ?? t.status}${t.kind === 'status' && !t.sure ? '（知略しだい）' : ''}（${statusEffect(t.status).replace(/。$/, '')}）`);
    if (t.kind === 'mpRestore' && t.amount) xs.push(`気力を${t.amount}回復`);
    if (t.kind === 'cure') xs.push('悪い状態を治す');
    if (t.kind === 'dispel') xs.push('強化・弱化を消す');
    if (t.friendlyFire) xs.push('味方も巻き込む');
    return xs.join('、');
  };
  const kinds = Object.keys(TACTIC_KIND);
  const list = D.tactics.filter((t) => hit(t.name.jp, t.name.cn, t.id, TACTIC_KIND[t.kind] ?? '')).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.mp - b.mp);
  if (!list.length) return '<p>当てはまる軍略がありません。</p>';
  const row = (t: TacticDef): string => `<tr>
    <td class="zk-left" data-tip="${esc(tacticTip(t))}">${esc(nm(t.name))}</td><td>${esc(KIND_SHORT[t.kind] ?? TACTIC_KIND[t.kind] ?? t.kind)}</td><td>${t.mp}</td><td>${t.power || '—'}</td><td>${where(t)}</td>
    <td class="zk-left zk-fx">${esc(effect(t)) || '—'}</td><td class="zk-left zk-who">${holders(t.id, 'tactic')}</td></tr>`;
  return `<p class="small">気力は1回に使う気力（教わったばかりの借り物は多くかかる）。威力は知略が高いほど強い。軍略は外れない（状態が付くかだけが確率）。「将：」は、その役職の武将が使える。名前に乗せると説明が出る。</p>
    <div class="scroll"><table><tr><th>名前</th><th>種類</th><th>気力</th><th>威力</th><th>対象</th><th>効き目</th><th>使える役職・兵種</th></tr>${list.map(row).join('')}</table></div>`;
}

// ------------------------------------------------------------ 役職表（P91）

const sg = (v: number): string => `${v > 0 ? '+' : ''}${v}`;
const UNIQUE: Record<string, string> = { lord: '当主だけ', feature: '特別' };

/** なる条件（どの役職から、何が要るか） */
function reqText(c: ClassDef): string {
  const req = Object.entries(c.req).filter(([, v]) => v).map(([k, v]) => `${k === 'lv' ? 'Lv' : k === 'mastery' ? '熟練' : T[k as 'str' | 'int' | 'agi']()}${v}`);
  if (!c.from) return c.unique === 'lord' ? '当主になると' : '始めから';
  return `${esc(nm(D.byClass[c.from]?.name ?? { jp: c.from, cn: c.from }))}から${req.length ? `（${req.join('・')}）` : ''}`;
}

function classesPage(): string {
  const groups: [string, ClassDef[]][] = [['一般の役職', D.classes.filter((c) => !c.unique)], ['当主の役職', D.classes.filter((c) => c.unique === 'lord')], ['特別な役職', D.classes.filter((c) => c.unique === 'feature')]];
  const out = ['<p class="small">武将の役職。通常攻撃・防御・移動・得意な地形は役職で決まり、能力（体力・気力・武力・知略・機敏）には役職の加減が足される（上の格ほど体力・気力が多い）。軍略は、その役職でいるあいだ使える（熟練度が上限になると、役職を変えても持ち越せる）。名前に乗せると説明が出る。</p>'];
  for (const [title, cs0] of groups) {
    const cs = cs0.filter((c) => hit(c.name.jp, c.name.cn, c.id));
    if (!cs.length) continue;
    out.push(`<h3>${title}</h3><div class="scroll"><table><tr><th>名前</th><th>格</th><th>通常攻撃</th><th>防御</th><th>移動</th><th>得意</th><th>${T.hp()}</th><th>${T.mp()}</th><th>${T.str()}</th><th>${T.int()}</th><th>${T.agi()}</th><th>軍略</th><th>なる条件</th></tr>
      ${cs.map((c) => { const m = classMod(c); const a = c.attack; return `<tr>
        <td class="zk-left" data-tip="${esc(classTip(c.id))}">${esc(nm(c.name))}${c.sex === 'f' ? '<span class="dim small">（女）</span>' : ''}</td><td>${TIER[c.tier] ?? c.tier}${c.unique ? `<br><span class="dim small">${UNIQUE[c.unique] ?? ''}</span>` : ''}</td>
        <td>${a.kind === 'bow' ? '飛び道具' : '近接'} 威${a.power}<br><span class="dim small">射程${a.range[0] === a.range[1] ? a.range[1] : `${a.range[0]}〜${a.range[1]}`}</span></td><td>${c.def}</td><td>${c.move}</td><td>${AFFINITY_NAME[c.affinity] ?? c.affinity}</td>
        ${(['hp', 'mp', 'str', 'int', 'agi'] as const).map((k) => `<td>${m[k] ? sg(m[k]) : '±0'}</td>`).join('')}
        <td class="zk-left zk-fx">${c.tactics.map((id) => D.byTactic[id] ? `<span data-tip="${esc(tacticTip(D.byTactic[id]))}">${esc(nm(D.byTactic[id].name))}</span>` : esc(id)).join('・') || '—'}</td>
        <td class="zk-left">${reqText(c)}</td></tr>`; }).join('')}</table></div>`);
  }
  return out.length > 1 ? out.join('') : `${out[0]}<p>当てはまる役職がありません。</p>`;
}

// ------------------------------------------------------------ 昇格の系図（P91）

function treePage(): string {
  const out = ['<p class="small">左から右へ、昇格（兵）・昇進（武将）の道すじ。矢印の上は要るもの（レベル・品・熟練）。枝分かれは、どちらか1つを選ぶ。名前に乗せると説明が出る。</p>'];
  // 兵：系統ごとに、下級の兵種から木をたどる
  const unitNode = (u: UnitDef, seen: Set<string>): string => {
    if (seen.has(u.id)) return '';
    seen.add(u.id);
    const kids = (u.promote ?? []).filter((p) => D.byUnit[p.to]);
    const me = `<span class="zk-node" data-tip="${esc(unitTip(u.id))}">${pic('jp', u.id)}<b>${esc(nm(u.name))}</b><span class="dim small">${TIER[u.tier]}</span></span>`;
    if (!kids.length) return `<div class="zk-branch">${me}</div>`;
    return `<div class="zk-branch">${me}<div class="zk-kids">${kids.map((p) => `<div class="zk-kid"><span class="zk-arrow">→<small>${[p.lv ? `Lv${p.lv}` : '', p.item ? `品「${esc(D.items[p.item]?.[ver] ?? p.item)}」` : ''].filter(Boolean).join('・') || ''}</small></span>${unitNode(D.byUnit[p.to], seen)}</div>`).join('')}</div></div>`;
  };
  const lines = [...new Set(D.units.map((u) => u.line))].sort((a, b) => a - b);
  const unitParts = lines.map((line) => {
    const us = D.units.filter((u) => u.line === line);
    if (query && !us.some((u) => hit(u.name.jp, u.name.cn, westName(u.id) ?? ''))) return '';
    const roots = us.filter((u) => !us.some((o) => (o.promote ?? []).some((p) => p.to === u.id)));
    const seen = new Set<string>();
    return `<div class="zk-tree"><div class="zk-line">系統${line}：${esc(LINE[line] ?? '')}</div>${roots.map((r) => unitNode(r, seen)).join('')}</div>`;
  }).filter(Boolean);
  if (unitParts.length) out.push('<h3>兵の昇格</h3>', ...unitParts);
  // 武将：下級の役職から昇進をたどる
  const classNode = (c: ClassDef): string => {
    const kids = D.classes.filter((k) => k.from === c.id);
    const me = `<span class="zk-node" data-tip="${esc(classTip(c.id))}"><b>${esc(nm(c.name))}</b><span class="dim small">${TIER[c.tier]}</span></span>`;
    if (!kids.length) return `<div class="zk-branch">${me}</div>`;
    return `<div class="zk-branch">${me}<div class="zk-kids">${kids.map((k) => { const req = Object.entries(k.req).filter(([, v]) => v).map(([n, v]) => `${n === 'lv' ? 'Lv' : n === 'mastery' ? '熟練' : T[n as 'str' | 'int' | 'agi']()}${v}`).join('・'); return `<div class="zk-kid"><span class="zk-arrow">→<small>${req}</small></span>${classNode(k)}</div>`; }).join('')}</div></div>`;
  };
  for (const [title, pick] of [['武将の昇進（一般の役職）', (c: ClassDef) => !c.unique], ['当主の役職', (c: ClassDef) => c.unique === 'lord'], ['特別な役職', (c: ClassDef) => c.unique === 'feature']] as const) {
    const roots = D.classes.filter((c) => pick(c) && (!c.from || !D.byClass[c.from]) && (!query || D.classes.some((k) => k.line === c.line && hit(k.name.jp, k.name.cn))));
    if (roots.length) out.push(`<h3>${title}</h3>`, `<div class="zk-tree">${roots.map(classNode).join('')}</div>`);
  }
  return out.length > 1 ? out.join('') : `${out[0]}<p>当てはまるものがありません。</p>`;
}

// ------------------------------------------------------------ 地形・天気（P91）

function terrainPage(): string {
  const W = D.combat.weather, sgn = (v: number): string => `${v > 0 ? '+' : ''}${v}`;
  const reg = Object.entries(D.terrain.regen).map(([k, v]) => `${k === 'camp' ? '陣' : k}：番の始めに最大${T.hp()}の${v}%を回復`);
  const perch = Object.entries(D.terrain.ranged).map(([k, v]) => `${k === 'tower' ? '櫓' : k === 'lookout' ? '物見櫓' : k}：射程2以上の技の命中${sgn(v.hit)}・射程+${v.range}`);
  const SEASON: Record<string, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
  const SKY: Record<string, string> = { clear: '晴れ', rain: '雨', fog: '霧', snow: '雪' };
  return `<p class="small">得意な地形（平地・森・山・湿地・水上・騎）ごとの数。兵種と役職の得意な地形は、兵種の対応表・役職のタブにある。</p>
    <h3>移動の手間</h3><p class="small">1マス進むのに使う移動力。×は入れない。</p>
    ${terrainTable((k, a) => { const v = D.terrain.moveCost[k][a]; return v === null ? '×' : String(v); })}
    <h3>命中・回避の補正</h3><p class="small">その地形に立つ駒の命中と回避（％ポイント。受ける側の回避は、攻める側の命中から引く）。</p>
    ${terrainTable((k, a) => sgn(D.terrain.hitMod[k][a]))}
    <h3>地形と天気で強まる・弱まる攻撃</h3><p class="small">ダメージの倍率。「相手がいる」は攻撃を受ける側のいる地形、「自分がいる」は攻める側のいる地形。</p>
    ${fieldTable()}
    <h3>特別なマス</h3><ul class="small">
      <li>要のマス（天守・砦の本丸・本陣）：立つ駒は防御+${D.combat.seatDefPct}%（攻め手でも守り手でも）。攻め手が押さえ続けると攻め手の勝ち。</li>
      ${reg.map((x) => `<li>${esc(x)}</li>`).join('')}${perch.map((x) => `<li>${esc(x)}</li>`).join('')}
      <li>門・柵：壊すまで通れない（攻め手は「壊す」で壊せる）。城壁：登るのに移動力が要り、騎馬は入れない。</li></ul>
    <h3>天気と夜</h3><ul class="small">
      <li>雨：射程2以上の技の命中${sgn(W.rainRangedHit)}、火の技・軍略の威力×${W.rainFireMult}</li>
      <li>霧：2マス以上離れた相手への命中${sgn(W.fogFarHit)}</li>
      <li>雪：移動の手間+${W.snowMoveCost}（雪に強い地形を除く）、戦いの巡の上限+${W.snowExtraRounds}</li>
      <li>夜：命中${sgn(W.nightHit)}（戦いの${Math.round(W.nightChance * 100)}%が夜）</li></ul>
    <h3>季節ごとの天気の出やすさ</h3><div class="scroll"><table><tr><th>季節</th>${Object.values(SKY).map((n) => `<th>${n}</th>`).join('')}</tr>
      ${Object.entries(W.odds).map(([s, o]) => { const sum = Object.values(o).reduce((a, b) => a + b, 0) || 1; return `<tr><th>${SEASON[s] ?? s}</th>${Object.keys(SKY).map((k) => `<td>${Math.round(((o as Record<string, number>)[k] ?? 0) / sum * 100)}%</td>`).join('')}</tr>`; }).join('')}</table></div>`;
}

// ------------------------------------------------------------ 特性（P91）

function traitsPage(): string {
  const ids = Object.keys(TRAIT_NAME).filter((t) => hit(TRAIT_NAME[t], t));
  if (!ids.length) return '<p>当てはまる特性がありません。</p>';
  const part = (lines: string[], head: string): string => lines.find((l) => l.startsWith(head))?.slice(head.length) ?? '';
  return `<p class="small">武将の人柄。戦場の効き目は、その将と配下のすべての兵に効く。「将だけ」は将本人に、「領の仕事」は国モードで効く。「戦い方」はコンピュータが動かすときの傾向。名前に乗せると説明が出る。</p>
    <div class="scroll"><table><tr><th>名前</th><th>あらまし</th><th>戦場（将と兵）</th><th>将だけ</th><th>領の仕事</th><th>戦い方</th></tr>
    ${ids.map((t) => { const ls = traitTip(t).split('\n'); return `<tr><td class="zk-left" data-tip="${esc(traitTip(t))}">${esc(TRAIT_NAME[t])}</td>
      <td class="zk-left zk-fx">${esc(ls[1] ?? '')}</td><td class="zk-left">${esc(part(ls, '戦場（将と配下のすべての兵に効く）：')) || '—'}</td><td class="zk-left">${esc(part(ls, '将だけ：')) || '—'}</td>
      <td class="zk-left">${esc(part(ls, '領の仕事：')) || '—'}</td><td class="zk-left">${esc(part(ls, '戦い方：').replace(/（敵の武将.*$/, '')) || '—'}</td></tr>`; }).join('')}</table></div>`;
}

// ------------------------------------------------------------ レベル表

function levelsPage(): string {
  const C = D.combat, curve = D.exp.curve.div;
  const classes = D.classes;
  const opt = (id: string, name: string, on: string): string => `<option value="${id}" ${id === on ? 'selected' : ''}>${esc(name)}</option>`;
  const MAX = 50;
  let cg = 0, cu = 0;
  const rows: string[] = [];
  for (let lv = 1; lv < MAX; lv++) {
    const g = generalExpToNext({ classId: pickClass, level: lv }), u = troopExpToNext({ unitId: pickUnit, level: lv });
    cg += g; cu += u;
    rows.push(`<tr><td>${lv} → ${lv + 1}</td><td>${(1 + (lv - 1) ** 2 / curve).toFixed(2)}</td><td>${g.toLocaleString()}</td><td class="dim">${cg.toLocaleString()}</td><td>${u.toLocaleString()}</td><td class="dim">${cu.toLocaleString()}</td></tr>`);
  }
  const c = D.byClass[pickClass], u = D.byUnit[pickUnit];
  return `<p class="small">次のレベルまでの経験値 ＝ K ×（1 ＋（いまのレベル − 1）² ÷ ${curve}）。K は役職・兵種ごと（当主の役職はみな同じ）。レベルに上限は無い。</p>
    <p class="small">経験値の入り方：技・軍略を使うと ${C.useExp}（回復は ${C.healExp}）、相手を倒すと相手の種類とレベルしだい、勝つと勝った側の駒すべてに +${C.winExp.rout}（敵の武将をみな退けた）か +${C.winExp.other}（要のマスを押さえた・守り切った）。武将は特性の「得る経験」で増減する。国モードでは訓練でも入る。</p>
    <p class="zk-pick">武将の役職 <select data-zk="class">${classes.map((x) => opt(x.id, nm(x.name), pickClass)).join('')}</select>
      兵種 <select data-zk="unit">${D.units.map((x) => opt(x.id, `${nm(x.name)}（${x.id}）`, pickUnit)).join('')}</select></p>
    <div class="scroll"><table class="zk-levels"><tr><th>Lv</th><th>倍率</th><th data-tip="${esc(classTip(c.id))}">${esc(nm(c.name))}：次まで</th><th>累計</th><th data-tip="${esc(unitTip(u.id))}">${esc(nm(u.name))}：次まで</th><th>累計</th></tr>${rows.join('')}</table></div>`;
}

const PAGES: Record<Tab, () => string> = { units: unitsPage, classes: classesPage, tree: treePage, skills: skillsPage, tactics: tacticsPage, terrain: terrainPage, traits: traitsPage, levels: levelsPage };

// ------------------------------------------------------------ 表示

/** 一度作った表は覚えておく（データは遊んでいるあいだ変わらない）。兵種の表は絵と説明が多く、作るのに時間がかかるため */
const made = new Map<string, string>();
const keyOf = (): string => `${tab}|${ver}|${query}|${tab === 'levels' ? `${pickClass}|${pickUnit}` : ''}`;
const cached = (): boolean => made.has(keyOf());

function render(keepScroll = false): void {
  if (!back) return;
  back.querySelector('nav')!.innerHTML = TABS.map(([id, name]) => `<button data-ztab="${id}" class="${id === tab ? 'on' : ''}">${name}</button>`).join('');
  back.querySelector<HTMLSelectElement>('[data-zk="ver"]')!.value = ver;
  const body = back.querySelector<HTMLElement>('.help-body')!;
  const top = body.scrollTop;
  const key = keyOf();
  if (!made.has(key)) made.set(key, PAGES[tab]());
  body.innerHTML = made.get(key)!;
  body.scrollTop = keepScroll ? top : 0;
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.stopPropagation(); e.preventDefault();
  closeZukan();
}

/** 開く。まだ作っていない表は、先に「図鑑を開いています…」を出してから作る（反応の無い時間を0.2秒以内に） */
export async function openZukan(to?: Tab): Promise<void> {
  if (!back) initZukan();
  tab = to ?? tab;
  if (cached()) render(); else await busy('図鑑を開いています…', () => render());
  back!.hidden = false;
  document.addEventListener('keydown', onKey, true);
  back!.querySelector<HTMLButtonElement>('.help-close')!.focus();
}

export function closeZukan(): void {
  if (!back || back.hidden) return;
  back.hidden = true;
  document.removeEventListener('keydown', onKey, true);
}

/** 重ね表示を document.body に付ける。画面の中の入口は data-zukan を付けたボタン（タイトル画面の「図鑑」） */
export function initZukan(): void {
  if (back) return;
  back = document.createElement('div');
  back.className = 'help-back zukan';
  back.hidden = true;
  back.innerHTML = `
    <div class="help" role="dialog" aria-modal="true" aria-label="図鑑">
      <header><b>図鑑</b><nav></nav><span class="spacer"></span><button type="button" class="help-close">閉じる</button>
        <div class="zk-tools"><label>名前 <select data-zk="ver"><option value="jp">日本版</option><option value="cn">中国版</option></select></label>
        <input type="search" data-zk="q" placeholder="名前で探す" aria-label="名前で探す"></div></header>
      <div class="help-body"></div>
    </div>`;
  back.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === back || el.closest('.help-close')) { closeZukan(); return; }
    const t = el.closest<HTMLElement>('[data-ztab]');
    // 表は大きいので、作り置きがあっても描き直しに時間がかかる。先に表示を出してから替える
    if (t) { tab = t.dataset.ztab as Tab; void busy(cached() ? '表を出しています…' : '表を作っています…', () => render()); }
  });
  back.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.zk === 'ver') ver = el.value as Ver;
    else if (el.dataset.zk === 'class') pickClass = el.value;
    else if (el.dataset.zk === 'unit') pickUnit = el.value;
    else return;
    render(true);
  });
  back.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.zk !== 'q') return;
    query = el.value.trim();
    render();
  });
  document.body.append(back);
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-zukan]');
    if (!el) return;
    const to = el.dataset.zukan as Tab;
    void openZukan(to in PAGES ? to : undefined);
  });
}
