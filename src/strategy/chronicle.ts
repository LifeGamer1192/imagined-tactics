// 年表（P57）：自分の家の歩みを書き留める（起った日・攻め取った領・奪われた領・滅ぼした家・開戦・同盟・停戦・本拠の移り・当主の交代・史実の出来事）。
// 天下を統一したときに、年表と功臣を発表する。記録（c.log）はセーブで直近だけに切り詰めるので、年表は別に持つ。

import type { Campaign, CampaignLog } from './campaign';

export type ChronKind = 'start' | 'capture' | 'lost' | 'fall' | 'war' | 'ally' | 'truce' | 'capital' | 'lord' | 'history' | 'unify';
export interface ChronEntry { year: number; month: number; kind: ChronKind; text: string; provs?: number }
/** 武将ごとの戦の数・勝った数・倒した敵将の数（功臣を決める） */
export interface Feat { battles: number; wins: number; foes: number }

const dateOf = (c: Campaign): { year: number; month: number } => ({ year: c.gs.year, month: c.gs.month });
const myProvs = (c: Campaign): number => c.gs.provinces.filter((p) => p.owner === c.player && !p.out).length;

export function chron(c: Campaign, kind: ChronKind, text: string): void {
  if (!c.player) return;
  (c.chronicle ??= []).push({ ...dateOf(c), kind, text, provs: myProvs(c) });
}

/** 家が起った日（年表が無いときだけ） */
export function startChronicle(c: Campaign): void {
  const me = c.gs.factions[c.player];
  if (!me || c.chronicle?.length) return;
  const cap = c.gs.provinces[me.capital];
  chron(c, 'start', `${me.name.ja}、${cap?.name.ja ?? ''}を本拠に、${myProvs(c)}の領をもって天下をめざす`);
}

/** 記録の1件から、自分の家に関わるものを年表へ写す（note から呼ぶ） */
export function chronFromLog(c: Campaign, e: CampaignLog): void {
  const me = c.gs.factions[c.player]?.name.ja;
  if (!me) return;
  const v = e.vars, s = (k: string): string => String(v[k] ?? '');
  switch (e.key) {
    case 'capture':
      if (s('faction') === me) chron(c, 'capture', `${s('prov')}を${s('from') || '在地の兵'}から攻め取る`);
      else if (s('from') === me) chron(c, 'lost', `${s('prov')}を${s('faction')}に奪われる`);
      break;
    case 'chainCapture':
      if (s('faction') === me) chron(c, 'capture', `勢いに乗り、${s('from')}の${s('provs')}も一気に取る`);
      else if (s('from') === me) chron(c, 'lost', `${s('faction')}の勢いに押され、${s('provs')}も失う`);
      break;
    case 'fall':
      if (s('by') === me) chron(c, 'fall', `${s('faction')}を滅ぼす`);
      break;
    case 'war':
      if (s('a') === me) chron(c, 'war', `${s('b')}に戦を仕掛ける`);
      else if (s('b') === me) chron(c, 'war', `${s('a')}が攻めかかってくる`);
      break;
    case 'alliance':
      if (s('a') === me || s('b') === me) chron(c, 'ally', `${s('a') === me ? s('b') : s('a')}と同盟を結ぶ`);
      break;
    case 'truce':
      if (s('a') === me || s('b') === me) chron(c, 'truce', `${s('a') === me ? s('b') : s('a')}と停戦する`);
      break;
    case 'vassal':
      if (s('lord') === me) chron(c, 'ally', `${s('faction')}が従属する`);
      break;
    case 'capitalMoved':
      if (s('faction') === me) chron(c, 'capital', `本拠を${s('prov')}へ移す`);
      break;
    case 'succeed': case 'newLord':
      if (s('faction') === me) chron(c, 'lord', `${s('name')}が当主となる`);
      break;
    case 'history':
      if (s('text') && (String(v.text).includes(me) || v.choice)) chron(c, 'history', String(v.text));
      break;
  }
}

/** 戦の結果を功臣の記録に足す（自分の家の武将だけ） */
export function addFeats(c: Campaign, ids: string[], won: boolean, foesBeaten: number): void {
  if (!c.player) return;
  const f = (c.feats ??= {});
  for (const id of ids) {
    const g = c.gs.generals[id];
    if (!g || g.faction !== c.player) continue;
    const x = (f[id] ??= { battles: 0, wins: 0, foes: 0 });
    x.battles++;
    if (won) { x.wins++; x.foes += foesBeaten; }
  }
}

/** 統一までの年月（「◯年◯か月」） */
export function spanText(c: Campaign): string {
  const s = c.chronicle?.[0], e = dateOf(c);
  if (!s) return `${c.months}か月`;
  const months = (e.year - s.year) * 12 + (e.month - s.month);
  const y = Math.floor(months / 12), m = months % 12;
  return y ? `${y}年${m ? `${m}か月` : ''}` : `${m}か月`;
}
