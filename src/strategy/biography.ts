// 将の列伝：hist-sim の人物の記録（生まれ・家・親子・在位・役職・縁）、すでに起きた史実の出来事、シナリオの解説記事、
// この国モードの記録から、その人物にかかわるものを集める。これから起きる史実の出来事は出さない（先が分かってしまうため）。

import { BOONS } from '../convert/heroes';
import { D, L } from '../data/db';
import { yearOf, type HWorld, type NotableRole, type TieKind } from '../bridge/histsim';
import type { GGeneral } from '../convert/model';
import type { Campaign } from './campaign';
import { eventMonth, historyText, type HEvent } from './history';

export const ROLE_NAME: Record<NotableRole, string> = {
  general: '武人', minister: '文官', scholar: '学者', artist: '芸術家', saint: '聖人', prophet: '預言者', rebel: '反逆者', hero: '豪傑', explorer: '探検家', seer: '占い師',
};
/** 縁の呼び名（hist-sim の画面と同じ。縁の種類は「自分の立場」なので、相手の呼び名は逆になる：lord＝自分が主君＝相手は家臣） */
export const TIE_NAME: Record<TieKind, string> = {
  mentor: '弟子', pupil: '師', friend: '友', sworn: '義兄弟', rival: '宿敵', love: '想い人', companion: '生涯の友',
  betrayed: '裏切った相手', betrayed_by: '裏切られた相手', avenge: '仇', lord: '家臣', servant: '主君', spouse: '伴侶',
};

export interface Biography {
  /** 生まれ・家・役目・名声など */
  facts: string[];
  /** 親・配偶者・子 */
  family: string[];
  /** 在位 */
  reigns: string[];
  /** 縁（hist-sim の記録と、hex-sim の武将どうしの縁） */
  ties: string[];
  /** すでに起きた史実の出来事のうち、この人物の名が出るもの（年と本文） */
  events: { year: string; text: string }[];
  /** シナリオの解説記事のうち、この人物の名が出るもの */
  articles: { title: string; text: string }[];
}

interface Scenario { data?: { events?: HEvent[]; articles?: Record<string, { title: { ja: string }; body: { ja: string } }>; bc?: boolean }; fired?: Record<string, number>; nationOf?: Record<string, number> }

const yearLabel = (y: number): string => (y <= 0 ? `前${1 - y}年` : `${y}年`);
/** [[p:名|見出し]] などの印を外す */
const plain = (s: string): string => s.replace(/\[\[\w+:([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_m, name: string, label?: string) => label ?? name);

export function biography(c: Campaign, g: GGeneral): Biography {
  const w = c.world as HWorld, gs = c.gs;
  const rec = g.pid !== undefined ? w.people?.[g.pid] : undefined;
  const nameOf = (pid: number): string => w.people?.[pid]?.p.name?.ja ?? '名の伝わらない人';
  const nationName = (id: number): string => { const n = w.nations?.[id]; return n ? (n.label ?? n.root).ja : '今は無い国'; };
  const facts: string[] = [], family: string[] = [], reigns: string[] = [], ties: string[] = [];

  // 生まれと家
  const bornYear = gs.year - g.age;
  facts.push(`${yearLabel(bornYear)}ごろの生まれ（${g.age}歳）${g.house.ja ? `、${g.house.ja}の家` : ''}${g.sex === 'f' ? '・女性' : ''}。`);
  if (g.isLord) facts.push(`${gs.factions[g.faction]?.name.ja ?? ''}の当主。`);
  else if (g.role === 'heir') facts.push(`${gs.factions[g.faction]?.name.ja ?? ''}の跡継ぎ。`);
  else if (g.faction) facts.push(`${gs.factions[g.faction]?.name.ja ?? ''}に仕える。`);
  else facts.push('どこにも仕えていない浪人。');
  // 名将（P102）
  if (g.hero?.boon && BOONS[g.hero.boon]) facts.push(`名将：天佑「${L(BOONS[g.hero.boon].name)}」を持つ（${BOONS[g.hero.boon].story}）${g.hero.skill && D.bySkill[g.hero.skill] ? `特別技「${L(D.bySkill[g.hero.skill].name)}」。` : ''}${g.hero.tactic && D.byTactic[g.hero.tactic] ? `特別軍略「${L(D.byTactic[g.hero.tactic].name)}」。` : ''}`);
  if (rec?.role) facts.push(`${ROLE_NAME[rec.role]}として名を知られる（名声${rec.fame}）。`);
  if (g.office?.ja) facts.push(`役職：${g.office.ja}。`);

  if (rec) {
    if (rec.parents.length) family.push(`親：${rec.parents.map(nameOf).join('・')}`);
    if (rec.spouses.length) family.push(`配偶者：${rec.spouses.map(nameOf).join('・')}`);
    if (rec.children.length) family.push(`子：${rec.children.map(nameOf).join('・')}`);
    for (const r of rec.reigns) {
      const from = yearLabel(yearOf(w, r.from)), to = r.to < 0 ? '今' : yearLabel(yearOf(w, r.to));
      reigns.push(`${nationName(r.nation)}の当主（${from}〜${to}）`);
    }
    for (const t of rec.ties ?? []) {
      if (t.settled) continue;
      ties.push(`${TIE_NAME[t.kind] ?? t.kind}：${nameOf(t.with)}${t.note?.ja ? `（${plain(t.note.ja)}）` : ''}`);
    }
  }
  for (const t of g.ties) {
    const o = gs.generals[t.with];
    const line = o ? `${TIE_NAME[t.kind] ?? t.kind}：${o.name.ja}` : '';
    if (line && !ties.some((x) => x.startsWith(line))) ties.push(line);
  }

  // 史実の出来事（すでに起きたものだけ）と、解説記事
  const sc = (w as unknown as { scenario?: Scenario }).scenario;
  const mark = `[[p:${g.name.ja}`;
  const events: Biography['events'] = [], articles: Biography['articles'] = [];
  if (sc?.data) {
    const now = gs.year * 12 + gs.month, done = new Set(c.history.done);
    for (const ev of sc.data.events ?? []) {
      if (!ev.ja.includes(mark)) continue;
      const happened = ev.id in (sc.fired ?? {}) || (done.has(ev.id) && eventMonth(sc, ev) <= now && (c.history.from === undefined || eventMonth(sc, ev) >= c.history.from));
      if (!happened) continue;
      const y = sc.data.bc ? 1 - ev.y : ev.y;
      events.push({ year: yearLabel(y), text: historyText(c, ev, sc.nationOf ?? {}) });
    }
    events.sort((a, b) => parseYear(a.year) - parseYear(b.year));
    for (const a of Object.values(sc.data.articles ?? {})) {
      if (!a.body?.ja?.includes(mark)) continue;
      // その人物の名が出る段落を抜き出す
      const para = a.body.ja.split('\n').find((s) => s.includes(mark)) ?? a.body.ja;
      articles.push({ title: a.title.ja, text: plain(para) });
    }
  }
  return { facts, family, reigns, ties, events, articles };
}

function parseYear(s: string): number {
  const m = /^(前)?(\d+)年/.exec(s);
  return m ? (m[1] ? 1 - Number(m[2]) : Number(m[2])) : 0;
}
