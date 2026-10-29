// 図鑑（P90）：兵種の対応表・技表・軍略表・レベル表。タイトル画面の「図鑑」から開く（遊び方の案内と同じ重ね表示）。
// 数はすべて data/system の正本から作る（データを変えれば図鑑も変わる。手で直す所は無い）。名前に乗せると、遊び方と同じ説明の小窓が出る。

import { artUrl } from '../art/art';
import { busy } from './busy';
import { D, westName } from '../data/db';
import type { Loc, SkillDef, TacticDef } from '../data/types';
import { generalExpToNext, troopExpToNext } from '../rules/growth';
import { MARK, statusEffect, skillTip, TACTIC_KIND, tacticTip, unitTip, classTip } from './describe';
import { AFFINITY_NAME, STATUS_NAME } from './text';

type Tab = 'units' | 'skills' | 'tactics' | 'levels';
const TABS: [Tab, string][] = [['units', '兵種の対応表'], ['skills', '技'], ['tactics', '軍略'], ['levels', 'レベル']];
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

const PAGES: Record<Tab, () => string> = { units: unitsPage, skills: skillsPage, tactics: tacticsPage, levels: levelsPage };

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
